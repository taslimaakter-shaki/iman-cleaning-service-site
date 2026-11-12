const assert = require("node:assert/strict");
const model = require("../booking-conditions");
const { calculateResidentialQuoteBundle: quote } = require("../api/booking/_shared");
const { pricingRows } = require("../api/booking/_payment-receipt-pdf");
const eligibility = { roomConditionVersion: 1, hazards: "none", clutter: "low", buildup: "none",
  constructionFinished: "yes", contractorItemsRemoved: "yes" };
function unit(overrides = {}) {
  const value = { bedrooms: 2, fullBathrooms: 1, halfBathrooms: 1, kitchens: 1, livingRooms: 1, diningRooms: 1,
    livingDining: "combined", additionalRooms: 1, additionalRoomTypes: { office: 1 },
    refrigerator: "no", oven: "no", cabinets: "no", constructionAreas: { bedrooms: 1 }, ...overrides };
  value.roomConditions = Object.fromEntries(model.roomsForUnit(value).map(room => [room.id,
    Object.fromEntries(Object.keys(model.definitions).filter(kind => model.applicable(room, kind))
      .map(kind => [kind, kind === "clutter" ? "low" : "none"]))]));
  return value;
}
const base = unit();
const light = quote([base], "standard", eligibility);
const moderate = structuredClone(base);
for (const answer of Object.values(moderate.roomConditions)) if ("dust" in answer) answer.dust = "some";
const included = quote([moderate], "standard", eligibility);
assert.equal(included.priceCents, light.priceCents, "Light and Moderate dust have the same total");
assert.equal(included.manHours, light.manHours);
assert.equal(included.dustAdjustment.amount, 0);
assert.equal(included.units[0].addOns.filter(item => item.key === "dust_adjustment").length, 0);

const heavy = structuredClone(moderate);
heavy.roomConditions["bedrooms:1"].dust = "heavy";
heavy.roomConditions["additionalRooms:1"].dust = "heavy";
heavy.roomConditions["combinedLivingDining:1"].dust = "heavy";
const charged = quote([heavy], "standard", eligibility);
assert.equal(charged.dustAdjustment.amount, 72); // Bedroom $50 × .4 + Office $50 × .4 + combined $80 × .4.
assert.equal(charged.dustAdjustment.taxCents, 639);
assert.equal(charged.priceCents - light.priceCents, 7839);
assert.equal(charged.units[0].subtotalCents, charged.priceCents);
assert.deepEqual(charged.dustAdjustment.affectedAreas.map(area => [area.label, area.amount]),
  [["Bedroom 1", 20], ["Living & dining area", 32], ["Office", 20]]);
assert.equal(charged.buildupAdjustment.amount, 0, "Dry rooms never also receive a buildup fee");
assert.equal(model.roomsForUnit(heavy).some(room => ["livingRooms", "diningRooms"].includes(room.key)), false,
  "Combined living and dining is one selectable area, not two extra rooms");

const separate = unit({ livingDining: "separate" });
separate.roomConditions["livingRooms:1"].dust = "heavy";
separate.roomConditions["diningRooms:1"].dust = "some";
assert.equal(quote([separate], "standard", eligibility).dustAdjustment.amount, 20);
separate.roomConditions["diningRooms:1"].dust = "heavy";
assert.equal(quote([separate], "standard", eligibility).dustAdjustment.amount, 40);
const unequal = unit({ livingRooms: 2 });
unequal.roomConditions["combinedLivingDining:1"].dust = "heavy";
unequal.roomConditions["livingRooms:2"].dust = "heavy";
assert.equal(quote([unequal], "standard", eligibility).dustAdjustment.amount, 52);

