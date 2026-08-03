const crypto = require("crypto");
const { Readable } = require("stream");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const {
  cleanText: cleanOneLine,
  driveWebViewLink,
  getGoogleClients,
  json
} = require("../quote/_shared");

const MAX_WEBHOOK_BODY = 24 * 1024 * 1024;
const MAX_TRANSCRIPT_TEXT = 60 * 1024;
const MAX_SUMMARY_TEXT = 8000;

function cleanText(value, maxLength = 1000) {
  return String(value || "")
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength);
}

function readRawBody(request, maxBytes = MAX_WEBHOOK_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(Object.assign(new Error("Webhook body is too large."), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function requireElevenLabsWebhookSecret() {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET || process.env.ELEVENLABS_POST_CALL_WEBHOOK_SECRET;
  if (!secret) {
    const error = new Error("ElevenLabs webhook secret is not configured.");
    error.statusCode = 503;
    error.setup = "Create an ElevenLabs post-call webhook and add its HMAC secret as ELEVENLABS_WEBHOOK_SECRET in Vercel.";
    throw error;
  }
  return secret;
}

async function verifyElevenLabsWebhook(request) {
  const rawBody = await readRawBody(request);
  const signature = request.headers["elevenlabs-signature"];
  const secret = requireElevenLabsWebhookSecret();
  const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY || "unused" });

  try {
    return await client.webhooks.constructEvent(rawBody.toString("utf8"), signature, secret);
  } catch (error) {
    const authError = new Error("Invalid ElevenLabs webhook signature.");
    authError.statusCode = 401;
    authError.details = error.message;
    throw authError;
  }
}

function requireSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    const error = new Error("Supabase storage is not configured.");
    error.statusCode = 503;
    error.setup = "Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then run the updated supabase-schema.sql.";
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
    const error = new Error(data?.message || "Supabase request failed.");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function assertAdmin(request) {
  const adminToken = process.env.ADMIN_TOKEN;
  const headerToken = request.headers["x-admin-token"];
  const bearer = cleanOneLine(request.headers.authorization).toLowerCase().startsWith("bearer ")
    ? cleanOneLine(request.headers.authorization).slice(7).trim()
    : "";
  const queryToken = request.query?.token;
  return Boolean(adminToken && [headerToken, bearer, queryToken].some((value) => value === adminToken));
}

function isoFromUnixSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function valueFromAnalysis(analysis, names) {
  const collection = analysis?.data_collection_results || {};
  const candidates = Array.isArray(names) ? names : [names];

  for (const name of candidates) {
    const direct = collection[name] ?? analysis?.[name];
    const value = unwrapCollectedValue(direct);
    if (value) return value;
  }

  const normalizedNames = new Set(candidates.map(normalizeKey));
  const queue = [collection];
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== "object") continue;
    for (const [key, value] of Object.entries(item)) {
      if (normalizedNames.has(normalizeKey(key))) {
        const unwrapped = unwrapCollectedValue(value);
        if (unwrapped) return unwrapped;
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return "";
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function unwrapCollectedValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return cleanOneLine(value);
  }
  if (Array.isArray(value)) return cleanOneLine(value.join(", "));
  if (typeof value === "object") {
    for (const key of ["value", "result", "answer", "text", "string_value", "collected_value"]) {
      const unwrapped = unwrapCollectedValue(value[key]);
      if (unwrapped) return unwrapped;
    }
  }
  return "";
}

function transcriptToText(transcript = []) {
  return cleanText((Array.isArray(transcript) ? transcript : []).map((turn) => {
    const role = cleanOneLine(turn.role, "unknown");
    const message = cleanText(turn.message || turn.text || "", 4000);
    if (!message) return "";
    return `${role}: ${message}`;
  }).filter(Boolean).join("\n"), MAX_TRANSCRIPT_TEXT);
}

function transcriptIncludesTool(transcript = [], pattern) {
  return JSON.stringify(transcript || []).toLowerCase().includes(pattern);
}

function inferCallType({ analysis = {}, transcriptText = "" }) {
  const collected = valueFromAnalysis(analysis, ["call_type", "call_reason", "intent"]);
  if (collected) return collected;
  const haystack = `${analysis.transcript_summary || ""}\n${transcriptText}`.toLowerCase();
  if (/quote|estimate|price|pricing/.test(haystack)) return "quote";
  if (/appointment|schedule|reschedule|cancel/.test(haystack)) return "appointment";
  if (/concern|complaint|previous cleaning|issue|problem/.test(haystack)) return "service concern";
  return "other";
}

function getProviderBody(metadata = {}) {
  if (metadata?.phone_call && typeof metadata.phone_call === "object") return metadata.phone_call;
  if (metadata?.telephony && typeof metadata.telephony === "object") return metadata.telephony;
  if (metadata?.body && typeof metadata.body === "object") return metadata.body;
  if (metadata?.provider_data && typeof metadata.provider_data === "object") return metadata.provider_data;
  return metadata;
}

function firstPhone(...values) {
  for (const value of values) {
    const text = cleanOneLine(value);
    if (/^\+?\d[\d\s().-]{6,}$/.test(text)) return text;
  }
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
    push(container.args);
    push(container.arguments);
    push(container.parameters);
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
      const value = cleanOneLine(container[key]);
      if (value) return value;
    }
  }

  return "";
}

