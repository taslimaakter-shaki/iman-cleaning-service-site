const assert = require("node:assert/strict");
const model = require("../booking-conditions");
const { calculateResidentialQuoteBundle: quote } = require("../api/booking/_shared");

const eligibility = { roomConditionVersion: 3, movingKitchenPricingVersion: 1, requestedService: "move", movingDirection: "move-out" };
const unit = {
  bedrooms: 1, fullBathrooms: 1, halfBathrooms: 0, kitchens: 1,
  livingRooms: 1, diningRooms: 1, livingDining: "combined", additionalRooms: 0,
  movingKitchens: [{ excludeKitchenItems: "no", cabinetCount: 12, drawerCount: 6 }],
  roomConditions: {
    "bedrooms:1": { dust: "heavy" },
    "fullBathrooms:1": { buildup: "some", mold: "some" },
    "kitchens:1": { grease: "some" },
    "combinedLivingDining:1": { dust: "none" }
  }
};
const current = quote([unit, unit], "move", eligibility);
assert.equal(current.clutterAdjustment.amountCents, 0);
assert.equal(current.clutterAdjustment.totalCents, 0);
assert.deepEqual(current.clutterAdjustment.affectedAreas, []);
assert.ok(current.dustAdjustment.amount > 0);
assert.ok(current.buildupAdjustment.affectedAreas.some(area => area.conditionType === "buildup"));
assert.ok(current.buildupAdjustment.affectedAreas.some(area => area.conditionType === "grease"));
assert.ok(current.moldAdjustment.amount > 0);
assert.ok(current.units.every(unit => !unit.addOns.some(item => item.key === "clutter_adjustment")));
assert.equal(current.priceCents, current.subtotalCents + current.taxCents);

// Legacy global answers cannot add a hidden clutter fee to a new Moving quote.
assert.equal(quote([{ ...unit, clutterAreas: { bedrooms: 1, kitchens: 1 } }, unit], "move", { ...eligibility, clutter: "heavy" }).priceCents, current.priceCents);

// Other applicable conditions remain required, even though clutter is omitted.
for (const [room, kind] of [["bedrooms:1", "dust"], ["fullBathrooms:1", "buildup"], ["fullBathrooms:1", "mold"], ["kitchens:1", "grease"]]) {
  const missing = structuredClone(unit);
  delete missing.roomConditions[room][kind];
  assert.throws(() => quote([missing], "move", eligibility), error => error.statusCode === 400);
}

// Old saved Moving quotes retain their clutter fee and can still be recalculated.
const old = structuredClone(unit);
Object.values(old.roomConditions).forEach(answers => { answers.clutter = "heavy"; });
const legacy = quote([old], "move", { ...eligibility, roomConditionVersion: 2 });
assert.ok(legacy.clutterAdjustment.amount > 0);
assert.equal(legacy.priceCents - quote([unit], "move", eligibility).priceCents, legacy.clutterAdjustment.totalCents);
assert.throws(() => quote([old], "move", eligibility), /Review the condition answers/);

// Editing or switching to Moving removes stale clutter while retaining other answers.
assert.deepEqual(model.reconcile(old, "move"), unit.roomConditions);
const edited = { ...old, roomConditions: model.reconcile(old, "move") };
assert.equal(quote([edited], "move", eligibility).priceCents, quote([unit], "move", eligibility).priceCents);
assert.equal(quote([old], "move", { ...eligibility, roomConditionVersion: 2 }).priceCents, legacy.priceCents);
for (const service of ["standard", "deep", "recurring", "post"]) {
  assert.throws(() => model.validate(edited, 1, 3, service), /Choose clutter/);
  assert.deepEqual(model.validate(old, 1, 3, service), old.roomConditions);
}

console.log("Moving quotes skip clutter, preserve other required conditions, discard stale draft answers and retain legacy prices.");
