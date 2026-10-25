const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "book-now.html"), "utf8");
const browserCode = fs.readFileSync(path.join(root, "book-now.js"), "utf8");
const promoApiCode = fs.readFileSync(path.join(root, "api/booking/_promo-validate.js"), "utf8");

assert.match(
  html,
  /<button[^>]+data-check-eligibility(?![^>]*\shidden(?:\s|>|=))[^>]*>/,
  "The instant quote Continue button should be visible in the initial markup."
);
assert.match(
  browserCode,
  /eligibilityContinue\.hidden\s*=\s*false/,
  "The Continue button should remain visible as the questionnaire changes modes."
);
assert.doesNotMatch(
  browserCode,
  /scheduleAutoAdvance|autoAdvanceTimer/,
  "Instant quote answers must not automatically advance to the next question."
);
assert.doesNotMatch(html, /name="organizationPhotos"|data-organization-photos/);
assert.doesNotMatch(html, /organized or decluttered/i);
assert.doesNotMatch(browserCode, /uploadOrganizationPhotos|organizationPhotoFiles/);
assert.match(html, /data-booking-service="hourly"/);
assert.match(html, /data-booking-service="recurring"/);
assert.match(html, /data-booking-service="post"/);
assert.match(browserCode, /\["standard", "deep", "move", "post", "hourly", "recurring"\]\.includes\(presetService\)/);
assert.match(browserCode, /selectedService === "hourly"/);
assert.doesNotMatch(browserCode, /serviceChoiceFromCategory|resumeEligibilityAfterServiceChoice/);
assert.doesNotMatch(browserCode, /quote\.html\?category=residential&service=hourly/);
assert.match(browserCode, /state\.pricingMode = "hourly_formula"/);
assert.match(html, /data-hourly-details-title/);
assert.match(html, /min="4"/);
assert.match(html, /data-post-construction-screening-form/);
assert.match(html, /Will all construction work be finished before the cleaning appointment\?/);
assert.match(html, /Will contractor tools, unused materials, and equipment be removed before cleaning\?/);
assert.match(browserCode, /form\.elements\.requestedService\.value = "post"/);
assert.match(browserCode, /form\.elements\.constructionFinished\.value = constructionFinished/);
assert.match(browserCode, /form\.elements\.contractorItemsRemoved\.value = contractorItemsRemoved/);
assert.match(
  browserCode,
  /closePostConstructionScreening\(\);\s*persistBookingDraft\(\);\s*enterPropertyTypeChoice\(\);/,
  "Post-construction screening should continue to property details from the Service step."
);
assert.match(browserCode, /question: "Which rooms in this unit have construction dust or debris\?"/);
assert.match(browserCode, /constructionAreas/);
assert.match(browserCode, /unit\.livingDining === "combined"/);
assert.match(browserCode, /label: "Combined living & dining areas"/);
assert.match(browserCode, /linkedValues: \["livingRooms", "diningRooms"\]/);
assert.equal(
  (browserCode.match(/roomTypes: affectedRoomTypes\(\)/g) || []).length,
  4,
  "Mold, buildup, clutter, and post-construction room questions should share the living/dining layout logic."
);
assert.match(browserCode, /additionalRooms: 0/);
assert.match(browserCode, /detailValue = standardDetailNumberInput\.value/);
assert.match(browserCode, /Some quotes have no applicable extra questions/);
assert.doesNotMatch(browserCode, /currentDetailQuestionIndex = firstUnitQuestions\.findIndex/);
assert.doesNotMatch(html, /name="quotePromoCode"/);
assert.match(promoApiCode, /body\.precheck === true/);

console.log("Instant quote navigation regression passed: Continue stays visible and answers do not auto-advance.");