function boolFromValue(value) {
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|sent|done)$/i.test(cleanOneLine(value));
}

function fallbackConversationId(body, now, callerPhone) {
  const explicitId = firstPayloadValue(
    body,
    "conversation_id",
    "conversationId",
    "call_id",
    "callId",
    "retell_call_id",
    "retellCallId",
    "call_sid",
    "callSid",
    "CallSid",
    "sid",
    "session_id",
    "sessionId"
  );
  if (explicitId) return explicitId.slice(0, 250);

  const phoneDigits = cleanOneLine(callerPhone).replace(/\D/g, "") || "unknown";
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `manual-${phoneDigits}-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function buildManualCallRow(body = {}, overrides = {}) {
  const now = new Date();
  const callerPhone = firstPhone(
    overrides.callerPhone,
    firstPayloadValue(
      body,
      "callerPhone",
      "customerPhone",
      "phone",
      "mobileNumber",
      "caller_phone",
      "customer_phone",
      "mobile_number",
      "callerNumber",
      "caller_number",
      "callerId",
      "caller_id",
      "user_number",
      "userNumber",
      "from_number",
      "fromNumber",
      "from",
      "From",
      "Caller"
    )
  );
  const callType = cleanOneLine(
    overrides.callType
    || firstPayloadValue(body, "callType", "callReason", "reason", "intent", "department", "call_type", "call_reason"),
    "other"
  );
  const summary = cleanText(
    overrides.summary
    || firstPayloadValue(body, "summary", "notes", "details", "concernSummary", "concern", "callSummary", "concern_summary", "call_summary"),
    MAX_SUMMARY_TEXT
  );

  return {
    raw_event_type: cleanOneLine(overrides.rawEventType, "manual_receptionist_call"),
    event_timestamp: now.toISOString(),
    conversation_id: fallbackConversationId(body, now, callerPhone),
    agent_id: firstPayloadValue(body, "agent_id", "agentId"),
    agent_name: firstPayloadValue(body, "agent_name", "agentName"),
    call_status: cleanOneLine(overrides.callStatus || firstPayloadValue(body, "callStatus", "call_status", "status"), "in_progress"),
    call_started_at: now.toISOString(),
    caller_phone: callerPhone,
    recipient_phone: firstPhone(
      firstPayloadValue(body, "recipientPhone", "to_number", "toNumber", "to", "To", "Called")
    ),
    call_direction: cleanOneLine(firstPayloadValue(body, "direction", "callDirection", "call_direction"), "inbound"),
    customer_name: cleanOneLine(
      overrides.customerName
      || firstPayloadValue(body, "callerName", "customerName", "name", "fullName", "caller_name", "customer_name", "full_name")
    ),
    customer_email: firstPayloadValue(body, "customerEmail", "email", "customer_email"),
    call_type: callType,
    service_type: firstPayloadValue(body, "serviceType", "service", "service_type", "residential_or_commercial"),
    requested_service: firstPayloadValue(body, "requestedService", "cleaningType", "requested_service", "cleaning_type"),
    service_address: firstPayloadValue(body, "serviceAddress", "address", "location", "service_address"),
    preferred_date: firstPayloadValue(body, "preferredDate", "requestedDate", "preferred_date", "requested_date"),
    preferred_time: firstPayloadValue(body, "preferredTime", "requestedTime", "preferred_time", "requested_time"),
    appointment_date: firstPayloadValue(body, "appointmentDate", "scheduledDate", "appointment_date", "scheduled_date"),
    appointment_time: firstPayloadValue(body, "appointmentTime", "scheduledTime", "appointment_time", "scheduled_time"),
    appointment_status: firstPayloadValue(body, "appointmentStatus", "bookingStatus", "appointment_status", "booking_status"),
    quote_form_sent: Boolean(overrides.quoteFormSent) || boolFromValue(firstPayloadValue(body, "quoteFormSent", "quote_form_sent")),
    transfer_requested: Boolean(overrides.transferRequested) || boolFromValue(firstPayloadValue(body, "transferRequested", "transfer_requested")),
    concern_summary: cleanText(firstPayloadValue(body, "concernSummary", "concern", "complaintSummary", "concern_summary", "complaint_summary"), MAX_SUMMARY_TEXT),
    summary,
    dynamic_variables: body.dynamic_variables || body.dynamicVariables || {},
    metadata: {
      source: cleanOneLine(overrides.source, "retell"),
      received_at: now.toISOString(),
      raw_payload: body
    },
    updated_at: now.toISOString()
  };
}

function buildTranscriptionRow(event) {
  const data = event.data || {};
  const metadata = data.metadata || {};
  const analysis = data.analysis || {};
  const dynamicVariables = data.conversation_initiation_client_data?.dynamic_variables || {};
  const providerBody = getProviderBody(metadata);
  const transcriptText = transcriptToText(data.transcript);
  const callType = inferCallType({ analysis, transcriptText });

  return {
    raw_event_type: cleanOneLine(event.type),
    event_timestamp: isoFromUnixSeconds(event.event_timestamp),
    conversation_id: cleanOneLine(data.conversation_id),
    agent_id: cleanOneLine(data.agent_id),
    agent_name: cleanOneLine(data.agent_name),
    call_status: cleanOneLine(data.status),
    call_successful: cleanOneLine(analysis.call_successful),
    call_started_at: isoFromUnixSeconds(metadata.start_time_unix_secs),
    call_duration_seconds: Math.max(0, Number(metadata.call_duration_secs || providerBody.CallDuration || providerBody.Duration) || 0),
    caller_phone: firstPhone(
      dynamicVariables.customer_phone,
      dynamicVariables.phone,
      dynamicVariables.caller_phone,
      dynamicVariables.caller_id,
      providerBody.From,
      providerBody.Caller,
      providerBody.from_number
    ),
    recipient_phone: firstPhone(providerBody.To, providerBody.Called, providerBody.to_number),
    call_direction: cleanOneLine(providerBody.Direction || metadata.direction),
    customer_name: valueFromAnalysis(analysis, ["customer_name", "name", "full_name"]) || cleanOneLine(dynamicVariables.customer_name || dynamicVariables.user_name),
    customer_email: valueFromAnalysis(analysis, ["customer_email", "email"]) || cleanOneLine(dynamicVariables.customer_email || dynamicVariables.email),
    call_type: callType,
    service_type: valueFromAnalysis(analysis, ["service_type", "residential_or_commercial"]),
    requested_service: valueFromAnalysis(analysis, ["requested_service", "cleaning_type", "service"]),
    service_address: valueFromAnalysis(analysis, ["service_address", "address", "location"]),
    preferred_date: valueFromAnalysis(analysis, ["preferred_date", "requested_date"]),
    preferred_time: valueFromAnalysis(analysis, ["preferred_time", "requested_time"]),
    appointment_date: valueFromAnalysis(analysis, ["appointment_date", "scheduled_date"]),
    appointment_time: valueFromAnalysis(analysis, ["appointment_time", "scheduled_time"]),
    appointment_status: valueFromAnalysis(analysis, ["appointment_status", "booking_status"]),
    quote_form_sent: transcriptIncludesTool(data.transcript, "send_quote_link"),
    transfer_requested: transcriptIncludesTool(data.transcript, "transfer_to_number") || transcriptIncludesTool(data.transcript, "transfer"),
    concern_summary: valueFromAnalysis(analysis, ["concern_summary", "service_concern", "complaint_summary"]),
    summary: cleanText(analysis.transcript_summary, MAX_SUMMARY_TEXT),
    transcript_text: transcriptText,
    transcript_json: Array.isArray(data.transcript) ? data.transcript : [],
    analysis_json: analysis,
    dynamic_variables: dynamicVariables,
    metadata,
    has_audio: Boolean(data.has_audio),
    updated_at: new Date().toISOString()
  };
}

function buildFailureRow(event) {
  const data = event.data || {};
  const metadata = data.metadata || {};
  const providerBody = getProviderBody(metadata);

  return {
    raw_event_type: cleanOneLine(event.type),
    event_timestamp: isoFromUnixSeconds(event.event_timestamp),
    conversation_id: cleanOneLine(data.conversation_id),
    agent_id: cleanOneLine(data.agent_id),
    call_status: cleanOneLine(data.failure_reason, "call_failed"),
    call_successful: "failure",
    caller_phone: firstPhone(providerBody.From, providerBody.Caller, providerBody.from_number),
    recipient_phone: firstPhone(providerBody.To, providerBody.Called, providerBody.to_number),
    call_direction: cleanOneLine(providerBody.Direction || metadata.direction),
    summary: cleanText(data.failure_reason || providerBody.error_reason || providerBody.CallStatus, MAX_SUMMARY_TEXT),
    metadata,
    updated_at: new Date().toISOString()
  };
}

async function saveAudioToDrive({ conversationId, fullAudio }) {
  const base64 = cleanText(fullAudio, MAX_WEBHOOK_BODY).replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, "");
  const buffer = Buffer.from(base64, "base64");
  const safeConversationId = cleanOneLine(conversationId, `conv-${Date.now()}`).replace(/[^\w.-]+/g, "-");
  const name = `AI-call-${safeConversationId}.mp3`;

  if (!buffer.length) {
    return {
      audio_received: false,
      audio_file_name: name,
      audio_file_size: 0,
      audio_file_link: "",
      audio_save_error: "Audio webhook did not include a valid MP3 payload."
    };
  }

  try {
    const { config, drive } = getGoogleClients();
    const created = await drive.files.create({
      requestBody: {
        name,
        parents: [config.parentFolderId]
      },
      media: {
        mimeType: "audio/mpeg",
        body: Readable.from(buffer)
      },
      fields: "id, name, webViewLink, size"
    });

    return {
      audio_received: true,
      audio_file_name: created.data.name || name,
      audio_file_size: Number(created.data.size || buffer.length) || buffer.length,
      audio_file_link: created.data.webViewLink || driveWebViewLink(created.data.id),
      audio_save_error: ""
    };
  } catch (error) {
    return {
      audio_received: true,
      audio_file_name: name,
      audio_file_size: buffer.length,
      audio_file_link: "",
      audio_save_error: cleanOneLine(error.message, "Audio received but could not be saved to Drive.")
    };
  }
}

async function buildAudioRow(event) {
  const data = event.data || {};
  const audio = await saveAudioToDrive({
    conversationId: data.conversation_id,
    fullAudio: data.full_audio
  });

  return {
    raw_event_type: cleanOneLine(event.type),
    event_timestamp: isoFromUnixSeconds(event.event_timestamp),
    conversation_id: cleanOneLine(data.conversation_id),
    agent_id: cleanOneLine(data.agent_id),
    has_audio: true,
    ...audio,
    updated_at: new Date().toISOString()
  };
}

async function upsertCallLog(row) {
  if (!row.conversation_id) {
    const error = new Error("Webhook event did not include a conversation_id.");
    error.statusCode = 400;
    throw error;
  }

  const records = await supabaseRequest(
    "receptionist_call_logs",
    "?on_conflict=conversation_id",
    {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(row)
    }
  );

  return records[0] || row;
}

async function safeUpsertCallLog(row) {
  try {
    return {
      logged: true,
      record: await upsertCallLog(row)
    };
  } catch (error) {
    return {
      logged: false,
      error: cleanOneLine(error.message, "Call log could not be saved.")
    };
  }
}

module.exports = {
  assertAdmin,
  buildAudioRow,
  buildFailureRow,
  buildManualCallRow,
  buildTranscriptionRow,
  cleanText,
  firstPayloadValue,
  json,
  safeUpsertCallLog,
  supabaseRequest,
  upsertCallLog,
  verifyElevenLabsWebhook
};
