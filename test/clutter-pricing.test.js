const assert = require("node:assert/strict");
const { calculateResidentialQuoteBundle, recommendResidentialService } = require("../api/booking/_shared");

const unit = () => ({
  bedrooms: 1,
  fullBathrooms: 1,
  halfBathrooms: 0,
  hasLivingRoom: "yes",
  hasDiningRoom: "no",
  livingDining: "living_only",
  hasPets: "no",
  refrigerator: "no",
  oven: "no",
  cabinets: "no",
  additionalCleaning: "no",
  windowCleaning: "no",
  additionalRooms: 0
});

const affectedUnit = () => ({ ...unit(), clutterAreas: { fullBathrooms: 1 } });
const units = [affectedUnit(), affectedUnit()];
const low = calculateResidentialQuoteBundle(units, "standard", { clutter: "low", buildup: "none", hazards: "none" });
const moderate = calculateResidentialQuoteBundle(units, "standard", { clutter: "moderate", buildup: "none", hazards: "none" });
const several = calculateResidentialQuoteBundle(units, "standard", { clutter: "several", buildup: "none", hazards: "none" });
const heavy = calculateResidentialQuoteBundle(units, "standard", { clutter: "heavy", buildup: "none", hazards: "none" });

assert.equal(low.baseLaborHours, 5);
assert.equal(low.clutterAdjustment.percentage, 0);

assert.equal(moderate.clutterAdjustment.percentage, 40);
assert.equal(moderate.clutterAdjustment.affectedAreaBasePrice, 100);
assert.equal(moderate.clutterAdjustment.addedLaborHours, 0.5);
assert.equal(moderate.clutterAdjustment.amount, 40);
assert.equal(moderate.manHours, 6);
assert.equal(moderate.subtotalCents, low.subtotalCents + 4000);

assert.equal(several.clutterAdjustment.percentage, 50);
assert.equal(several.clutterAdjustment.affectedAreaBasePrice, 100);
assert.equal(several.clutterAdjustment.addedLaborHours, 0.625);
assert.equal(several.clutterAdjustment.amount, 50);
assert.equal(several.manHours, 6);
assert.equal(several.subtotalCents, low.subtotalCents + 5000);
assert.equal(heavy.clutterAdjustment.percentage, 60);
assert.equal(heavy.clutterAdjustment.affectedAreaBasePrice, 100);
assert.equal(heavy.clutterAdjustment.amount, 60);
assert.equal(heavy.clutterAdjustment.addedLaborHours, 0.75);
assert.equal(heavy.manHours, 6);
assert.deepEqual(moderate.units[0].clutterAreas, {
  bedrooms: 0, fullBathrooms: 1, halfBathrooms: 0, kitchens: 0,
  livingRooms: 0, diningRooms: 0, additionalRooms: 0
});

const oneAffectedUnit = calculateResidentialQuoteBundle([
  affectedUnit(),
  { ...unit(), clutterAreas: {} },
  { ...unit(), clutterAreas: {} },
  { ...unit(), clutterAreas: {} }
], "standard", { clutter: "moderate", buildup: "none", hazards: "none" });
assert.equal(oneAffectedUnit.clutterAdjustment.affectedAreas.length, 1);
assert.equal(oneAffectedUnit.clutterAdjustment.affectedAreas[0].unitNumber, 1);

assert.throws(
  () => calculateResidentialQuoteBundle([{ ...affectedUnit(), clutterAreas: { kitchens: 2 } }], "standard", { clutter: "moderate", buildup: "none" }),
  /clutter-affected kitchens/
);

const halfBathroomOnly = calculateResidentialQuoteBundle([{
  ...unit(),
  bedrooms: 4,
  fullBathrooms: 3,
  halfBathrooms: 1,
  clutterAreas: { halfBathrooms: 1 }
}], "deep", { clutter: "moderate", buildup: "none", hazards: "none" });
assert.equal(halfBathroomOnly.clutterAdjustment.affectedAreaBasePrice, 60);
assert.equal(halfBathroomOnly.clutterAdjustment.amount, 24);

const kitchenWithAddOns = calculateResidentialQuoteBundle([{
  ...unit(),
  kitchens: 1,
  refrigerator: "empty",
  oven: "yes",
  cabinets: "yes",
  cabinetCount: 1,
  drawerCount: 1,
  cabinetsEmpty: "yes",
  clutterAreas: { kitchens: 1 }
}], "deep", { clutter: "moderate", buildup: "none", hazards: "none" });
assert.equal(kitchenWithAddOns.clutterAdjustment.affectedAreaBasePrice, 154.5);
assert.equal(kitchenWithAddOns.clutterAdjustment.amount, 61.8);
assert.equal(kitchenWithAddOns.clutterAdjustment.addedLaborHours, 61.8 / 80);
assert.throws(
  () => calculateResidentialQuoteBundle([unit()], "standard", { clutter: "several", buildup: "none" }),
  /Select at least one clutter-affected area/
);

for (const quote of [moderate, several, heavy]) {
  assert.ok(quote.units[0].addOns.some((item) => item.key === "clutter_adjustment"));
  assert.equal(quote.priceCents, quote.subtotalCents + quote.taxCents);
  assert.equal(quote.manHours, Math.ceil((quote.total / 80) * 2) / 2);
}

const moderateRecommendation = recommendResidentialService({
  propertyStatus: "occupied", requestedService: "standard", cleaningCategory: "residential",
  clutter: "moderate", buildup: "none", hazards: "none"
});
assert.equal(moderateRecommendation.type, "instant");

const severalRecommendation = recommendResidentialService({
  propertyStatus: "occupied", requestedService: "standard", cleaningCategory: "residential",
  clutter: "several", buildup: "none", hazards: "none"
});
assert.equal(severalRecommendation.type, "instant");

const heavyRecommendation = recommendResidentialService({
  propertyStatus: "occupied", requestedService: "standard", cleaningCategory: "residential",
  clutter: "heavy", buildup: "none", hazards: "none"
});
assert.equal(heavyRecommendation.type, "instant");
assert.equal(heavyRecommendation.serviceKey, "standard");

const unsafeClutterRecommendation = recommendResidentialService({
  propertyStatus: "occupied", requestedService: "standard", cleaningCategory: "residential",
  utilitiesAvailable: "yes", unsafeConditions: "no", clutter: "unsafe", buildup: "none", hazards: "none"
});
assert.equal(unsafeClutterRecommendation.type, "ineligible");
assert.equal(unsafeClutterRecommendation.internalReason, "ineligible_clutter_access");
assert.equal(unsafeClutterRecommendation.reviewUrl, undefined);

console.log("Clutter access pricing tests passed.");
