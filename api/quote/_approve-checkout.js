const {
  cleanText,
  json,
  centsToDollars,
  verifyQuoteToken
} = require("./_shared");

const TERMS_CHECKBOX_TEXT = "I have read, understood, and agree to the Iman Cleaning Service LLC Service Agreement.";
const PAYMENT_BUTTON_TEXT = "By continuing, you agree that a 25% deposit of the total service price is collected now to secure the appointment. The appointment is not confirmed until the deposit has been received. The remaining balance is due immediately upon completion of service unless otherwise agreed in writing. If you cancel less than 48 hours before the scheduled appointment, the 25% deposit is non-refundable.";

function depositCents(totalCents) {
  return Math.max(1, Math.round((Number(totalCents) || 0) * 0.25));
}

function getSiteUrl(request) {
  const configuredUrl = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

function getClientIp(request) {
  const forwardedFor = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return cleanText(forwardedFor || request.socket?.remoteAddress || "");
}

function parseMultipartFields(request) {
  return new Promise((resolve, reject) => {
    const fields = {};
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const params = new URLSearchParams(body);
      params.forEach((value, key) => {
        fields[key] = value;
      });
      resolve(fields);
    });
    request.on("error", reject);
  });
}

async function readFields(request) {
  const contentType = String(request.headers["content-type"] || "");
  if (!contentType.includes("multipart/form-data")) {
    return parseMultipartFields(request);
  }

  const Busboy = require("busboy");
  return new Promise((resolve, reject) => {
    const fields = {};
    const busboy = Busboy({
      headers: request.headers,
      limits: {
        files: 0,
        fields: 10
      }
    });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (name, file) => {
      file.resume();
    });

    busboy.on("error", reject);
    busboy.on("finish", () => {
      resolve(fields);
    });

    request.pipe(busboy);
  });
}

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

    const fields = await readFields(request);
    if (fields.agreementAccepted !== "true") {
      return json(response, 400, { error: "You must agree to the service agreement before payment." });
    }
    if (fields.agreementScrolled !== "true") {
      return json(response, 400, { error: "Please scroll through the service agreement before payment." });
    }

    const agreementSignature = cleanText(fields.agreementSignature);
    if (agreementSignature.length < 2) {
      return json(response, 400, { error: "Please type your full legal name to sign the service agreement." });
    }

    const quote = verifyQuoteToken(fields.token);

    const siteUrl = getSiteUrl(request);
    const totalAmountCents = Number(quote.amountCents) || 0;
    const scheduleText = [quote.serviceDate, quote.serviceTime].filter(Boolean).join(" at ");
    const paymentAmountCents = depositCents(totalAmountCents);
    const remainingAmountCents = Math.max(0, totalAmountCents - paymentAmountCents);
    const agreementSignedAt = new Date().toISOString();
    const agreementIp = getClientIp(request);
    const productDescription = [
      quote.description,
      quote.serviceLocation ? `Service location: ${quote.serviceLocation}.` : "",
      scheduleText ? `Scheduled service: ${scheduleText}.` : "",
      `Total service price: $${centsToDollars(totalAmountCents)}.`,
      `Deposit due now: $${centsToDollars(paymentAmountCents)}.`
    ].filter(Boolean).join(" ");

    const checkoutSession = await createCheckoutSession(secretKey, {
      mode: "payment",
      customer_email: quote.customerEmail,
      customer_creation: "always",
      "phone_number_collection[enabled]": "true",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": paymentAmountCents,
      "line_items[0][price_data][product_data][name]": `${quote.service} - 25% Deposit`,
      "line_items[0][price_data][product_data][description]": productDescription,
      "line_items[0][quantity]": 1,
      "consent_collection[terms_of_service]": "required",
      "custom_text[terms_of_service_acceptance][message]": TERMS_CHECKBOX_TEXT,
      "custom_text[submit][message]": PAYMENT_BUTTON_TEXT,
      "payment_intent_data[description]": `${quote.service} for ${quote.customerName}`,
      "payment_intent_data[receipt_email]": quote.customerEmail,
      "payment_intent_data[metadata][quote_id]": quote.quoteId,
      "payment_intent_data[metadata][customer_name]": quote.customerName,
      "payment_intent_data[metadata][service_location]": quote.serviceLocation,
      "payment_intent_data[metadata][service]": quote.service,
      "payment_intent_data[metadata][service_date]": quote.serviceDate,
      "payment_intent_data[metadata][service_time]": quote.serviceTime,
      "payment_intent_data[metadata][total_amount_cents]": totalAmountCents,
      "payment_intent_data[metadata][payment_amount_cents]": paymentAmountCents,
      "payment_intent_data[metadata][remaining_amount_cents]": remainingAmountCents,
      "payment_intent_data[metadata][payment_type]": "deposit_25",
      "payment_intent_data[metadata][agreement_accepted]": "true",
      "payment_intent_data[metadata][agreement_signature]": agreementSignature,
      "payment_intent_data[metadata][agreement_signed_at]": agreementSignedAt,
      "payment_intent_data[metadata][agreement_ip]": agreementIp,
      "metadata[quote_id]": quote.quoteId,
      "metadata[customer_name]": quote.customerName,
      "metadata[service_location]": quote.serviceLocation,
      "metadata[service]": quote.service,
      "metadata[service_date]": quote.serviceDate,
      "metadata[service_time]": quote.serviceTime,
      "metadata[agreement_url]": quote.agreementUrl,
      "metadata[total_amount_cents]": totalAmountCents,
      "metadata[payment_amount_cents]": paymentAmountCents,
      "metadata[remaining_amount_cents]": remainingAmountCents,
      "metadata[payment_type]": "deposit_25",
      "metadata[agreement_accepted]": "true",
      "metadata[agreement_signature]": agreementSignature,
      "metadata[agreement_signed_at]": agreementSignedAt,
      "metadata[agreement_ip]": agreementIp,
      "invoice_creation[enabled]": "true",
      "invoice_creation[invoice_data][description]": productDescription,
      "invoice_creation[invoice_data][metadata][quote_id]": quote.quoteId,
      "invoice_creation[invoice_data][metadata][customer_name]": quote.customerName,
      "invoice_creation[invoice_data][metadata][service_location]": quote.serviceLocation,
      "invoice_creation[invoice_data][metadata][service]": quote.service,
      "invoice_creation[invoice_data][metadata][service_date]": quote.serviceDate,
      "invoice_creation[invoice_data][metadata][service_time]": quote.serviceTime,
      "invoice_creation[invoice_data][metadata][agreement_accepted]": "true",
      "invoice_creation[invoice_data][metadata][agreement_signature]": agreementSignature,
      "invoice_creation[invoice_data][metadata][agreement_signed_at]": agreementSignedAt,
      success_url: `${siteUrl}/quote-paid.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/approve-quote.html?token=${encodeURIComponent(fields.token)}`
    });

    return json(response, 201, {
      quoteId: quote.quoteId,
      checkoutUrl: checkoutSession.url,
      sessionId: checkoutSession.id
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Quote approval could not be completed.",
      details: error.details,
      setup: error.setup
    });
  }
};
