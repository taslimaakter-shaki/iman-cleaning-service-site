const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, fields } = require('./crm-quote-editor.test');
const { validateDiscount, flatPricing, packageFingerprint, applyPackageDiscount } = require('../api/booking/_discount');
const { validateAndPrice } = require('../api/booking/_saved-quote');
const { savedQuote, bookingQuote } = require('../api/crm/_quotes');
const reject = task => assert.rejects(task, error => [400, 409, 502].includes(error.statusCode));
const save = async (f, source, id, amount, label = 'First-time customer discount') => f.api.saveDiscount({ source, id,
  version: (await f.api.load(source, id)).version, discountCents: amount, discountLabel: label });

(async () => {
  for (const amount of [-1, .5, NaN, Infinity, '100', 10000001]) assert.throws(() => validateDiscount(amount));
  assert.throws(() => validateDiscount(100, 'a'.repeat(161)));
  assert.throws(() => flatPricing(10000, 0, 9801));
  assert.equal(flatPricing(10000, 10000, 9800, 'Special').totalCents, 10200);
  assert(flatPricing(200, 10000, 0, '').subtotalCents >= 0);
  const f = fixture();
  const raw = { quoteId: 'SAVED-1', version: 1, createdAt: Date.now(), expiresAt: Date.now() + 86400000,
    eligibility: { serviceIntent: 'cleaning', requestedService: 'hourly', serviceZip: '11432' }, unitDetails: [{ hours: 4 }], pricingMode: 'hourly_formula',
    customer: { firstName: 'Jane', lastName: 'Example', email: 'jane@example.test', phone: '+12125550123' } };
  const file = f.add('saved_quote', 'SAVED-1', raw), pkg = validateAndPrice(raw).pkg;
  assert.equal(pkg.priceCents, 32000);
  f.sessions.push({ id: 'cs_saved_old', status: 'open', metadata: { saved_quote_id: 'SAVED-1' } });
  await save(f, 'saved', 'SAVED-1', 5000);
  assert.equal(f.sessions[0].status, 'expired');
  let found = await f.api.load('saved', 'SAVED-1');
  assert.equal(found.state.fields, undefined, 'Discount-only does not convert instant quotes or require an appointment');
  assert.equal(f.bookings.size, 0, 'No booking created by saving a discount');
  let priced = await f.api.applySavedDiscount('VALID', pkg, found.state.revision);
  assert.equal(priced.priceCents, 27000);
  assert.equal(priced.manHours, pkg.manHours); assert.equal(priced.teamHours, pkg.teamHours);
  assert.equal(priced.taxCents, pkg.taxCents); assert.deepEqual(priced.units, pkg.units);
  assert.equal(Math.round(priced.priceCents / 4), 6750);
  assert.equal(savedQuote(found.record, f.files.get(file).file).amountCents, 27000);
  await reject(f.api.applySavedDiscount('VALID', { ...pkg, manHours: 1 }, found.state.revision));
  await reject(f.api.applySavedDiscount('VALID', { ...pkg, units: [] }, found.state.revision));
  const oldRevision = found.state.revision;
  await save(f, 'saved', 'SAVED-1', 2500);
  found = await f.api.load('saved', 'SAVED-1');
  assert.equal((await f.api.applySavedDiscount('VALID', pkg, found.state.revision)).priceCents, 29500, 'Replace, never stack');
  await reject(f.api.checkSavedCheckout('VALID', undefined, oldRevision));
  f.sessions.push({ id: 'cs_stale', status: 'open', metadata: { saved_quote_id: 'SAVED-1' } });
  await reject(f.api.checkSavedCheckout('VALID', { id: 'cs_stale' }, oldRevision));
  assert.equal(f.sessions.at(-1).status, 'expired', 'Concurrent checkout cannot keep stale price');
  await save(f, 'saved', 'SAVED-1', 0);
  found = await f.api.load('saved', 'SAVED-1');
  assert.equal((await f.api.applySavedDiscount('VALID', pkg, found.state.revision)).priceCents, 32000);
  await reject(save(f, 'saved', 'SAVED-1', 31900));
  f.setFailure(true); await reject(save(f, 'saved', 'SAVED-1', 2000)); f.setFailure(false);
  assert.equal((await f.api.load('saved', 'SAVED-1')).state.manualDiscount.amountCents, 0, 'Provider failure retains offer');
  f.sessions.push({ id: 'cs_paid', status: 'complete', payment_status: 'paid', metadata: { saved_quote_id: 'SAVED-1' } });
  await reject(save(f, 'saved', 'SAVED-1', 2000));

  const custom = fixture();
  const units = [{ name: 'Apartment 1', items: [{ name: 'Bedroom', quantity: 2, unitPriceCents: 10000 }] }];
  const u = custom.api.unitPricing(custom.api.validateUnits(units), 0, 0);
  custom.add('custom_quote', 'QUOTE-1', { quoteId: 'QUOTE-1', createdAt: Date.now(), formFields: {} });
  await custom.api.saveEdit({ source: 'custom', id: 'QUOTE-1', version: (await custom.api.load('custom', 'QUOTE-1')).version,
    operation: 'payment_link', fields: { ...fields(), units, amountCents: u.totalCents } });
  const original = await custom.api.load('custom', 'QUOTE-1');
  await save(custom, 'custom', 'QUOTE-1', 5000);
  let offer = await custom.api.resolveManaged({ quoteId: 'QUOTE-1' });
  assert.equal(offer.amountCents, 16775); assert.equal(offer.pricing.taxCents, 1775);
  assert.equal(offer.pricing.discountLabel, 'First-time customer discount');
  assert.equal((await custom.api.load('custom', 'QUOTE-1')).state.approvalCode, original.state.approvalCode);
  const booked = await custom.api.ensureManagedBooking(offer);
  assert.equal(custom.bookings.get(booked.bookingId).estimate.payment.depositCents, 4194);
  assert.equal(custom.bookings.get(booked.bookingId).estimate.payment.remainingCents, 12581);
  await save(custom, 'custom', 'QUOTE-1', 0);
  assert.equal((await custom.api.resolveManaged({ quoteId: 'QUOTE-1' })).amountCents, 21775);

  const frozenNow = Date.now();
  class FrozenDate extends Date {
    constructor(...args) { super(...(args.length ? args : [frozenNow])); }
    static now() { return frozenNow; }
  }
  const b = fixture({ clock: FrozenDate });
  const booking = { id: 'BK-1', created_at: '2026-09-10', schedule: '2030-09-15T13:00:00Z', client_name: 'Jane Example',
    email: 'jane@example.test', phone: '+12125550123', address: 'Example address', service_label: 'Deep cleaning',
    estimate: { total: 500, manHours: 6, cleanerCount: 2, units: [{ baseItems: [{ label: 'Bedrooms', amount: 400 }] }],
      payment: { totalCents: 50000, rushFeeCents: 10000, paidCents: 0, status: 'deposit_pending', balanceCollection: 'after_service' } } };
  b.bookings.set('BK-1', booking);
  await save(b, 'booking', 'BK-1', 5000, 'Loyalty');
  let current = b.bookings.get('BK-1');
  assert.equal(current.estimate.payment.totalCents, 45000); assert.equal(current.estimate.payment.depositCents, 18750);
  assert.equal(current.estimate.payment.remainingCents, 26250); assert.equal(current.estimate.manHours, 6);
  assert.deepEqual(current.estimate.units, booking.estimate.units);
  const firstSavedAt = current.estimate.crmQuote.updatedAt;
  await save(b, 'booking', 'BK-1', 2500);
  assert.equal(b.bookings.get('BK-1').estimate.crmQuote.updatedAt, firstSavedAt, 'Exercise two edits in the same millisecond');
  assert.equal(b.bookings.get('BK-1').estimate.payment.totalCents, 47500);
  current = b.bookings.get('BK-1'); current.estimate.payment.paidCents = 1;
  await reject(save(b, 'booking', 'BK-1', 5000));

  const discounted = applyPackageDiscount(pkg, { ...validateDiscount(5000, 'Welcome'), packageFingerprint: packageFingerprint(pkg) });
  const converted = bookingQuote({ ...booking, estimate: { ...booking.estimate, total: 270, manualDiscount: discounted.manualDiscount,
    payment: { totalCents: 27000, paidCents: 0 } } });
  assert.equal(converted.editFields.baseAmountCents, 32000, 'A saved discount inherited by checkout is not stacked later');
  assert.equal(converted.editFields.discountCents, 5000);
  for (const file of ['crm.js', 'book-now.js', 'api/booking/_checkout.js']) new (require('node:vm').Script)(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  console.log('Quote discounts passed: saved instant flow, scope binding, revisions, exact totals, replacement/removal, stable custom links, rush fee, preserved work, paid protection, rollback. No live activity.');
})().catch(error => { console.error(error); process.exitCode = 1; });
