const crypto = require("crypto");
const { getGoogleClients, json, readJsonBody } = require("../quote/_shared");

const TIME_ZONE = "America/New_York";
const concernPolicy = require("../../service-concern-policy");
const { MAX_FILE_BYTES, MAX_FILES } = concernPolicy;
const ALLOWED_TYPES = new Set(concernPolicy.ALLOWED_TYPES);

function clean(value, max = 1000) {
  return String(value || "").replace(/\0/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

function localDateStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function makeCaseNumber(now = new Date(), randomInt = crypto.randomInt) {
  return `ICS-SC-${localDateStamp(now)}-${randomInt(1000, 10000)}`;
}

function tokenSecret() {
  return process.env.SERVICE_CONCERN_SECRET
    || process.env.QUOTE_APPROVAL_SECRET
    || process.env.ADMIN_TOKEN
    || process.env.STRIPE_SECRET_KEY
    || "";
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signCase(payload) {
  const secret = tokenSecret();
  if (!secret) throw Object.assign(new Error("Service concern submissions are not configured."), { statusCode: 503 });
  const body = encode(payload);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyCase(token) {
  const secret = tokenSecret();
  const [body, signature] = clean(token, 4000).split(".");
  if (!secret || !body || !signature) throw Object.assign(new Error("Invalid service concern session."), { statusCode: 400 });
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw Object.assign(new Error("Invalid service concern session."), { statusCode: 400 });
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (Date.now() > Number(payload.expiresAt || 0)) {
    throw Object.assign(new Error("This service concern session expired. Please submit the form again."), { statusCode: 410 });
  }
  return payload;
}

function safeFileName(value, index = 1) {
  const source = clean(value, 140).replace(/[^\w.()\- ]+/g, "-").replace(/\s+/g, " ");
  return `${String(index).padStart(2, "0")}-${source || "evidence-file"}`;
}

function validateFile({ mimeType, size }) {
  const type = clean(mimeType, 100).toLowerCase();
  const bytes = Number(size || 0);
  if (!ALLOWED_TYPES.has(type)) throw Object.assign(new Error("Upload a JPG, PNG, HEIC, HEIF, WebP, MP4, MOV, WebM, or PDF file."), { statusCode: 400 });
  if (!Number.isFinite(bytes) || bytes < 1 || bytes > MAX_FILE_BYTES) {
    throw Object.assign(new Error("Each file must be 20 MB or smaller."), { statusCode: 413 });
  }
  return { mimeType: type, size: bytes };
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function emailMessage({ to, replyTo = "", subject, text, html }) {
  const from = process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com";
  const boundary = `service_concern_${Date.now().toString(36)}`;
  const headers = [
    `From: =?UTF-8?B?${Buffer.from("IMAN Cleaning Service LLC").toString("base64")}?= <${from}>`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : "",
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ].filter(Boolean);
  const raw = [
    headers.join("\r\n"),
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
  return { raw: base64Url(raw) };
}

module.exports = {
  ALLOWED_TYPES,
  MAX_FILE_BYTES,
  MAX_FILES,
  base64Url,
  clean,
  emailMessage,
  escapeHtml,
  getGoogleClients,
  json,
  makeCaseNumber,
  readJsonBody,
  safeFileName,
  signCase,
  validateFile,
  verifyCase
};
