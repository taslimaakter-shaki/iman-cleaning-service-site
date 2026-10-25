const crypto = require('crypto');
const store = () => require('./_shared');
const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });

async function assertCalendarReady() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw fail('Shared booking availability is not configured. Please contact our team.', 503);
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/iman_booking_calendar_version`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000)
  });
  if (!response.ok || await response.json() !== 2) throw fail('The shared calendar database update must be installed before booking.', 503);
}

function newReservation() {
  return { state: 'creating', attempt: crypto.randomUUID(), startedAt: new Date().toISOString() };
}

async function stripeSession(id, method = 'GET') {
  const secret = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
  if (!secret || !/^cs_[\w]+$/.test(id || '')) throw fail('Payment reservation could not be verified.', 503);
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}${method === 'POST' ? '/expire' : ''}`, {
    method, headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10000)
  });
  const data = await response.json();
  if (!response.ok) throw fail('Payment reservation could not be verified. Please try again.', 503);
  return data;
}

// Conditional PATCH prevents a stale webhook/retry from releasing a newer hold.
async function changeReservation(booking, reservation) {
  const previous = booking.estimate?.calendarReservation;
  const query = `?id=eq.${encodeURIComponent(booking.id)}&status=eq.New&select=*` +
    (previous?.attempt ? `&estimate->calendarReservation->>attempt=eq.${encodeURIComponent(previous.attempt)}` : '&estimate->calendarReservation->>attempt=is.null');
  const rows = await store().supabaseRequest(query, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ estimate: { ...booking.estimate, calendarReservation: reservation } })
  });
  if (!rows?.[0]) throw fail('This reservation changed. Please reopen your booking link.');
  return rows[0];
}

async function reserveBooking(bookingId, existingSession) {
  await assertCalendarReady();
  let booking = await store().getBooking(bookingId);
  if (booking) booking = await reconcileReservation(booking);
  if (!booking || booking.status !== 'New') throw fail('This booking is no longer awaiting payment.');
  const prior = booking.estimate?.calendarReservation;
  if (prior && ['creating', 'open'].includes(prior.state)) {
    if (existingSession && prior.sessionId === existingSession.id && existingSession.status === 'open') return booking;
    throw fail('A payment is already being prepared for this quote. Please reopen the link in a moment.');
  }
  await store().assertScheduleAvailable(booking.schedule, store().bookingDurationHours(booking), booking.id);
  const reservation = existingSession ? { ...newReservation(), state: 'open', sessionId: existingSession.id, expiresAt: new Date(existingSession.expires_at * 1000).toISOString() } : newReservation();
  return changeReservation(booking, reservation);
}

async function attachCheckout(bookingId, attempt, session) {
  const booking = await store().getBooking(bookingId);
  if (booking?.status !== 'New') return; // A fast payment webhook may already have confirmed it.
  if (booking.estimate?.calendarReservation?.attempt !== attempt) {
    await stripeSession(session.id, 'POST');
    throw fail('Your reservation changed. Please reopen the payment link.');
  }
  await changeReservation(booking, { ...booking.estimate.calendarReservation, state: 'open', sessionId: session.id, expiresAt: new Date(session.expires_at * 1000).toISOString() });
}

async function releaseExpiredSession(session) {
  if (session.status !== 'expired' || session.payment_status === 'paid') return;
  const id = session.metadata?.booking_id;
  if (!id) return;
  const booking = await store().getBooking(id);
  const held = booking?.estimate?.calendarReservation;
  if (booking?.status !== 'New' || held?.sessionId !== session.id) return;
  await changeReservation(booking, { ...held, state: 'released', releasedAt: new Date().toISOString() });
}

async function reconcileReservation(booking) {
  const held = booking.estimate?.calendarReservation;
  if (booking.status !== 'New' || held?.state !== 'open' || Date.parse(held.expiresAt) > Date.now()) return booking;
  try {
    const session = await stripeSession(held.sessionId);
    if (session.status === 'expired' && session.payment_status !== 'paid') {
      await releaseExpiredSession(session);
      return await store().getBooking(booking.id);
    }
    // Paid/processing and unverifiable sessions remain blocked until confirmed.
  } catch { /* Fail closed: never offer time while its payment status is unknown. */ }
  return booking;
}

async function expireBookingCheckout(bookingId) {
  const booking = await store().getBooking(bookingId);
  const held = booking?.estimate?.calendarReservation;
  if (booking?.status !== 'New' || !held || ['released', 'draft'].includes(held.state)) return;
  if (!held.sessionId) throw fail('A checkout is being prepared. Wait a moment before changing this quote.');
  let session = await stripeSession(held.sessionId);
  if (session.payment_status === 'paid' || session.status === 'complete') throw fail('Payment has already been received. Keep this booking unchanged.');
  if (session.status === 'open') session = await stripeSession(session.id, 'POST');
  await releaseExpiredSession(session);
}

async function cleanupCheckout(bookingId, attempt, session, error) {
  if (!bookingId || !attempt) return;
  const booking = await store().getBooking(bookingId);
  const held = booking?.estimate?.calendarReservation;
  if (booking?.status !== 'New' || held?.attempt !== attempt) return;
  if (session) {
    const expired = await stripeSession(session.id, 'POST');
    if (expired.status === 'expired') await changeReservation(booking, { ...held, state: 'released', sessionId: session.id });
  } else if (error?.statusCode >= 400 && error.statusCode < 500) {
    // A definite rejected creation cannot be paid. Network/5xx failures are
    // ambiguous, so retain the slot for review rather than risk a double booking.
    await changeReservation(booking, { ...held, state: 'released' });
  }
}

module.exports = { assertCalendarReady, newReservation, reserveBooking, attachCheckout, releaseExpiredSession, reconcileReservation, expireBookingCheckout, changeReservation, cleanupCheckout };
