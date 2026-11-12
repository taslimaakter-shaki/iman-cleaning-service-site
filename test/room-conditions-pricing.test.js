const assert = require("node:assert/strict");
const model = require("../booking-conditions");
const { calculateResidentialQuoteBundle: quote } = require("../api/booking/_shared");
const eligibility = { roomConditionVersion: 2, hazards: "none", clutter: "low", buildup: "none" };
const base = () => ({ bedrooms: 2, fullBathrooms: 1, halfBathrooms: 0, kitchens: 2,
  livingRooms: 2, diningRooms: 1, livingDining: "combined", additionalRooms: 1,
  additionalRoomTypes: { office: 1 }, refrigerator: "no", oven: "no", cabinets: "no" });
const withLight = unit => ({ ...unit, roomConditions: Object.fromEntries(model.roomsForUnit(unit).map(room => [room.id,
  { clutter: "low", ...(model.applicable(room, "dust") ? { dust: "none" } : {}), ...(model.applicable(room, "buildup") ? { buildup: "none" } : {}), ...(room.key === "kitchens" ? { grease: "none" } : {}),
    ...(model.applicable(room, "mold") ? { mold: "none" } : {}) }])) });
const unit = withLight(base());
unit.roomConditions["bedrooms:2"].clutter = "several"; // 50 * 50% = 25
unit.roomConditions["kitchens:1"].clutter = "heavy"; // 50 * 60% = 30
unit.roomConditions["additionalRooms:1"].clutter = "moderate"; // 50 * 40% = 20
unit.roomConditions["bedrooms:1"].dust = "some"; // Moderate dust is included.
unit.roomConditions["fullBathrooms:1"].buildup = "heavy"; // 50 * 60% = 30
unit.roomConditions["combinedLivingDining:1"].dust = "some"; // Moderate dust is included.
unit.roomConditions["livingRooms:2"].dust = "heavy"; // unpaired room: 50 * 40% = 20
unit.roomConditions["kitchens:1"].grease = "some"; // 50 * 50% = 25
unit.roomConditions["kitchens:2"].grease = "heavy"; // 50 * 60% = 30
const mixed = quote([unit], "standard", eligibility);
assert.equal(mixed.basePrice, 430);
assert.equal(mixed.clutterAdjustment.amount, 75);
assert.equal(mixed.dustAdjustment.amount, 20);
assert.equal(mixed.buildupAdjustment.amount, 85);
assert.equal(mixed.priceCents, 62598); // base includes tax; condition taxes total 15.98
assert.equal(mixed.manHours, 8);
assert.equal(mixed.dustAdjustment.affectedAreas.find(area => area.roomId === "livingRooms:2").baseAreaPrice, 50);
assert.deepEqual(mixed.units[0].roomConditions, unit.roomConditions);
const oldCounts = quote([{ ...unit, buildupAreas: { bedrooms: 20 }, clutterAreas: { kitchens: 20 }, grease: "heavy" }], "standard", eligibility);
assert.equal(oldCounts.priceCents, mixed.priceCents, "Edited older quotes use the new room answers, not stale legacy counts or unit-level grease");

const kitchen = withLight({ ...base(), bedrooms: 0, fullBathrooms: 0, livingRooms: 0, diningRooms: 0, livingDining: "none", additionalRooms: 0, additionalRoomTypes: {}, kitchens: 1,
  refrigerator: "empty", oven: "yes", cabinets: "yes", cabinetCount: 1, drawerCount: 1, cabinetsEmpty: "yes" });
kitchen.roomConditions["kitchens:1"] = { clutter: "moderate", grease: "heavy" };
const withFridge = quote([kitchen], "deep", eligibility);
const withoutFridge = quote([{ ...kitchen, refrigerator: "no" }], "deep", eligibility);
const greaseFee = result => result.buildupAdjustment.affectedAreas.find(area => area.conditionType === "grease");
assert.equal(greaseFee(withFridge).baseAreaPrice, 134.5); // kitchen 80 + oven 50 + cabinets/drawer 4.5
assert.equal(greaseFee(withFridge).amount, 80.7);
assert.equal(greaseFee(withFridge).amount, greaseFee(withoutFridge).amount);
assert.equal(withFridge.buildupAdjustment.amount, 80.7); // Kitchen has grease only; no separate dirt fee.
assert.equal(withFridge.clutterAdjustment.amount, 69.8);

const moving = quote([{ ...kitchen, excludeKitchenItems: "no" }], "move", eligibility);
assert.equal(greaseFee(moving).baseAreaPrice, 110);
const movingNoFridge = quote([{ ...kitchen, excludeKitchenItems: "yes", excludeOven: "no", excludeCabinets: "no", excludeRefrigerator: "yes" }], "move", eligibility);
assert.equal(greaseFee(movingNoFridge).amount, greaseFee(moving).amount);

const secondUnit = withLight({ ...base(), bedrooms: 1, fullBathrooms: 0, kitchens: 0, livingRooms: 0, diningRooms: 0, livingDining: "none", additionalRooms: 0, additionalRoomTypes: {} });
secondUnit.roomConditions["bedrooms:1"].clutter = "heavy";
const multi = quote([unit, secondUnit], "standard", eligibility);
assert.equal(multi.units[1].addOns.find(item => item.key === "clutter_adjustment").amount, 30);
assert.equal(multi.units[0].addOns.find(item => item.key === "clutter_adjustment").amount, 75);
assert.equal(Math.round(multi.units.flatMap(unit => unit.addOns).filter(item => item.key === "clutter_adjustment").reduce((sum, item) => sum + item.taxAmount, 0) * 100), multi.clutterAdjustment.taxCents);
assert.equal(multi.priceCents, multi.subtotalCents + multi.taxCents);

