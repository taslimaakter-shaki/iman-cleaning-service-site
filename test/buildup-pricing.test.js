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

const affectedUnit = () => ({ ...unit(), buildupAreas: { bedrooms: 1 } });

const noKitchen = calculateResidentialQuoteBundle([{
  ...unit(),
  kitchens: 0,
  refrigerator: "",
  oven: "",
  cabinets: ""
}], "standard", { buildup: "none", clutter: "low", hazards: "none" });
assert.equal(noKitchen.units[0].kitchens, 0);
assert.equal(noKitchen.units[0].refrigerator, "no");
assert.equal(noKitchen.units[0].oven, "no");
assert.equal(noKitchen.units[0].cabinets, "no");
assert.equal(noKitchen.units[0].baseItems.some((item) => item.key === "kitchen"), false);

const units = [affectedUnit(), affectedUnit()];
const none = calculateResidentialQuoteBundle(units, "standard", { buildup: "none" });
const some = calculateResidentialQuoteBundle(units, "standard", { buildup: "some" });
const heavy = calculateResidentialQuoteBundle(units, "standard", { buildup: "heavy" });

assert.equal(none.baseLaborHours, 5);
assert.equal(none.manHours, 5);
assert.equal(none.buildupAdjustment.percentage, 0);
assert.equal(none.buildupAdjustment.amount, 0);

assert.equal(some.baseLaborHours, 5);
assert.equal(some.buildupAdjustment.percentage, 50);
assert.equal(some.buildupAdjustment.affectedAreaBasePrice, 100);
assert.equal(some.buildupAdjustment.addedLaborHours, 0.625);
assert.equal(some.buildupAdjustment.amount, 50);
assert.equal(some.manHours, 6);
assert.equal(some.subtotalCents, none.subtotalCents + 5000);
assert.equal(some.taxCents, none.taxCents + 444);
assert.equal(some.price, none.price + 54.44);

assert.equal(heavy.baseLaborHours, 5);
assert.equal(heavy.buildupAdjustment.percentage, 60);
assert.equal(heavy.buildupAdjustment.affectedAreaBasePrice, 100);
assert.equal(heavy.buildupAdjustment.addedLaborHours, 0.75);
assert.equal(heavy.buildupAdjustment.amount, 60);
assert.equal(heavy.manHours, 6);
assert.equal(heavy.subtotalCents, none.subtotalCents + 6000);
assert.equal(heavy.taxCents, none.taxCents + 533);
assert.equal(heavy.price, 465.33);
assert.deepEqual(some.units[0].buildupAreas, {
  bedrooms: 1, fullBathrooms: 0, halfBathrooms: 0, kitchens: 0,
  livingRooms: 0, diningRooms: 0, additionalRooms: 0
});

const oneAffectedUnit = calculateResidentialQuoteBundle([
  affectedUnit(),
  { ...unit(), buildupAreas: {} },
  { ...unit(), buildupAreas: {} },
  { ...unit(), buildupAreas: {} }
], "standard", { buildup: "some", clutter: "low", hazards: "none" });
assert.equal(oneAffectedUnit.buildupAdjustment.affectedAreas.length, 1);
assert.equal(oneAffectedUnit.buildupAdjustment.affectedAreas[0].unitNumber, 1);

assert.throws(
  () => calculateResidentialQuoteBundle([{ ...affectedUnit(), buildupAreas: { bedrooms: 2 } }], "standard", { buildup: "some" }),
  /buildup-affected bedrooms/
);

const kitchenOnly = calculateResidentialQuoteBundle([{
  ...unit(),
  bedrooms: 4,
  fullBathrooms: 3,
  kitchens: 1,
  refrigerator: "empty",
  oven: "yes",
  cabinets: "yes",
  cabinetCount: 1,
  drawerCount: 1,
  cabinetsEmpty: "yes",
  buildupAreas: { kitchens: 1 }
}], "deep", { buildup: "some", clutter: "low", hazards: "none" });
assert.equal(kitchenOnly.buildupAdjustment.affectedAreaBasePrice, 174.5);
assert.equal(kitchenOnly.buildupAdjustment.amount, 87.25);
assert.equal(kitchenOnly.buildupAdjustment.addedLaborHours, 87.25 / 80);
assert.equal(kitchenOnly.units[0].cabinetsEmpty, "yes", "Other residential services retain cabinet readiness when selected");

const movingKitchen = calculateResidentialQuoteBundle([{
  ...unit(),
  kitchens: 1,
  excludeKitchenItems: "no"
}], "move", { movingDirection: "move-in", buildup: "none", clutter: "low", hazards: "none" });
assert.equal(movingKitchen.units[0].cabinets, "included");
assert.equal(movingKitchen.units[0].cabinetsEmpty, "", "Moving Cleaning does not create an unused cabinet-readiness answer");
assert.throws(
  () => calculateResidentialQuoteBundle([unit()], "standard", { buildup: "heavy" }),
  /Select at least one buildup-affected area/
);

