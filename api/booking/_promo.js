const { cleanText } = require("./_shared");
const bookingDiscountName = require("../../booking-discount-names");

const eligibleServices = Object.freeze(["standard", "deep", "move", "hourly", "window", "post", "commercial"]);
const PROMOTIONS = Object.freeze({
  FALL10: Object.freeze({
    code: "FALL10",
    label: bookingDiscountName("FALL10"),
    percent: 5,
    startsAt: "2026-09-22T04:00:00.000Z",
    expiresAt: "2026-12-21T04:59:59.999Z",
    expiresLabel: "December 20, 2026",
    eligibleServices
  }),
  RETURNING5: Object.freeze({
    code: "RETURNING5",
    label: bookingDiscountName("RETURNING5"),
    percent: 5,
    eligibleServices
  })
});

function promoError(message, statusCode = 400, code = "PROMO_INVALID") {
  return Object.assign(new Error(message), { statusCode, code });
}

function normalizeCode(value) {
  return cleanText(value, 40).replace(/\s+/g, "").toUpperCase();
}

function normalizeEmail(value) {
  return cleanText(value, 180).toLowerCase();
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function normalizeIdentifier(value) {
  return cleanText(value, 180).toLowerCase();
}

function normalizeAddress(value) {
  return cleanText(value, 500)
    .toLowerCase()
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(apartment|unit)\b/g, "apt")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function promotionForCode(value, now = new Date()) {
  const code = normalizeCode(value);
  const promotion = PROMOTIONS[code];
  if (!promotion) throw promoError("This discount is unavailable.", 400, "PROMO_INVALID");
  const time = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(time)) throw promoError("Your discount could not be checked. Please try again.", 500);
  if (promotion.startsAt && time < Date.parse(promotion.startsAt)) {
    throw promoError("This discount is not active yet.", 409, "PROMO_NOT_STARTED");
  }
  if (promotion.expiresAt && time > Date.parse(promotion.expiresAt)) {
    throw promoError(`This discount expired on ${promotion.expiresLabel}.`, 410, "PROMO_EXPIRED");
  }
  return promotion;
}

function assertEligibleService(promotion, serviceKey) {
  if (!promotion.eligibleServices.includes(cleanText(serviceKey, 40).toLowerCase())) {
    throw promoError("This discount is unavailable for the selected service.", 409, "PROMO_INELIGIBLE");
  }
}

function bookingRedeemedPromo(booking, code) {
  const storedCode = normalizeCode(booking?.estimate?.promoCode || booking?.estimate?.promoDiscount?.code || booking?.promoCode);
  if (storedCode !== code) return false;
  const status = cleanText(booking?.status, 80).toLowerCase();
  const payment = booking?.estimate?.payment || {};
  const paymentStatus = cleanText(payment.status || booking?.estimate?.paymentStatus, 80).toLowerCase();
  if (/cancel|refund|failed|expired/.test(`${status} ${paymentStatus}`)) return false;
  return Number(payment.paidCents || 0) > 0 ||
    /confirmed|cleaner assigned|in progress|completed/.test(status) ||
    /deposit_paid|paid|captured|succeeded|complete/.test(paymentStatus);
}

function sameCustomerOrAddress(booking, customer) {
  const bookingEmail = normalizeEmail(booking?.email || booking?.customer?.email);
  const bookingPhone = normalizePhone(booking?.phone || booking?.customer?.phone);
  const bookingAddress = normalizeAddress(booking?.address || booking?.serviceAddress || booking?.customer?.address);
  const email = normalizeEmail(customer?.email);
  const phone = normalizePhone(customer?.phone);
  const address = normalizeAddress(customer?.address);
  const bookingAccountId = normalizeIdentifier(
    booking?.estimate?.accountUserId || booking?.accountUserId || booking?.customer?.id
  );
  const accountId = normalizeIdentifier(customer?.accountUserId || customer?.customerId);
  const bookingStripeCustomerId = normalizeIdentifier(booking?.estimate?.payment?.stripeCustomerId);
  const stripeCustomerId = normalizeIdentifier(customer?.stripeCustomerId);
  const bookingPaymentFingerprint = normalizeIdentifier(
    booking?.estimate?.payment?.paymentMethodFingerprint || booking?.estimate?.payment?.cardFingerprint
  );
  const paymentFingerprint = normalizeIdentifier(customer?.paymentMethodFingerprint || customer?.cardFingerprint);
  return Boolean(
    (email && bookingEmail && email === bookingEmail) ||
    (phone && bookingPhone && phone === bookingPhone) ||
    (address && bookingAddress && address === bookingAddress) ||
    (accountId && bookingAccountId && accountId === bookingAccountId) ||
    (stripeCustomerId && bookingStripeCustomerId && stripeCustomerId === bookingStripeCustomerId) ||
    (paymentFingerprint && bookingPaymentFingerprint && paymentFingerprint === bookingPaymentFingerprint)
  );
}

