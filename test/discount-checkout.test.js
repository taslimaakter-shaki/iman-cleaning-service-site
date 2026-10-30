const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture } = require('./crm-quote-editor.test');
const shared = require('../api/booking/_shared');
const discount = require('../api/booking/_discount');
const clone = x => JSON.parse(JSON.stringify(x));
const request = { method: 'POST', headers: { host: 'www.imancleaningservice.com' } };
function load(file, dependencies, extras = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    module, exports: module.exports, require: name => dependencies[name] || (name === './_staffing-options' ? require('../api/booking/_staffing-options') : require(name)),
    process: { env: { STRIPE_SECRET_KEY: 'sk_test_mock' } }, Buffer, URL, URLSearchParams, Date, Intl, console, ...extras
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
  const handler = load('api/booking/_checkout.js', {
    './_shared': { ...shared, readJsonBody: async () => body, json: (_, status, value) => { result = { status, ...value }; },
      availableSlotsForPackage: async p => { assert.equal(p.manHours, 4); assert.equal(p.teamHours, 2); return [slot]; },
      createBooking: async b => { booking = clone(b); }, deletePendingBooking: async () => {}, makeUniqueOrderNumber: async () => 'TEST-ORDER' },
    '../crm/_quote-admin': f.api, '../account/_shared': { authenticatedUser: async () => null },
    './_arrival-preference': require('../api/booking/_arrival-preference'),
    './_calendar': { newReservation: () => ({ attempt: 'test' }), attachCheckout: async () => {}, cleanupCheckout: async () => {} }
  }, { fetch: async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    stripe = new URLSearchParams(options.body);
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
  assert.match(stripe.get('line_items[0][price_data][product_data][description]'), /Original total: \$320\.00/);
  assert.match(stripe.get('line_items[0][price_data][product_data][description]'), /Welcome: -\$50\.00/);
  assert.match(stripe.get('line_items[0][price_data][product_data][description]'), /Discounted service total: \$270\.00/);
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
  assert.equal(booking.estimate.arrivalPreference.windowLabel, '8:00 AM–4:00 PM');
  assert.equal(booking.estimate.arrivalPreference.windowEnd, '16:00');
  assert.equal(booking.estimate.calendarReservationHours, flexiblePkg.teamHours + 1);
  assert.equal(booking.estimate.payment.totalCents, flexiblePkg.priceCents);
  assert.equal(booking.estimate.payment.depositCents, Math.round(flexiblePkg.priceCents * 0.25));
  assert.match(booking.schedule_label, /Estimated arrival 8:00 AM–4:00 PM/);

  body.arrivalPreference = 'exact';
  body.agreementReview.contextFingerprint = JSON.stringify({ packageId: pkg.id, total: 270, laborHours: 4, schedule: slot.value });
  body.discountCents = 23000;
  await handler(request, {});
  assert.equal(result.status, 201); assert.equal(stripe.get('metadata[total_amount_cents]'), '27000', 'Ignore client discount');
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
