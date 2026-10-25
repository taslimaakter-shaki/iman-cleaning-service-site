const db = require('./_additional-store');
const shared = require('./_shared');
const RATE = 8000, MAX_MINUTES = 749999;
const ORIGIN = 'https://www.imancleaningservice.com';
const idOf = value => typeof value === 'string' ? value : value?.id;
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
function duration(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minute${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ');
}
function timeInput(hours, minutes) {
  const valid = n => (typeof n === 'number' || typeof n === 'string' && /^\d+$/.test(n)) && Number.isSafeInteger(Number(n));
  if (!valid(hours) || !valid(minutes) || Number(hours) < 0 || Number(minutes) < 0 || Number(minutes) > 60) throw db.fail('Enter whole hours starting at 0 and minutes from 0 to 60.', 400);
  const total = Number(hours) * 60 + Number(minutes);
  if (!Number.isSafeInteger(total) || total < 1) throw db.fail('Choose at least 1 minute of additional work.', 400);
  if (total > MAX_MINUTES) throw db.fail('This amount exceeds the payment limit. Please contact our team.', 400);
  return { totalMinutes: total, amountCents: Math.round(total * RATE / 60) };
}
function brandName(brand) { return ({ amex: 'American Express', visa: 'Visa', mastercard: 'Mastercard', discover: 'Discover', diners: 'Diners Club', jcb: 'JCB', unionpay: 'UnionPay' })[brand] || 'Card'; }
function cardLabel(order) { return order.card_last4 ? `${brandName(order.card_brand)} ending in ${order.card_last4}` : 'No saved card'; }
function consentText(order) { return `I approve ${duration(order.total_minutes)} of additional cleaning labor for ${money(order.amount_cents)} and authorize IMAN Cleaning Service LLC to charge this amount now to my ${cardLabel(order)}. Additional work remains subject to team availability.`; }
async function stripe(path, params, key) {
  const secret = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
  if (!secret?.startsWith('sk_')) throw db.fail('Secure payment is unavailable. Please contact our team.', 503);
  const encoded = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) encoded.append(k, String(v));
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(params ? { body: encoded.toString() } : {}), signal: AbortSignal.timeout(18000)
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(db.fail('Payment needs attention. Please check the status before trying again.', response.status >= 500 ? 503 : 409), { stripeIntent: data?.error?.payment_intent, stripeCode: data?.error?.code });
  return data;
}
async function savedCard(customerId, methodId) {
  if (!customerId || !methodId) return null;
  const method = await stripe(`payment_methods/${encodeURIComponent(methodId)}`);
  if (method.type !== 'card' || idOf(method.customer) !== customerId || !/^\d{4}$/.test(method.card?.last4 || '')) throw db.fail('The saved card could not be verified. Please contact our team.', 409);
  return { stripe_customer_id: customerId, payment_method_id: method.id, card_brand: method.card.brand, card_last4: method.card.last4 };
}
function customerOrder(o) {
  if (!o) return null;
  return { id: o.id, revision: o.revision, status: o.status, hours: Math.floor(o.total_minutes / 60), minutes: o.total_minutes % 60,
    totalMinutes: o.total_minutes, amountCents: o.amount_cents, duration: duration(o.total_minutes), card: o.card_last4 ? cardLabel(o) : '',
    consent: o.card_last4 ? consentText(o) : '', approvedAt: o.approved_at, paidAt: o.paid_at, error: o.last_error || '' };
}
async function prepare(booking, body) {
  const { totalMinutes } = timeInput(body.hours, body.minutes);
  // Do not overlap a still-open payment from the previous checkout workflow.
  for (const legacy of booking.estimate?.additionalWork?.orders || []) {
    if (legacy.status === 'checkout_created' && legacy.checkoutSessionId) {
      const session = await stripe(`checkout/sessions/${encodeURIComponent(legacy.checkoutSessionId)}`);
      if (session.status !== 'expired' && session.payment_status !== 'paid') throw db.fail('An earlier additional-work payment is still open. Please contact our team before starting another.');
    }
  }
  const existing = body.orderId ? await db.get(body.orderId, booking.id) : null;
  if (body.orderId && !existing) throw db.fail('Additional-work request not found.', 404);
  const payment = booking.estimate?.payment || {};
  const customerId = existing?.stripe_customer_id || payment.stripeCustomerId;
  const card = await savedCard(customerId, existing?.payment_method_id || payment.paymentMethodId);
  return db.rpc('iman_additional_work_prepare', { p_booking_id: booking.id, p_input: {
    id: body.orderId || null, revision: body.revision || null, previous_id: body.previousId || null, total_minutes: totalMinutes,
    stripe_customer_id: customerId || null, payment_method_id: null, card_brand: null, card_last4: null, ...card
  } });
}
async function recordIntent(intent) {
  if (intent?.metadata?.payment_type !== 'additional_work_approval') return null;
  let order = await db.get(intent.metadata.additional_work_order_id);
  if (!order) throw db.fail('Additional-work order is missing.', 503);
  // Stale events from a canceled, superseded card approval must not change a new one.
  if (String(order.revision) !== intent.metadata.approval_revision || order.payment_intent_id !== intent.id) return order;
  const missingFailedCard = !intent.payment_method && ['requires_payment_method','canceled'].includes(intent.status);
  if (order.booking_id !== intent.metadata.parent_booking_id || Number(intent.amount) !== order.amount_cents || intent.currency !== 'usd' || idOf(intent.customer) !== order.stripe_customer_id || (!missingFailedCard && idOf(intent.payment_method) !== order.payment_method_id)) throw db.fail('Payment details do not match this approval.', 503);
  if (order.status === 'paid') return order;
  const status = ({ succeeded: 'paid', processing: 'processing', requires_action: 'requires_action', requires_payment_method: 'payment_failed', canceled: 'payment_failed', requires_confirmation: 'approved' })[intent.status];
  if (!status) throw db.fail('Payment status needs review.', 503);
  if (status === 'paid' && Number(intent.amount_received) !== order.amount_cents) throw db.fail('Received payment does not match the approved total.', 503);
  const patch = { status, ...(status === 'paid' ? { paid_at: new Date().toISOString() } : {}), last_error: status === 'payment_failed' ? 'Your card was not charged successfully. Update your card and approve again.' : status === 'requires_action' ? 'Your bank requires verification before payment can finish.' : null };
  try { order = await db.patch(order, patch, ['approved','processing','requires_action','payment_failed']); }
  catch (error) { const current = await db.get(order.id); if (current?.status === 'paid') return current; throw error; }
  return order;
}
async function notify(order) {
  const deliver = require('./_additional-notifications');
  for (const notice of await db.notices(order.id)) {
    const claimed = await db.claim(notice);
    if (!claimed) continue;
    let result;
    try { result = await deliver.send(claimed, notice.revision === order.revision ? order.status : 'payment_failed'); }
    catch { result = { status: 'uncertain', error: 'Delivery could not be confirmed. Check the provider before resending.' }; }
    // A crash here leaves "sending" for manual review; never automatically resend an ambiguous delivery.
    await db.finish(claimed, result);
  }
}
async function paymentResult(order, intent) {
  const publicKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
  const result = { order: customerOrder(order) };
  if (order.status === 'requires_action') {
    if (intent.next_action?.type === 'redirect_to_url') result.verificationUrl = intent.next_action.redirect_to_url.url;
    else if (publicKey.startsWith('pk_') && intent.client_secret) Object.assign(result, { publishableKey: publicKey, clientSecret: intent.client_secret });
  }
  return result;
}
async function payApproved(order, booking) {
  if (!order.approved_at || !['approved','processing','requires_action','payment_failed','paid'].includes(order.status)) throw db.fail('Review and approve the additional work first.');
  let intent;
  if (!order.payment_intent_id) {
    // Create WITHOUT confirming. Persist the ID before any possible charge.
    intent = await stripe('payment_intents', {
      amount: order.amount_cents, currency: 'usd', customer: order.stripe_customer_id, payment_method: order.payment_method_id,
      'payment_method_types[0]': 'card', capture_method: 'automatic', confirmation_method: 'automatic',
      description: `Additional work ${order.id} for booking ${booking.id}`, receipt_email: booking.email || undefined,
      'metadata[payment_type]': 'additional_work_approval', 'metadata[parent_booking_id]': booking.id,
      'metadata[additional_work_order_id]': order.id, 'metadata[approval_revision]': order.revision
    }, `additional-create-${order.id}-${order.revision}`);
    try { order = await db.patch(order, { payment_intent_id: intent.id }, ['approved']); }
    catch (error) {
      const current = await db.get(order.id);
      if (current?.revision !== order.revision || !current.payment_intent_id || !current.approved_at) throw error;
      order = current;
      // Another request may have persisted an older intent after Stripe's idempotency cache expired.
      // Only the intent already attached to this approval can ever be confirmed.
      intent = await stripe(`payment_intents/${encodeURIComponent(order.payment_intent_id)}`);
    }
  } else intent = await stripe(`payment_intents/${encodeURIComponent(order.payment_intent_id)}`);
  if (intent.status === 'requires_confirmation') {
    try {
      intent = await stripe(`payment_intents/${intent.id}/confirm`, {
        return_url: require('./_additional-work').additionalWorkUrl(booking, ORIGIN),
        ...(process.env.STRIPE_PUBLISHABLE_KEY ? { use_stripe_sdk: 'true' } : {})
      }, `additional-confirm-${order.id}-${order.revision}`);
    } catch (error) {
      // Reconcile the persisted intent after timeouts as well as declines; never create another charge.
      intent = await stripe(`payment_intents/${encodeURIComponent(order.payment_intent_id)}`);
      if (intent.status === 'requires_confirmation') {
        await notify(order);
        throw db.fail('Approval received. Payment has not been confirmed. Use Check payment status before trying again.', 503);
      }
    }
  }
  order = await recordIntent(intent);
  await notify(order);
  return paymentResult(order, intent);
}
async function approve(booking, order, body) {
  if (body.accepted !== true || body.revision !== order.revision) throw db.fail('Please review the current amount and authorize the charge.', 400);
  if (!order.approved_at) {
    const verified = await savedCard(order.stripe_customer_id, order.payment_method_id);
    if (!verified || verified.card_brand !== order.card_brand || verified.card_last4 !== order.card_last4) throw db.fail('The card changed. Review this offer again.');
  }
  order = await db.rpc('iman_additional_work_approve', { p_booking_id: booking.id, p_id: order.id, p_revision: order.revision, p_text: consentText(order) });
  return payApproved(order, booking);
}
async function reconcile(order, send = true) {
  if (!order.payment_intent_id) { if (send) await notify(order); return { order: customerOrder(order) }; }
  const intent = await stripe(`payment_intents/${encodeURIComponent(order.payment_intent_id)}`);
  order = await recordIntent(intent);
  if (send && order.approved_at) await notify(order);
  return paymentResult(order, intent);
}
async function changeCard(order) {
  if (!['draft','requires_action','payment_failed'].includes(order.status)) throw db.fail('Check the payment status before changing the card.');
  if (order.payment_intent_id) {
    let intent = await stripe(`payment_intents/${order.payment_intent_id}`);
    if (intent.status === 'succeeded' || intent.status === 'processing') { await recordIntent(intent); throw db.fail('This payment has already succeeded or is processing.'); }
    if (intent.status !== 'canceled') intent = await stripe(`payment_intents/${intent.id}/cancel`, {}, `additional-cancel-${order.id}-${order.revision}`);
    if (intent.status !== 'canceled') throw db.fail('The previous payment must be canceled before changing cards.');
  }
  return db.patch(order, { status: 'draft', revision: order.revision + 1, approved_at: null, approval_text: null, payment_intent_id: null, setup_session_id: null, payment_method_id: null, card_brand: null, card_last4: null, last_error: null }, order.payment_intent_id ? ['requires_action','payment_failed'] : ['draft']);
}
async function setupCard(booking, order) {
  if (!['draft','setting_up'].includes(order.status)) throw db.fail('Reset the failed payment before updating your card.');
  if (order.status === 'draft') order = await db.patch(order, { status: 'setting_up' });
  let customerId = order.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe('customers', { email: booking.email || undefined, name: booking.client_name || undefined, 'metadata[booking_id]': booking.id }, `additional-customer-${order.id}`);
    customerId = customer.id;
    order = await db.patch(order, { stripe_customer_id: customerId });
  }
  const url = require('./_additional-work').additionalWorkUrl(booking, ORIGIN);
  let session;
  if (order.setup_session_id) session = await stripe(`checkout/sessions/${order.setup_session_id}`);
  else {
    session = await stripe('checkout/sessions', { mode: 'setup', currency: 'usd', customer: customerId, 'payment_method_types[0]': 'card',
      'setup_intent_data[metadata][additional_work_order_id]': order.id, 'setup_intent_data[metadata][approval_revision]': order.revision,
      success_url: url, cancel_url: url }, `additional-setup-${order.id}-${order.revision}`);
    order = await db.patch(order, { setup_session_id: session.id });
  }
  if (session.status === 'expired') {
    order = await db.patch(order, { status: 'draft', revision: order.revision + 1, setup_session_id: null });
    throw db.fail('The card setup expired. Please try again.');
  }
  return { order: customerOrder(order), setupUrl: session.url };
}
async function completeSetup(order) {
  if (order.status !== 'setting_up' || !order.setup_session_id) return { order: customerOrder(order) };
  const session = await stripe(`checkout/sessions/${order.setup_session_id}?expand[]=setup_intent`);
  if (session.status !== 'complete') return { order: customerOrder(order), setupUrl: session.url };
  const setup = typeof session.setup_intent === 'string' ? await stripe(`setup_intents/${session.setup_intent}`) : session.setup_intent;
  if (session.mode !== 'setup' || idOf(session.customer) !== order.stripe_customer_id || setup?.status !== 'succeeded' || idOf(setup.customer) !== order.stripe_customer_id || setup.metadata?.additional_work_order_id !== order.id || setup.metadata?.approval_revision !== String(order.revision)) throw db.fail('Card setup could not be verified.', 409);
  const card = await savedCard(order.stripe_customer_id, idOf(setup.payment_method));
  order = await db.patch(order, { ...card, status: 'draft', revision: order.revision + 1, setup_session_id: null });
  return { order: customerOrder(order) };
}
async function handler(request, response, booking, body) {
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.method === 'GET') return shared.json(response, 200, { bookingId: booking.id, customerName: booking.client_name, service: booking.service_label || booking.service, rateCents: RATE, order: customerOrder(await db.latest(booking.id)) });
  if (request.method !== 'POST') return shared.json(response, 405, { error: 'Method not allowed.' });
  if (request.headers.origin !== ORIGIN) throw db.fail('Open this offer on the IMAN website.', 403);
  if (body.action === 'prepare') return shared.json(response, 200, { order: customerOrder(await prepare(booking, body)) });
  if (!/^[a-f0-9-]{36}$/.test(body.orderId || '')) throw db.fail('Review the additional-work offer first.', 400);
  const order = await db.get(body.orderId, booking.id);
  if (!order) throw db.fail('Additional-work request not found.', 404);
  let result;
  if (body.action === 'status') result = await reconcile(order);
  else if (body.revision !== order.revision) throw db.fail('This offer changed. Refresh and review it again.');
  else if (body.action === 'approve') result = await approve(booking, order, body);
  else if (body.action === 'setup') result = await setupCard(booking, order);
  else if (body.action === 'setup-return') result = await completeSetup(order);
  else if (body.action === 'change-card') result = { order: customerOrder(await changeCard(order)) };
  else throw db.fail('Refresh this page to use the new approval form.', 400);
  return shared.json(response, 200, result);
}
async function handlePaymentEvent(event) {
  const incoming = event.data?.object;
  if (!event.type.startsWith('payment_intent.') || incoming?.metadata?.payment_type !== 'additional_work_approval') return null;
  // Retrieve current Stripe state so late/out-of-order events cannot downgrade it.
  const intent = await stripe(`payment_intents/${encodeURIComponent(incoming.id)}`);
  const order = await recordIntent(intent);
  if (order?.approved_at) await notify(order);
  return { orderId: order?.id, status: order?.status };
}
async function crmOrders(bookingId) {
  const orders = await db.request(`${db.ORDERS}?booking_id=eq.${encodeURIComponent(bookingId)}&order=created_at.desc`);
  return Promise.all(orders.map(async o => ({ ...customerOrder(o), paymentIntentId: o.payment_intent_id, confirmations: (await db.notices(o.id)).map(n => ({ revision: n.revision, channel: n.channel, status: n.status, sentAt: n.sent_at, attemptedAt: n.attempted_at, providerId: n.provider_id, error: n.error, approval: { time: duration(n.snapshot.total_minutes), amountCents: n.snapshot.amount_cents, card: cardLabel(n.snapshot), approvedAt: n.snapshot.approved_at } })) })));
}
async function processPending() {
  const pending = await db.request(`${db.NOTICES}?status=eq.pending&select=order_id&limit=20`);
  let checked = 0, errors = 0;
  for (const id of new Set(pending.map(n => n.order_id))) {
    try { const o = await db.get(id); if (o) { await reconcile(o); checked++; } } catch { errors++; }
  }
  return { checked, errors };
}
module.exports = { handler, timeInput, duration, money, brandName, cardLabel, consentText, prepare, approve, payApproved, reconcile, recordIntent, changeCard, setupCard, completeSetup, notify, handlePaymentEvent, crmOrders, customerOrder, stripe, processPending };
