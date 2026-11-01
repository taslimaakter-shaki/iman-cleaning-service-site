const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { applyPromotion, PROMOTIONS } = require('../api/booking/_promo');
const { applyArrivalDiscount: serverArrival, ARRIVAL_PREFERENCES } = require('../api/booking/_arrival-preference');
const { buildAgreementAcceptance, AGREEMENT_VERSION, AGREEMENT_ACCEPTANCE_TEXT } = require('../api/booking/_checkout')._test;

const source = fs.readFileSync(require.resolve('../book-now.js'), 'utf8');
const arrivalCode = source.slice(source.indexOf('  const clearArrivalDiscount ='), source.indexOf('  const setSchedulerStatus ='));
// Exercise the renderer's price normalization before its DOM-only display work.
const renderCode = source.slice(source.indexOf('  const renderPriceBreakdown ='), source.indexOf('    const breakdown = document.querySelector("[data-price-breakdown]")')) + '\n};';
const original = { id: 'standard-test', serviceKey: 'standard', manHours: 4, teamHours: 2, subtotalCents: 25000, taxCents: 2219, priceCents: 27219, price: 272.19, taxRate: 0.08875 };
const promoPackage = applyPromotion(original, PROMOTIONS.FALL10);
const state = { package: structuredClone(promoPackage), packageBeforePromo: original, promo: promoPackage.promoDiscount };
const context = vm.createContext({ state, displayTime: time => { const [h, m] = time.split(':'); return `${Number(h) % 12 || 12}:${m} ${Number(h) >= 12 ? 'PM' : 'AM'}`; }, slotsForDate: () => state.availableSlots || [] });
const windowCode = source.slice(source.indexOf('  const ARRIVAL_OPTIONS ='), source.indexOf('  const clearArrivalDiscount ='));
vm.runInContext(windowCode, context);
vm.runInContext(arrivalCode + '\n' + renderCode, context);

for (const key of ['any_day', 'morning', 'afternoon', 'exact', 'any_day']) {
  context.option = ARRIVAL_PREFERENCES[key];
  vm.runInContext('applyArrivalDiscount(option); renderPriceBreakdown(state.package); renderPriceBreakdown(state.package);', context);
  const expected = serverArrival(promoPackage, key);
  assert.equal(state.package.priceCents, expected.priceCents, `${key}: rendering preserves the server checkout total`);
  assert.equal(state.package.taxCents, expected.taxCents);
  assert.equal(state.arrivalDiscount?.windowEnd, expected.arrivalDiscount?.windowEnd);
  assert.equal(state.arrivalDiscount?.windowLabel, expected.arrivalDiscount?.windowLabel);
  const slot = { value: '2030-11-01T09:00:00-04:00' };
  const now = Date.now();
  const evidence = buildAgreementAcceptance({
    pkg: expected, slot, request: { headers: {} }, secretKey: 'test-secret',
    review: {
      version: AGREEMENT_VERSION, accepted: true, signedName: 'Jane Example', acceptanceText: AGREEMENT_ACCEPTANCE_TEXT,
      openedAt: new Date(now - 60000).toISOString(), scrolledToEndAt: new Date(now - 30000).toISOString(), acceptedAt: new Date(now - 10000).toISOString(),
      contextFingerprint: JSON.stringify({ packageId: state.package.id, total: state.package.price, laborHours: state.package.manHours, schedule: slot.value })
    }
  });
  assert.equal(evidence.context.totalCents, expected.priceCents);
}
console.log('Arrival discounts survive repeated rendering, option changes, and server agreement validation.');

for (const [hours, latest, tooLate, expected] of [[4, '17:30', '18:00', '8:00 AM–5:30 PM'], [2, '18:30', '19:00', '8:00 AM–6:30 PM']]) {
  state.package = { manHours: hours, teamHours: hours / 2 };
  state.availableSlots = [latest, tooLate].map(time => ({ time, flexibleEligible: true }));
  assert.equal(vm.runInContext("arrivalWindowText(arrivalOption('any_day'))", context), `Estimated arrival ${expected}`);
  assert.equal(vm.runInContext("slotsForArrivalOption(arrivalOption('any_day')).map(s => s.time).join(',')", context), latest);
}
