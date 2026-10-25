const { cleanText, supabaseRequest } = require("../receptionist/_shared");

const CALLBACK_STATUSES = new Set(["Pending", "Called", "Completed"]);
const CALLBACK_LIMIT = 500;

function callbackText(record = {}) {
  return [record.summary, record.transcript_text, record.concern_summary, record.call_status]
    .map((value) => String(value || ""))
    .join("\n")
    .toLowerCase();
}

function isCallbackRecord(record = {}) {
  if (record.metadata?.iman_callback?.requested) return true;
  if (/callback[_ -]?pending|callback[_ -]?requested/.test(String(record.call_status || "").toLowerCase())) return true;
  return Boolean(record.transfer_requested) && /representatives? (?:are|is) busy|team members? (?:are|is) busy|(?:we will|we'll) call you back/.test(callbackText(record));
}

function toClientCallback(record = {}) {
  const callback = record.metadata?.iman_callback || {};
  return {
    id: record.conversation_id,
    customerName: record.customer_name || "Caller",
    phone: record.caller_phone || "",
    requestedAt: callback.requestedAt || record.call_started_at || record.event_timestamp || record.created_at,
    status: CALLBACK_STATUSES.has(callback.status) ? callback.status : "Pending",
    reason: record.call_type || "Requested a team member",
    summary: record.summary || record.concern_summary || "Customer requested a team member, but no representative answered.",
    notes: callback.notes || "",
    calledAt: callback.calledAt || "",
    completedAt: callback.completedAt || "",
    attempts: Array.isArray(callback.attempts) ? callback.attempts : []
  };
}

async function listCallbacks() {
  const records = await supabaseRequest(
    "receptionist_call_logs",
    `?select=*&transfer_requested=eq.true&order=created_at.desc&limit=${CALLBACK_LIMIT}`
  );
  return (Array.isArray(records) ? records : []).filter(isCallbackRecord).map(toClientCallback);
}

async function updateCallback({ id, status, notes }) {
  const callbackId = cleanText(id, 250);
  const nextStatus = cleanText(status, 30);
  if (!callbackId) throw Object.assign(new Error("Callback ID is required."), { statusCode: 400 });
  if (!CALLBACK_STATUSES.has(nextStatus)) throw Object.assign(new Error("Choose a valid callback status."), { statusCode: 400 });

  const records = await supabaseRequest(
    "receptionist_call_logs",
    `?conversation_id=eq.${encodeURIComponent(callbackId)}&select=*`
  );
  const record = records[0];
  if (!record) throw Object.assign(new Error("Callback request was not found."), { statusCode: 404 });

  const now = new Date().toISOString();
  const previous = record.metadata?.iman_callback || {};
  const attempts = Array.isArray(previous.attempts) ? [...previous.attempts] : [];
  if (nextStatus === "Called" && previous.status !== "Called") attempts.push({ at: now });
  const callback = {
    ...previous,
    requested: true,
    status: nextStatus,
    requestedAt: previous.requestedAt || record.call_started_at || record.created_at || now,
    notes: cleanText(notes, 2000),
    attempts,
    calledAt: nextStatus === "Called" ? now : previous.calledAt || "",
    completedAt: nextStatus === "Completed" ? now : "",
    updatedAt: now
  };
  const updated = await supabaseRequest(
    "receptionist_call_logs",
    `?conversation_id=eq.${encodeURIComponent(callbackId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ metadata: { ...(record.metadata || {}), iman_callback: callback }, updated_at: now })
    }
  );
  return toClientCallback(updated[0] || { ...record, metadata: { ...(record.metadata || {}), iman_callback: callback } });
}

module.exports = { isCallbackRecord, listCallbacks, toClientCallback, updateCallback };
