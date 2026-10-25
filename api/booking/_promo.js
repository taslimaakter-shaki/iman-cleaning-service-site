const { cleanText } = require("./_shared");

const PROMOTIONS = Object.freeze({
  FALL10: Object.freeze({
    code: "FALL10",
    label: "First-time customer fall discount",
    percent: 5,
    startsAt: "2026-09-22T04:00:00.000Z",
    expiresAt: "2026-12-21T04:59:59.999Z",
    expiresLabel: "December 20, 2026",
    eligibleServices: Object.freeze(["standard", "recurring", "deep", "move", "hourly", "window", "post", "commercial"])
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
  if (!promotion) throw promoError("That promo code is not valid.", 400, "PROMO_INVALID");
  const time = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(time)) throw promoError("The promo code could not be checked. Please try again.", 500);
  if (time < Date.parse(promotion.startsAt)) {
    throw promoError("This promo code is not active yet.", 409, "PROMO_NOT_STARTED");
  }
  if (time > Date.parse(promotion.expiresAt)) {
    throw promoError(`This promo code expired on ${promotion.expiresLabel}.`, 410, "PROMO_EXPIRED");
  }
  return promotion;
}

function assertEligibleService(promotion, serviceKey) {
  if (!promotion.eligibleServices.includes(cleanText(serviceKey, 40).toLowerCase())) {
    throw promoError("This promo code is valid for all eligible IMAN cleaning services.", 409, "PROMO_INELIGIBLE");
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
  const paymentStatus = cleanText(payment.status || booking?.estimate?.paymentStatus, 80).toLowerCase();
  if (/cancel|refund|failed|expired/.test(`${status} ${paymentStatus}`)) return false;
  if (Number(payment.paidCents || 0) > 0) return true;
  return /^(deposit_paid|paid|captured|succeeded|complete)$/.test(paymentStatus);
}

function assertNotRedeemed(bookings, customer, promotion) {
  const previousCustomer = (bookings || []).some((booking) => {
    if (!sameCustomerOrAddress(booking, customer)) return false;
    return bookingHasSuccessfulPayment(booking);
  });
  if (previousCustomer) {
    throw promoError("FALL10 is available only to first-time customers.", 409, "PROMO_FIRST_TIME_ONLY");
  }
}

function applyPromotion(pkg, promotion) {
  if (!pkg) throw promoError("Your quote must be completed before applying a promo code.");
  assertEligibleService(promotion, pkg.serviceKey);
  if (pkg.manualDiscount?.amountCents) {
    throw promoError("This promo code cannot be combined with another discount.", 409, "PROMO_NOT_COMBINABLE");
  }
  const originalSubtotalCents = Math.max(0, Math.round(Number(pkg.subtotalCents) || 0));
  const originalTaxCents = Math.max(0, Math.round(Number(pkg.taxCents) || 0));
  const calculatedOriginalTotalCents = originalSubtotalCents + originalTaxCents;
  const originalTotalCents = Math.max(0, Math.round(Number(pkg.priceCents || pkg.totalCents) || calculatedOriginalTotalCents));
  const amountCents = Math.round(originalSubtotalCents * promotion.percent / 100);
  const discountedSubtotalCents = Math.max(0, originalSubtotalCents - amountCents);
  const taxRate = Number(pkg.taxRate) || 0.08875;
  const taxCents = Math.round(discountedSubtotalCents * taxRate);
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
  assertEligibleService,
  assertNotRedeemed,
  bookingHasSuccessfulPayment,
  normalizeAddress,
  normalizeCode,
  normalizeEmail,
  normalizeIdentifier,
  normalizePhone,
  promotionForCode,
  sameCustomerOrAddress
};