for (const mutate of [
  value => { delete value.roomConditions; },
  value => { delete value.roomConditions["bedrooms:1"]; },
  value => { delete value.roomConditions["bedrooms:1"].clutter; },
  value => { delete value.roomConditions["bedrooms:1"].dust; },
  value => { delete value.roomConditions["fullBathrooms:1"].buildup; },
  value => { delete value.roomConditions["kitchens:1"].grease; },
  value => { value.roomConditions["bedrooms:1"].clutter = ""; },
  value => { value.roomConditions["bedrooms:1"].clutter = "invalid"; },
  value => { value.roomConditions["bedrooms:1"].grease = "heavy"; },
  value => { value.roomConditions["kitchens:1"].buildup = "heavy"; },
  value => { value.roomConditions["bedrooms:99"] = { clutter: "heavy", buildup: "none" }; },
  value => { value.roomConditions = []; }
]) {
  const invalid = structuredClone(unit);
  mutate(invalid);
  assert.throws(() => quote([invalid], "standard", eligibility), error => error.statusCode === 400);
}
// New quotes require explicit answers for every applicable room and condition.
assert.throws(() => quote([base()], "standard", eligibility), /Choose clutter for Bedroom 1 in Unit 1/);
assert.throws(() => quote([{ ...base(), roomConditions: { "bedrooms:1": { clutter: "heavy" } } }], "standard", eligibility), /Choose dust & dirt for Bedroom 1 in Unit 1/);
assert.throws(() => quote([unit, base()], "standard", {}), /Choose clutter for Bedroom 1 in Unit 2/);
assert.throws(() => quote([unit], "standard", { roomConditionVersion: 999 }), /refresh the quote/);
assert.throws(() => quote([null], "standard", eligibility), error => error.statusCode === 400);
const removedKitchen = { ...unit, kitchens: 1 };
removedKitchen.roomConditions = model.reconcile(removedKitchen);
assert.equal(removedKitchen.roomConditions["kitchens:2"], undefined);
assert.equal(removedKitchen.roomConditions["kitchens:1"].grease, "some");
const addedBedroom = { ...removedKitchen, bedrooms: 3 };
addedBedroom.roomConditions = model.reconcile(addedBedroom);
assert.deepEqual(addedBedroom.roomConditions["bedrooms:3"], {});
assert.throws(() => quote([addedBedroom], "standard", eligibility), /Choose clutter for Bedroom 3/);
addedBedroom.roomConditions["bedrooms:3"] = { clutter: "low", dust: "none" };
assert.deepEqual(quote([addedBedroom], "standard", eligibility).units[0].roomConditions["bedrooms:3"], { clutter: "low", dust: "none" });
for (const service of ["standard", "deep", "move", "post", "recurring"]) {
  const details = { ...base(), constructionAreas: { fullBathrooms: 1 } };
  const answers = { hazards: "none", clutter: "low", buildup: "none", movingDirection: "move-in", constructionFinished: "yes", contractorItemsRemoved: "yes" };
  const legacy = quote([details], service, answers);
  const light = quote([withLight(details)], service, { ...answers, roomConditionVersion: 2 });
  assert.equal(light.priceCents, legacy.priceCents, `${service}: Light conditions preserve the base price`);
  assert.equal(light.manHours, legacy.manHours);
}

// Bathroom-only buildup applies across units and skips kitchens entirely.
assert.deepEqual(model.roomsForUnit(unit).filter(room => model.applicable(room, "buildup")).map(room => room.id), ["fullBathrooms:1"]);
assert.equal(model.roomsForUnit(kitchen).some(room => model.applicable(room, "buildup")), false);
assert.equal(withFridge.buildupAdjustment.affectedAreas.every(area => area.conditionType === "grease"), true);
const bathrooms = withLight({ ...base(), bedrooms: 0, fullBathrooms: 1, halfBathrooms: 1, kitchens: 0,
  livingRooms: 0, diningRooms: 0, additionalRooms: 0, additionalRoomTypes: {} });
bathrooms.roomConditions["fullBathrooms:1"].buildup = "some";
bathrooms.roomConditions["halfBathrooms:1"].buildup = "heavy";
const bathroomsOnly = quote([bathrooms, kitchen], "standard", eligibility);
assert.deepEqual(bathroomsOnly.buildupAdjustment.affectedAreas.filter(area => area.conditionType === "buildup")
  .map(area => [area.unitNumber, area.roomId, area.amount]), [[1, "fullBathrooms:1", 25], [1, "halfBathrooms:1", 18]]);
// Existing version-1 quotes retain their accepted kitchen dirt and grease prices.
const legacyKitchen = structuredClone(kitchen);
legacyKitchen.roomConditions["kitchens:1"].buildup = "some";
const legacyKitchenQuote = quote([legacyKitchen], "deep", { ...eligibility, roomConditionVersion: 1 });
assert.equal(legacyKitchenQuote.buildupAdjustment.amount, 167.95);
assert.equal(legacyKitchenQuote.buildupAdjustment.roomConditionVersion, 1);
// Editing an older draft removes its obsolete kitchen buildup answer, retaining grease.
legacyKitchen.roomConditions = model.reconcile(legacyKitchen);
assert.deepEqual(legacyKitchen.roomConditions["kitchens:1"], { clutter: "moderate", grease: "heavy" });
assert.equal(quote([legacyKitchen], "deep", eligibility).buildupAdjustment.amount, 80.7);
assert.equal(quote([legacyKitchen], "deep", {}).buildupAdjustment.amount, 80.7, "Unversioned new room answers use current pricing");

console.log("Required room conditions: missing/partial-answer rejection, independent levels, paired rooms, kitchen extras, fridge exclusion, additive fees, unit allocation and legacy quote compatibility passed.");