function bookingHasSuccessfulPayment(booking) {
  const status = cleanText(booking?.status, 80).toLowerCase();
  const payment = booking?.estimate?.payment || {};
  const paymentStatus = cleanText(payment.status || booking?.estimate?.paymentStatus || booking?.payment_status, 80).toLowerCase();
  if (/cancel|refund|failed|expired/.test(`${status} ${paymentStatus}`)) return false;
  if (Number(payment.paidCents || 0) > 0) return true;
  return /^(deposit_paid|paid|fully_paid|captured|succeeded|complete|completed)$/.test(paymentStatus);
}

function customerPromotion(bookings, customer, now = new Date()) {
  // These two contact fields are available both at quote time and at checkout.
  const email = normalizeEmail(customer?.email);
  const phone = normalizePhone(customer?.phone);
  const contact = { email, phone: /^\d{10,15}$/.test(phone) ? phone : "" };
  if ((bookings || []).some(booking => bookingHasSuccessfulPayment(booking) && sameCustomerOrAddress(booking, contact))) {
    return PROMOTIONS.RETURNING5;
  }
  try {
    return promotionForCode("FALL10", now);
  } catch (error) {
    if (["PROMO_NOT_STARTED", "PROMO_EXPIRED"].includes(error.code)) return null;
    throw error;
  }
}

function assertCustomerPromotion(code, eligible) {
  const requested = promotionForCode(code);
  if (requested.code === eligible?.code) return requested;
  if (requested.code === "RETURNING5") {
    throw promoError("The returning customer discount requires a previous paid booking with your email or phone number.", 409, "PROMO_RETURNING_ONLY");
  }
  throw promoError("The Fall Cleaning Discount is available only to first-time customers.", 409, "PROMO_FIRST_TIME_ONLY");
}

function applyQuotedPromotion(pkg, code, bookings, customer) {
  const eligible = customerPromotion(bookings, customer);
  // A customer can pay for another booking between receiving a fall quote and
  // using it. Both offers use the same percentage and the same pretax subtotal.
  const promotion = normalizeCode(code) === "FALL10" && eligible?.code === "RETURNING5"
    ? eligible
    : assertCustomerPromotion(code, eligible);
  return applyPromotion(pkg, promotion);
}

function applyPromotion(pkg, promotion) {
  if (!pkg) throw promoError("Your quote must be completed before applying a discount.");
  assertEligibleService(promotion, pkg.serviceKey);
  if (pkg.manualDiscount?.amountCents) {
    throw promoError("These discounts cannot be combined.", 409, "PROMO_NOT_COMBINABLE");
  }
  const originalSubtotalCents = Math.max(0, Math.round(Number(pkg.subtotalCents) || 0));
  const originalTaxCents = Math.max(0, Math.round(Number(pkg.taxCents) || 0));
  const calculatedOriginalTotalCents = originalSubtotalCents + originalTaxCents;
  const originalTotalCents = Math.max(0, Math.round(Number(pkg.priceCents || pkg.totalCents) || calculatedOriginalTotalCents));
  const amountCents = Math.round((originalSubtotalCents - Number(pkg.protectedPetSubtotalCents || 0)) * promotion.percent / 100);
  const discountedSubtotalCents = Math.max(0, originalSubtotalCents - amountCents);
  const taxRate = Number(pkg.taxRate) || 0.08875;
  const taxCents = Math.round((discountedSubtotalCents - Number(pkg.protectedPetSubtotalCents || 0)) * taxRate) + Number(pkg.protectedPetFeeCents || 0) - Number(pkg.protectedPetSubtotalCents || 0);
  const totalCents = discountedSubtotalCents + taxCents;
  return {
    ...pkg,
    originalSubtotalCents,
    originalTaxCents,
    originalTotalCents,
    subtotalCents: originalSubtotalCents,
    subtotal: originalSubtotalCents / 100,
    discountedSubtotalCents,
    discountedSubtotal: discountedSubtotalCents / 100,
    taxCents,
    tax: taxCents / 100,
    totalCents,
    total: totalCents / 100,
    priceCents: totalCents,
    price: totalCents / 100,
    promoCode: promotion.code,
    promoDiscount: {
      code: promotion.code,
      label: promotion.label,
      percent: promotion.percent,
      amountCents,
      discountedSubtotalCents,
      expiresAt: promotion.expiresAt,
      expiresLabel: promotion.expiresLabel,
      application: "before_tax"
    }
  };
}

module.exports = {
  PROMOTIONS,
  applyPromotion,
  applyQuotedPromotion,
  assertEligibleService,
  assertCustomerPromotion,
  customerPromotion,
  bookingHasSuccessfulPayment,
  normalizeAddress,
  normalizeCode,
  normalizeEmail,
  normalizeIdentifier,
  normalizePhone,
  promotionForCode,
  sameCustomerOrAddress
};
