const crypto = require("crypto");
const {
  calculateHourlyCleaningQuote,
  calculateWindowQuote,
  calculateResidentialQuoteBundle,
  assertResidentialDayFits,
  cleanText,
  isNYCServiceZip,
  temporarilyPausedServiceBorough,
  json,
  listAllBookings,
  packageForClient,
  readJsonBody,
  recommendResidentialService
} = require("./_shared");

const TOKEN_VERSION = 1;
const QUOTE_LINK_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const CONSENT_VERSION = "2026-09-07-v2";
const TRANSACTIONAL_SMS_DISCLOSURE = "I agree to receive my quote and appointment-related communications by email and text from Iman Cleaning Service LLC. Required service messages only. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help.";
const TRANSACTIONAL_EMAIL_DISCLOSURE = "I agree to receive my quote and appointment-related communications by email and text from Iman Cleaning Service LLC.";
const MARKETING_SMS_DISCLOSURE = "I agree to receive promotional emails and recurring promotional text messages from Iman Cleaning Service LLC. Texts may be sent using automated technology. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe from texts or HELP for help. Promotional emails include an unsubscribe option. Consent is not a condition of purchase.";
const MARKETING_EMAIL_NOTICE = MARKETING_SMS_DISCLOSURE;
const recentDeliveries = new Map();
const pendingDeliveries = new Map();

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
  if (record.crmQuote?.deletedAt) throw Object.assign(new Error("This quote is no longer available. Please contact IMAN Cleaning Service."), { statusCode: 410 });
  if (record.crmQuote?.updating) throw Object.assign(new Error("Your quote is being updated. Please try again shortly."), { statusCode: 409 });
  if (record.expiresAt && Date.now() > Number(record.expiresAt)) {
    const error = new Error("This saved quote link has expired. Please create a new quote.");
    error.statusCode = 410;
    throw error;
  }
  return record;
}

function bookingDisablesQuote(booking, quoteId) {
  if (cleanText(booking?.estimate?.savedQuoteId, 150) !== cleanText(quoteId, 150)) return false;
  const bookingStatus = cleanText(booking?.status, 80).toLowerCase();
  const payment = booking?.estimate?.payment || {};
  const paymentStatus = cleanText(payment.status || booking?.estimate?.paymentStatus || booking?.payment_status, 80).toLowerCase();
  return ["confirmed", "cleaner assigned", "in progress", "completed"].includes(bookingStatus)
    || Number(payment.paidCents || 0) > 0
    || /^(deposit_paid|paid|captured|fully_paid|succeeded|complete|completed)$/.test(paymentStatus);
}

async function assertQuoteUnused(quoteId, bookings) {
  const records = bookings || await listAllBookings();
  if (records.some((booking) => bookingDisablesQuote(booking, quoteId))) {
    const error = new Error("This quote has already been paid and booked. Your appointment is confirmed, so this quote link is no longer available.");
    error.statusCode = 410;
    error.code = "QUOTE_ALREADY_BOOKED";
    throw error;
  }
}

async function markQuoteOpened(quoteId, openedAt = new Date()) {
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
    fields: "files(id)", pageSize: 1
  });
  const file = listed.data.files?.[0];
  if (!file) return;
  const current = await drive.files.get({ fileId: file.id, alt: "media" });
  const record = Buffer.isBuffer(current.data)
    ? JSON.parse(current.data.toString("utf8"))
    : typeof current.data === "string" ? JSON.parse(current.data) : current.data;
  if (record.quoteOpenedAt) return;
  await drive.files.update({
    fileId: file.id,
    media: { mimeType: "application/json", body: JSON.stringify({ ...record, quoteOpenedAt: openedAt.toISOString() }) }
  });
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
    "Questions? Call 929-232-1930.",
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
      <p>Questions? Call <a href="tel:+19292321930" style="color:#0b6474;font-weight:bold;">929-232-1930</a>.</p>
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
  const pausedBorough = temporarilyPausedServiceBorough(eligibility.serviceZip);
  if (pausedBorough) {
    const error = new Error(`We’re temporarily not providing service in ${pausedBorough}. We expect to resume service there soon.`);
    error.statusCode = 409;
    throw error;
  }
  if (!isNYCServiceZip(eligibility.serviceZip)) {
    const error = new Error("Enter a ZIP code within our New York City service area.");
    error.statusCode = 400;
    throw error;
  }
  const serviceKey = cleanText(eligibility.requestedService, 40);
  const unitDetails = Array.isArray(body.unitDetails) ? body.unitDetails.slice(0, 10) : [];
  if (serviceKey === "organization") {
    const error = new Error("Organization Service is no longer available. Please choose another cleaning service.");
    error.statusCode = 410;
    throw error;
  }
  if (serviceKey === "hourly" && body.pricingMode === "hourly_formula") {
    const pkg = calculateHourlyCleaningQuote(unitDetails[0]?.hours);
    return { eligibility, serviceKey, unitDetails, pkg };
  }
  if (serviceKey === "window" && body.pricingMode === "window_formula") {
    const pkg = calculateWindowQuote(unitDetails[0], eligibility.serviceZip);
    return { eligibility, serviceKey, unitDetails, pkg };
  }
  if (!["standard", "recurring", "deep", "move", "post"].includes(serviceKey) || body.pricingMode !== `${serviceKey}_formula`) {
    const error = new Error("This saved quote request is not supported.");
    error.statusCode = 400;
    throw error;
  }
  const pkg = calculateResidentialQuoteBundle(unitDetails, serviceKey, eligibility, Boolean(body.packageSnapshot && body.packageSnapshot.protectedPetFeeCents === undefined));
  const recommendation = recommendResidentialService(eligibility);
  if (recommendation.type !== "instant" || recommendation.serviceKey !== serviceKey) {
    const error = new Error(recommendation.reason || "This cleaning request requires a custom quote.");
    error.statusCode = 409;
    throw error;
  }
  assertResidentialDayFits(pkg, eligibility.serviceZip, true);
  return { eligibility, serviceKey, unitDetails, pkg };
}

