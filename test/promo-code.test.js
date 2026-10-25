const assert = require("node:assert/strict");
const {
  PROMOTIONS,
  applyPromotion,
  assertEligibleService,
  assertNotRedeemed,
  promotionForCode
} = require("../api/booking/_promo");
const { applySavedQuotePromotion } = require("../api/booking/_saved-quote");

const activeDate = new Date("2026-10-08T16:00:00.000Z");
const promotion = promotionForCode(" fall10 ", activeDate);
assert.equal(promotion.code, "FALL10");
assert.equal(promotion.percent, 10);
assert.equal(promotion.label, "First-time customer fall discount");
assert.throws(
  () => promotionForCode("FALL10", new Date("2026-12-21T05:00:00.000Z")),
  (error) => error.code === "PROMO_EXPIRED" && /expired on December 20, 2026/.test(error.message)
);
assert.throws(() => promotionForCode("NOPE", activeDate), (error) => error.code === "PROMO_INVALID");
for (const service of ["standard", "recurring", "deep", "move", "hourly", "window", "post", "commercial"]) {
  assert.doesNotThrow(() => assertEligibleService(promotion, service));
}
assert.throws(() => assertEligibleService(promotion, "unknown"), (error) => error.code === "PROMO_INELIGIBLE");

const pkg = {
  id: "deep__instant",
  serviceKey: "deep",
  serviceLabel: "Deep Cleaning",
  subtotalCents: 100000,
  subtotal: 1000,
  taxRate: 0.08875,
  taxCents: 8875,
  tax: 88.75,
  totalCents: 108875,
  total: 1088.75,
  priceCents: 108875,
  price: 1088.75,
  manHours: 12,
  teamHours: 6
};
const discounted = applyPromotion(pkg, promotion);
assert.equal(discounted.promoDiscount.amountCents, 10000, "10% applies to the pretax service subtotal, with no maximum cap");
assert.equal(discounted.promoDiscount.application, "before_tax");
assert.equal(discounted.subtotalCents, 100000);
assert.equal(discounted.discountedSubtotalCents, 90000);
assert.equal(discounted.taxCents, 7988);
assert.equal(discounted.priceCents, 97988);
assert.equal(discounted.manHours, 12, "Promotion does not reduce the purchased cleaning work");
const savedQuoteDiscount = applySavedQuotePromotion(pkg, {}, { email: "new@example.com" }, []);
assert.equal(savedQuoteDiscount.promoCode, "FALL10", "Saved quotes automatically receive FALL10 for a first-time customer");
assert.equal(savedQuoteDiscount.priceCents, 97988, "Saved quote total includes the automatic pretax fall discount and recalculated tax");
assert.equal(
  applySavedQuotePromotion(pkg, {}, { email: "customer@example.com" }, [{
    status: "Completed",
    email: "customer@example.com",
    estimate: { payment: { status: "paid", paidCents: 10000 } }
  }]).promoCode,
  undefined,
  "Returning customers do not receive the first-time FALL10 offer"
);

const hourlyPackage = {
  id: "hourly__4_hours",
  serviceKey: "hourly",
  serviceLabel: "Hourly Cleaning Service",
  subtotalCents: 29392,
  subtotal: 293.92,
  taxRate: 0.08875,
  taxCents: 2608,
  tax: 26.08,
  totalCents: 32000,
  total: 320,
  priceCents: 32000,
  price: 320,
  manHours: 4,
  teamHours: 2
};
const discountedHourly = applyPromotion(hourlyPackage, promotion);
assert.equal(discountedHourly.promoDiscount.amountCents, 2939);
assert.equal(discountedHourly.subtotalCents, 29392, "Promo does not rewrite the before-tax subtotal");
assert.equal(discountedHourly.discountedSubtotalCents, 26453);
assert.equal(discountedHourly.taxCents, 2348, "Sales tax is recalculated from the discounted subtotal");
assert.equal(discountedHourly.priceCents, 28801, "Four hourly-cleaning work-hours use the pretax FALL10 workflow");

const customerExample = applyPromotion({
  ...pkg,
  subtotalCents: 51458,
  subtotal: 514.58,
  taxCents: 4567,
  tax: 45.67,
  totalCents: 56025,
  total: 560.25,
  priceCents: 56025,
  price: 560.25
}, promotion);
assert.equal(customerExample.promoDiscount.amountCents, 5146);
assert.equal(customerExample.discountedSubtotalCents, 46312);
assert.equal(customerExample.taxCents, 4110);
assert.equal(customerExample.priceCents, 50422);

const redeemed = {
  status: "Confirmed",
  email: "Customer@Example.com",
  phone: "+1 (929) 555-0101",
  address: "88-56 77th Street, Apt 2, Woodhaven, NY 11421",
  estimate: {
    accountUserId: "USR_ABC123",
    promoCode: "FALL10",
    payment: {
      status: "deposit_paid",
      paidCents: 2500,
      stripeCustomerId: "cus_123",
      paymentMethodFingerprint: "fp_secure_456"
    }
  }
};
assert.throws(
  () => assertNotRedeemed([redeemed], { email: "customer@example.com" }, promotion),
  (error) => error.code === "PROMO_FIRST_TIME_ONLY"
);
assert.throws(
  () => assertNotRedeemed([redeemed], { phone: "9295550101" }, promotion),
  (error) => error.code === "PROMO_FIRST_TIME_ONLY"
);
assert.throws(
  () => assertNotRedeemed([redeemed], { address: "88-56 77th St Apt 2 Woodhaven NY 11421" }, promotion),
  (error) => error.code === "PROMO_FIRST_TIME_ONLY"
);
assert.throws(
  () => assertNotRedeemed([redeemed], { accountUserId: "usr_abc123" }, promotion),
  (error) => error.code === "PROMO_FIRST_TIME_ONLY"
);
assert.throws(
  () => assertNotRedeemed([redeemed], { stripeCustomerId: "CUS_123" }, promotion),
  (error) => error.code === "PROMO_FIRST_TIME_ONLY"
);
assert.throws(
  () => assertNotRedeemed([redeemed], { paymentMethodFingerprint: "FP_SECURE_456" }, promotion),
  (error) => error.code === "PROMO_FIRST_TIME_ONLY"
);
assert.throws(
  () => assertNotRedeemed([{ ...redeemed, estimate: { ...redeemed.estimate, promoCode: "" } }], { email: "customer@example.com" }, promotion),
  (error) => error.code === "PROMO_FIRST_TIME_ONLY",
  "A prior paid booking blocks FALL10 even when that booking used no promotion."
);
assert.doesNotThrow(() => assertNotRedeemed([
  { ...redeemed, status: "Cancelled", estimate: { ...redeemed.estimate, payment: { status: "refunded", paidCents: 0 } } }
], { email: "customer@example.com" }, promotion));
assert.doesNotThrow(() => assertNotRedeemed([
  { ...redeemed, status: "Confirmed", estimate: { ...redeemed.estimate, payment: { status: "deposit_pending", paidCents: 0 } } },
  { ...redeemed, status: "Quote sent", estimate: { ...redeemed.estimate, payment: {} } }
], { email: "customer@example.com" }, promotion), "Unpaid bookings and repeated quotes do not make someone a returning customer");
assert.equal(PROMOTIONS.FALL10.expiresLabel, "December 20, 2026");

console.log("Promo code tests passed: active/expired states, uncapped 10%, service eligibility, and first-time-customer enforcement.");
