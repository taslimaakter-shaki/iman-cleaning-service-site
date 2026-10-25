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

for (const petCount of [1, 2, 3]) {
  const quote = calculateResidentialUnitPrice(unit(petCount), 0, "standard");
  const petItem = quote.addOns.find((item) => item.key === "pet_fee");

  const expectedAmount = 50 + (petCount - 1) * 20;
  assert.equal(petItem.amount, expectedAmount);
  assert.equal(petItem.label, `Additional cleaning for ${petCount} pet${petCount === 1 ? "" : "s"}`);
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
