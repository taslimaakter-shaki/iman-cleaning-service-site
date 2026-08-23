const crypto = require("crypto");
const {
  calculateOrganizationQuote,
  calculateWindowQuote,
  calculateResidentialQuoteBundle,
  cleanText,
  json,
  packageForClient,
  readJsonBody,
  recommendResidentialService
} = require("./_shared");

const TOKEN_VERSION = 1;
const QUOTE_LINK_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const recentDeliveries = new Map();

function getSiteUrl(request) {
  const configuredUrl = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

function getTokenSecret() {
  return process.env.QUOTE_APPROVAL_SECRET
    || process.env.ADMIN_TOKEN
    || process.env.Admin_Token
    || process.env.admin_token
    || process.env.STRIPE_SECRET_KEY
    || "";
}

function tokenKey() {
  const secret = getTokenSecret();
  if (!secret) {
    const error = new Error("Saved quote links are not configured.");
    error.statusCode = 503;
    throw error;
  }
  return crypto.createHash("sha256").update(String(secret)).digest();
}

function encodeSavedQuote(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [iv, ciphertext, tag].map((part) => part.toString("base64url")).join(".");
}

function decodeSavedQuote(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    const error = new Error("This saved quote link is invalid.");
    error.statusCode = 400;
    throw error;
  }
  try {
    const [iv, ciphertext, tag] = parts.map((part) => Buffer.from(part, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", tokenKey(), iv);
    decipher.setAuthTag(tag);
    const payload = JSON.parse(Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString("utf8"));
    if (payload.version !== TOKEN_VERSION) throw new Error("Unsupported saved quote version.");
    if (payload.expiresAt && Date.now() > Number(payload.expiresAt)) {
      const error = new Error("This saved quote link has expired. Please create a new quote.");
      error.statusCode = 410;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.statusCode) throw error;
    const invalid = new Error("This saved quote link is invalid.");
    invalid.statusCode = 400;
    throw invalid;
  }
}

function normalizePhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

async function saveQuoteRecord(record) {
  const { drive, config } = require("../quote/_shared").getGoogleClients();
  await drive.files.create({
    requestBody: {
      name: `${record.quoteId}-saved-residential-quote.json`,
      parents: [config.parentFolderId],
      mimeType: "application/json",
      appProperties: {
        iman_record_type: "saved_quote",
        saved_quote_id: record.quoteId
      }
    },
    media: {
      mimeType: "application/json",
      body: JSON.stringify(record)
    },
    fields: "id"
  });
}

async function loadQuoteRecord(quoteId) {
  const safeId = cleanText(quoteId, 100).replace(/'/g, "\\'");
  const { drive, config } = require("../quote/_shared").getGoogleClients();
  const parentFolderId = String(config.parentFolderId || "").replace(/'/g, "\\'");
  const listed = await drive.files.list({
    q: [
      `'${parentFolderId}' in parents`,
      "trashed = false",
      "appProperties has { key='iman_record_type' and value='saved_quote' }",
      `appProperties has { key='saved_quote_id' and value='${safeId}' }`
    ].join(" and "),
    fields: "files(id)",
    pageSize: 1
  });
  const file = listed.data.files?.[0];
  if (!file) {
    const error = new Error("This saved quote could not be found.");
    error.statusCode = 404;
    throw error;
  }
  const downloaded = await drive.files.get({ fileId: file.id, alt: "media" });
  const record = Buffer.isBuffer(downloaded.data)
    ? JSON.parse(downloaded.data.toString("utf8"))
    : typeof downloaded.data === "string"
    ? JSON.parse(downloaded.data)
    : downloaded.data;
  if (record.expiresAt && Date.now() > Number(record.expiresAt)) {
    const error = new Error("This saved quote link has expired. Please create a new quote.");
    error.statusCode = 410;
    throw error;
  }
  return record;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function encodeMimeWord(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function quoteEmail({ customer, pkg, quoteUrl }) {
  const from = process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com";
  const subject = `Your ${pkg.serviceLabel} quote — Iman Cleaning Service`;
  const greetingName = customer.firstName || "there";
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2
  }).format(pkg.price);
  const text = [
    `Hi ${greetingName},`,
    "",
    `Your personalized ${pkg.serviceLabel} quote is ${money}, including New York sales tax.`,
    "",
    "Use your secure link to review the quote, choose an available appointment, and pay:",
    quoteUrl,
    "",
    "This link is valid for 90 days. Appointment availability is confirmed when payment is completed.",
    "",
    "Questions? Call 929-803-4053.",
    "",
    "Iman Cleaning Service LLC"
  ].join("\n");
  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f8f7;font-family:Arial,sans-serif;color:#263b40;line-height:1.55;">
  <div style="max-width:640px;margin:0 auto;padding:28px 18px;">
    <div style="background:#fff;border:1px solid #d9e6e3;border-radius:18px;padding:30px;">
      <p style="margin-top:0;">Hi ${escapeHtml(greetingName)},</p>
      <h1 style="margin:10px 0;color:#073f49;font-size:26px;">Your personalized cleaning quote is ready.</h1>
      <p><strong>${escapeHtml(pkg.serviceLabel)}: ${escapeHtml(money)}</strong>, including New York sales tax.</p>
      <p style="margin:26px 0;"><a href="${escapeHtml(quoteUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#0b6474;color:#fff;text-decoration:none;font-weight:bold;">View quote and choose an appointment</a></p>
      <p>This secure link is valid for 90 days. Appointment availability is confirmed when payment is completed.</p>
      <p>Questions? Call <a href="tel:+19298034053" style="color:#0b6474;font-weight:bold;">929-803-4053</a>.</p>
      <p style="margin-bottom:0;">Iman Cleaning Service LLC</p>
    </div>
  </div>
</body></html>`;
  const boundary = `saved_quote_${Date.now().toString(36)}`;
  const raw = [
    `From: ${encodeMimeWord("IMAN Cleaning Service LLC")} <${from}>`,
    `To: ${customer.email}`,
    `Subject: ${encodeMimeWord(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "",
    text,
    `--${boundary}`,
    "Content-Type: text/html; charset=\"UTF-8\"",
    "",
    html,
    `--${boundary}--`,
    ""
  ].join("\r\n");
  return { raw: base64Url(raw), subject };
}

async function sendEmail({ customer, pkg, quoteUrl }) {
  const { getGoogleClients } = require("../quote/_shared");
  const { gmail } = getGoogleClients();
  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: quoteEmail({ customer, pkg, quoteUrl }).raw }
  });
  return cleanText(sent.data.id, 100);
}

async function sendSms({ customer, pkg, quoteUrl }) {
  const accountSid = cleanText(process.env.TWILIO_ACCOUNT_SID, 100);
  const authToken = cleanText(process.env.TWILIO_AUTH_TOKEN, 200);
  const from = normalizePhoneNumber(process.env.TWILIO_FROM_NUMBER);
  const to = normalizePhoneNumber(customer.phone);
  if (!accountSid || !authToken || !from) {
    const error = new Error("Text-message delivery is not configured.");
    error.statusCode = 503;
    throw error;
  }
  if (!to) {
    const error = new Error("Enter a valid mobile phone number.");
    error.statusCode = 400;
    throw error;
  }
  const body = [
    `Hi ${customer.firstName || "there"}, your ${pkg.serviceLabel} quote from Iman Cleaning Service is ready: ${quoteUrl}`,
    "Choose an appointment and pay whenever you’re ready. Link valid for 90 days. Reply STOP to opt out."
  ].join(" ");
  const encoded = new URLSearchParams({ From: from, To: to, Body: body });
  const smsResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: encoded.toString()
  });
  const text = await smsResponse.text();
  const data = text ? JSON.parse(text) : {};
  if (!smsResponse.ok) {
    const error = new Error(data?.message || "The quote text message could not be sent.");
    error.statusCode = smsResponse.status;
    throw error;
  }
  return cleanText(data.sid, 100);
}

