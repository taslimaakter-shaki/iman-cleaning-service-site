const assert = require("assert");
const fs = require("fs");
const path = require("path");
const checkout = require("../api/booking/_checkout");
const { buildSections } = require("../api/booking/_confirmation-pdf");

const { AGREEMENT_ACCEPTANCE_TEXT, AGREEMENT_VERSION, buildAgreementAcceptance } = checkout._test;

function acceptedReview(pkg, slot) {
  const now = Date.now();
  return {
    version: AGREEMENT_VERSION,
    openedAt: new Date(now - 60_000).toISOString(),
    scrolledToEndAt: new Date(now - 30_000).toISOString(),
    acceptedAt: new Date(now - 10_000).toISOString(),
    accepted: true,
    signedName: "Jane Example",
    acceptanceText: AGREEMENT_ACCEPTANCE_TEXT,
    contextFingerprint: JSON.stringify({
      packageId: pkg.id,
      total: pkg.price,
      laborHours: pkg.manHours,
      schedule: slot.value
    })
  };
}

const pkg = {
  id: "standard-test",
  serviceLabel: "Standard Cleaning",
  price: 200,
  priceCents: 20000,
  manHours: 3
};
const slot = { value: "2026-09-09T09:00:00-04:00" };
const request = { headers: { host: "example.test", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.1", "user-agent": "Test Browser" } };

const evidence = buildAgreementAcceptance({
  review: acceptedReview(pkg, slot),
  request,
  secretKey: "test-secret",
  pkg,
  slot
});
assert.strictEqual(evidence.version, AGREEMENT_VERSION);
assert.strictEqual(evidence.acceptanceMethod, "scroll_to_end_typed_name_then_checkbox");
assert.strictEqual(evidence.signedName, "Jane Example");
assert.strictEqual(evidence.context.depositCents, 5000);
assert.strictEqual(evidence.context.remainingCents, 15000);
assert.match(evidence.recordHash, /^[a-f0-9]{64}$/);
assert.match(evidence.ipEvidenceHash, /^[a-f0-9]{64}$/);

assert.throws(() => buildAgreementAcceptance({
  review: { ...acceptedReview(pkg, slot), scrolledToEndAt: "" },
  request,
  secretKey: "test-secret",
  pkg,
  slot
}), /scroll to the end/i);

assert.throws(() => buildAgreementAcceptance({
  review: { ...acceptedReview(pkg, slot), contextFingerprint: "changed" },
  request,
  secretKey: "test-secret",
  pkg,
  slot
}), /booking details changed/i);

assert.throws(() => buildAgreementAcceptance({
  review: { ...acceptedReview(pkg, slot), signedName: "Jane" },
  request,
  secretKey: "test-secret",
  pkg,
  slot
}), /full legal name/i);

const html = fs.readFileSync(path.join(__dirname, "..", "book-now.html"), "utf8");
const bookingScript = fs.readFileSync(path.join(__dirname, "..", "book-now.js"), "utf8");
assert.match(html, /data-agreement-scroll/);
assert.match(html, /data-agreement-accept disabled/);
assert.match(html, /data-agreement-signed-name/);
assert.match(html, /data-accept-agreement disabled/);
assert.match(html, /data-pay-button disabled/);
assert.doesNotMatch(html, /data-agreement-progress/);
assert.doesNotMatch(html, /Open full-page copy/);
assert.doesNotMatch(html, /Scroll to the end to enable acceptance/);
assert.doesNotMatch(bookingScript, /Finished — you may now agree/);
assert.doesNotMatch(bookingScript, /Accepted for this booking\. Select above to review it again\./);
assert.doesNotMatch(html, /booking-agreement-key-terms/);
assert.doesNotMatch(html, /Important payment terms/);
assert.doesNotMatch(html, /name="bookingAgreement"/);
assert.doesNotMatch(html, /You are paying only the booking deposit today/);
assert.match(html, /Plans change\? Reschedule or cancel 48\+ hours ahead—your deposit is fully refundable\./);
assert.doesNotMatch(html, /It may temporarily reduce your available credit or funds/);
assert.doesNotMatch(bookingScript, /document\.querySelector\("\[data-final-labor-hours\]"\)\.textContent/);
assert.doesNotMatch(html, /booking-important-note/);

const agreementHtml = fs.readFileSync(path.join(__dirname, "..", "agreement.html"), "utf8");
assert.match(agreementHtml, /Cleaner Break Time/);
assert.match(agreementHtml, /Break time does not count toward the maximum labor-hours/);
assert.match(agreementHtml, /Your estimate is based on the information and details provided before your appointment/);
assert.doesNotMatch(agreementHtml, /Your estimate is based on the information, photos, videos, and details provided before your appointment/);
assert.match(agreementHtml, /Your cleaning team will work within the maximum labor-hours shown in your estimate/);
assert.match(agreementHtml, /This is a maximum estimate, not a guaranteed duration\. Your cleaning may be completed sooner\./);
assert.doesNotMatch(agreementHtml, /\$80 per cleaner, per hour|per[- ]hour rate/i,
  'Customer agreements must not disclose the internal hourly rate');
assert.doesNotMatch(html, /This is a maximum estimate, not a guaranteed duration\. Your cleaning may be completed sooner\./);
assert.match(agreementHtml, />5\. Payment Terms</);
assert.match(agreementHtml, /temporary authorization hold for the remaining 75%/);
assert.match(agreementHtml, /for a total charge of 50% of the scheduled service price/);
assert.match(agreementHtml, /at least 48 hours before the scheduled appointment/);

const sections = buildSections({
  booking: { estimate: { agreementVersion: AGREEMENT_VERSION, agreementAcceptance: evidence } },
  record: {}
});
const agreementRows = sections.find((section) => section.title === "Agreement and payment confirmation").rows;
assert(agreementRows.some(([label, value]) => label === "Agreement record hash" && value === evidence.recordHash));
assert(agreementRows.some(([label]) => label === "Agreement scrolled to end at"));
assert(agreementRows.some(([label, value]) => label === "Electronically signed by" && value === "Jane Example"));

console.log("Agreement review tests passed.");
