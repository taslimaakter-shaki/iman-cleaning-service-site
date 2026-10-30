const assert = require('assert');
const { pricingRows } = require('../api/booking/_payment-receipt-pdf');
const booking = { estimate: { units: [{ baseItems: [{ label: 'Kitchen', amount: 80 }], addOns: [
  { key: 'buildup_adjustment', label: 'Buildup adjustment (50% of selected affected rooms)', amount: 40 },
  { key: 'clutter_adjustment', label: 'Clutter access adjustment (40% of selected affected rooms)', amount: 32 },
  { key: 'mold_adjustment_kitchen', label: 'Kitchen - possible mold/mildew adjustment (50%)', amount: 40 }
] }], buildupAdjustment: { amount: 40 }, clutterAdjustment: { amount: 32 }, moldAdjustment: { amount: 40 } } };
assert.deepEqual(pricingRows(booking, {}), [['Kitchen', '$80.00'], ['Buildup adjustment', '$40.00'], ['Clutter access adjustment', '$32.00'], ['Kitchen - possible mold/mildew adjustment', '$40.00']]);
const original = JSON.stringify(booking);
pricingRows(booking, {});
assert.equal(JSON.stringify(booking), original, 'Receipt formatting must not change booking charges');
assert.deepEqual(pricingRows({ estimate: { buildupAdjustment: { amountCents: 4000 } } }, {}), [['Buildup adjustment', '$40.00']]);
const multi = structuredClone(booking); multi.estimate.units.push(structuredClone(multi.estimate.units[0]));
assert.equal(pricingRows(multi, {}).filter(([label]) => label.includes('Buildup adjustment')).length, 2, 'Keep separate unit charges, but not a duplicate aggregate');
console.log('Receipt adjustment labels, duplicate prevention, and unchanged charges passed.');
