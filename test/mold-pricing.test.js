const assert = require("node:assert/strict");
const { calculateResidentialQuoteBundle, recommendResidentialService } = require("../api/booking/_shared");

const baseUnit = {
  bedrooms: 2,
  fullBathrooms: 1,
  halfBathrooms: 1,
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
};

const noMold = calculateResidentialQuoteBundle([baseUnit], "standard", { hazards: "none", buildup: "none" });
const withMold = calculateResidentialQuoteBundle([{
  ...baseUnit,
  moldBathrooms: "yes",
  moldFullBathrooms: 1,
  moldHalfBathrooms: 1,
  moldKitchen: "yes",
  moldBedrooms: "yes",
  moldBedroomCount: 1,
  moldLivingRoom: "yes"
}], "standard", { hazards: "mold", moldCleaningRequested: "yes", buildup: "none" });

assert.equal(withMold.moldAdjustment.percentage, 50);
assert.equal(withMold.moldAdjustment.affectedAreas.length, 5);
assert.equal(withMold.moldAdjustment.amount, 115);
assert.equal(withMold.moldAdjustment.tax, 10.21);
assert.equal(withMold.subtotalCents, noMold.subtotalCents + 11500);
assert.equal(withMold.taxCents, noMold.taxCents + 1021);
assert.equal(withMold.price, noMold.price + 125.21);
assert.equal(withMold.manHours, Math.ceil((withMold.total / 80) * 2) / 2);
assert.equal(withMold.units[0].addOns.filter((item) => item.key.startsWith("mold_adjustment_")).length, 5);

const counterMold = calculateResidentialQuoteBundle([{
  ...baseUnit,
  kitchens: 1,
  livingRooms: 1,
  additionalRooms: 2,
  additionalRoomTypes: { office: 1, storage: 1 },
  moldAreas: {
    bedrooms: 2,
    fullBathrooms: 1,
    halfBathrooms: 0,
    kitchens: 1,
    livingRooms: 1,
    additionalRooms: 2
  }
}], "standard", { hazards: "mold", moldCleaningRequested: "yes", buildup: "none" });
assert.equal(counterMold.moldAdjustment.affectedAreas.length, 5);
assert.equal(counterMold.units[0].moldAdditionalRoomCount, 2);
assert.equal(counterMold.units[0].moldBedroomCount, 2);
assert.equal(counterMold.units[0].moldKitchenCount, 1);

const combinedConditions = calculateResidentialQuoteBundle([{
  ...baseUnit,
  kitchens: 1,
  buildupAreas: { kitchens: 1 },
  clutterAreas: { halfBathrooms: 1 },
  moldAreas: { bedrooms: 1 }
}], "deep", {
  buildup: "some",
  clutter: "moderate",
  hazards: "mold",
  moldCleaningRequested: "yes"
});
assert.equal(combinedConditions.buildupAdjustment.amount, 40);
assert.equal(combinedConditions.clutterAdjustment.amount, 24);
assert.equal(combinedConditions.moldAdjustment.amount, 40);
assert.equal(combinedConditions.manHours, Math.ceil((combinedConditions.total / 80) * 2) / 2);

const kitchenMoldWithAddOns = calculateResidentialQuoteBundle([{
  ...baseUnit,
  kitchens: 1,
  refrigerator: "empty",
  oven: "yes",
  cabinets: "yes",
  cabinetCount: 1,
  drawerCount: 1,
  cabinetsEmpty: "yes",
  moldAreas: { kitchens: 1 }
}], "deep", {
  buildup: "none",
  clutter: "low",
  hazards: "mold",
  moldCleaningRequested: "yes"
});
assert.equal(kitchenMoldWithAddOns.moldAdjustment.affectedAreaBasePrice, 154.5);
assert.equal(kitchenMoldWithAddOns.moldAdjustment.amount, 77.25);
assert.equal(kitchenMoldWithAddOns.manHours, Math.ceil((kitchenMoldWithAddOns.total / 80) * 2) / 2);

assert.throws(() => calculateResidentialQuoteBundle([{
  ...baseUnit,
  kitchens: 1,
  moldAreas: { kitchens: 2 }
}], "standard", { hazards: "mold", moldCleaningRequested: "yes" }), /affected kitchens|whole number/i);

assert.throws(() => calculateResidentialQuoteBundle([{
  ...baseUnit,
  moldBathrooms: "yes",
  moldFullBathrooms: 2,
  moldHalfBathrooms: 0,
  moldKitchen: "no",
  moldBedrooms: "no",
  moldLivingRoom: "no"
}], "standard", { hazards: "mold", moldCleaningRequested: "yes" }), /whole number|affected full bathrooms/i);

const moldNotRequested = calculateResidentialQuoteBundle([baseUnit], "standard", {
  hazards: "mold",
  moldCleaningRequested: "no",
  buildup: "none"
});
assert.equal(moldNotRequested.moldAdjustment.amount, 0);
assert.equal(moldNotRequested.price, noMold.price);

const recommendation = recommendResidentialService({
  propertyStatus: "occupied",
  requestedService: "standard",
  cleaningCategory: "residential",
  clutter: "low",
  buildup: "none",
  hazards: "mold"
});
assert.equal(recommendation.type, "instant");
assert.equal(recommendation.serviceKey, "standard");

console.log("Possible mold room-pricing tests passed.");
