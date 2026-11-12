const assert = require("node:assert/strict");
const model = require("../booking-conditions");
const { calculateResidentialQuoteBundle: quote } = require("../api/booking/_shared");
const eligibility = { roomConditionVersion: 1, hazards: "none", clutter: "low", buildup: "none",
  movingDirection: "move-in", constructionFinished: "yes", contractorItemsRemoved: "yes" };
const makeUnit = (overrides = {}) => {
  const unit = { bedrooms: 1, fullBathrooms: 1, halfBathrooms: 1, kitchens: 1, livingRooms: 0,
    diningRooms: 0, additionalRooms: 0, refrigerator: "no", oven: "no", cabinets: "no",
    constructionAreas: { fullBathrooms: 1 }, ...overrides };
  unit.roomConditions = Object.fromEntries(model.roomsForUnit(unit).map(room => [room.id, {
    clutter: "low", buildup: "none", ...(room.key === "kitchens" ? { grease: "none" } : {}),
    ...(model.applicable(room, "mold") ? { mold: "none" } : {})
  }]));
  return unit;
};
const light = makeUnit();
const noMold = quote([light], "standard", eligibility);
assert.equal(noMold.moldAdjustment.amountCents, 0);
assert.equal(noMold.units[0].addOns.filter(item => item.key.startsWith("mold_adjustment_")).length, 0);

const mixed = makeUnit({ fullBathrooms: 2 });
mixed.roomConditions["fullBathrooms:1"].mold = "some";
mixed.roomConditions["halfBathrooms:1"].mold = "heavy";
const otherUnit = makeUnit({ bedrooms: 0, halfBathrooms: 0, kitchens: 0 });
otherUnit.roomConditions["fullBathrooms:1"].mold = "heavy";
const result = quote([mixed, otherUnit], "standard", eligibility);
assert.equal(result.moldAdjustment.amount, 110); // Full $50 × 60%, half $30 × 100%, other unit full $50 × 100%.
assert.deepEqual(result.moldAdjustment.affectedAreas.map(area => [area.unitNumber, area.roomId, area.percentage, area.amount]),
  [[1, "fullBathrooms:1", 60, 30], [1, "halfBathrooms:1", 100, 30], [2, "fullBathrooms:1", 100, 50]]);
assert.equal(result.units[0].addOns.filter(item => item.key.startsWith("mold_adjustment_")).reduce((sum, item) => sum + item.amount, 0), 60);
assert.equal(result.units[1].addOns.find(item => item.key.startsWith("mold_adjustment_")).amount, 50);
assert.equal(result.units.reduce((sum, unit) => sum + unit.subtotalCents, 0), result.priceCents);
assert.equal(result.priceCents, result.subtotalCents + result.taxCents);

// Each condition uses the original bathroom price, with no percentage charged on another fee.
const stacked = makeUnit({ bedrooms: 0, kitchens: 0, halfBathrooms: 0 });
stacked.roomConditions["fullBathrooms:1"] = { clutter: "heavy", buildup: "heavy", mold: "some" };
const additive = quote([stacked], "standard", eligibility);
assert.equal(additive.clutterAdjustment.amount, 30);
assert.equal(additive.buildupAdjustment.amount, 30);
assert.equal(additive.moldAdjustment.amount, 30);
const stale = quote([{ ...stacked, moldAreas: { bedrooms: 20, kitchens: 20 }, moldFullBathrooms: 20 }], "standard",
  { ...eligibility, hazards: "mold", moldCleaningRequested: "yes" });
assert.equal(stale.priceCents, additive.priceCents, "Stale legacy mold counts must not add a second fee");

for (const [service, fullPrice, halfPrice] of [["standard", 50, 30], ["recurring", 50, 30],
  ["deep", 80, 60], ["move", 80, 60], ["post", 100, 60]]) {
  const unit = makeUnit();
  unit.roomConditions["fullBathrooms:1"].mold = "some";
  unit.roomConditions["halfBathrooms:1"].mold = "heavy";
  assert.equal(quote([unit], service, eligibility).moldAdjustment.amount, fullPrice * 0.6 + halfPrice, service);
}

// Three $30 fees have $7.99 aggregate tax, which must also match all displayed line items.
const thirds = makeUnit({ fullBathrooms: 3, halfBathrooms: 0 });
for (const answer of Object.values(thirds.roomConditions)) if ("mold" in answer) answer.mold = "some";
const rounded = quote([thirds], "standard", eligibility);
assert.equal(rounded.moldAdjustment.taxCents, 799);
assert.equal(Math.round(rounded.units[0].addOns.filter(item => item.key.startsWith("mold_adjustment_")).reduce((sum, item) => sum + item.taxAmount, 0) * 100), 799);
assert.equal(rounded.units[0].subtotalCents, rounded.priceCents);

for (const value of [undefined, "", "invalid", null]) {
  const invalid = makeUnit();
  invalid.roomConditions["fullBathrooms:1"].mold = value;
  assert.throws(() => quote([invalid], "standard", eligibility), error => error.statusCode === 400 && /bathroom mold/.test(error.message));
}
for (const id of ["bedrooms:1", "kitchens:1"]) {
  const invalid = makeUnit();
  invalid.roomConditions[id].mold = "some";
  assert.throws(() => quote([invalid], "standard", eligibility), error => error.statusCode === 400);
}
const noBath = makeUnit({ fullBathrooms: 0, halfBathrooms: 0, constructionAreas: {} });
assert.equal(quote([noBath], "standard", eligibility).moldAdjustment.amount, 0);
assert.equal(model.roomsForUnit(noBath).filter(room => model.applicable(room, "mold")).length, 0);
const changed = { ...mixed, fullBathrooms: 1, halfBathrooms: 2 };
changed.roomConditions = model.reconcile(changed);
assert.equal(changed.roomConditions["fullBathrooms:2"], undefined);
assert.equal(changed.roomConditions["fullBathrooms:1"].mold, "some");
changed.roomConditions["halfBathrooms:2"] = { clutter: "low", buildup: "none" };
assert.throws(() => quote([changed], "standard", eligibility), /Choose bathroom mold for Half bathroom 2/);
changed.roomConditions["halfBathrooms:2"].mold = "none";
assert.equal(quote([changed], "standard", eligibility).moldAdjustment.amount, 60);
console.log("Bathroom mold: per-bathroom rates, service bases, additive fees, required answers, room changes, tax allocation and legacy-count isolation passed.");