function validateAndPrice(body) {
  const eligibility = body.eligibility && typeof body.eligibility === "object"
    ? body.eligibility
    : {};
  const serviceKey = cleanText(eligibility.requestedService, 40);
  const unitDetails = Array.isArray(body.unitDetails) ? body.unitDetails.slice(0, 10) : [];
  if (serviceKey === "organization" && body.pricingMode === "organization_formula") {
    const pkg = calculateOrganizationQuote(unitDetails[0]?.hours);
    return { eligibility, serviceKey, unitDetails, pkg };
  }
  if (serviceKey === "window" && body.pricingMode === "window_formula") {
    const pkg = calculateWindowQuote(unitDetails[0], eligibility.serviceZip);
    return { eligibility, serviceKey, unitDetails, pkg };
  }
  if (!["standard", "deep", "move"].includes(serviceKey) || body.pricingMode !== `${serviceKey}_formula`) {
    const error = new Error("This saved quote request is not supported.");
    error.statusCode = 400;
    throw error;
  }
  const pkg = calculateResidentialQuoteBundle(unitDetails, serviceKey);
  const recommendation = recommendResidentialService(eligibility);
  if (recommendation.type !== "instant" || recommendation.serviceKey !== serviceKey) {
    const error = new Error(recommendation.reason || "This cleaning request requires a custom quote.");
    error.statusCode = 409;
    throw error;
  }
  return { eligibility, serviceKey, unitDetails, pkg };
}

