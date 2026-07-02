function json(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function assertAdmin(request) {
  const adminToken = process.env.ADMIN_TOKEN;
  const providedToken = request.headers["x-admin-token"];

  return Boolean(adminToken && providedToken && providedToken === adminToken);
}

function getSiteUrl(request) {
  const configuredUrl = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

function formatServiceName(service) {
  const cleanService = String(service || "").trim();
  return cleanService || "Cleaning Service Quote";
}

function toStripeAmount(amount) {
  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.round(value * 100);
}

function centsToDollars(cents) {
  return (Math.max(0, Number(cents) || 0) / 100).toFixed(2);
}

function depositCents(totalCents) {
  return Math.max(1, Math.round((Number(totalCents) || 0) * 0.25));
}

function remainingCents(totalCents) {
  return Math.max(0, (Number(totalCents) || 0) - depositCents(totalCents));
}

function normalizePaymentType(value) {
  return String(value || "").trim() === "remaining_75" ? "remaining_75" : "full";
}

const TERMS_CHECKBOX_TEXT = "I have read, understood, and agree to the Iman Cleaning Service LLC Service Agreement.";
const PAYMENT_BUTTON_TEXT = "By continuing, you agree to the Iman Cleaning Service LLC Service Agreement. The remaining balance is due immediately upon completion of service unless otherwise agreed in writing.";

async function createCheckoutSession(secretKey, params) {
  const encoded = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      encoded.append(key, String(value));
    }
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: encoded.toString()
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(data?.error?.message || "Stripe checkout session could not be created.");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    if (!assertAdmin(request)) {
      return json(response, 401, { error: "Admin token required." });
    }

    const secretKey = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;

    if (!secretKey) {
      return json(response, 503, {
        error: "Stripe is not configured yet.",
        setup: "Add STRIPE_SECRET_KEY in Vercel."
      });
    }
    if (!String(secretKey).startsWith("sk_")) {
      return json(response, 503, {
        error: "Stripe secret key is saved incorrectly in Vercel.",
        setup: "Update STRIPE_SECRET_KEY or Stripe_Secret_Key so the value starts with sk_live_."
      });
    }

    const body = await readBody(request);
    const totalAmountCents = toStripeAmount(body.amount);
    const paymentType = normalizePaymentType(body.paymentType);
    const amountCents = paymentType === "remaining_75" ? remainingCents(totalAmountCents) : totalAmountCents;
    const remainingAmountCents = paymentType === "remaining_75" ? 0 : 0;
    const siteUrl = getSiteUrl(request);
    const agreementUrl = String(body.agreementUrl || `${siteUrl}/agreement.html`);
    const customerName = String(body.customerName || "").trim();
    const customerEmail = String(body.customerEmail || "").trim();
    const serviceLocation = String(body.serviceLocation || "").trim();
    const serviceName = formatServiceName(body.service);
    const quoteId = String(body.quoteId || `QUOTE-${Date.now().toString().slice(-6)}`);
    const description = String(body.description || "").trim();
    const serviceDate = String(body.serviceDate || "").trim();
    const serviceTime = String(body.serviceTime || "").trim();

    if (!customerName || !customerEmail || !serviceLocation || !serviceDate || !serviceTime || !totalAmountCents || !amountCents) {
      return json(response, 400, {
        error: "Customer name, customer email, service location, service date, service start time, and a valid amount are required."
      });
    }

    const paymentLabel = paymentType === "remaining_75" ? "75% Remaining Balance" : "Full Payment";
    const scheduleText = [serviceDate, serviceTime].filter(Boolean).join(" at ");
    const productDescription = [
      description,
      serviceLocation ? `Service location: ${serviceLocation}.` : "",
      scheduleText ? `Scheduled service: ${scheduleText}.` : "",
      paymentType === "remaining_75"
        ? `Total service price: $${centsToDollars(totalAmountCents)}. Remaining balance due now: $${centsToDollars(amountCents)}.`
        : `Full service price: $${centsToDollars(amountCents)}.`
    ].filter(Boolean).join(" ");

    const checkoutParams = {
      mode: "payment",
      customer_email: customerEmail,
      customer_creation: "always",
      "phone_number_collection[enabled]": "true",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": amountCents,
      "line_items[0][price_data][product_data][name]": `${serviceName} - ${paymentLabel}`,
      "line_items[0][price_data][product_data][description]": productDescription,
      "line_items[0][quantity]": 1,
      "payment_intent_data[description]": `${serviceName} for ${customerName}`,
      "payment_intent_data[receipt_email]": customerEmail,
      "payment_intent_data[metadata][quote_id]": quoteId,
      "payment_intent_data[metadata][customer_name]": customerName,
      "payment_intent_data[metadata][service_location]": serviceLocation,
      "payment_intent_data[metadata][service]": serviceName,
      "payment_intent_data[metadata][service_date]": serviceDate,
      "payment_intent_data[metadata][service_time]": serviceTime,
      "payment_intent_data[metadata][total_amount_cents]": totalAmountCents,
      "payment_intent_data[metadata][payment_amount_cents]": amountCents,
      "payment_intent_data[metadata][remaining_amount_cents]": remainingAmountCents,
      "payment_intent_data[metadata][payment_type]": paymentType,
      "metadata[quote_id]": quoteId,
      "metadata[customer_name]": customerName,
      "metadata[service_location]": serviceLocation,
      "metadata[service]": serviceName,
      "metadata[service_date]": serviceDate,
      "metadata[service_time]": serviceTime,
      "metadata[agreement_url]": agreementUrl,
      "metadata[total_amount_cents]": totalAmountCents,
      "metadata[payment_amount_cents]": amountCents,
      "metadata[remaining_amount_cents]": remainingAmountCents,
      "metadata[payment_type]": paymentType,
      "invoice_creation[enabled]": "true",
      "invoice_creation[invoice_data][description]": productDescription,
      "invoice_creation[invoice_data][metadata][quote_id]": quoteId,
      "invoice_creation[invoice_data][metadata][customer_name]": customerName,
      "invoice_creation[invoice_data][metadata][service_location]": serviceLocation,
      "invoice_creation[invoice_data][metadata][service]": serviceName,
      "invoice_creation[invoice_data][metadata][service_date]": serviceDate,
      "invoice_creation[invoice_data][metadata][service_time]": serviceTime,
      success_url: `${siteUrl}/quote-paid.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: paymentType === "remaining_75" ? siteUrl : `${siteUrl}/agreement.html`
    };

    if (paymentType !== "remaining_75") {
      Object.assign(checkoutParams, {
        "consent_collection[terms_of_service]": "required",
        "custom_text[terms_of_service_acceptance][message]": TERMS_CHECKBOX_TEXT,
        "custom_text[submit][message]": PAYMENT_BUTTON_TEXT
      });
    }

    const checkoutSession = await createCheckoutSession(secretKey, checkoutParams);

    return json(response, 201, {
      quoteId,
      checkoutUrl: checkoutSession.url,
      sessionId: checkoutSession.id
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Unexpected server error.",
      details: error.details
    });
  }
};
