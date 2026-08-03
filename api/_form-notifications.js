const DEFAULT_OWNER_SMS_TO = "+19298034053";
const MAX_SMS_BODY_LENGTH = 1200;

function cleanText(value, maxLength = 1000) {
  return String(value || "")
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength);
}

function normalizePhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

function getOwnerSmsRecipients() {
  const raw = process.env.FORM_NOTIFICATION_TO
    || process.env.OWNER_SMS_TO
    || process.env.ADMIN_SMS_TO
    || process.env.AGENT_NOTIFY_TO
    || process.env.LIVE_AGENT_PHONE
    || process.env.TRANSFER_PHONE_NUMBER
    || DEFAULT_OWNER_SMS_TO;

  return [...new Set(raw.split(/[;,]+/).map(normalizePhoneNumber).filter(Boolean))];
}

function getSmsConfig() {
  return {
    accountSid: cleanText(process.env.TWILIO_ACCOUNT_SID),
    authToken: cleanText(process.env.TWILIO_AUTH_TOKEN),
    from: cleanText(process.env.TWILIO_FROM_NUMBER),
    recipients: getOwnerSmsRecipients()
  };
}

function formatValue(value) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item, 180)).filter(Boolean).join(", ");
  if (value && typeof value === "object") return cleanText(JSON.stringify(value), 240);
  return cleanText(value, 240);
}

function getFieldValue(fields = {}, names = []) {
  const entries = Object.entries(fields || {});
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) return formatValue(fields[name]);
    const lowerName = name.toLowerCase();
    const match = entries.find(([key]) => key.toLowerCase() === lowerName);
    if (match) return formatValue(match[1]);
  }
  return "";
}

function line(label, value) {
  const text = formatValue(value);
  return text ? `${label}: ${text}` : "";
}

function firstNonEmpty(values) {
  return values.map(formatValue).find(Boolean) || "";
}

function addressFromFields(fields) {
  return firstNonEmpty([
    getFieldValue(fields, ["Address", "Service Address", "Street Address"]),
    [
      getFieldValue(fields, ["Street Address"]),
      getFieldValue(fields, ["City", "City or Borough"]),
      getFieldValue(fields, ["State"]),
      getFieldValue(fields, ["ZIP Code", "Zip Code", "Postal Code"])
    ].filter(Boolean).join(", ")
  ]);
}

function buildFormSubmissionSms({
  source = "Website form",
  fields = {},
  recordId = "",
  pageUrl = "",
  folderLink = "",
  summaryLines = []
} = {}) {
  const name = getFieldValue(fields, [
    "Name",
    "Full Name",
    "Contact Name",
    "Client Name",
    "Customer Name"
  ]) || firstNonEmpty([
    [
      getFieldValue(fields, ["First Name"]),
      getFieldValue(fields, ["Last Name"])
    ].filter(Boolean).join(" ")
  ]);
  const phone = getFieldValue(fields, ["Phone", "Phone Number", "Customer Phone"]);
  const email = getFieldValue(fields, ["Email", "Email Address", "Customer Email"]);
  const service = getFieldValue(fields, [
    "Service",
    "Service Type",
    "Service Category",
    "Position Interested In",
    "Job interested in"
  ]);
  const address = addressFromFields(fields);
  const message = getFieldValue(fields, [
    "Message",
    "Project Details",
    "Experience Availability and Notes",
    "Notes",
    "Condition Notes"
  ]);

  const lines = [
    `IMAN website: ${cleanText(source, 80)} submitted`,
    line("ID", recordId),
    line("Name", name),
    line("Phone", phone),
    line("Email", email),
    line("Service", service),
    line("Address", address),
    line("Message", message),
    ...summaryLines.map((item) => cleanText(item, 240)).filter(Boolean),
    line("Quote folder", folderLink),
    line("Page", pageUrl)
  ].filter(Boolean);

  const body = lines.join("\n");
  return body.length > MAX_SMS_BODY_LENGTH
    ? `${body.slice(0, MAX_SMS_BODY_LENGTH - 3)}...`
    : body;
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
    const error = new Error(data?.message || "Form notification SMS could not be sent.");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function sendFormSubmissionNotification(payload = {}) {
  const config = getSmsConfig();
  const missing = Object.entries({
    TWILIO_ACCOUNT_SID: config.accountSid,
    TWILIO_AUTH_TOKEN: config.authToken,
    TWILIO_FROM_NUMBER: config.from,
    OWNER_SMS_TO: config.recipients.length ? config.recipients.join(",") : ""
  }).filter(([, value]) => !value).map(([key]) => key);

  if (missing.length) {
    return {
      status: "not_configured",
      sent: [],
      error: `SMS notifications are not configured. Missing: ${missing.join(", ")}.`
    };
  }

  const body = buildFormSubmissionSms(payload);
  const sent = [];
  for (const to of config.recipients) {
    const result = await twilioRequest({
      accountSid: config.accountSid,
      authToken: config.authToken,
      from: config.from,
      to,
      body
    });
    sent.push({ to, messageId: cleanText(result.sid, 80) });
  }

  return {
    status: "sent",
    sent,
    error: ""
  };
}

async function trySendFormSubmissionNotification(payload = {}) {
  try {
    return await sendFormSubmissionNotification(payload);
  } catch (error) {
    return {
      status: "error",
      sent: [],
      error: cleanText(error.message || "Form notification SMS could not be sent.", 240),
      details: error.details
    };
  }
}

module.exports = {
  buildFormSubmissionSms,
  cleanText,
  getOwnerSmsRecipients,
  normalizePhoneNumber,
  sendFormSubmissionNotification,
  trySendFormSubmissionNotification
};
