const crypto = require("crypto");
const {
  cleanText,
  createSession,
  getLatestSessionByContact,
  getSmsConfig,
  normalizePhoneNumber,
  saveMessage,
  supabaseRequest,
  twilioRequest,
  updateSession
} = require("../chat/_shared");

function error(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function customerPhone(value) {
  const normalized = normalizePhoneNumber(value);
  if (!/^\+[1-9]\d{9,14}$/.test(normalized)) throw error("A valid customer phone number is required.");
  return normalized;
}

async function sendCustomerMessage(body = {}) {
  const phone = customerPhone(body.phone);
  const messageBody = cleanText(body.message, 1600);
  if (!messageBody) throw error("Enter a text message.");
  const config = getSmsConfig();
  if (!config.accountSid || !config.authToken || !config.from) throw error("Twilio texting is not configured.", 503);

  let session = await getLatestSessionByContact(phone);
  if (!session) {
    session = await createSession({
      visitorName: cleanText(body.customerName, 120),
      visitorContact: phone,
      pageUrl: `sms:${normalizePhoneNumber(config.from)}`,
      referrer: "CRM customer message"
    });
  } else {
    session = await updateSession(session.id, {
      status: "active",
      visitor_name: cleanText(body.customerName, 120) || session.visitor_name,
      visitor_contact: phone,
      page_url: `sms:${normalizePhoneNumber(config.from)}`,
      referrer: session.referrer || "CRM customer message",
      closed_at: null
    });
  }

  const sent = await twilioRequest({
    accountSid: config.accountSid,
    authToken: config.authToken,
    from: config.from,
    to: phone,
    body: messageBody
  });
  const message = await saveMessage({
    sessionId: session.id,
    sender: "owner",
    body: messageBody,
    clientMessageId: `crm-out:${cleanText(sent.sid, 80)}`,
    twilioMessageSid: cleanText(sent.sid, 80)
  });
  await updateSession(session.id, {
    status: "active",
    last_owner_reply_at: message.created_at || new Date().toISOString()
  });
  return { sessionId: session.id, messageId: cleanText(sent.sid, 80), phone };
}

async function startCustomerCall(body = {}) {
  const phone = customerPhone(body.phone);
  const now = new Date().toISOString();
  const id = `CRM-CALL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const row = {
    raw_event_type: "crm_outbound_call",
    event_timestamp: now,
    conversation_id: id,
    call_status: "connecting",
    call_started_at: now,
    call_duration_seconds: 0,
    caller_phone: normalizePhoneNumber(process.env.TWILIO_FROM_NUMBER),
    recipient_phone: phone,
    call_direction: "outbound",
    customer_name: cleanText(body.customerName, 160),
    call_type: "Team member outbound call",
    summary: cleanText(body.sourceLabel, 300),
    metadata: {
      source: "crm_browser_dialer",
      source_id: cleanText(body.sourceId, 160),
      source_type: cleanText(body.sourceType, 80)
    },
    updated_at: now
  };
  const records = await supabaseRequest("receptionist_call_logs", "?on_conflict=conversation_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row)
  });
  return records[0] || row;
}

async function finishCustomerCall(body = {}) {
  const id = cleanText(body.callId, 200);
  if (!id) throw error("Call record ID is required.");
  const durationSeconds = Math.max(0, Math.min(24 * 60 * 60, Math.round(Number(body.durationSeconds) || 0)));
  const status = cleanText(body.status, 60) || "completed";
  const now = new Date().toISOString();
  const records = await supabaseRequest(
    "receptionist_call_logs",
    `?conversation_id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        event_timestamp: now,
        call_status: status,
        call_duration_seconds: durationSeconds,
        updated_at: now
      })
    }
  );
  if (!records[0]) throw error("Call record was not found.", 404);
  return records[0];
}

module.exports = { customerPhone, finishCustomerCall, sendCustomerMessage, startCustomerCall };
