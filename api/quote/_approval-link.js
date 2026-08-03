const { cleanText, json, readJsonBody, signQuotePayload } = require("./_shared");

function assertAdmin(request) {
  const adminToken = cleanText(process.env.ADMIN_TOKEN || process.env.Admin_Token || process.env.admin_token);
  const providedToken = cleanText(request.headers["x-admin-token"]);
  return Boolean(adminToken && providedToken && providedToken === adminToken);
}

function getSiteUrl(request) {
  const configuredUrl = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

function amountToCents(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    if (!assertAdmin(request)) {
      return json(response, 401, { error: "Admin token required." });
    }

    const body = await readJsonBody(request);
    const quoteId = cleanText(body.quoteId, `QUOTE-${Date.now().toString().slice(-6)}`);
    const customerName = cleanText(body.customerName);
    const customerEmail = cleanText(body.customerEmail);
    const serviceLocation = cleanText(body.serviceLocation);
    const service = cleanText(body.service, "Cleaning Service Quote");
    const amountCents = amountToCents(body.amount);
    const serviceDate = cleanText(body.serviceDate);
    const serviceTime = cleanText(body.serviceTime);
    const description = cleanText(body.description);
    const siteUrl = getSiteUrl(request);
    const agreementUrl = cleanText(body.agreementUrl, `${siteUrl}/agreement.html`);

    if (!customerName || !customerEmail || !serviceLocation || !amountCents || !serviceDate || !serviceTime) {
      return json(response, 400, {
        error: "Customer name, customer email, service location, service date, service start time, and a valid amount are required."
      });
    }

    const token = signQuotePayload({
      quoteId,
      customerName,
      customerEmail,
      serviceLocation,
      service,
      amountCents,
      serviceDate,
      serviceTime,
      description,
      agreementUrl,
      createdAt: Date.now(),
      expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000
    });

    return json(response, 201, {
      quoteId,
      approvalUrl: `${siteUrl}/approve-quote.html?token=${encodeURIComponent(token)}`
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Quote approval link could not be created."
    });
  }
};
