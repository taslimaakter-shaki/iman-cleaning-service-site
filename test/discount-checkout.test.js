process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture } = require('./crm-quote-editor.test');
const shared = require('../api/booking/_shared');
const discount = require('../api/booking/_discount');
const clone = x => JSON.parse(JSON.stringify(x));
const testEnv = { STRIPE_SECRET_KEY: 'sk_test_mock' };
const request = { method: 'POST', headers: { host: 'www.imancleaningservice.com' } };
// Include optional fields in the budget, even if a particular fixture omits them.
const checkoutSource = fs.readFileSync(path.join(__dirname, '../api/booking/_checkout.js'), 'utf8');
const sessionMetadataKeys = new Set([...checkoutSource.matchAll(/"metadata\[([^\]]+)\]":/g)].map(match => match[1]));
assert(sessionMetadataKeys.size <= 50, `Checkout can send ${sessionMetadataKeys.size} session metadata keys; Stripe allows 50`);
function load(file, dependencies, extras = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    module, exports: module.exports, require: name => name.endsWith("/_hosted-cancel") ? require("../api/booking/_hosted-cancel") : name.endsWith("/_minimum-total") ? require("../api/booking/_minimum-total") : dependencies[name] || (name === './_staffing-options' ? require('../api/booking/_staffing-options') : require(name)),
    process: { env: testEnv }, Buffer, URL, URLSearchParams, Date, Intl, console, ...extras
  }, { filename: file });
  return module.exports;
}
(async () => {
  const f = fixture();
  const raw = { quoteId: 'SAVED-1', version: 1, createdAt: Date.now(), expiresAt: Date.now() + 86400000,
    eligibility: { serviceIntent: 'cleaning', requestedService: 'hourly', serviceZip: '11432' },
    unitDetails: [{ hours: 4 }], pricingMode: 'hourly_formula' };
  f.add('saved_quote', 'SAVED-1', raw);
  await f.api.saveDiscount({ source: 'saved', id: 'SAVED-1', version: (await f.api.load('saved', 'SAVED-1')).version,
    discountCents: 5000, discountLabel: 'Welcome' });
  const revision = (await f.api.load('saved', 'SAVED-1')).state.revision;
  const pkg = await f.api.applySavedDiscount('VALID', shared.calculateHourlyCleaningQuote(4), revision);
  const slot = { value: '2030-09-15T13:00:00Z', label: 'Test appointment', date: '2030-09-15', time: '09:00', flexibleEligible: true };
  let body, result, stripe, booking, afterStripe;
  let priorBookings = [];
  // Exercise skipped lookups while the first-time discount is actually available.
  const promo = load('api/booking/_promo.js', {
    './_shared': shared, '../../booking-discount-names': require('../booking-discount-names')
  }, { Date: class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-05T12:00:00Z'])); }
  } });
  const handler = load('api/booking/_checkout.js', {
    './_shared': { ...shared, listAllBookings: async () => priorBookings, readJsonBody: async () => body, json: (_, status, value) => { result = { status, ...value }; },
      availableSlotsForPackage: async p => { assert.equal(p.manHours, 4); assert.equal(p.teamHours, 2); return [slot]; },
      createBooking: async b => { booking = clone(b); }, deletePendingBooking: async () => {}, makeUniqueOrderNumber: async () => 'TEST-ORDER' },
    '../crm/_quote-admin': f.api, '../account/_shared': { authenticatedUser: async () => null },
    './_deposit-payment': { prepare: async (id,params) => { assert.equal(booking.id,id); assert.equal(booking.estimate.calendarReservation.state,'draft'); assert.equal(params['metadata[payment_amount_cents]'],booking.estimate.payment.depositCents); return {url:'/booking-payment.html#test'}; } },
    './_arrival-preference': require('../api/booking/_arrival-preference'),
    './_promo': promo,
    '../../booking-discount-names': require('../booking-discount-names'),
    './_calendar': { newReservation: () => ({ attempt: 'test' }), attachCheckout: async () => {}, cleanupCheckout: async () => {} }
  }, { fetch: async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    stripe = new URLSearchParams(options.body);
    for (const prefix of ['metadata[', 'payment_intent_data[metadata][']) {
      const keys = [...stripe.keys()].filter(key => key.startsWith(prefix));
      assert(keys.length <= 50, `${prefix}: Stripe metadata limit exceeded (${keys.length})`);
    }
    assert(stripe.get('metadata[booking_id]'));
    assert(stripe.get('metadata[agreement_record_hash]'));
    const session = { id: `cs_checkout_${f.sessions.length}`, status: 'open', metadata: { saved_quote_id: 'SAVED-1' }, url: 'https://checkout.stripe.test/test' };
    f.sessions.push(session);
    if (afterStripe) await afterStripe();
    return { ok: true, text: async () => JSON.stringify(session) };
  } });
  const terms = handler._test;
  body = { ...raw, savedQuoteToken: 'VALID', quoteRevision: revision, schedule: slot.value,
    customer: { firstName: 'Jane', lastName: 'Example', email: 'jane@example.test', phone: '+12125550123', address: '123 Example St', city: 'Queens', state: 'NY', zip: '11432' },
    agreements: { laborHours: true, completion: true, condition: true, terms: true },
    agreementReview: { accepted: true, signedName: 'Jane Example', version: terms.AGREEMENT_VERSION, acceptanceText: terms.AGREEMENT_ACCEPTANCE_TEXT,
      openedAt: new Date(Date.now() - 10000).toISOString(), scrolledToEndAt: new Date(Date.now() - 5000).toISOString(), acceptedAt: new Date().toISOString(),
      contextFingerprint: JSON.stringify({ packageId: pkg.id, total: 270, laborHours: 4, schedule: slot.value }) } };
  await handler(request, {});
  assert.equal(result.status, 201, result.error);
  assert.equal(stripe.get('line_items[0][price_data][unit_amount]'), '6750');
  assert.equal(stripe.has('line_items[1][price_data][unit_amount]'), false, 'Do not charge tax twice');
  assert.equal(stripe.get('metadata[total_amount_cents]'), '27000');
  assert.equal(stripe.get('metadata[remaining_amount_cents]'), '20250');
  assert.equal(stripe.get('metadata[discount_cents]'), '5000');
  assert.equal(stripe.get('line_items[0][price_data][product_data][name]'), '25% booking deposit (tax included)');
  assert.equal(stripe.has('line_items[0][price_data][product_data][description]'), false, 'No lengthy service description in Stripe checkout');
  assert.match(stripe.get('invoice_creation[invoice_data][description]'), /Original service total \$320\.00; discount -\$50\.00; final service total \$270\.00/);
  assert.equal(stripe.get('invoice_creation[invoice_data][custom_fields][2][value]'), '-$50.00');
  assert.equal(booking.estimate.total, 270); assert.equal(booking.estimate.payment.depositCents, 6750);
  assert.equal(booking.estimate.agreementAcceptance.context.totalCents, 27000);
  assert.equal(booking.estimate.customQuotePricing.discountLabel, 'Welcome');

  const flexiblePkg = require('../api/booking/_arrival-preference').applyArrivalDiscount(pkg, 'any_day');
  body.arrivalPreference = 'any_day';
  body.agreementReview.contextFingerprint = JSON.stringify({
    packageId: flexiblePkg.id,
    total: flexiblePkg.price,
    laborHours: flexiblePkg.manHours,
    schedule: slot.value
  });
  await handler(request, {});
  assert.equal(result.status, 201, result.error);
  assert.equal(stripe.get('line_items[0][price_data][unit_amount]'), String(Math.round(flexiblePkg.priceCents * 0.25)));
  assert.equal(stripe.get('metadata[total_amount_cents]'), String(flexiblePkg.priceCents));
  assert.equal(stripe.get('metadata[remaining_amount_cents]'), String(flexiblePkg.priceCents - Math.round(flexiblePkg.priceCents * 0.25)));
  assert.equal(stripe.get('metadata[arrival_preference]'), 'any_day');
  assert.equal(stripe.get('metadata[arrival_discount_cents]'), String(flexiblePkg.arrivalDiscount.amountCents));
  assert.equal(booking.estimate.arrivalPreference.flexible, true);
  assert.equal(booking.estimate.arrivalPreference.confirmationStatus, 'pending');
  assert.equal(booking.estimate.arrivalPreference.windowLabel, '8:00 AM–5:30 PM');
  assert.equal(booking.estimate.arrivalPreference.windowEnd, '17:30');
  assert.equal(booking.estimate.calendarReservationHours, flexiblePkg.teamHours + 1);
  assert.equal(booking.estimate.payment.totalCents, flexiblePkg.priceCents);
  assert.equal(booking.estimate.payment.depositCents, Math.round(flexiblePkg.priceCents * 0.25));
  assert.match(booking.schedule_label, /Estimated arrival 8:00 AM–5:30 PM/);

  const originalSlot = { ...slot };
  for (const [preferenceKey, time, value] of [
    ['morning', '08:00', '2030-09-15T12:00:00Z'],
    ['afternoon', '17:30', '2030-09-15T21:30:00Z']
  ]) {
    Object.assign(slot, { time, value });
    body.arrivalPreference = preferenceKey;
    body.schedule = value;
    body.agreementReview.contextFingerprint = JSON.stringify({ packageId: pkg.id, total: pkg.price, laborHours: 4, schedule: value });
    await handler(request, {});
    assert.equal(result.status, 201, result.error);
    assert.equal(booking.schedule, value);
    assert.equal(booking.estimate.arrivalPreference.flexible, false);
    assert.equal(booking.estimate.arrivalPreference.confirmationStatus, 'confirmed');
    assert.equal(booking.estimate.arrivalPreference.windowStart, time);
    assert.equal(booking.estimate.arrivalPreference.windowEnd, time);
    assert.equal(booking.estimate.arrivalDiscount, null);
    assert.equal(booking.estimate.payment.totalCents, pkg.priceCents, 'Fixed choices add no arrival discount');
    // A stale page must not turn a fixed Morning/Afternoon choice into another time.
    slot.time = '09:30';
    await handler(request, {});
    assert.equal(result.status, 409);
  }
  for (const [preferenceKey, time, value] of [
    ['morning', '11:00', '2030-09-15T15:00:00Z'],
    ['afternoon', '12:30', '2030-09-15T16:30:00Z']
  ]) {
    Object.assign(slot, { time, value, arrivalOptions: [preferenceKey] });
    body.arrivalPreference = preferenceKey;
    body.schedule = value;
    body.agreementReview.contextFingerprint = JSON.stringify({ packageId: pkg.id, total: pkg.price, laborHours: 4, schedule: value });
    await handler(request, {});
    assert.equal(result.status, 201, result.error);
    assert.equal(booking.estimate.arrivalPreference.windowStart, time);
    assert.equal(booking.estimate.arrivalPreference.windowEnd, time);
    assert.equal(booking.estimate.arrivalPreference.flexible, false);
    assert.equal(booking.estimate.arrivalDiscount, null);
    assert.equal(stripe.get('metadata[service_time]'), time);
    slot.arrivalOptions = [];
    await handler(request, {});
    assert.equal(result.status, 409, 'A stale choice cannot pay for an unoffered start');
  }
  delete slot.arrivalOptions;
  Object.assign(slot, originalSlot);
  body.schedule = slot.value;
  body.arrivalPreference = 'exact';
  body.agreementReview.contextFingerprint = JSON.stringify({ packageId: pkg.id, total: 270, laborHours: 4, schedule: slot.value });
  body.discountCents = 23000;
  await handler(request, {});
  assert.equal(result.status, 201); assert.equal(stripe.get('metadata[total_amount_cents]'), '27000', 'Ignore client discount');
  testEnv.BOOKING_PAYMENT_FLOW='server';
  const previousStripe=stripe;
  await handler(request, {}); assert.equal(result.status,201,result.error); assert.equal(result.checkoutUrl,'/booking-payment.html#test'); assert.equal(stripe,previousStripe,'Draft checkout does not call Stripe');
  delete testEnv.BOOKING_PAYMENT_FLOW;
  body.quoteRevision = 'outdated'; stripe = null;
  await handler(request, {}); assert.equal(result.status, 409); assert.equal(stripe, null);
  body.quoteRevision = revision; body.unitDetails = [{ hours: 6 }];
  await handler(request, {}); assert.equal(result.status, 409); assert.equal(stripe, null);
  body.unitDetails = [{ hours: 4 }];
  afterStripe = async () => {
    const found = await f.api.load('saved', 'SAVED-1');
    await f.api.saveDiscount({ source: 'saved', id: 'SAVED-1', version: found.version, discountCents: 2500, discountLabel: 'Updated' });
  };
  await handler(request, {}); assert.equal(result.status, 409, result.error);
  assert(f.sessions.every(s => s.status === 'expired'), 'A concurrent discount invalidates the old checkout');

  afterStripe = null;
  delete body.savedQuoteToken;
  priorBookings = [{ email: body.customer.email.toUpperCase(), status: 'Confirmed', estimate: { payment: { paidCents: 8000 } } }];
  const promoLookup = load('api/booking/_promo-validate.js', {
    './_shared': { ...shared, readJsonBody: async req => req.body, listAllBookings: async () => priorBookings,
      json: (_, status, value) => ({ status, ...value }) },
    './_promo': promo
  });
  const offer = await promoLookup({ method: 'POST', body: { automatic: true, serviceKey: 'hourly', customer: body.customer } }, {});
  assert.equal(offer.code, 'RETURNING5');
  for (const selectedCode of [offer.code, 'FALL10', '']) {
    body.promoCode = selectedCode;
    const acceptedPrice = selectedCode ? 304 : 320;
    body.agreementReview.contextFingerprint = JSON.stringify({ packageId: pkg.id, total: acceptedPrice, laborHours: 4, schedule: slot.value });
    await handler(request, {});
    assert.equal(result.status, 201, result.error);
    assert.equal(booking.estimate.promoCode, selectedCode ? 'RETURNING5' : '');
    if (selectedCode) {
      assert.equal(stripe.get('invoice_creation[invoice_data][custom_fields][0][value]'), 'Returning Customer Discount');
      assert.doesNotMatch(stripe.get('invoice_creation[invoice_data][description]'), /RETURNING5|FALL10/);
    }
    assert.equal(stripe.get('metadata[total_amount_cents]'), String(acceptedPrice * 100));
    assert.equal(stripe.get('line_items[0][price_data][unit_amount]'), String(acceptedPrice * 25));
  }
  priorBookings = [];
  const seasonalOffer = await promoLookup({ method: 'POST', body: { automatic: true, serviceKey: 'hourly', customer: body.customer } }, {});
  assert.equal(seasonalOffer.code, 'FALL10');
  for (const code of [undefined, '', seasonalOffer.code]) {
    if (code === undefined) delete body.promoCode;
    else body.promoCode = code;
    const signedTotal = code ? 304 : 320;
    body.agreementReview.contextFingerprint = JSON.stringify({ packageId: pkg.id, total: signedTotal, laborHours: 4, schedule: slot.value });
    await handler(request, {});
    assert.equal(result.status, 201, result.error);
    assert.equal(booking.estimate.agreementAcceptance.context.totalCents, signedTotal * 100);
    assert.equal(booking.estimate.promoCode, code || '');
    assert.equal(stripe.get('metadata[total_amount_cents]'), String(signedTotal * 100));
    assert.equal(stripe.get('line_items[0][price_data][unit_amount]'), String(signedTotal * 25));
  }
  delete body.promoCode; // The signed total still includes the $16 discount.
  stripe = null;
  await handler(request, {});
  assert.equal(result.status, 400);
  assert.equal(stripe, null, 'A genuinely changed total must be accepted before payment');
  body.promoCode = 'RETURNING5';
  stripe = null;
  await handler(request, {});
  assert.equal(result.status, 409);
  assert.equal(stripe, null, 'A first-time customer cannot claim the returning discount');

  let record = { id: 'SD-TEST', status: 'New request', updatedAt: 'original', quote: { priceCents: 32000, price: 320, manHours: 4, teamHours: 2, taxCents: 2608 },
    customer: body.customer, serviceAddress: 'Test', serviceKey: 'hourly', eligibility: {}, pricingMode: 'hourly_formula' };
  let sms = 0, approval;
  const drive = { files: {
    list: async () => ({ data: { files: [{ id: 'file-test' }] } }),
    get: async () => ({ data: clone(record) }),
    update: async ({ media }) => { record = JSON.parse(media.body); return { data: {} }; }
  } };
  const sameDay = load('api/booking/_same-day.js', {
    './_shared': { ...shared, assertScheduleAvailable: async () => {}, createBooking: async b => { booking = clone(b); }, makeUniqueOrderNumber: async () => 'TEST-ORDER' },
    './_saved-quote': require('../api/booking/_saved-quote'), './_discount': discount,
    '../quote/_shared': { getGoogleClients: () => ({ drive, config: { parentFolderId: 'test' } }) },
    './_notifications': { sendCustomerSms: async () => { sms++; return { status: 'sent' }; } },
    '../quote/_short-approval': { createShortApproval: async a => { approval = clone(a); return { code: 'testonlycode' }; } },
    '../_form-notifications': {}
  });
  await sameDay.updateSameDayRequest({ id: record.id, action: 'discount', updatedAt: record.updatedAt, discountCents: 5000, discountLabel: 'Welcome' }, request);
  assert.equal(record.quote.priceCents, 27000); assert.equal(sms, 0, 'Saving discount must not send a message');
  await sameDay.updateSameDayRequest({ id: record.id, action: 'discount', updatedAt: record.updatedAt, discountCents: 2500, discountLabel: 'Welcome' }, request);
  assert.equal(record.quote.priceCents, 29500, 'Replace, not stack');
  await sameDay.updateSameDayRequest({ id: record.id, action: 'approve', serviceDate: '2030-09-15', serviceTime: '09:00' }, request);
  assert.equal(sms, 1); assert.equal(booking.estimate.payment.totalCents, 39500);
  assert.equal(booking.estimate.payment.depositCents, 17375); assert.equal(booking.estimate.payment.remainingCents, 22125);
  assert.equal(approval.amountCents, 29500); assert.equal(approval.rushFeeCents, 10000); assert.equal(approval.pricing.discountCents, 2500);
  await assert.rejects(sameDay.updateSameDayRequest({ id: record.id, action: 'discount', updatedAt: record.updatedAt, discountCents: 1000 }, request), e => e.statusCode === 409);
  console.log('Mocked instant checkout and same-day approval passed: exact Stripe amount, agreement price, unchanged work, no duplicated tax, stale checkout fencing, no discount SMS, rush fee preserved.');
})().catch(error => { console.error(error); process.exitCode = 1; });
