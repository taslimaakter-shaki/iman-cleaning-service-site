const {
  assertAdmin,
  cleanText,
  json,
  supabaseRequest
} = require("./_shared");

const EXPORT_LIMIT = 5000;

const COLUMNS = [
  "record_type",
  "record_id",
  "created_at",
  "status",
  "customer_name",
  "phone",
  "email",
  "address",
  "service",
  "service_details",
  "preferred_schedule",
  "appointment_date",
  "appointment_time",
  "conversation_id",
  "call_duration_seconds",
  "quote_form_sent",
  "transfer_requested",
  "recording_link",
  "summary",
  "transcript_or_notes",
  "raw_json"
];

function csvCell(value) {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${String(safeText).replace(/"/g, '""')}"`;
}

function csv(rows) {
  const lines = [COLUMNS.map(csvCell).join(",")];
  rows.forEach((row) => {
    lines.push(COLUMNS.map((column) => csvCell(row[column])).join(","));
  });
  return `${lines.join("\r\n")}\r\n`;
}

function callToRow(call) {
  return {
    record_type: "AI receptionist call",
    record_id: call.id,
    created_at: call.call_started_at || call.created_at,
    status: call.call_status || call.call_successful,
    customer_name: call.customer_name,
    phone: call.caller_phone,
    email: call.customer_email,
    address: call.service_address,
    service: [call.service_type, call.requested_service].filter(Boolean).join(" - "),
    service_details: call.call_type,
    preferred_schedule: [call.preferred_date, call.preferred_time].filter(Boolean).join(" "),
    appointment_date: call.appointment_date,
    appointment_time: call.appointment_time,
    conversation_id: call.conversation_id,
    call_duration_seconds: call.call_duration_seconds,
    quote_form_sent: call.quote_form_sent,
    transfer_requested: call.transfer_requested,
    recording_link: call.audio_file_link,
    summary: call.summary || call.concern_summary,
    transcript_or_notes: call.transcript_text,
    raw_json: {
      metadata: call.metadata || {},
      analysis: call.analysis_json || {},
      dynamic_variables: call.dynamic_variables || {}
    }
  };
}

function bookingToRow(booking) {
  return {
    record_type: "Website booking",
    record_id: booking.id,
    created_at: booking.created_at,
    status: booking.status,
    customer_name: booking.client_name,
    phone: booking.phone,
    email: booking.email,
    address: booking.address,
    service: booking.service_label || booking.service,
    service_details: [
      booking.bedrooms_label,
      booking.bathrooms_label,
      booking.sqft ? `${booking.sqft} sq ft` : "",
      Array.isArray(booking.addons) ? booking.addons.join("; ") : ""
    ].filter(Boolean).join(" | "),
    preferred_schedule: booking.schedule_label || booking.schedule,
    appointment_date: "",
    appointment_time: "",
    conversation_id: "",
    call_duration_seconds: "",
    quote_form_sent: "",
    transfer_requested: "",
    recording_link: "",
    summary: cleanText(booking.notes, 2000),
    transcript_or_notes: cleanText(booking.notes, 8000),
    raw_json: {
      estimate: booking.estimate || {},
      addons: booking.addons || []
    }
  };
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "GET") {
      return json(response, 405, { error: "Method not allowed." });
    }
    if (!assertAdmin(request)) {
      return json(response, 401, { error: "Admin token required." });
    }

    const [calls, bookings] = await Promise.all([
      supabaseRequest("receptionist_call_logs", `?select=*&order=created_at.desc&limit=${EXPORT_LIMIT}`),
      supabaseRequest("bookings", `?select=*&order=created_at.desc&limit=${EXPORT_LIMIT}`)
    ]);

    const rows = [
      ...calls.map(callToRow),
      ...bookings.map(bookingToRow)
    ].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

    response.statusCode = 200;
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", "attachment; filename=\"iman-operations-export.csv\"");
    response.end(csv(rows));
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Operations export could not be created.",
      details: error.details,
      setup: error.setup
    });
  }
};
