const { supabaseRequest } = require("../receptionist/_shared");
const { normalizeDialNumber } = require("./_voice");

const CALL_LIMIT = 1000;

function callbackPhone(record, direction) {
  // Never fall back to the business side of a call when its customer number is missing.
  const customer = direction === "outbound" ? record.recipient_phone : record.caller_phone;
  if (!/^\+?[\d\s().-]+$/.test(String(customer || ""))) return "";
  try {
    const number = normalizeDialNumber(customer);
    const businessNumbers = [process.env.TWILIO_FROM_NUMBER, direction === "outbound" ? record.caller_phone : record.recipient_phone];
    if (businessNumbers.some(value => String(value || "").replace(/\D/g, "").slice(-10) === number.slice(-10))) return "";
    return number;
  } catch { return ""; }
}

function toClientCall(record = {}) {
  const direction = /^outbound(?:-|$)/i.test(record.call_direction || "") ? "outbound" : "inbound";
  return {
    id: record.conversation_id,
    customerName: record.customer_name || "Caller",
    phone: direction === "outbound" ? (record.recipient_phone || record.caller_phone || "") : (record.caller_phone || record.recipient_phone || ""),
    callbackPhone: callbackPhone(record, direction),
    calledAt: record.call_started_at || record.event_timestamp || record.created_at,
    durationSeconds: Math.max(0, Number(record.call_duration_seconds || 0)),
    direction,
    status: record.call_status || record.call_successful || "Completed",
    callType: record.call_type || "Other",
    summary: record.summary || record.concern_summary || "",
    transcript: record.transcript_text || "",
    recordingLink: record.audio_file_link || "",
    transferRequested: Boolean(record.transfer_requested),
    callbackStatus: record.metadata?.iman_callback?.status || "",
    sourceId: record.metadata?.source_id || "",
    sourceType: record.metadata?.source_type || ""
  };
}

async function listCalls() {
  const records = await supabaseRequest(
    "receptionist_call_logs",
    `?select=*&order=created_at.desc&limit=${CALL_LIMIT}`
  );
  return (Array.isArray(records) ? records : []).map(toClientCall);
}

module.exports = { listCalls, toClientCall };
