const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { recommendResidentialService } = require("../api/booking/_shared");

const recommendation = recommendResidentialService({
  propertyStatus: "occupied",
  requestedService: "standard",
  cleaningCategory: "residential",
  propertyOver2000: "yes",
  squareFootage: "3500",
  waterDamage: "no",
  recentRenovation: "no",
  excessiveBelongings: "no",
  utilitiesAvailable: "yes",
  unsafeConditions: "no",
  clutter: "low",
  buildup: "light",
  hazards: "none"
});

assert.equal(recommendation.type, "instant");
assert.equal(recommendation.serviceKey, "standard");

const unsafeConditionRecommendation = recommendResidentialService({
  propertyStatus: "occupied",
  requestedService: "standard",
  cleaningCategory: "residential",
  waterDamage: "no",
  recentRenovation: "no",
  excessiveBelongings: "no",
  utilitiesAvailable: "yes",
  unsafeConditions: "yes",
  clutter: "low",
  buildup: "light",
  hazards: "none"
});

assert.equal(unsafeConditionRecommendation.type, "ineligible");
assert.equal(unsafeConditionRecommendation.internalReason, "ineligible_unsafe_conditions");

const unavailableUtilitiesRecommendation = recommendResidentialService({
  propertyStatus: "occupied",
  requestedService: "standard",
  cleaningCategory: "residential",
  waterDamage: "no",
  recentRenovation: "no",
  excessiveBelongings: "no",
  utilitiesAvailable: "no",
  unsafeConditions: "no",
  clutter: "low",
  buildup: "none",
  hazards: "none"
});
assert.equal(unavailableUtilitiesRecommendation.type, "ineligible");
assert.equal(unavailableUtilitiesRecommendation.internalReason, "utilities_unavailable");
assert.equal(unavailableUtilitiesRecommendation.reviewUrl, undefined);

const waterDamageRecommendation = recommendResidentialService({
  propertyStatus: "occupied",
  requestedService: "standard",
  cleaningCategory: "residential",
  waterDamage: "yes",
  recentRenovation: "no",
  excessiveBelongings: "no",
  utilitiesAvailable: "yes",
  unsafeConditions: "no",
  clutter: "low",
  buildup: "none",
  hazards: "none"
});
assert.equal(waterDamageRecommendation.type, "ineligible");
assert.equal(waterDamageRecommendation.internalReason, "water_damage");
assert.equal(waterDamageRecommendation.reviewUrl, undefined);

const possibleMoldRecommendation = recommendResidentialService({
  propertyStatus: "occupied",
  requestedService: "standard",
  cleaningCategory: "residential",
  waterDamage: "no",
  recentRenovation: "no",
  excessiveBelongings: "no",
  utilitiesAvailable: "yes",
  unsafeConditions: "no",
  clutter: "low",
  buildup: "none",
  hazards: "mold"
});
assert.equal(possibleMoldRecommendation.type, "instant");

for (const hazards of ["pests", "waste"]) {
  const ineligibleRecommendation = recommendResidentialService({
    propertyStatus: "occupied",
    requestedService: "standard",
    cleaningCategory: "residential",
    waterDamage: "no",
    recentRenovation: "no",
    excessiveBelongings: "no",
    utilitiesAvailable: "yes",
    unsafeConditions: "no",
    clutter: "low",
    buildup: "none",
    hazards
  });
  assert.equal(ineligibleRecommendation.type, "ineligible");
  assert.equal(ineligibleRecommendation.internalReason, "ineligible_safety");
}

const html = fs.readFileSync(path.join(__dirname, "..", "book-now.html"), "utf8");
assert.doesNotMatch(html, /affected spaces\s*[×x*]\s*\d+%/i);
assert.match(html, /Does the property have any unsafe or hazardous conditions that could put our cleaning team at risk\?/);
assert.match(html, /exposed needles or sharp objects/);
assert.doesNotMatch(html, /data-large-property-question/);
assert.doesNotMatch(html, /name="propertyOver2000"/);
assert.doesNotMatch(html, /name="squareFootage"/);

const browserCode = fs.readFileSync(path.join(__dirname, "..", "book-now.js"), "utf8");
assert.match(browserCode, /answers\.unsafeConditions === "yes"\) return "ineligible_unsafe_conditions"/);
assert.match(browserCode, /ineligible_unsafe_conditions:[\s\S]*?ineligible: true/);
assert.match(browserCode, /utilities_unavailable:[\s\S]*?ineligible: true/);
assert.match(browserCode, /water_damage:[\s\S]*?ineligible: true/);
assert.match(browserCode, /ineligible_clutter_access:[\s\S]*?ineligible: true/);
assert.match(browserCode, /answers\.clutter === "unsafe"\) return "ineligible_clutter_access"/);
assert.doesNotMatch(browserCode, /value\("propertyOver2000"\) === "yes"/);
assert.doesNotMatch(browserCode, /answers\.propertyOver2000 === "yes"\) return "large_property"/);
assert.doesNotMatch(browserCode, /routeHeavyClutterToOrganization/);
assert.doesNotMatch(browserCode, /answers\.clutter === "heavy"\) return "heavy_clutter"/);

console.log("Large-property instant-pricing checks passed.");
