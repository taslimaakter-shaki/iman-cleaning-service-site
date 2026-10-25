const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.ADMIN_TOKEN = "test-consent-secret";

const { consentEvidence } = require("../api/booking/_saved-quote");

const request = {
  headers: {
    host: "www.imancleaningservice.com",
    "x-forwarded-proto": "https",
    "x-forwarded-for": "192.0.2.10",
    "user-agent": "Consent test browser"
  },
  socket: {}
};
const capturedAt = new Date("2026-09-07T15:30:00.000Z");
const consent = consentEvidence(request, {
  smsConsent: true,
  smsMarketingConsent: false
}, capturedAt);

assert.equal(consent.transactionalSms.granted, true);
assert.equal(consent.transactionalEmail.granted, true);
assert.equal(consent.marketingSms.granted, false);
assert.equal(consent.marketingEmail.eligible, false);
assert.equal(consent.marketingEmail.basis, "not-requested");
assert.equal(consent.capturedAt, capturedAt.toISOString());
assert.equal(consent.sourceUrl, "https://www.imancleaningservice.com/book-now.html");
assert.match(consent.transactionalSms.disclosure, /email and text/);
assert.match(consent.transactionalSms.disclosure, /Required service messages only/);
assert.match(consent.transactionalSms.disclosure, /Message frequency varies/);
assert.match(consent.transactionalSms.disclosure, /STOP to opt out/);
assert.match(consent.evidenceHash, /^[a-f0-9]{64}$/);

const html = fs.readFileSync(path.join(__dirname, "..", "book-now.html"), "utf8");
assert.match(html, /name="quoteCommunicationConsent"[^>]*\srequired/);
assert.doesNotMatch(html, /name="quoteCommunicationConsent"[^>]*\schecked/);
assert.match(html, /quote and appointment-related communications by email and text/);
assert.match(html, /Message frequency varies/);
assert.match(html, /booking-communication-disclosure/);
assert.doesNotMatch(html, /name="emailMarketingConsent"/);
assert.match(html, /name="smsMarketingConsent"/);
assert.doesNotMatch(html, /name="smsMarketingConsent"[^>]*\srequired/);
assert.doesNotMatch(html, /name="smsMarketingConsent"[^>]*\schecked/);
assert.match(html, /promotional emails and recurring promotional text messages/);
assert.match(html, /Consent is not a condition of purchase/);

const promotionalConsent = consentEvidence(request, {
  smsConsent: true,
  smsMarketingConsent: true
}, capturedAt);
assert.equal(promotionalConsent.marketingSms.granted, true);
assert.equal(promotionalConsent.marketingEmail.eligible, true);
assert.equal(promotionalConsent.marketingEmail.basis, "express-opt-in");

const script = fs.readFileSync(path.join(__dirname, "..", "book-now.js"), "utf8");
assert.match(script, /elements\.smsMarketingConsent\?\.checked/);
assert.match(script, /smsMarketingConsent:\s*wantsMarketingTexts/);

console.log("Marketing consent tests passed.");
