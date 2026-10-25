const crypto = require('node:crypto');
const fail = message => Object.assign(new Error(message), { statusCode: 400 });

function validateDiscount(amountCents, label = '') {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || amountCents > 10000000) throw fail('Enter a valid dollar discount with no more than two decimal places.');
  if (typeof label !== 'string' || label.length > 160) throw fail('Discount name must be at most 160 characters.');
  return { amountCents, label: label.replace(/\0/g, '').trim() || 'Discount' };
}

function flatPricing(baseAmountCents, rushFeeCents, discountCents, discountLabel, originalTaxCents) {
  validateDiscount(discountCents, discountLabel || '');
  if (!Number.isSafeInteger(baseAmountCents) || baseAmountCents < 200 || baseAmountCents + rushFeeCents > 10000000) throw fail('Set a valid quote price before adding a discount.');
  if (baseAmountCents - discountCents < 200) throw fail('Reduce the discount: at least $2 of cleaning charges must remain, in addition to any rush fee.');
  const beforeDiscountCents = baseAmountCents + rushFeeCents;
  const taxCents = Number.isSafeInteger(originalTaxCents) && originalTaxCents >= 0 && originalTaxCents <= beforeDiscountCents
    ? originalTaxCents : baseAmountCents - Math.round(baseAmountCents / 1.08875);
  return { subtotalCents: beforeDiscountCents - taxCents - rushFeeCents, rushFeeCents, taxRate: 0.08875, taxCents,
    beforeDiscountCents, discountCents, discountLabel: discountLabel || 'Discount', discountApplication: 'after_tax', totalCents: beforeDiscountCents - discountCents };
}

function packageFingerprint(pkg) {
  const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  return crypto.createHash('sha256').update(JSON.stringify(ordered({ id: pkg.id, serviceKey: pkg.serviceKey,
    priceCents: pkg.priceCents, manHours: pkg.manHours, cleanerCount: pkg.cleanerCount, units: pkg.units }))).digest('hex');
}

function applyPackageDiscount(pkg, discount) {
  if (!discount) return pkg;
  if (discount.packageFingerprint !== packageFingerprint(pkg)) throw Object.assign(new Error('This discount is for the saved cleaning details. Reopen your quote or ask our team to update it.'), { statusCode: 409 });
  const pricing = flatPricing(pkg.priceCents, 0, discount.amountCents, discount.label, pkg.taxCents);
  return { ...pkg, priceCents: pricing.totalCents, totalCents: pricing.totalCents, price: pricing.totalCents / 100,
    total: pricing.totalCents / 100, manualDiscount: { ...pricing, amountCents: discount.amountCents, label: discount.label } };
}

module.exports = { validateDiscount, flatPricing, packageFingerprint, applyPackageDiscount };
