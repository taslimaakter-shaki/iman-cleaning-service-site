const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const availability = require("../api/booking/_availability");
const checkout = require("../api/booking/_checkout");
const { validateAndPrice } = require("../api/booking/_saved-quote");
const { validateQuoteFormFields } = require("../api/quote/_shared");
const { reminderStage } = require("../api/booking/_quote-reminders");
const { calculateResidentialUnitPrice, isNYCServiceZip } = require("../api/booking/_shared");
const { validateFields, resolveManaged } = require("../api/crm/_quote-admin");
const { savedQuote } = require("../api/crm/_quotes");
const { createShortApproval } = require("../api/quote/_short-approval");

const retired = {
  serviceKey: "window", pricingMode: "window_formula", serviceZip: "11218",
  eligibility: { requestedService: "window", cleaningCategory: "window", serviceZip: "11218" },
  unitDetails: [{ windows: [{ type: "double_hung", quantity: 8 }] }]
};
const isGone = error => error.statusCode === 410;
async function request(handler, body, query) {
  const req = Readable.from([JSON.stringify(body)]);
  Object.assign(req, { method: query ? "GET" : "POST", query, headers: {} });
  const res = { setHeader() {}, end(value) { this.result = JSON.parse(value); } };
  await handler(req, res);
  return res;
}

(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_unused";
  for (const res of [
    await request(availability, retired),
    await request(availability, {}, { packageId: "window__instant_quote" }),
    await request(checkout, retired)
  ]) {
    assert.equal(res.statusCode, 410);
    assert.match(res.result.error, /no longer available/);
  }

  assert.throws(() => validateAndPrice(retired), isGone);
  assert.throws(() => validateQuoteFormFields({ "Service Type": "Window Cleaning" }), isGone);
  const crmFields = Object.fromEntries(["customerName", "email", "phone", "address", "serviceDate", "serviceTime", "details", "internalNotes"].map(key => [key, ""]));
  assert.throws(() => validateFields({ ...crmFields, customerName: "Example", service: "Window Washing" }), isGone);
  await assert.rejects(createShortApproval({ service: "Window Cleaning" }), isGone);
  await assert.rejects(resolveManaged({ service: "Window Cleaning" }), isGone);
  const saved = { packageSnapshot: { serviceKey: "window" }, createdAt: 1, quoteReminderEligibleAt: 1, expiresAt: 1e15 };
  assert.equal(savedQuote(saved, {}), null);
  assert.equal(reminderStage(saved), "");

  const unit = { bedrooms: 1, fullBathrooms: 1, halfBathrooms: 0, kitchens: 1,
    livingRooms: 1, diningRooms: 0, livingDining: "living_only", additionalRooms: 0 };
  const moving = calculateResidentialUnitPrice(unit, 0, "move");
  assert.deepEqual(moving.baseItems.find(item => item.key === "interior_windows"),
    { key: "interior_windows", label: "Reachable interior window cleaning", amount: 0, included: true });
  assert.throws(() => calculateResidentialUnitPrice({ ...unit, exteriorWindows: "yes" }, 0, "move"), isGone);
  assert.equal(validateQuoteFormFields({ "Service Type": "Move-In/Move-Out Cleaning", Details: "Reachable interior windows" }).Details, "Reachable interior windows");
  for (const zip of ["11432", "11004", "11005"]) assert.equal(isNYCServiceZip(zip), true);
  for (const zip of ["11001", "11040", "11096", "11501", "11701", "11801", "11901"]) assert.equal(isNYCServiceZip(zip), false);
  console.log("Retired service rejected by booking and CRM. Moving still includes reachable interior windows.");
})().catch(error => { console.error(error); process.exitCode = 1; });
