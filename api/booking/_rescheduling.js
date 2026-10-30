const crypto = require('crypto');
const shared = require('./_shared');
const { stripePost, cancelRemainingAuthorization } = require('./_payments');
const VERSION = '2026-10-30-rescheduling-v1';
const POLICY = 'One approved reschedule at least 48 hours ahead is free. Rescheduling with less than 48 hours notice costs 10% of the booked cleaning price, including tax, separate from the cleaning payment. If that booking is later canceled, the 25% cancellation fee applies regardless of the new date, with paid late-rescheduling fees credited toward it. Second requests require direct contact and approval. Approved booking fees are charged to the payment method used for the 25% deposit.';
const fail = message => Object.assign(new Error(message), { statusCode: 409 });
function terms(booking, now = new Date()) {
  const state = booking.estimate?.rescheduling || {};
  const total = Number(booking.estimate?.payment?.cleaningPriceCents || booking.estimate?.payment?.totalCents || Math.round(Number(booking.estimate?.total || 0) * 100));
  const remaining = new Date(booking.schedule).getTime() - now.getTime();
  const late = !Number.isFinite(remaining) || remaining < 48 * 3600000;
  return { late, feeCents: late ? Math.round(total * .10) : 0, cancellationCents: Math.round(total * .25), count: Number(state.count || (state.previousSchedule ? 1 : 0)), state };
}
function cancellationProtection(booking) {
  const state = booking.estimate?.rescheduling || {};
  const credit = (state.fees || []).reduce((sum, fee) => sum + (fee.status === 'paid' ? Number(fee.amountCents || 0) : 0), 0);
  return { locked: Boolean(state.cancellationLocked), creditCents: credit, remainingCents: Math.max(0, Number(state.cancellationFeeCents || 0) - credit) };
}
// Compare the entire estimate and schedule so concurrent approvals, cancellations,
// or edits cannot overwrite a payment receipt or approve the same request twice.
async function save(booking, state, changes = {}) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw fail('Rescheduling requests are unavailable. Please call 929-232-1930.');
  const rows = await shared.supabaseRequest(`?id=eq.${encodeURIComponent(booking.id)}&status=eq.${encodeURIComponent(booking.status)}&schedule=eq.${encodeURIComponent(booking.schedule)}&estimate=eq.${encodeURIComponent(JSON.stringify(booking.estimate || {}))}&select=*`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...changes, estimate: { ...booking.estimate, rescheduling: state } })
  });
  if (!rows?.[0]) throw fail('This booking changed. Refresh before continuing.');
  return rows[0];
}
async function requestChange(booking, body, slot, now = new Date()) {
  const t = terms(booking, now);
  if (t.state.cancellationOperation) throw fail('Cancellation is already being processed.');
  if (!['Confirmed', 'Cleaner assigned'].includes(booking.status) || new Date(booking.schedule) <= now) throw fail('Please contact us about this appointment.');
  if (['pending', 'processing', 'declining'].includes(t.state.request?.status)) throw fail('Your request is already awaiting review. Please call or text us for updates.');
  if (t.count >= 1 && body.directContact !== true) throw fail('A second reschedule requires direct contact. Please call or text 929-232-1930.');
  if (body.acceptPolicy !== true || body.policyVersion !== VERSION || Number(body.feeCents) !== t.feeCents) throw fail('Review and accept the current rescheduling fee and payment terms.');
  if (slot.value === booking.schedule) throw fail('Choose a different appointment.');
  const request = { id: crypto.randomUUID(), status: 'pending', previousSchedule: booking.schedule, schedule: slot.value, label: slot.label, requestedAt: now.toISOString(), feeCents: t.feeCents, cancellationCents: t.cancellationCents, late: t.late, consent: POLICY, policyVersion: VERSION, acceptedAt: now.toISOString(), directContactConfirmed: body.directContact === true };
  return save(booking, { ...t.state, request });
}
async function stripeGet(id) {
  const key = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` } });
  const data = await response.json();
  if (!response.ok) throw fail('Could not verify the rescheduling payment. Retry approval.');
  return data;
}
async function decide(booking, requestId, decision) {
  let state = booking.estimate?.rescheduling || {};
  let req = state.request;
  if (state.cancellationOperation) throw fail('Cancellation is already being processed.');
  if (!req || req.id !== requestId) throw fail('Refresh the booking to see its latest request.');
  if (req.status === 'approved') return booking;
  if (!['Confirmed', 'Cleaner assigned'].includes(booking.status) || !['pending', 'processing', 'declining'].includes(req.status)) throw fail('This request can no longer be approved.');
  if (decision === 'decline') {
    booking = await save(booking, { ...state, request: { ...req, status: 'declining' } });
    state = booking.estimate.rescheduling; req = state.request;
    if (req.paymentIntentId) {
      let payment = await stripeGet(req.paymentIntentId);
      if (!['succeeded', 'canceled'].includes(payment.status)) {
        try { payment = await stripePost({ path: `payment_intents/${req.paymentIntentId}/cancel`, idempotencyKey: `reschedule-cancel-${req.id}`, params: {} }); }
        catch (error) { payment = await stripeGet(req.paymentIntentId); if (!['succeeded', 'canceled'].includes(payment.status)) throw error; }
      }
      if (payment.status === 'succeeded') await stripePost({ path: 'refunds', idempotencyKey: `reschedule-declined-refund-${req.id}`, params: { payment_intent: req.paymentIntentId, amount: req.feeCents } });
    }
    return save(booking, { ...state, fees: (state.fees || []).map(fee => fee.requestId === req.id ? { ...fee, status: 'refunded' } : fee), request: { ...req, status: 'declined', decidedAt: new Date().toISOString() } });
  }
  if (req.status === 'declining') throw fail('Complete the decline and refund before continuing.');
  if (decision !== 'approve') throw fail('Choose approve or decline.');
  if (booking.schedule !== req.previousSchedule) throw fail('The original appointment changed. Contact the customer.');
  const duration = Number(booking.estimate.calendarReservationHours || shared.bookingDurationHours(booking));
  await shared.assertScheduleAvailable(req.schedule, duration, booking.id);
  if (req.status === 'pending') {
    booking = await save(booking, { ...state, request: { ...req, status: 'processing' } });
    state = booking.estimate.rescheduling; req = state.request;
  }
  let intent;
  if (req.feeCents > 0) {
    const payment = booking.estimate.payment || {};
    if (!payment.stripeCustomerId || !payment.paymentMethodId) throw fail('The deposit payment method is not saved. The appointment has not moved; contact the customer to resolve payment.');
    if (!req.paymentIntentId) {
      intent = await stripePost({ path: 'payment_intents', idempotencyKey: `reschedule-create-${req.id}`, params: {
        amount: req.feeCents, currency: 'usd', customer: payment.stripeCustomerId, payment_method: payment.paymentMethodId,
        'payment_method_types[0]': 'card', description: `Late rescheduling fee for ${booking.id}`, receipt_email: booking.email,
        'metadata[payment_type]': 'late_rescheduling', 'metadata[booking_id]': booking.id, 'metadata[request_id]': req.id
      } });
      booking = await save(booking, { ...state, request: { ...req, paymentIntentId: intent.id } });
      state = booking.estimate.rescheduling; req = state.request;
    } else intent = await stripeGet(req.paymentIntentId);
    if (Number(intent.amount) !== req.feeCents || intent.currency !== 'usd' || intent.customer !== payment.stripeCustomerId || intent.payment_method !== payment.paymentMethodId || intent.metadata?.request_id !== req.id) throw fail('The fee payment details do not match the approved request.');
    if (intent.status === 'requires_confirmation') intent = await stripePost({ path: `payment_intents/${req.paymentIntentId}/confirm`, idempotencyKey: `reschedule-confirm-${req.id}`, params: { off_session: true } });
    if (intent.status !== 'succeeded' || Number(intent.amount_received) !== req.feeCents) throw fail('The fee has not been paid. The original appointment remains confirmed. Contact the customer about bank verification or a declined payment.');
  }
  // Reload after external payment; only the persisted intent is ever confirmed.
  booking = await shared.getBooking(booking.id); state = booking.estimate.rescheduling; req = state.request;
  if (req.status === 'approved') return booking;
  if (req.id !== requestId || req.status !== 'processing') throw fail('The request changed while payment was processing. Refresh its status.');
  const fees = [...(state.fees || [])];
  if (intent && !fees.some(f => f.requestId === req.id)) fees.push({ requestId: req.id, paymentIntentId: intent.id, amountCents: req.feeCents, status: 'paid', paidAt: new Date().toISOString() });
  const next = { ...state, fees, count: Number(state.count || (state.previousSchedule ? 1 : 0)) + 1, previousSchedule: booking.schedule, cancellationLocked: Boolean(state.cancellationLocked || req.late), cancellationFeeCents: Math.max(Number(state.cancellationFeeCents || 0), req.late ? req.cancellationCents : 0), request: { ...req, status: 'approved', decidedAt: new Date().toISOString() } };
  // Preserve a paid fee even if a slot is taken between availability check and save.
  booking = await save(booking, { ...state, fees });
  try { booking = await save(booking, next, { schedule: req.schedule, schedule_label: req.label }); }
  catch (error) { throw fail(`Fee payment is recorded, but the appointment needs review: ${error.message} Retry approval; the fee will not be charged again.`); }
  const followup = {};
  try { await cancelRemainingAuthorization({ booking, resetForReschedule: true }); }
  catch (error) { followup.authorizationError = shared.cleanText(error.message, 500); }
  try { await shared.updateBookingGoogleCalendar(booking, 'reschedule'); }
  catch (error) { followup.calendarError = shared.cleanText(error.message, 500); }
  if (Object.keys(followup).length) {
    const latest = await shared.getBooking(booking.id);
    booking = await save(latest, { ...latest.estimate.rescheduling, followup });
    await require('../_form-notifications').trySendFormSubmissionNotification({ source: 'Rescheduling approval', eventLabel: 'follow-up required', recordId: booking.id, fields: followup, summaryLines: ['The new appointment is confirmed. Review the balance authorization or calendar synchronization in CRM.'] }).catch(() => {});
  }
  return booking;
}
async function beginCancellation(booking, source) {
  const state = booking.estimate?.rescheduling || {};
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return booking;
  if (['processing', 'declining'].includes(state.request?.status)) throw fail('Resolve the rescheduling payment before canceling this booking.');
  if (state.cancellationOperation) {
    if (state.cancellationOperation.source !== source) throw fail('Retry the original cancellation before changing who canceled.');
    return booking;
  }
  return save(booking, { ...state, cancellationOperation: { source, startedAt: new Date().toISOString() } });
}
async function recordOwnerNotification(bookingId, requestId, delivery) {
  const booking = await shared.getBooking(bookingId);
  const state = booking?.estimate?.rescheduling;
  if (!state || state.request?.id !== requestId) return;
  return save(booking, { ...state, ownerNotifications: { ...(state.ownerNotifications || {}), [delivery.event]: delivery } });
}
module.exports = { VERSION, POLICY, terms, cancellationProtection, requestChange, decide, beginCancellation, recordOwnerNotification };
