const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sameDay = require("../api/booking/_same-day")._test;
const checkout = require("../api/quote/_approve-checkout")._test;
const shortApproval = require("../api/quote/_short-approval")._test;

const request = { headers: { host: "www.imancleaningservice.com", "x-forwarded-proto": "https" } };
const saved = sameDay.validSavedQuoteUrl("https://www.imancleaningservice.com/book-now.html?quote=secure-token", request);
assert.match(saved, /book-now\.html\?quote=secure-token/);
assert.throws(() => sameDay.validSavedQuoteUrl("https://www.imancleaningservice.com/book-now.html", request));

const unavailable = sameDay.buildUnavailableMessage({ savedQuoteUrl: saved });
assert.match(unavailable, /unavailable for a same-day appointment/i);
assert.match(unavailable, /secure-token/);
assert.match(unavailable, /929-232-1930/);

assert.deepEqual(checkout.paymentBreakdown(40000, 10000), {
  baseAmountCents: 40000,
  rushFeeCents: 10000,
  totalAmountCents: 50000,
  baseDepositCents: 10000,
  paymentAmountCents: 20000,
  remainingAmountCents: 30000
});

const shortCode = shortApproval.approvalCode();
assert.match(shortCode, shortApproval.CODE_PATTERN);
assert.equal(shortApproval.normalizeCode(shortCode), shortCode);
assert.throws(() => shortApproval.normalizeCode("predictable-or-too-long"));

const root = path.resolve(__dirname, "..");
const bookingHtml = fs.readFileSync(path.join(root, "book-now.html"), "utf8");
const crmHtml = fs.readFileSync(path.join(root, "crm.html"), "utf8");
const sameDayApi = fs.readFileSync(path.join(root, "api/booking/_same-day.js"), "utf8");
const approvalLinkApi = fs.readFileSync(path.join(root, "api/quote/_approval-link.js"), "utf8");
assert.match(bookingHtml, /Request a same-day appointment/);
assert.match(bookingHtml, /\$100 rush fee/);
assert.doesNotMatch(bookingHtml.match(/data-same-day-dialog[\s\S]*?<\/section>/)?.[0] || "", /type="file"/);
assert.match(crmHtml, /Same-day requests/);
assert.doesNotMatch(sameDayApi, /created\.id/);
assert.match(sameDayApi, /\/q\/\$\{approval\.code\}/);
assert.doesNotMatch(sameDayApi, /approve-quote\.html\?token=/);
assert.match(approvalLinkApi, /\/q\/\$\{approval\.code\}/);

console.log("Same-day request workflow tests passed.");
