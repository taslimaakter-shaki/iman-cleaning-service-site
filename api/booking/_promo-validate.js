const { cleanText, json, listAllBookings, readJsonBody } = require("./_shared");
const { assertEligibleService, assertNotRedeemed, promotionForCode } = require("./_promo");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    const body = await readJsonBody(request);
    const promotion = promotionForCode(body.promoCode);
    assertEligibleService(promotion, body.serviceKey);
    if (body.precheck === true) {
      return json(response, 200, {
        valid: true,
        code: promotion.code,
        label: promotion.label,
        percent: promotion.percent,
        expiresAt: promotion.expiresAt,
        expiresLabel: promotion.expiresLabel,
        pendingIdentityCheck: true
      });
    }
    const customer = body.customer || {};
    const identity = {
      email: cleanText(customer.email, 180),
      phone: cleanText(customer.phone, 40),
      address: cleanText(customer.address, 500)
    };
    if (!identity.email || !identity.phone) {
      return json(response, 400, { error: "Complete your email and phone number before applying the first-time customer discount." });
    }
    assertNotRedeemed(await listAllBookings(), identity, promotion);
    return json(response, 200, {
      valid: true,
      code: promotion.code,
      label: promotion.label,
      percent: promotion.percent,
      expiresAt: promotion.expiresAt,
      expiresLabel: promotion.expiresLabel
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "The promo code could not be checked.",
      code: error.code || "PROMO_ERROR"
    });
  }
};
