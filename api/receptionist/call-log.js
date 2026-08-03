const crypto = require("crypto");
const { cleanText, readJsonBody } = require("../quote/_shared");
const { normalizePhoneNumber } = require("../quote/_send-link");
const {
  buildAudioRow,
  buildFailureRow,
  buildManualCallRow,
  buildTranscriptionRow,
  json,
  safeUpsertCallLog,
  upsertCallLog,
  verifyElevenLabsWebhook
} = require("./_shared");

const DEFAULT_AGENT_PHONE = "+19298034053";
const MAX_SMS_BODY_LENGTH = 1200;

function isNotifyAgentRequest(request) {
  if (request.query?.action === "notify-agent") return true;
  try {
    const url = new URL(request.url || "", "https://www.imancleaningservice.com");
    return url.searchParams.get("action") === "notify-agent";
  } catch {
    return false;
  }
}

function requestAction(request) {
  if (request.query?.action) return cleanText(request.query.action);
  try {
    const url = new URL(request.url || "", "https://www.imancleaningservice.com");
    return cleanText(url.searchParams.get("action"));
  } catch {
    return "";
  }
}

function isManualCallLogRequest(request) {
  return ["log-call", "record-call", "excel-log"].includes(requestAction(request));
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function webhookSecret() {
  return cleanText(process.env.AGENT_NOTIFY_WEBHOOK_SECRET || process.env.QUOTE_LINK_WEBHOOK_SECRET);
}

function requireWebhookAuth(request) {
  const secret = webhookSecret();
  if (!secret) {
    const error = new Error("Agent notification webhook is not configured.");
    error.statusCode = 503;
    error.setup = "Add AGENT_NOTIFY_WEBHOOK_SECRET or QUOTE_LINK_WEBHOOK_SECRET in Vercel and in the ElevenLabs webhook tool header.";
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

function requireSmsConfig() {
  const config = {
    accountSid: cleanText(process.env.TWILIO_ACCOUNT_SID),
    authToken: cleanText(process.env.TWILIO_AUTH_TOKEN),
    from: cleanText(process.env.TWILIO_FROM_NUMBER)
  };
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

function agentPhone() {
  return normalizePhoneNumber(
    process.env.AGENT_NOTIFY_TO
      || process.env.OWNER_SMS_TO
      || process.env.LIVE_AGENT_PHONE
      || process.env.TRANSFER_PHONE_NUMBER
      || DEFAULT_AGENT_PHONE
  );
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

function firstPayloadValue(body, ...keys) {
  for (const container of payloadContainers(body)) {
    for (const key of keys) {
      const value = cleanText(container[key]);
      if (value) return value;
    }
  }

  return "";
}

function line(label, value) {
  const text = cleanText(value);
  return text ? `${label}: ${text}` : "";
}

function buildAgentMessage(body = {}) {
  const callerName = firstPayloadValue(body, "callerName", "customerName", "name", "caller_name", "customer_name");
  const callerPhone = firstPayloadValue(
    body,
    "callerPhone",
    "customerPhone",
    "phone",
    "mobileNumber",
    "caller_phone",
    "customer_phone",
    "mobile_number",
    "user_number",
    "userNumber",
    "from_number",
    "fromNumber",
    "from"
  );
  const reason = firstPayloadValue(body, "reason", "callReason", "intent", "callType", "department", "call_reason", "call_type");
  const service = firstPayloadValue(body, "service", "serviceType", "requestedService", "cleaningType", "service_type", "requested_service", "cleaning_type");
  const appointmentDate = firstPayloadValue(body, "appointmentDate", "scheduledDate", "serviceDate", "appointment_date", "scheduled_date", "service_date");
  const appointmentTime = firstPayloadValue(body, "appointmentTime", "scheduledTime", "serviceTime", "appointment_time", "scheduled_time", "service_time");
  const summary = firstPayloadValue(body, "summary", "notes", "details", "concernSummary", "concern", "callSummary", "concern_summary", "call_summary");
  const transferStatus = firstPayloadValue(body, "transferStatus", "transfer_status", "status", "callStatus", "call_status");

  const lines = [
    "Iman Cleaning AI call:",
    line("Name", callerName),
    line("Phone", callerPhone),
    line("Reason", reason),
    line("Service", service),
    line("Date", appointmentDate),
    line("Time", appointmentTime),
    line("Transfer", transferStatus),
    line("Summary", summary)
  ].filter(Boolean);

  const message = lines.join("\n").trim();
  return message.length > MAX_SMS_BODY_LENGTH
    ? `${message.slice(0, MAX_SMS_BODY_LENGTH - 3)}...`
    : message;
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
    const error = new Error(data?.message || "Agent notification SMS could not be sent.");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function notifyAgent(request) {
  requireWebhookAuth(request);

  const body = await readJsonBody(request);
  const to = normalizePhoneNumber(firstPayloadValue(body, "agentPhone", "agentPhoneNumber", "to", "agent_phone", "agent_phone_number")) || agentPhone();
  if (!to) {
    const error = new Error("A valid agent phone number is required.");
    error.statusCode = 400;
    throw error;
  }

  const message = buildAgentMessage(body);
  if (!message) {
    const error = new Error("A transfer summary is required.");
    error.statusCode = 400;
    throw error;
  }

  const result = await twilioRequest({
    ...requireSmsConfig(),
    to,
    body: message
  });
  const logResult = await safeUpsertCallLog(buildManualCallRow(body, {
    rawEventType: "retell_transfer_notification",
    callStatus: "transfer_notified",
    transferRequested: true,
    source: "retell_notify_agent"
  }));

  return {
    sent: true,
    to,
    messageId: cleanText(result.sid),
    callLogged: logResult.logged,
    callLogError: logResult.error || ""
  };
}

async function recordManualCall(request) {
  requireWebhookAuth(request);

  const body = await readJsonBody(request);
  const logResult = await safeUpsertCallLog(buildManualCallRow(body, {
    rawEventType: "retell_manual_call_record",
    callStatus: firstPayloadValue(body, "callStatus", "call_status", "status") || "recorded",
    source: "retell_call_record"
  }));

  if (!logResult.logged) {
    const error = new Error(logResult.error || "Call log could not be saved.");
    error.statusCode = 503;
    throw error;
  }

  return {
    logged: true,
    conversationId: logResult.record.conversation_id,
    callerPhone: logResult.record.caller_phone,
    customerName: logResult.record.customer_name,
    callType: logResult.record.call_type
  };
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    if (isNotifyAgentRequest(request)) {
      const result = await notifyAgent(request);
      return json(response, 200, result);
    }

    if (isManualCallLogRequest(request)) {
      const result = await recordManualCall(request);
      return json(response, 200, result);
    }

    const event = await verifyElevenLabsWebhook(request);
    let row = null;

    if (event.type === "post_call_transcription") {
      row = buildTranscriptionRow(event);
    } else if (event.type === "post_call_audio") {
      row = await buildAudioRow(event);
    } else if (event.type === "call_initiation_failure") {
      row = buildFailureRow(event);
    } else {
      return json(response, 200, {
        received: true,
        processed: false,
        eventType: event.type || ""
      });
    }

    const record = await upsertCallLog(row);

    return json(response, 200, {
      received: true,
      processed: true,
      eventType: event.type,
      conversationId: record.conversation_id,
      audioReceived: Boolean(record.audio_received)
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Receptionist call log webhook could not be processed.",
      details: error.details,
      setup: error.setup
    });
  }
};