function applySavedQuotePromotion(pkg, body, customer, bookings = []) {
  if (!pkg || pkg.manualDiscount || body?.crmQuote?.manualDiscount) return pkg;
  const recurring = pkg.serviceKey === "recurring";
  if (recurring && !["FALL10", "RETURNING5"].includes(pkg.promoDiscount?.code)) return pkg;
  if (!recurring && !body?.quoteId && body?.promoCode === "") return pkg;
  const { customerPromotion, applyPromotion } = require("./_promo");
  const eligible = recurring ? null : customerPromotion(bookings, customer);
  const previous = pkg.promoDiscount;
  if (previous) {
    if (previous.code === eligible?.code) return pkg;
    if (eligible && previous.percent === eligible.percent) {
      // Update the offer on a saved quote without repricing its purchased work.
      return {
        ...pkg,
        promoCode: eligible.code,
        promoDiscount: { ...previous, code: eligible.code, label: eligible.label, expiresAt: eligible.expiresAt, expiresLabel: eligible.expiresLabel }
      };
    }
    // Restore the quote before any expired or inapplicable customer offer.
    const subtotalCents = pkg.originalSubtotalCents ?? pkg.subtotalCents;
    const totalCents = pkg.originalTotalCents ?? previous.originalTotalCents;
    const taxCents = pkg.originalTaxCents ?? totalCents - subtotalCents;
    pkg = {
      ...pkg, promoCode: "", promoDiscount: null, subtotalCents, subtotal: subtotalCents / 100,
      discountedSubtotalCents: subtotalCents, discountedSubtotal: subtotalCents / 100,
      taxCents, tax: taxCents / 100, priceCents: totalCents, price: totalCents / 100, totalCents, total: totalCents / 100
    };
  }
  if (body?.packageSnapshot && !previous && eligible?.code !== "RETURNING5") return pkg;
  return eligible ? applyPromotion(pkg, eligible) : pkg;
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

// Compare submitted details independently of object key order and form whitespace.
function recurringQuoteDetails(input) {
  if (input.eligibility?.requestedService !== "recurring") return {};
  return {
    recurringOrderNumber: cleanText(input.recurringOrderNumber, 100).toUpperCase(),
    recurringPlan: ["weekly", "biweekly", "monthly"].includes(input.recurringPlan) ? input.recurringPlan : ""
  };
}

function quoteDetailsKey(input) {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : typeof value === "string" ? value.trim() : value;
  return JSON.stringify(canonical({ eligibility: input.eligibility, unitDetails: input.unitDetails,
    pricingMode: input.pricingMode, customer: cleanCustomer(input.customer), ...recurringQuoteDetails(input) }));
}

function deliveryKey(request, customer, consent = {}, quote = {}) {
  const ip = cleanText(request.headers["x-forwarded-for"] || request.socket?.remoteAddress, 120).split(",")[0];
  return crypto.createHash("sha256").update([
    ip,
    JSON.stringify(customer),
    JSON.stringify(quote),
    consent.transactionalSms?.granted ? "transactional-sms" : "email-only",
    consent.marketingSms?.granted ? "sms-marketing" : "no-sms-marketing",
    "email-marketing-eligible",
    "automatic-fall10-v2"
  ].join("|")).digest("hex");
}

function consentEvidence(request, body, capturedAt = new Date()) {
  const timestamp = capturedAt.toISOString();
  const ip = cleanText(request.headers["x-forwarded-for"] || request.socket?.remoteAddress, 120).split(",")[0];
  const evidenceHash = crypto.createHmac("sha256", tokenKey()).update(ip || "unknown").digest("hex");
  const evidence = (granted, disclosure) => ({
    granted: granted === true,
    capturedAt: timestamp,
    disclosure,
    disclosureVersion: CONSENT_VERSION,
    source: "instant-quote-contact-form"
  });
  return {
    version: CONSENT_VERSION,
    capturedAt: timestamp,
    sourceUrl: `${getSiteUrl(request)}/book-now.html`,
    evidenceHash,
    userAgent: cleanText(request.headers["user-agent"], 300),
    transactionalSms: evidence(body.smsConsent, TRANSACTIONAL_SMS_DISCLOSURE),
    transactionalEmail: evidence(body.smsConsent, TRANSACTIONAL_EMAIL_DISCLOSURE),
    marketingSms: evidence(body.smsMarketingConsent, MARKETING_SMS_DISCLOSURE),
    marketingEmail: {
      eligible: body.smsMarketingConsent === true,
      basis: body.smsMarketingConsent === true ? "express-opt-in" : "not-requested",
      capturedAt: timestamp,
      notice: MARKETING_EMAIL_NOTICE,
      noticeVersion: CONSENT_VERSION,
      source: "instant-quote-contact-form"
    }
  };
}

function recentDelivery(key) {
  const now = Date.now();
  for (const [storedKey, delivery] of recentDeliveries) {
    if (now - delivery.time > 10 * 60 * 1000) recentDeliveries.delete(storedKey);
  }
  return recentDeliveries.get(key) || null;
}

module.exports = async function handler(request, response) {
  let savedCustomer;
  try {
    if (request.method === "GET") {
      response.setHeader("Cache-Control", "private, no-store");
      const link = decodeSavedQuote(request.query?.token);
      const payload = await loadQuoteRecord(link.quoteId);
      const bookings = await listAllBookings({ complete: true });
      await assertQuoteUnused(link.quoteId, bookings);
      try { await markQuoteOpened(link.quoteId); } catch { /* Opening the quote must not fail if analytics recording is unavailable. */ }
      if (payload.crmQuote?.fields) {
        const code = payload.crmQuote.approvalCode;
        if (!code || !require("../crm/_quote-admin").ready(payload.crmQuote.fields)) return json(response, 409, { error: "Our team is finalizing your updated quote. Please contact IMAN Cleaning Service." });
        return json(response, 200, { redirectUrl: `/q/${encodeURIComponent(code)}` });
      }
      if (payload.eligibility?.requestedService === "hourly" && Number(payload.unitDetails?.[0]?.hours) > 23) {
        return json(response, 200, {
          eligibility: payload.eligibility,
          unitDetails: payload.unitDetails,
          customer: payload.customer,
          package: null,
          requiresHourlyUpdate: true,
          quoteRevision: payload.crmQuote?.revision || "",
          expiresAt: payload.expiresAt
        });
      }
      savedCustomer = payload.customer;
      if (payload.packageSnapshot) assertResidentialDayFits(payload.packageSnapshot, payload.eligibility?.serviceZip, true);
      const pkg = applySavedQuotePromotion(payload.packageSnapshot || validateAndPrice(payload).pkg, payload, payload.customer, bookings);
      return json(response, 200, {
        eligibility: payload.eligibility,
        unitDetails: payload.unitDetails,
        customer: payload.customer,
        ...recurringQuoteDetails(payload),
        package: packageForClient(require('./_discount').applyPackageDiscount(pkg, payload.crmQuote?.manualDiscount)),
        quoteRevision: payload.crmQuote?.revision || '',
        expiresAt: payload.expiresAt
      });
    }
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const body = await readJsonBody(request);
    if (cleanText(body.website, 100)) return json(response, 200, { saved: true });
    if (body.smsConsent !== true) {
      return json(response, 400, { error: "Please agree to receive your quote and appointment-related communications by email and text." });
    }
    const customer = cleanCustomer(body.customer);
    const { eligibility, unitDetails, pkg: calculatedPackage } = validateAndPrice(body);
    const recurringDetails = recurringQuoteDetails(body);
    const bookings = await listAllBookings({ complete: true });
    if (body.previousQuoteToken) {
      const previous = decodeSavedQuote(body.previousQuoteToken);
      const record = await loadQuoteRecord(previous.quoteId);
      await assertQuoteUnused(previous.quoteId, bookings);
      if (!record.crmQuote?.fields && quoteDetailsKey(record) === quoteDetailsKey({ eligibility, unitDetails, pricingMode: calculatedPackage.pricingMode, customer, ...recurringDetails })) {
        return json(response, 200, { saved: true, unchanged: true,
          quoteUrl: `${getSiteUrl(request)}/book-now.html?quote=${encodeURIComponent(body.previousQuoteToken)}`,
          quoteRevision: record.crmQuote?.revision || '',
          package: record.packageSnapshot ? packageForClient(require('./_discount').applyPackageDiscount(
            applySavedQuotePromotion(record.packageSnapshot, record, customer, bookings), record.crmQuote?.manualDiscount)) : undefined,
          delivery: { email: "not_resent", sms: "not_resent" } });
      }
    }
    const pkg = applySavedQuotePromotion(calculatedPackage, body, customer, bookings);
    const now = Date.now();
    const communicationConsent = consentEvidence(request, body, new Date(now));
    const key = deliveryKey(request, customer, communicationConsent, { previousQuoteToken: body.previousQuoteToken || "", eligibility, unitDetails, pricingMode: pkg.pricingMode, package: packageForClient(pkg), ...recurringDetails });
    if (pendingDeliveries.has(key)) {
      const result = await pendingDeliveries.get(key);
      return json(response, 200, result);
    }
    const recent = recentDelivery(key);
    if (recent && recent.delivery.email === "sent" && recent.delivery.sms === "sent") {
      return json(response, 200, { saved: true, quoteUrl: recent.quoteUrl, delivery: { email: "already_sent", sms: "already_sent" } });
    }
    const deliver = async () => {
      const quoteId = recent?.quoteId || `SAVED-${now.toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const expiresAt = recent?.expiresAt || now + QUOTE_LINK_LIFETIME_MS;
      const token = encodeSavedQuote({
        version: TOKEN_VERSION,
        quoteId,
        expiresAt
      });
      if (!recent) await saveQuoteRecord({
        version: TOKEN_VERSION,
        quoteId,
        eligibility,
        unitDetails,
        pricingMode: pkg.pricingMode,
        ...recurringDetails,
        customer,
        promoCode: pkg.promoCode || "",
        packageSnapshot: packageForClient(pkg),
        communicationConsent,
        createdAt: now,
        ...(process.env.QUOTE_REMINDERS_ENABLED === "true" ? { quoteReminderEligibleAt: now } : {}),
        expiresAt
      });
      const quoteUrl = recent?.quoteUrl || `${getSiteUrl(request)}/book-now.html?quote=${encodeURIComponent(token)}`;

      const emailPromise = recent?.delivery.email === "sent" ? Promise.resolve() : sendEmail({ customer, pkg, quoteUrl });
      const smsPromise = communicationConsent.transactionalSms.granted
        ? (recent?.delivery.sms === "sent" ? Promise.resolve() : sendSms({ customer, pkg, quoteUrl }))
        : Promise.resolve(null);
      const [emailResult, smsResult] = await Promise.allSettled([emailPromise, smsPromise]);
      const result = {
        saved: true,
        quoteUrl,
        delivery: {
          email: emailResult.status === "fulfilled" ? "sent" : "failed",
          sms: !communicationConsent.transactionalSms.granted
            ? "not_requested"
            : smsResult.status === "fulfilled" ? "sent" : "failed"
        }
      };
      recentDeliveries.set(key, { time: now, quoteId, expiresAt, quoteUrl, delivery: result.delivery });
      return result;
    };
    const pending = deliver();
    pendingDeliveries.set(key, pending);
    try { return json(response, 201, await pending); }
    finally { pendingDeliveries.delete(key); }
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Your saved quote link could not be created.",
      code: error.code || "", reviewRequired: error.reviewRequired, reviewUrl: error.reviewUrl,
      customer: error.code === "RESIDENTIAL_DAY_LIMIT" ? savedCustomer : undefined
    });
  }
};

module.exports.decodeSavedQuote = decodeSavedQuote;
module.exports.encodeSavedQuote = encodeSavedQuote;
module.exports.normalizePhoneNumber = normalizePhoneNumber;
module.exports.consentEvidence = consentEvidence;
module.exports.cleanCustomer = cleanCustomer;
module.exports.validateAndPrice = validateAndPrice;
module.exports.applySavedQuotePromotion = applySavedQuotePromotion;
module.exports.bookingDisablesQuote = bookingDisablesQuote;
module.exports.assertQuoteUnused = assertQuoteUnused;
