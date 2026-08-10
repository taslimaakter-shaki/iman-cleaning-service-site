const { cleanText, trySendFormSubmissionNotification } = require("./_form-notifications");

const MAX_JSON_BODY = 64 * 1024;
const DEFAULT_SITE_URL = "https://www.imancleaningservice.com";
const INSTANT_PRICING_NOTIFICATION_TO = "+19298034053";
const INSTANT_PRICING_DEDUP_MS = 30 * 60 * 1000;
const recentInstantPricingNotifications = new Map();

function json(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function readRawBody(request, maxBytes = MAX_JSON_BODY) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function readJsonBody(request) {
  const raw = await readRawBody(request);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw Object.assign(new Error("Invalid JSON body."), { statusCode: 400 });
  }
}

function getUrl(request) {
  return new URL(request.url || "", DEFAULT_SITE_URL);
}

function getAction(request) {
  const queryAction = request.query?.action;
  if (Array.isArray(queryAction)) return cleanText(queryAction[0], 80);
  if (queryAction) return cleanText(queryAction, 80);
  return cleanText(getUrl(request).searchParams.get("action"), 80);
}

function adminToken(request) {
  return cleanText(request.headers["x-admin-token"])
    || cleanText(getUrl(request).searchParams.get("token"));
}

function assertAdmin(request) {
  const expected = cleanText(process.env.ADMIN_TOKEN);
  if (!expected || adminToken(request) !== expected) {
    const error = new Error("Admin token required.");
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

function clientFingerprint(request) {
  const forwarded = cleanText(request.headers["x-forwarded-for"], 240).split(",")[0].trim();
  const address = forwarded
    || cleanText(request.headers["x-real-ip"], 120)
    || cleanText(request.socket?.remoteAddress, 120)
    || "unknown";
  const userAgent = cleanText(request.headers["user-agent"], 240);
  return `${address}|${userAgent}`;
}

function recentlyNotifiedInstantPricing(request, now = Date.now()) {
  for (const [key, notifiedAt] of recentInstantPricingNotifications) {
    if (now - notifiedAt > INSTANT_PRICING_DEDUP_MS) recentInstantPricingNotifications.delete(key);
  }
  const key = clientFingerprint(request);
  const notifiedAt = recentInstantPricingNotifications.get(key);
  if (notifiedAt && now - notifiedAt <= INSTANT_PRICING_DEDUP_MS) return true;
  recentInstantPricingNotifications.set(key, now);
  return false;
}

async function twilioRequest({ accountSid, authToken, path, options = {} }) {
  return twilioFetch({
    accountSid,
    authToken,
    url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}${path}`,
    options
  });
}

async function twilioFetch({ accountSid, authToken, url, options = {} }) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(data?.message || "Twilio webhook setup failed.");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function setupTwilioWebhook(request, response) {
  assertAdmin(request);

  const accountSid = cleanText(process.env.TWILIO_ACCOUNT_SID);
  const authToken = cleanText(process.env.TWILIO_AUTH_TOKEN);
  const from = normalizePhoneNumber(process.env.TWILIO_FROM_NUMBER);
  const siteUrl = DEFAULT_SITE_URL;
  const configuredSmsUrl = cleanText(process.env.LIVE_CHAT_SMS_WEBHOOK_URL);
  const smsUrl = configuredSmsUrl || `${siteUrl}/api/chat/twilio-webhook`;

  const missing = Object.entries({
    TWILIO_ACCOUNT_SID: accountSid,
    TWILIO_AUTH_TOKEN: authToken,
    TWILIO_FROM_NUMBER: from
  }).filter(([, value]) => !value).map(([key]) => key);

  if (missing.length) {
    return json(response, 503, {
      error: `Twilio is not configured. Missing: ${missing.join(", ")}.`
    });
  }

  const list = await twilioRequest({
    accountSid,
    authToken,
    path: `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from)}`
  });
  const phoneNumber = list.incoming_phone_numbers?.[0];
  if (!phoneNumber?.sid) {
    return json(response, 404, {
      error: "The configured TWILIO_FROM_NUMBER was not found in this Twilio account."
    });
  }

  if (phoneNumber.messaging_service_sid) {
    const body = new URLSearchParams({
      InboundRequestUrl: smsUrl,
      InboundMethod: "POST"
    });
    const updatedService = await twilioFetch({
      accountSid,
      authToken,
      url: `https://messaging.twilio.com/v1/Services/${encodeURIComponent(phoneNumber.messaging_service_sid)}`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
      }
    });

    return json(response, 200, {
      ok: true,
      target: "messaging_service",
      phoneNumberSid: phoneNumber.sid,
      messagingServiceSid: updatedService.sid,
      smsUrl: updatedService.inbound_request_url || "",
      smsMethod: updatedService.inbound_method || ""
    });
  }

  const body = new URLSearchParams({
    SmsApplicationSid: "",
    SmsUrl: smsUrl,
    SmsMethod: "POST"
  });
  const updated = await twilioRequest({
    accountSid,
    authToken,
    path: `/IncomingPhoneNumbers/${encodeURIComponent(phoneNumber.sid)}.json`,
    options: {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    }
  });

  return json(response, 200, {
    ok: true,
    phoneNumberSid: updated.sid,
    smsUrl: updated.sms_url,
    smsMethod: updated.sms_method
  });
}

module.exports = async function handler(request, response) {
  try {
    if (getAction(request) === "setup-twilio-webhook") {
      return await setupTwilioWebhook(request, response);
    }

    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const body = await readJsonBody(request);
    const fields = body.fields && typeof body.fields === "object" ? body.fields : {};
    const source = cleanText(body.source, 80) || "Website form";
    const eventLabel = cleanText(body.event, 24) === "opened" ? "opened" : "submitted";
    if (source === "Instant pricing form" && eventLabel === "opened" && recentlyNotifiedInstantPricing(request)) {
      return json(response, 202, {
        ok: true,
        deduplicated: true,
        ownerSms: { status: "deduplicated", sent: [], error: "" }
      });
    }
    const ownerSms = await trySendFormSubmissionNotification({
      source,
      eventLabel,
      recipientOverride: source === "Instant pricing form" && eventLabel === "opened"
        ? [INSTANT_PRICING_NOTIFICATION_TO]
        : undefined,
      fields,
      recordId: cleanText(body.recordId, 120),
      pageUrl: cleanText(body.pageUrl, 500),
      folderLink: cleanText(body.folderLink, 500),
      summaryLines: Array.isArray(body.summaryLines) ? body.summaryLines : []
    });

    return json(response, ownerSms.status === "sent" ? 200 : 202, {
      ok: ownerSms.status === "sent",
      ownerSms
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Form notification could not be processed.",
      details: error.details
    });
  }
};
