const assert = require("node:assert/strict");
const { calculateResidentialQuoteBundle, recommendResidentialService } = require("../api/booking/_shared");

const eligibility = {
  propertyStatus: "renovated",
  requestedService: "post",
  constructionFinished: "yes",
  contractorItemsRemoved: "yes",
  hazards: "none",
  buildup: "none",
  clutter: "low",
  propertyHasPets: "no"
};

const unit = {
  bedrooms: 2,
  fullBathrooms: 2,
  halfBathrooms: 0,
  kitchens: 1,
  livingRooms: 1,
  diningRooms: 1,
  livingDining: "combined",
  additionalRooms: 0,
  refrigerator: "no",
  oven: "no",
  cabinets: "no",
  windowCleaning: "no",
  constructionAreas: { bedrooms: 2, fullBathrooms: 2, kitchens: 1, livingRooms: 1, diningRooms: 1 }
};

assert.equal(recommendResidentialService(eligibility).serviceKey, "post");
const quote = calculateResidentialQuoteBundle([unit], "post", eligibility);
assert.equal(quote.serviceKey, "post");
assert.equal(quote.units[0].basePrice, 580);
assert.equal(quote.units[0].constructionAreas.bedrooms, 2);

assert.throws(
  () => calculateResidentialQuoteBundle([{ ...unit, constructionAreas: {} }], "post", eligibility),
  /construction dust or debris in any unit/
);
const twoUnitQuote = calculateResidentialQuoteBundle([
  unit,
  { ...unit, constructionAreas: {} }
], "post", eligibility);
assert.equal(twoUnitQuote.units[1].constructionAreas.bedrooms, 0);
assert.throws(
  () => calculateResidentialQuoteBundle([unit], "post", { ...eligibility, constructionFinished: "no" }),
  /requires all construction work to be finished/
);

console.log("Post-construction instant pricing and per-unit affected-room validation passed.");
