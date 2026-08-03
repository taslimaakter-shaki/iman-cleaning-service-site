const crypto = require("crypto");

const MAX_JSON_BODY = 64 * 1024;
const CHAT_MESSAGE_LIMIT = 1600;
const DEFAULT_OWNER_SMS_TO = "+19298034053";

function json(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function twiml(response, message = "") {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/xml");
  const body = message
    ? `<Response><Message>${escapeXml(message)}</Message></Response>`
    : "<Response></Response>";
  response.end(body);
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cleanText(value, maxLength = 1000) {
  return String(value || "")
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength);
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
  const body = await readRawBody(request);
  try {
    return body ? JSON.parse(body) : {};
  } catch (error) {
    throw Object.assign(new Error("Invalid JSON body."), { statusCode: 400 });
  }
}

async function readFormBody(request) {
  const body = await readRawBody(request);
  return Object.fromEntries(new URLSearchParams(body));
}

function getSiteUrl(request) {
  const configuredUrl = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

function normalizePhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function getOwnerPhoneNumbers() {
  const raw = process.env.OWNER_SMS_TO
    || process.env.ADMIN_SMS_TO
    || process.env.AGENT_NOTIFY_TO
    || process.env.LIVE_AGENT_PHONE
    || process.env.TRANSFER_PHONE_NUMBER
    || DEFAULT_OWNER_SMS_TO;
  return raw
    .split(/[;,]+/)
    .map(normalizePhoneNumber)
    .filter(Boolean);
}

function getSmsConfig() {
  return {
    accountSid: cleanText(process.env.TWILIO_ACCOUNT_SID),
    authToken: cleanText(process.env.TWILIO_AUTH_TOKEN),
    from: cleanText(process.env.TWILIO_FROM_NUMBER),
    ownerNumbers: getOwnerPhoneNumbers()
  };
}

function requireSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    const error = new Error("Supabase live chat storage is not configured.");
    error.statusCode = 503;
    error.setup = "Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then run the live chat SQL in supabase-schema.sql.";
    throw error;
  }

  return {
    endpoint: `${url.replace(/\/$/, "")}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    }
  };
}

async function supabaseRequest(resource, query = "", options = {}) {
  const config = requireSupabaseConfig();
  const response = await fetch(`${config.endpoint}/${resource}${query}`, {
    ...options,
    headers: {
      ...config.headers,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.message || "Live chat database request failed.");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function makeSessionId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(5).toString("hex").toUpperCase();
  return `CHAT-${stamp}-${random}`;
}

function makeShortCode() {
  return `C${crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 5)}`;
}

async function getSession(sessionId) {
  const id = cleanText(sessionId, 80);
  if (!id) return null;
  const records = await supabaseRequest(
    "live_chat_sessions",
    `?select=*&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  return records[0] || null;
}

async function getSessionByShortCode(shortCode) {
  const code = cleanText(shortCode, 16).toUpperCase();
  if (!code) return null;
  const records = await supabaseRequest(
    "live_chat_sessions",
    `?select=*&short_code=eq.${encodeURIComponent(code)}&limit=1`
  );
  return records[0] || null;
}

async function getLatestActiveSession() {
  const records = await supabaseRequest(
    "live_chat_sessions",
    "?select=*&status=eq.active&order=updated_at.desc&limit=1"
  );
  return records[0] || null;
}

async function shortCodeExists(shortCode) {
  const records = await supabaseRequest(
    "live_chat_sessions",
    `?select=id&short_code=eq.${encodeURIComponent(shortCode)}&limit=1`
  );
  return Boolean(records[0]);
}

async function makeUniqueShortCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeShortCode();
    if (!(await shortCodeExists(code))) return code;
  }
  return `C${Date.now().toString(16).toUpperCase().slice(-5)}`;
}

