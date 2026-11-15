const assert = require("node:assert/strict");
const model = require("../booking-moving-kitchens");
const { calculateResidentialQuoteBundle: quote } = require("../api/booking/_shared");
const eligibility = { roomConditionVersion: 2, movingKitchenPricingVersion: 1, requestedService: "move" };
const all = () => ({ excludeKitchenItems: "no", cabinetCount: 12, drawerCount: 6 });
const selections = (oven = "no", refrigerator = "no", cabinets = "no") => ({
  ...all(), excludeKitchenItems: "yes", excludeOven: oven, excludeRefrigerator: refrigerator, excludeCabinets: cabinets
});
const unit = (kitchens = [all()]) => ({ bedrooms: 0, fullBathrooms: 0, halfBathrooms: 0, kitchens: kitchens.length,
  livingRooms: 0, diningRooms: 0, livingDining: "none", additionalRooms: 0, movingKitchens: kitchens,
  roomConditions: Object.fromEntries(kitchens.map((_, index) => [`kitchens:${index + 1}`, { clutter: "low", grease: "none" }])) });
const price = u => quote([u], "move", eligibility);
assert.equal(price(unit()).priceCents, 21500);
for (const oven of ["no", "yes"]) for (const fridge of ["no", "yes"]) for (const cabinets of ["no", "yes"]) {
  const p = price(unit([selections(oven, fridge, cabinets)]));
  assert.equal(p.priceCents, (80 + (oven === "no" ? 50 : 0) + (fridge === "no" ? 40 : 0) + (cabinets === "no" ? 45 : 0)) * 100);
  assert.equal(p.units[0].movingKitchens[0].cabinetCount, cabinets === "yes" ? 0 : 12);
}
assert.equal(price(unit([{ ...all(), cabinetCount: 1, drawerCount: 0 }])).priceCents, 17300);
assert.equal(price(unit([{ ...all(), cabinetsEmpty: "no", refrigeratorPrice: 1, cabinetPrice: 1, basePrice: 1 }])).priceCents, 21500,
  "The server derives empty-item prices instead of trusting submitted rates or readiness");
const greased = unit();
greased.roomConditions["kitchens:1"].grease = "some";
assert.equal(price(greased).buildupAdjustment.amount, 87.5);
assert.equal(price(greased).priceCents, 31027);
greased.roomConditions["kitchens:1"].grease = "heavy";
assert.equal(price(greased).buildupAdjustment.amount, 105);
greased.movingKitchens[0] = selections("no", "yes", "no");
assert.equal(price(greased).buildupAdjustment.amount, 105, "Refrigerator inclusion never changes the grease charge");
const multi = unit([all(), selections("yes", "yes", "yes")]);
multi.roomConditions["kitchens:1"] = { clutter: "moderate", grease: "some" };
multi.roomConditions["kitchens:2"] = { clutter: "heavy", grease: "heavy" };
const mixed = price(multi);
assert.equal(mixed.clutterAdjustment.amount, 86 + 48);
assert.equal(mixed.buildupAdjustment.amount, 87.5 + 48, "Each kitchen uses its own included items, not averaged extras");
assert.deepEqual(mixed.buildupAdjustment.affectedAreas.map(a => a.baseAreaPrice), [175, 80]);
assert.equal(quote([unit(), unit([selections("yes", "yes", "yes")])], "move", eligibility).priceCents, 29500);
assert.equal(price({ ...unit([]), bedrooms: 1, roomConditions: { "bedrooms:1": { clutter: "low", dust: "none" } } }).priceCents, 8000);
for (const invalid of ["", " ", -1, 0, 101, 1.5, true, null, {}, []]) {
  assert.throws(() => price(unit([{ ...all(), cabinetCount: invalid }])), /cabinet doors/);
}
for (const invalid of ["", -1, 101, 1.5, null]) {
  assert.throws(() => price(unit([{ ...all(), drawerCount: invalid }])), /drawers/);
}
assert.throws(() => price({ ...unit(), movingKitchens: [] }), /kitchen selections/);
assert.throws(() => price(unit([{}])), /include or exclude/);
assert.throws(() => price(unit([{ ...selections(), excludeOven: "" }])), /include or exclude/);
assert.throws(() => quote([unit()], "move", { ...eligibility, movingKitchenPricingVersion: 99 }), /refresh/);
assert.throws(() => quote([unit()], "move", { movingKitchenPricingVersion: 1 }), /refresh/);
const legacy = { ...unit(), excludeKitchenItems: "no" };
assert.equal(quote([legacy], "move", { roomConditionVersion: 2 }).priceCents, 15000, "Old quotes retain bundled pricing even if an edited draft has new fields");
legacy.roomConditions["kitchens:1"].grease = "some";
assert.equal(quote([legacy], "move", { roomConditionVersion: 2 }).priceCents, 20988);
assert.equal(quote([{ ...legacy, ...selections("yes", "yes", "yes"), roomConditions: { "kitchens:1": { clutter: "low", grease: "none" } } }], "move", { roomConditionVersion: 2 }).priceCents, 1000);
for (const [service, expected] of [["standard", 18500], ["deep", 21500]]) {
  const u = { ...unit(), refrigerator: "empty", oven: "yes", cabinets: "yes", cabinetCount: 12, drawerCount: 6, cabinetsEmpty: "yes" };
  assert.equal(quote([u], service, { roomConditionVersion: 2 }).priceCents, expected);
}
const draft = { kitchens: 2 };
let questions = model.questions(draft);
assert.deepEqual(questions.map(q => q.key), ["excludeKitchenItems", "excludeKitchenItems"]);
assert.match(questions[1].question, /Kitchen 2/);
model.setAnswer(draft, questions[0], "no");
questions = model.questions(draft);
assert.deepEqual(questions.filter(q => q.kitchenIndex === 0).map(q => q.key), ["excludeKitchenItems", "cabinetCount", "drawerCount"]);
model.setAnswer(draft, questions.find(q => q.key === "cabinetCount"), "12");
model.setAnswer(draft, questions.find(q => q.key === "drawerCount"), "6");
model.setAnswer(draft, questions[0], "yes");
questions = model.questions(draft);
model.setAnswer(draft, questions.find(q => q.key === "excludeCabinets"), "yes");
assert.equal(draft.movingKitchens[0].cabinetCount, "");
assert.equal(model.questions(draft).some(q => q.kitchenIndex === 0 && q.key === "cabinetCount"), false);
model.setAnswer(draft, questions.find(q => q.key === "excludeCabinets"), "no");
assert.equal(model.questions(draft).some(q => q.kitchenIndex === 0 && q.key === "cabinetCount"), true);
draft.kitchens = 1; model.reconcile(draft);
assert.equal(draft.movingKitchens.length, 1);
draft.kitchens = 2; model.reconcile(draft);
assert.equal(draft.movingKitchens[1].excludeKitchenItems, "", "A removed kitchen does not retain stale answers when added again");
draft.kitchens = 0;
assert.deepEqual(model.questions(draft), []);
console.log("Moving kitchen pricing: itemized empty interiors, all exclusions, per-kitchen conditions, required counts, question branches and legacy prices passed.");
