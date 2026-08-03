const crypto = require("crypto");
const { cleanText, json, readJsonBody } = require("./_shared");
const { buildManualCallRow, safeUpsertCallLog } = require("../receptionist/_shared");

const DEFAULT_QUOTE_URL = "https://www.imancleaningservice.com/quote.html";

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getAuthSecret() {
  return cleanText(process.env.QUOTE_LINK_WEBHOOK_SECRET);
}

function requireWebhookAuth(request) {
  const secret = getAuthSecret();
  if (!secret) {
    const error = new Error("Quote link SMS webhook is not configured.");
    error.statusCode = 503;
    error.setup = "Add QUOTE_LINK_WEBHOOK_SECRET in Vercel and in the ElevenLabs webhook tool header.";
    throw error;
  }

  const headerSecret = cleanText(request.headers["x-iman-webhook-secret"]);
  const authHeader = cleanText(request.headers.authorization);
  const bearerSecret = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";

  if (!safeEqual(headerSecret, secret) && !safeEqual(bearerSecret, secret)) {
    const error = new Error("Unauthorized.");
    error.statusCode = 401;
    throw error;
  }
}

function normalizePhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

function payloadContainers(body = {}) {
  const containers = [];
  const seen = new Set();

  function push(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || seen.has(value)) return;
    seen.add(value);
    containers.push(value);
  }

  push(body);
  push(body.args);
  push(body.arguments);
  push(body.parameters);
  push(body.call);
  push(body.phone_call);
  push(body.phoneCall);
  push(body.metadata);
  push(body.dynamic_variables);
  push(body.dynamicVariables);

  for (const container of [...containers]) {
    push(container.call);
    push(container.phone_call);
    push(container.phoneCall);
    push(container.telephony);
    push(container.provider_data);
    push(container.providerData);
    push(container.metadata);
    push(container.dynamic_variables);
    push(container.dynamicVariables);
  }

  return containers;
}

function firstPayloadText(body = {}, ...keys) {
  for (const container of payloadContainers(body)) {
    for (const key of keys) {
      const text = cleanText(container[key]);
      if (text) return text;
    }
  }
  return "";
}

function phoneFromPayload(body = {}) {
  return firstPayloadText(
    body,
    "to",
    "phone",
    "customerPhone",
    "customer_phone",
    "mobileNumber",
    "mobile_number",
    "callerPhone",
    "caller_phone",
    "callerNumber",
    "caller_number",
    "callerId",
    "caller_id",
    "user_number",
    "userNumber",
    "fromNumber",
    "from_number",
    "from",
    "From",
    "Caller"
  );
}

function textFromPayload(body = {}, ...keys) {
  return firstPayloadText(body, ...keys);
}

function getSmsConfig() {
  return {
    accountSid: cleanText(process.env.TWILIO_ACCOUNT_SID),
    authToken: cleanText(process.env.TWILIO_AUTH_TOKEN),
    from: cleanText(process.env.TWILIO_FROM_NUMBER)
  };
}

function requireSmsConfig() {
  const config = getSmsConfig();
  const missing = Object.entries({
    TWILIO_ACCOUNT_SID: config.accountSid,
    TWILIO_AUTH_TOKEN: config.authToken,
    TWILIO_FROM_NUMBER: config.from
  }).filter(([, value]) => !value).map(([key]) => key);

  if (missing.length) {
    const error = new Error(`SMS is not configured. Missing: ${missing.join(", ")}.`);
    error.statusCode = 503;
    error.setup = "Add Twilio SMS environment variables in Vercel.";
    throw error;
  }

  return config;
}

function quoteUrl() {
  return cleanText(process.env.PUBLIC_QUOTE_FORM_URL || process.env.QUOTE_FORM_URL, DEFAULT_QUOTE_URL);
}

function buildMessage() {
  return [
    "Hi! 👋 Thank you for contacting Iman Cleaning Service.",
    "",
    "To provide you with an accurate, no-obligation cleaning quote, please complete our secure quote form below:",
    "",
    `📝 ${quoteUrl()}`,
    "",
    "The form takes about 2-3 minutes to complete. Please include as much detail as possible and upload photos of the space if available. This helps us provide the most accurate estimate.",
    "",
    "Once we receive your request, our team member will review it and contact you within the next 30 minutes with your personalized quote.",
    "",
    "Thank you for choosing Iman Cleaning Service. We look forward to helping you! ✨",
    "",
    "📞 (929) 232-1930",
    "📧 info@imancleaningservice.com",
    "🌐 www.imancleaningservice.com",
    "",
    "Reply STOP to opt out."
  ].join("\n");
}

async function twilioRequest({ accountSid, authToken, from, to, body }) {
  const encoded = new URLSearchParams({
    From: from,
    To: to,
    Body: body
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: encoded.toString()
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(data?.message || "Quote form SMS could not be sent.");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function sendQuoteLink({ to, customerName = "", service = "" }) {
  const normalizedTo = normalizePhoneNumber(to);
  if (!normalizedTo) {
    const error = new Error("A valid customer phone number is required.");
    error.statusCode = 400;
    throw error;
  }

  const config = requireSmsConfig();
  const message = buildMessage({ customerName, service });
  const result = await twilioRequest({
    ...config,
    to: normalizedTo,
    body: message
  });

  return {
    sent: true,
    to: normalizedTo,
    quoteUrl: quoteUrl(),
    messageId: cleanText(result.sid)
  };
}

async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    requireWebhookAuth(request);

    const body = await readJsonBody(request);
    const customerName = textFromPayload(body, "customerName", "customer_name", "callerName", "caller_name", "name");
    const service = textFromPayload(body, "service", "serviceType", "service_type", "intent");
    const result = await sendQuoteLink({
      to: phoneFromPayload(body),
      customerName,
      service
    });
    const logResult = await safeUpsertCallLog(buildManualCallRow(body, {
      rawEventType: "retell_quote_link_sms",
      callType: "quote",
      callStatus: "quote_link_sent",
      quoteFormSent: true,
      callerPhone: result.to,
      customerName,
      summary: "Quote form link sent by SMS.",
      source: "retell_quote_link"
    }));

    return json(response, 200, {
      ...result,
      callLogged: logResult.logged,
      callLogError: logResult.error || ""
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Quote form SMS could not be sent.",
      details: error.details,
      setup: error.setup
    });
  }
}

module.exports = handler;
module.exports.sendQuoteLink = sendQuoteLink;
module.exports.buildMessage = buildMessage;
module.exports.normalizePhoneNumber = normalizePhoneNumber;
