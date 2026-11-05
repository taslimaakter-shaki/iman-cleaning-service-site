const { cleanText, json, listAllBookings, readJsonBody } = require("./_shared");
const { assertEligibleService, assertCustomerPromotion, customerPromotion, promotionForCode } = require("./_promo");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    const body = await readJsonBody(request);
    if (body.precheck === true) {
      const promotion = promotionForCode(body.promoCode);
      assertEligibleService(promotion, body.serviceKey);
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
      phone: cleanText(customer.phone, 40)
    };
    if (!identity.email || !identity.phone) {
      return json(response, 400, { error: "Enter your email and phone number to check your customer discount." });
    }
    const eligible = customerPromotion(await listAllBookings({ complete: true }), identity);
    const promotion = body.automatic === true ? eligible : assertCustomerPromotion(body.promoCode, eligible);
    if (!promotion) return json(response, 200, { valid: false });
    assertEligibleService(promotion, body.serviceKey);
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
      error: error.message || "Your discount could not be checked.",
      code: error.code || "PROMO_ERROR"
    });
  }
};