for (const [service, roomRate, combinedRate] of [["standard", 50, 80], ["deep", 80, 100],
  ["move", 80, 100], ["recurring", 50, 80], ["post", 90, 100]]) {
  assert.equal(quote([heavy], service, eligibility).dustAdjustment.amount, (roomRate * 2 + combinedRate) * 0.4, service);
}
const wet = unit({ bedrooms: 0, additionalRooms: 0, additionalRoomTypes: {}, livingRooms: 0, diningRooms: 0, constructionAreas: {} });
wet.roomConditions["fullBathrooms:1"].buildup = "some";
wet.roomConditions["halfBathrooms:1"].buildup = "heavy";
wet.roomConditions["kitchens:1"].buildup = "heavy";
wet.roomConditions["kitchens:1"].grease = "some";
const wetQuote = quote([wet], "standard", eligibility);
assert.equal(wetQuote.dustAdjustment.amount, 0);
assert.equal(wetQuote.buildupAdjustment.amount, 98); // Bathroom 25 + half 18 + kitchen 30 + grease 25.
assert.equal(model.roomsForUnit(wet).filter(room => model.applicable(room, "dust")).length, 0);
const cluttered = structuredClone(heavy);
cluttered.roomConditions["bedrooms:1"].clutter = "heavy";
assert.equal(quote([cluttered], "standard", eligibility).dustAdjustment.amount, 72, "Dust uses the base room price without compounding clutter");

for (const value of [undefined, "", "invalid", null]) {
  const missing = structuredClone(base);
  missing.roomConditions["bedrooms:1"].dust = value;
  assert.throws(() => quote([missing], "standard", eligibility), error => error.statusCode === 400 && /dust & dirt/.test(error.message));
}
for (const [id, kind] of [["kitchens:1", "dust"], ["fullBathrooms:1", "dust"], ["halfBathrooms:1", "dust"],
  ["bedrooms:1", "buildup"], ["combinedLivingDining:1", "buildup"]]) {
  const invalid = structuredClone(base);
  invalid.roomConditions[id][kind] = "heavy";
  assert.throws(() => quote([invalid], "standard", eligibility), error => error.statusCode === 400);
}
const oldDraft = structuredClone(base);
delete oldDraft.roomConditions["bedrooms:1"].dust;
oldDraft.roomConditions["bedrooms:1"].buildup = "heavy";
oldDraft.roomConditions = model.reconcile(oldDraft);
assert.deepEqual(oldDraft.roomConditions["bedrooms:1"], { clutter: "low" }, "Old buildup answers must not silently become new dust charges");
assert.throws(() => quote([oldDraft], "standard", eligibility), /Choose dust & dirt/);
const relabeled = { ...heavy, livingDining: "separate" };
relabeled.roomConditions = model.reconcile(relabeled);
assert.equal(relabeled.roomConditions["combinedLivingDining:1"], undefined);
assert.deepEqual(relabeled.roomConditions["livingRooms:1"], {});
assert.deepEqual(relabeled.roomConditions["diningRooms:1"], {});

const multi = quote([heavy, heavy, heavy], "standard", eligibility);
assert.equal(multi.dustAdjustment.amount, 216);
assert.equal(multi.units.reduce((sum, item) => sum + item.subtotalCents, 0), multi.priceCents);
assert.equal(Math.round(multi.units.flatMap(item => item.addOns).filter(item => item.key === "dust_adjustment")
  .reduce((sum, item) => sum + item.taxAmount, 0) * 100), multi.dustAdjustment.taxCents);
const receipt = pricingRows({ estimate: { units: multi.units, dustAdjustment: multi.dustAdjustment } }, {});
assert.equal(receipt.filter(([label]) => label.includes("Heavy dust and dirt")).length, 3, "Receipt keeps one dust fee per affected unit, without duplicating the aggregate");
assert.deepEqual(pricingRows({ estimate: { dustAdjustment: charged.dustAdjustment } }, {}), [["Heavy dust and dirt cleaning", "$72.00"]]);
console.log("Dust pricing: Light/Moderate included, Heavy 40%, combined/separate rooms, service rates, mandatory answers, wet-room isolation, legacy draft reset, exact totals and receipt allocation passed.");