function cleanCustomer(input = {}) {
  const customer = {
    firstName: cleanText(input.firstName, 80),
    lastName: cleanText(input.lastName, 80),
    email: cleanText(input.email, 180).toLowerCase(),
    phone: normalizePhoneNumber(input.phone)
  };
  if (!customer.firstName || !customer.lastName || !customer.email || !customer.phone) {
    const error = new Error("Enter your first name, last name, email, and mobile phone number.");
    error.statusCode = 400;
    throw error;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email)) {
    const error = new Error("Enter a valid email address.");
    error.statusCode = 400;
    throw error;
  }
  return customer;
}

function deliveryKey(request, customer) {
  const ip = cleanText(request.headers["x-forwarded-for"] || request.socket?.remoteAddress, 120).split(",")[0];
  return crypto.createHash("sha256").update(`${ip}|${customer.email}|${customer.phone}`).digest("hex");
}

function recentDelivery(key) {
  const now = Date.now();
  for (const [storedKey, delivery] of recentDeliveries) {
    if (now - delivery.time > 10 * 60 * 1000) recentDeliveries.delete(storedKey);
  }
  return recentDeliveries.get(key) || null;
}

module.exports = async function handler(request, response) {
  try {
    if (request.method === "GET") {
      const link = decodeSavedQuote(request.query?.token);
      const payload = await loadQuoteRecord(link.quoteId);
      const { pkg } = validateAndPrice(payload);
      return json(response, 200, {
        eligibility: payload.eligibility,
        unitDetails: payload.unitDetails,
        customer: payload.customer,
        package: packageForClient(pkg),
        expiresAt: payload.expiresAt
      });
    }
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const body = await readJsonBody(request);
    if (cleanText(body.website, 100)) return json(response, 200, { saved: true });
    if (body.smsConsent !== true) {
      return json(response, 400, { error: "Please agree to receive your quote by text message." });
    }
    const customer = cleanCustomer(body.customer);
    const { eligibility, unitDetails, pkg } = validateAndPrice(body);
    const now = Date.now();
    const key = deliveryKey(request, customer);
    const recent = recentDelivery(key);
    if (recent) {
      return json(response, 200, {
        saved: true,
        quoteUrl: recent.quoteUrl,
        delivery: { email: "already_sent", sms: "already_sent" }
      });
    }
    const quoteId = `SAVED-${now.toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const expiresAt = now + QUOTE_LINK_LIFETIME_MS;
    const token = encodeSavedQuote({
      version: TOKEN_VERSION,
      quoteId,
      expiresAt
    });
    await saveQuoteRecord({
      version: TOKEN_VERSION,
      quoteId,
      eligibility,
      unitDetails,
      pricingMode: pkg.pricingMode,
      customer,
      createdAt: now,
      expiresAt
    });
    const quoteUrl = `${getSiteUrl(request)}/book-now.html?quote=${encodeURIComponent(token)}`;
    recentDeliveries.set(key, { time: now, quoteUrl });

    const [emailResult, smsResult] = await Promise.allSettled([
      sendEmail({ customer, pkg, quoteUrl }),
      sendSms({ customer, pkg, quoteUrl })
    ]);
    return json(response, 201, {
      saved: true,
      quoteUrl,
      delivery: {
        email: emailResult.status === "fulfilled" ? "sent" : "failed",
        sms: smsResult.status === "fulfilled" ? "sent" : "failed"
      }
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Your saved quote link could not be created."
    });
  }
};

module.exports.decodeSavedQuote = decodeSavedQuote;
module.exports.encodeSavedQuote = encodeSavedQuote;
module.exports.normalizePhoneNumber = normalizePhoneNumber;
