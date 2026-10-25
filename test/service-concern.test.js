const assert = require("assert");
const fs = require("fs");
const path = require("path");

const concernForm = fs.readFileSync(path.join(__dirname, "../service-concern.html"), "utf8");
assert.match(concernForm, /aria-labelledby="reporting-deadline-title"/);
assert.match(concernForm, /Please submit concerns promptly/);
assert.match(concernForm, /24 hours after the cleaning is completed/);
assert.match(concernForm, /Concerns involving damage, missing items, billing, health, or safety should be reported as soon as they are discovered/);
assert.doesNotMatch(concernForm, /Complaints received after this period/);
assert.ok(concernForm.indexOf('class="reporting-deadline"') < concernForm.indexOf("<form data-form"), "Show the deadline before customers start filling out the form");
const confirmationSection = concernForm.match(/<div class="confirmations field-block">([\s\S]*?)<\/div>/)[1];
assert.equal((confirmationSection.match(/type="checkbox"/g) || []).length, 1);
assert.match(confirmationSection, /name="Customer confirmation" value="Confirmed" required/);
assert.doesNotMatch(confirmationSection, /\bchecked\b/);
assert.match(confirmationSection, /accurate to the best of my knowledge/);
assert.match(confirmationSection, /agree to be contacted about this concern/);
assert.match(confirmationSection, /does not guarantee a refund or other resolution/);
assert.match(confirmationSection, /does not cancel or reschedule my booking/);

const {
  MAX_FILES,
  emailMessage,
  makeCaseNumber,
  safeFileName,
  validateFile
} = require("../api/service-concern/_shared");

assert.equal(MAX_FILES, 10);
assert.equal((concernForm.match(/class="section-number"/g) || []).length, 7);
assert.match(concernForm, /Submit Concern for Review/);
assert.doesNotMatch(concernForm, /We generally acknowledge submissions within one business day/);
assert.ok(concernForm.indexOf("Was the concern discussed onsite?") < concernForm.indexOf("Photos and supporting evidence"), "Put photo uploads near the bottom");
assert.ok(concernForm.indexOf("Preferred resolution") < concernForm.indexOf("Photos and supporting evidence"), "Put photo uploads after the preferred resolution");
assert.match(concernForm, /call <a href="tel:911">911<\/a> before submitting this form/);
assert.doesNotMatch(concernForm, /You may upload up to 10 files/);
assert.doesNotMatch(concernForm, /Photos, videos, or PDF receipts and documents/);
assert.doesNotMatch(concernForm, /up to 100 files/);
assert.equal(makeCaseNumber(new Date("2026-09-02T16:00:00Z"), () => 1047), "ICS-SC-20260902-1047");
assert.equal(safeFileName("../../Kitchen photo (1).JPG", 3), "03-..-..-Kitchen photo (1).JPG");
assert.deepEqual(validateFile({ mimeType: "image/jpeg", size: 1024 }), { mimeType: "image/jpeg", size: 1024 });
assert.throws(() => validateFile({ mimeType: "text/html", size: 1024 }), /JPG/);
assert.throws(() => validateFile({ mimeType: "image/png", size: 21 * 1024 * 1024 }), /20 MB/);

const email = Buffer.from(emailMessage({
  to: "customer@example.com",
  subject: "Service concern received",
  text: "Plain text",
  html: "<p>HTML</p>"
}).raw, "base64url").toString("utf8");
assert.match(email, /To: customer@example\.com/);
assert.match(email, /\r\n\r\n--service_concern_/);
assert.match(email, /Plain text/);
assert.match(email, /<p>HTML<\/p>/);

console.log("service concern tests passed");
