const TIME_ZONE = "America/New_York";

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeMimeWord(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reminderStageForBooking(booking, now = new Date()) {
  const appointment = new Date(booking?.schedule);
  if (!Number.isFinite(appointment.getTime())) return "";
  const hoursUntil = (appointment.getTime() - now.getTime()) / 3600000;
  if (hoursUntil > 5 && hoursUntil <= 6) return "six_hours";
  if (hoursUntil > 0 && hoursUntil <= 1) return "one_hour";
  return "";
}

function reminderCopy(stage) {
  if (stage === "six_hours") {
    return {
      subjectLead: "Your appointment is in about 6 hours",
      heading: "Your appointment is coming up in about six hours.",
      intro: "This is a friendly reminder about your upcoming appointment."
    };
  }
  return {
    subjectLead: "Your appointment is in about 1 hour",
    heading: "Your appointment begins in about one hour.",
    intro: "Our team will be arriving soon."
  };
}

function formatAppointment(schedule) {
  const date = new Date(schedule);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function buildReminderEmail(booking, stage) {
  if (!booking?.email) return null;
  const copy = reminderCopy(stage);
  const from = process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com";
  const appointment = formatAppointment(booking.schedule);
  const subject = `${copy.subjectLead} — Iman Cleaning Service`;
  const customerName = booking.client_name || "there";
  const details = [
    ["Service", booking.service_label || booking.service || "Residential cleaning"],
    ["Appointment", appointment],
    ["Address", booking.address],
    ["Booking reference", booking.id]
  ].filter(([, value]) => value);
  const text = [
    `Hi ${customerName},`,
    "",
    copy.heading,
    copy.intro,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    "Before we arrive, please make sure we can access the property.",
    "If access instructions have changed, please call 929-803-4053.",
    "",
    "Thank you for choosing Iman Cleaning Service LLC."
  ].join("\n");
  const rows = details.map(([label, value]) => (
    `<tr><th align="left" style="padding:7px 14px 7px 0;color:#073f49;">${escapeHtml(label)}</th><td style="padding:7px 0;">${escapeHtml(value)}</td></tr>`
  )).join("");
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f4f8f7;font-family:Arial,sans-serif;color:#263b40;line-height:1.55;">
    <div style="max-width:640px;margin:0 auto;padding:28px 18px;">
      <div style="background:#ffffff;border:1px solid #d9e6e3;border-radius:18px;padding:30px;">
        <p style="margin-top:0;">Hi ${escapeHtml(customerName)},</p>
        <h1 style="margin:10px 0;color:#073f49;font-size:26px;">${escapeHtml(copy.heading)}</h1>
        <p>${escapeHtml(copy.intro)}</p>
        <table style="width:100%;margin:20px 0;border-collapse:collapse;">${rows}</table>
        <p>Before we arrive, please make sure we can access the property.</p>
        <p>If access instructions have changed, please call <a href="tel:+19298034053" style="color:#0b6474;font-weight:bold;">929-803-4053</a>.</p>
        <p style="margin-bottom:0;">Thank you for choosing Iman Cleaning Service LLC.</p>
      </div>
    </div>
  </body>
</html>`;
  const boundary = `booking_reminder_${stage}`;
  const headers = [
    `From: ${encodeMimeWord("IMAN Cleaning Service LLC")} <${from}>`,
    `To: ${booking.email}`,
    `Subject: ${encodeMimeWord(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];
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
  return { raw: base64Url(raw), subject, text, html };
}

async function sendBookingReminderEmail(booking, stage) {
  const email = buildReminderEmail(booking, stage);
  if (!email) return { status: "skipped", messageId: "", error: "Customer email is missing." };
  const { getGoogleClients } = require("../quote/_shared");
  const { gmail } = getGoogleClients();
  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: email.raw }
  });
  return { status: "sent", messageId: sent.data.id || "", error: "" };
}

function normalizePhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return String(value || "").trim().startsWith("+") ? String(value || "").trim() : "";
}

async function sendCustomerSms(toValue, body) {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const from = normalizePhoneNumber(process.env.TWILIO_FROM_NUMBER);
  const to = normalizePhoneNumber(toValue);
  if (!accountSid || !authToken || !from) {
    return { status: "not_configured", messageId: "", error: "SMS is not configured." };
  }
  if (!to) return { status: "skipped", messageId: "", error: "Customer phone is missing." };
  const encoded = new URLSearchParams({ From: from, To: to, Body: body });
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
    return { status: "failed", messageId: "", error: data?.message || "Text message could not be sent." };
  }
  return { status: "sent", messageId: data.sid || "", error: "" };
}

function buildReminderSms(booking, stage) {
  const copy = reminderCopy(stage);
  return [
    `IMAN Cleaning Service: ${copy.subjectLead}.`,
    `${booking.service_label || booking.service || "Service"}: ${formatAppointment(booking.schedule)}.`,
    booking.address ? `Address: ${booking.address}.` : "",
    `Booking: ${booking.id}.`,
    "Questions? Call 929-803-4053. Reply STOP to opt out."
  ].filter(Boolean).join(" ");
}

async function sendBookingReminderSms(booking, stage) {
  return sendCustomerSms(booking?.phone, buildReminderSms(booking, stage));
}

module.exports = {
  buildReminderSms,
  buildReminderEmail,
  formatAppointment,
  normalizePhoneNumber,
  reminderStageForBooking,
  sendBookingReminderEmail,
  sendBookingReminderSms,
  sendCustomerSms
};