async function createSession({ visitorName = "", visitorContact = "", pageUrl = "", referrer = "" } = {}) {
  const now = new Date().toISOString();
  const payload = {
    id: makeSessionId(),
    short_code: await makeUniqueShortCode(),
    status: "active",
    visitor_name: cleanText(visitorName, 120),
    visitor_contact: cleanText(visitorContact, 180),
    page_url: cleanText(pageUrl, 500),
    referrer: cleanText(referrer, 500),
    created_at: now,
    updated_at: now
  };

  const records = await supabaseRequest("live_chat_sessions", "", {
    method: "POST",
    headers: {
      Prefer: "return=representation"
    },
    body: JSON.stringify(payload)
  });

  return records[0];
}

async function updateSession(sessionId, updates) {
  const payload = {
    ...updates,
    updated_at: new Date().toISOString()
  };

  const records = await supabaseRequest(
    "live_chat_sessions",
    `?id=eq.${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload)
    }
  );

  return records[0] || null;
}

async function saveMessage({ sessionId, sender, body, clientMessageId = "", twilioMessageSid = "" }) {
  const cleanBody = cleanText(body, CHAT_MESSAGE_LIMIT);
  if (!cleanBody) {
    const error = new Error("Message is required.");
    error.statusCode = 400;
    throw error;
  }

  const payload = {
    session_id: sessionId,
    sender,
    body: cleanBody,
    client_message_id: cleanText(clientMessageId, 120),
    twilio_message_sid: cleanText(twilioMessageSid, 80)
  };

  const records = await supabaseRequest("live_chat_messages", "", {
    method: "POST",
    headers: {
      Prefer: "return=representation"
    },
    body: JSON.stringify(payload)
  });

  return records[0];
}

async function findClientMessage(sessionId, clientMessageId) {
  const id = cleanText(clientMessageId, 120);
  if (!id) return null;
  const records = await supabaseRequest(
    "live_chat_messages",
    `?select=*&session_id=eq.${encodeURIComponent(sessionId)}&client_message_id=eq.${encodeURIComponent(id)}&limit=1`
  );
  return records[0] || null;
}

async function listMessages(sessionId) {
  return supabaseRequest(
    "live_chat_messages",
    `?select=id,created_at,sender,body,client_message_id&session_id=eq.${encodeURIComponent(sessionId)}&order=created_at.asc&limit=120`
  );
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
    const error = new Error(data?.message || "SMS notification could not be sent.");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function messagePreview(body, maxLength = 700) {
  const value = cleanText(body, maxLength + 20);
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function buildOwnerSms({ session, message, siteUrl }) {
  const visitor = session.visitor_name || session.visitor_contact || "Website visitor";
  const source = session.page_url || siteUrl;
  return [
    `IMAN Cleaning Service LLC: New website chat ${session.short_code}`,
    `Visitor: ${visitor}`,
    session.visitor_contact ? `Contact: ${session.visitor_contact}` : "",
    source ? `Page: ${source}` : "",
    "",
    messagePreview(message.body),
    "",
    `Reply: ${session.short_code} your message`,
    `Close: ${session.short_code} close`,
    "Reply STOP to opt out or HELP for help."
  ].filter((line) => line !== "").join("\n");
}

async function sendOwnerSmsNotifications({ session, message, siteUrl }) {
  const config = getSmsConfig();
  if (!config.accountSid || !config.authToken || !config.from || !config.ownerNumbers.length) {
    return {
      status: "not_configured",
      sent: [],
      error: "Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in Vercel. Add OWNER_SMS_TO if the alerts should go somewhere other than 929-803-4053."
    };
  }

  const body = buildOwnerSms({ session, message, siteUrl });
  const sent = [];
  for (const to of config.ownerNumbers) {
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

module.exports = {
  cleanText,
  createSession,
  findClientMessage,
  getLatestActiveSession,
  getOwnerPhoneNumbers,
  getSession,
  getSessionByShortCode,
  getSiteUrl,
  json,
  listMessages,
  normalizePhoneNumber,
  readFormBody,
  readJsonBody,
  saveMessage,
  sendOwnerSmsNotifications,
  twiml,
  updateSession
};
