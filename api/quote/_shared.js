const crypto = require("crypto");
const { google } = require("googleapis");

const MAX_JSON_BODY = 1024 * 1024;

function json(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function readJsonBody(request, maxBytes = MAX_JSON_BODY) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(Object.assign(new Error("Invalid JSON body."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function requireGoogleConfig() {
  const config = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    parentFolderId: process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID,
    emailFrom: process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com",
    emailTo: process.env.QUOTE_EMAIL_TO || "Info@imancleaningservice.com"
  };

  const missing = Object.entries({
    GOOGLE_CLIENT_ID: config.clientId,
    GOOGLE_CLIENT_SECRET: config.clientSecret,
    GOOGLE_REFRESH_TOKEN: config.refreshToken,
    GOOGLE_DRIVE_PARENT_FOLDER_ID: config.parentFolderId
  }).filter(([, value]) => !value).map(([key]) => key);

  if (missing.length) {
    const error = new Error(`Google quote workflow is not configured. Missing: ${missing.join(", ")}.`);
    error.statusCode = 503;
    error.setup = "Add Google OAuth and Drive folder environment variables in Vercel.";
    throw error;
  }

  return config;
}

function getGoogleClients() {
  const config = requireGoogleConfig();
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
  auth.setCredentials({ refresh_token: config.refreshToken });

  return {
    auth,
    config,
    drive: google.drive({ version: "v3", auth }),
    gmail: google.gmail({ version: "v1", auth })
  };
}

function cleanText(value, fallback = "") {
  return String(value || fallback).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
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

function makeQuoteId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
  return `QUOTE-${stamp}`;
}

function makeFolderName(quoteId, formFields = {}) {
  const firstName = cleanText(formFields["First Name"]);
  const lastName = cleanText(formFields["Last Name"]);
  const customerName = cleanText(`${firstName} ${lastName}`, "Customer");
  return `${quoteId} - ${customerName}`;
}

function driveWebViewLink(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

function driveFolderLink(folderId) {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function base64UrlJson(value) {
  return base64Url(JSON.stringify(value));
}

function decodeBase64Url(value) {
  const input = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(input.padEnd(input.length + ((4 - input.length % 4) % 4), "="), "base64").toString("utf8");
}

function getQuoteApprovalSecret() {
  return process.env.QUOTE_APPROVAL_SECRET
    || process.env.ADMIN_TOKEN
    || process.env.Admin_Token
    || process.env.admin_token
    || process.env.STRIPE_SECRET_KEY
    || "";
}

function signQuotePayload(payload) {
  const secret = getQuoteApprovalSecret();
  if (!secret) {
    const error = new Error("Quote approval links are not configured. Add ADMIN_TOKEN or QUOTE_APPROVAL_SECRET in Vercel.");
    error.statusCode = 503;
    throw error;
  }
  const encodedPayload = base64UrlJson(payload);
  const signature = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifyQuoteToken(token) {
  const secret = getQuoteApprovalSecret();
  if (!secret) {
    const error = new Error("Quote approval links are not configured.");
    error.statusCode = 503;
    throw error;
  }

  const [encodedPayload, signature] = String(token || "").split(".");
  if (!encodedPayload || !signature) {
    const error = new Error("Invalid quote approval link.");
    error.statusCode = 400;
    throw error;
  }

  const expected = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    const error = new Error("Invalid quote approval link.");
    error.statusCode = 400;
    throw error;
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload));
  if (payload.expiresAt && Date.now() > Number(payload.expiresAt)) {
    const error = new Error("This quote approval link has expired.");
    error.statusCode = 410;
    throw error;
  }
  return payload;
}

function attachmentFromDataUrl(item) {
  const match = String(item?.dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  const content = match[2].replace(/\s/g, "");
  const buffer = Buffer.from(content, "base64");
  if (!buffer.length) return null;

  return {
    filename: cleanText(item.filename, "quote-photo.jpg"),
    mimeType: match[1],
    content,
    size: buffer.length
  };
}

function buildQuoteEmail({ quoteId, formFields, folderLink, photos, attachments, attachmentBatchLabel = "", attachmentFailureCount = 0 }) {
  const boundary = `iman_quote_${Date.now().toString(36)}`;
  const safeQuoteId = cleanText(quoteId, makeQuoteId());
  const firstName = cleanText(formFields["First Name"]);
  const lastName = cleanText(formFields["Last Name"]);
  const customerName = cleanText(`${firstName} ${lastName}`, "Customer");
  const customerEmail = cleanText(formFields.Email || formFields.email);
  const subject = `New cleaning quote request from www.imancleaningservice.com - ${safeQuoteId}${attachmentBatchLabel ? ` - ${attachmentBatchLabel}` : ""}`;
  const attachmentStatus = `${attachmentBatchLabel ? `${attachmentBatchLabel}: ` : ""}${(attachments || []).length} photo attachment${(attachments || []).length === 1 ? "" : "s"}${attachmentFailureCount ? `; ${attachmentFailureCount} photo${attachmentFailureCount === 1 ? "" : "s"} could not be attached and remain available in Google Drive` : ""}`;

  const fieldRows = Object.entries(formFields || {})
    .filter(([key, value]) => key && value !== "" && value !== null && typeof value !== "undefined")
    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(Array.isArray(value) ? value.join(", ") : value)}</td></tr>`)
    .join("");

  const photoItems = (photos || []).map((photo, index) => {
    const label = photo.originalName || photo.name || `Photo ${index + 1}`;
    return `<li><a href="${escapeHtml(photo.webViewLink || photo.link)}">${escapeHtml(`${index + 1}. ${label}`)}</a></li>`;
  }).join("");

  const html = [
    "<!doctype html><html><body>",
    `<h2>New cleaning quote request: ${escapeHtml(safeQuoteId)}</h2>`,
    `<p><strong>Customer:</strong> ${escapeHtml(customerName)}</p>`,
    `<p><strong>Google Drive folder:</strong> <a href="${escapeHtml(folderLink)}">${escapeHtml(folderLink)}</a></p>`,
    `<p><strong>Total uploaded photos:</strong> ${(photos || []).length}</p>`,
    `<p><strong>Email attachments:</strong> ${escapeHtml(attachmentStatus)}</p>`,
    "<h3>Quote details</h3>",
    `<table cellpadding="8" cellspacing="0" border="1">${fieldRows}</table>`,
    "<h3>Photo links</h3>",
    photoItems ? `<ol>${photoItems}</ol>` : "<p>No photos were uploaded.</p>",
    "</body></html>"
  ].join("");

  const text = [
    `New cleaning quote request: ${safeQuoteId}`,
    `Customer: ${customerName}`,
    `Google Drive folder: ${folderLink}`,
    `Total uploaded photos: ${(photos || []).length}`,
    `Email attachments: ${attachmentStatus}`,
    "",
    "Quote details:",
    ...Object.entries(formFields || {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`),
    "",
    "Photo links:",
    ...(photos || []).map((photo, index) => `${index + 1}. ${photo.originalName || photo.name || "Photo"}: ${photo.webViewLink || photo.link}`)
  ].join("\n");

  const headers = [
    `From: ${encodeMimeWord("IMAN Cleaning Service LLC")} <${process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com"}>`,
    `To: ${process.env.QUOTE_EMAIL_TO || "Info@imancleaningservice.com"}`,
    customerEmail ? `Reply-To: ${customerEmail}` : "",
    `Subject: ${encodeMimeWord(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`
  ].filter(Boolean);

  const parts = [
    `--${boundary}`,
    "Content-Type: multipart/alternative; boundary=\"quote_alt\"",
    "",
    "--quote_alt",
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    "--quote_alt",
    "Content-Type: text/html; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    "--quote_alt--"
  ];

  for (const attachment of attachments || []) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      attachment.content.replace(/(.{76})/g, "$1\n")
    );
  }

  parts.push(`--${boundary}--`, "");

  return {
    raw: base64Url(`${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`),
    subject
  };
}

module.exports = {
  attachmentFromDataUrl,
  buildQuoteEmail,
  centsToDollars,
  cleanText,
  depositCents,
  driveFolderLink,
  driveWebViewLink,
  getGoogleClients,
  json,
  makeFolderName,
  makeQuoteId,
  readJsonBody,
  remainingCents,
  signQuotePayload,
  verifyQuoteToken
};