const heavyRecommendation = recommendResidentialService({
  propertyStatus: "occupied",
  requestedService: "standard",
  cleaningCategory: "residential",
  buildup: "heavy",
  clutter: "low",
  hazards: "none"
});
assert.equal(heavyRecommendation.type, "instant");
assert.equal(heavyRecommendation.serviceKey, "standard");

for (const quote of [some, heavy]) {
  assert.equal(quote.manHours % 0.5, 0);
  assert.equal(quote.manHours, Math.ceil((quote.total / 80) * 2) / 2);
  assert.equal(quote.priceCents, quote.subtotalCents + quote.taxCents);
  const adjustmentItem = quote.units[0].addOns.find((item) => item.key === "buildup_adjustment");
  assert.ok(adjustmentItem, "buildup adjustment must be itemized");
  assert.equal(adjustmentItem.amount, quote.buildupAdjustment.amount);
}

const mixedKitchenConditions = {
  ...unit(),
  kitchens: 3,
  buildupAreas: { kitchens: 2, fullBathrooms: 1 },
  grease: "heavy",
  clutterAreas: { kitchens: 1 }
};
const mixedQuote = calculateResidentialQuoteBundle([mixedKitchenConditions], "standard", {
  buildup: "some", clutter: "moderate", hazards: "none"
});
const kitchenAdjustments = mixedQuote.buildupAdjustment.affectedAreas.filter(area => area.key === "kitchens");
assert.deepEqual(kitchenAdjustments.map(({ quantity, percentage }) => ({ quantity, percentage })), [
  { quantity: 2, percentage: 50 },
  { quantity: 3, percentage: 60 }
]);
assert.equal(mixedQuote.buildupAdjustment.affectedAreas.find(area => area.key === "full_bathrooms").percentage, 50);
assert.equal(mixedQuote.clutterAdjustment.amount, 20);
assert.throws(() => calculateResidentialQuoteBundle([{
  ...mixedKitchenConditions, grease: "invalid"
}], "standard", { buildup: "some" }), /kitchen buildup level/);

const kitchenWithAddOns = calculateResidentialQuoteBundle([{
  ...unit(), kitchens: 1, refrigerator: "empty", oven: "yes", cabinets: "yes",
  cabinetCount: 5, drawerCount: 0, cabinetsEmpty: "yes",
  buildupAreas: { kitchens: 1 }, grease: "heavy"
}], "standard", { buildup: "some" });
const addOnPrice = key => kitchenWithAddOns.units[0].addOns.find(item => item.key === key).amount;
const greaseBase = 50 + addOnPrice("oven") + addOnPrice("cabinets");
const dirtBase = greaseBase + addOnPrice("refrigerator");
assert.deepEqual(kitchenWithAddOns.buildupAdjustment.affectedAreas.map(area => area.baseAreaPrice), [dirtBase, greaseBase]);
assert.equal(kitchenWithAddOns.buildupAdjustment.amountCents, Math.round(dirtBase * 50) + Math.round(greaseBase * 60));

const moveKitchen = calculateResidentialQuoteBundle([{
  ...unit(), kitchens: 1, grease: "heavy"
}], "move", {});
assert.equal(moveKitchen.buildupAdjustment.affectedAreaBasePrice, 110);
assert.equal(moveKitchen.buildupAdjustment.amount, 66);

const perUnitGrease = calculateResidentialQuoteBundle([
  { ...unit(), kitchens: 1, grease: "none" },
  { ...unit(), kitchens: 1, grease: "some" },
  { ...unit(), kitchens: 2, grease: "heavy" },
  { ...unit(), kitchens: 0, grease: "heavy" }
], "standard", {});
assert.deepEqual(perUnitGrease.buildupAdjustment.affectedAreas.map(({ unitNumber, quantity, percentage }) => (
  { unitNumber, quantity, percentage }
)), [
  { unitNumber: 2, quantity: 1, percentage: 50 },
  { unitNumber: 3, quantity: 2, percentage: 60 }
]);
assert.equal(perUnitGrease.buildupAdjustment.amount, 85);

const moveKitchens = calculateResidentialQuoteBundle([{
  ...unit(), kitchens: 2, grease: "heavy"
}], "move", {});
assert.equal(moveKitchens.buildupAdjustment.affectedAreaBasePrice, 220);
assert.equal(moveKitchens.buildupAdjustment.amount, 132);
const moveWithoutFridge = calculateResidentialQuoteBundle([{
  ...unit(), kitchens: 1, grease: "heavy", excludeKitchenItems: "yes",
  excludeRefrigerator: "yes", excludeOven: "no", excludeCabinets: "no"
}], "move", {});
assert.equal(moveWithoutFridge.buildupAdjustment.amount, 66);

console.log("Buildup pricing tests passed, including per-unit kitchen grease and refrigerator exclusions.");
