const assert = require("node:assert/strict");
const { calculateResidentialUnitPrice, calculateResidentialQuoteBundle } = require("../api/booking/_shared");

function unit(petCount) {
  return {
    bedrooms: 1,
    fullBathrooms: 1,
    halfBathrooms: 0,
    hasLivingRoom: "no",
    hasDiningRoom: "no",
    hasPets: "yes",
    petCount,
    petType: "cats",
    refrigerator: "no",
    oven: "no",
    cabinets: "no",
    additionalCleaning: "no",
    additionalRooms: 0
  };
}

for (const petCount of [1, 2, 3, 10]) {
  const quote = calculateResidentialUnitPrice(unit(petCount), 0, "standard");
  const petItem = quote.addOns.find((item) => item.key === "pet_fee");

  const expectedAmount = 50;
  assert.equal(petItem.amount, expectedAmount);
  assert.equal(petItem.label, "Pet fee — $50 (tax included)");
  assert.doesNotMatch(petItem.label, /minutes|hours/i);
  assert.match(petItem.description, /pet hair, dander/);

  // Hiding the item-specific duration must not change its fee or the overall labor allowance.
  const withoutPets = calculateResidentialUnitPrice({ ...unit(petCount), hasPets: "no" }, 0, "standard");
  assert.equal(quote.subtotal, withoutPets.subtotal + expectedAmount);
  assert.equal(quote.manHours, Math.ceil((quote.subtotal / 80) * 2) / 2);
  const noPetUnit = { ...unit(petCount), hasPets: "no" };
  const bundle = calculateResidentialQuoteBundle([noPetUnit, noPetUnit], "standard", {
    propertyHasPets: "yes",
    propertyPetCount: petCount,
    propertyPetType: "cats",
    petsSecured: "yes"
  });
  const propertyPetItems = bundle.units.flatMap((pricedUnit) => pricedUnit.addOns)
    .filter((item) => item.key === "property_pet_fee");
  assert.equal(propertyPetItems.length, 1);
  assert.equal(propertyPetItems[0].amount, expectedAmount);
  assert.equal(bundle.propertyPets.petCount, petCount);
  assert.equal(bundle.propertyPets.fee, expectedAmount);
}

const moveBuildup = calculateResidentialQuoteBundle([{ ...unit(0), hasPets: "no" }], "move", {
  propertyHasPets: "no",
  previousPetBuildup: "yes"
});
assert.equal(moveBuildup.propertyPets.fee, 50);
assert.equal(moveBuildup.units[0].addOns.filter((item) => item.key === "property_pet_fee").length, 1);

console.log("Pet cleaning time pricing tests passed.");

const { applyPromotion } = require("../api/booking/_promo");
const { applyArrivalDiscount } = require("../api/booking/_arrival-preference");
const { applyPackageDiscount, packageFingerprint } = require("../api/booking/_discount");
for (const count of [1, 2, 10]) {
  const pkg = calculateResidentialQuoteBundle([{ ...unit(count), hasPets: "no" }], "standard", {
    propertyHasPets: "yes", propertyPetCount: count, propertyPetType: "cats", petsSecured: "yes"
  });
  const plain = calculateResidentialQuoteBundle([{ ...unit(count), hasPets: "no" }], "standard", { propertyHasPets: "no" });
  assert.equal(pkg.priceCents - plain.priceCents, 5000, "Pet fee includes tax exactly once");
  assert.equal(pkg.protectedPetFeeCents, 5000);
  const promo = applyPromotion(pkg, { code: "TEST", label: "Test", percent: 10, eligibleServices: ["standard"] });
  const both = applyArrivalDiscount(promo, "any_day");
  const cleaningSubtotal = pkg.subtotalCents - pkg.protectedPetSubtotalCents;
  const discountedCleaning = cleaningSubtotal - Math.round(cleaningSubtotal * .10) - Math.round(cleaningSubtotal * .05);
  assert.equal(both.priceCents, discountedCleaning + Math.round(discountedCleaning * pkg.taxRate) + 5000);
  assert.throws(() => applyPackageDiscount(pkg, { amountCents: pkg.priceCents - 5000, label: "Too large", packageFingerprint: packageFingerprint(pkg) }), /pet fee/);
}
console.log("Flat tax-inclusive pet fee survives promo and arrival discounts; oversized manual discounts rejected.");

const { applyRecurringDiscount } = require("../api/booking/_recurring-discount");
const recurring = calculateResidentialQuoteBundle([{ ...unit(3), hasPets: "no" }], "recurring", { propertyHasPets: "yes", propertyPetCount: 3, propertyPetType: "cats", petsSecured: "yes" });
assert.equal(applyRecurringDiscount(recurring, { percent: 20 }).priceCents, recurring.priceCents - Math.round((recurring.priceCents - 5000) * .20));
const legacy = calculateResidentialQuoteBundle([{ ...unit(3), hasPets: "no" }], "standard", { propertyHasPets: "yes", propertyPetCount: 3, propertyPetType: "cats", petsSecured: "yes" }, true);
assert.equal(legacy.propertyPets.fee, 90);
assert.equal(legacy.protectedPetFeeCents, 0);
