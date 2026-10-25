const { cleanText, listAllBookings, updateBookingEstimate } = require("./_shared");
const { sendCustomerSms } = require("./_notifications");

const GOOGLE_REVIEW_URL = "https://g.page/r/CZr1C9xnMwR3EBM/review";
const REVIEW_DELAY_MS = 24 * 60 * 60 * 1000;
const MAX_REVIEW_REQUESTS_PER_RUN = 20;
const REVIEW_REQUEST_MESSAGE = `Thank you for choosing IMAN Cleaning Service. We hope you’re enjoying your freshly cleaned space!

We’d appreciate your Google review:
${GOOGLE_REVIEW_URL}

Need help? Call 929-232-1930. Reply STOP to opt out.`;

function buildReviewRequestSms() {
  return REVIEW_REQUEST_MESSAGE;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeMimeWord(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildReviewRequestEmail(booking) {
  if (!booking?.email) return null;
  const firstName = cleanText(booking.client_name, 100) || "there";
  const from = process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com";
  const subject = "How did we do? — IMAN Cleaning Service";
  const text = [
    `Hi ${firstName},`, "",
    "Thank you for choosing IMAN Cleaning Service. We hope you’re enjoying your freshly cleaned space!", "",
    "We’d appreciate your Google review:", GOOGLE_REVIEW_URL, "",
    "Need help? Call 929-232-1930.", "",
    "IMAN Cleaning Service LLC"
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f8f7;font-family:Arial,sans-serif;color:#263b40;line-height:1.6"><div style="max-width:640px;margin:0 auto;padding:28px 18px"><div style="background:#fff;border:1px solid #d9e6e3;border-radius:18px;padding:30px"><p style="margin-top:0">Hi ${escapeHtml(firstName)},</p><p>Thank you for choosing IMAN Cleaning Service. We hope you’re enjoying your freshly cleaned space!</p><p>We’d appreciate your Google review:</p><p style="margin:24px 0"><a href="${GOOGLE_REVIEW_URL}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#0b6474;color:#fff;text-decoration:none;font-weight:bold">Leave a Google Review</a></p><p>Need help? Call <a href="tel:+19292321930" style="color:#0b6474;font-weight:bold">929-232-1930</a>.</p><p style="margin-bottom:0"><strong>IMAN Cleaning Service LLC</strong></p></div></div></body></html>`;
  const boundary = "iman_review_request";
  const raw = [
    `From: ${encodeMimeWord("IMAN Cleaning Service LLC")} <${from}>`,
    `To: ${booking.email}`,
    `Subject: ${encodeMimeWord(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=\"UTF-8\"", "", text,
    `--${boundary}`, "Content-Type: text/html; charset=\"UTF-8\"", "", html,
    `--${boundary}--`, ""
  ].join("\r\n");
  return { raw: base64Url(raw), subject, text, html };
}

async function sendReviewRequestEmail(booking) {
  const email = buildReviewRequestEmail(booking);
  if (!email) return { status: "skipped", messageId: "", error: "Customer email is missing." };
  try {
    const { gmail } = require("../quote/_shared").getGoogleClients();
    const sent = await gmail.users.messages.send({ userId: "me", requestBody: { raw: email.raw } });
    return { status: "sent", messageId: sent.data.id || "", error: "" };
  } catch (error) {
    return { status: "failed", messageId: "", error: cleanText(error.message, 300) };
  }
}

async function saveReviewRequest(booking, reviewRequest) {
  const estimate = booking.estimate && typeof booking.estimate === "object" ? booking.estimate : {};
  const nextEstimate = { ...estimate, reviewRequest };
  await updateBookingEstimate(booking.id, nextEstimate);
  booking.estimate = nextEstimate;
}

async function scheduleReviewRequest({ booking, now = new Date(), save = saveReviewRequest }) {
  if (!booking?.id) throw Object.assign(new Error("Booking could not be found."), { statusCode: 404 });
  if (booking.status !== "Completed") throw Object.assign(new Error("A review request can be scheduled only after the booking is completed."), { statusCode: 409 });
  const previous = booking.estimate?.reviewRequest || {};
  if (previous.sentAt || previous.status === "sent") return { ...previous, status: "already_sent", sent: true };
  if (previous.dueAt && ["scheduled", "sending", "failed"].includes(previous.status)) {
    return { ...previous, status: "already_scheduled", sent: false };
  }
  const completedAt = now.toISOString();
  const reviewRequest = {
    ...previous,
    status: "scheduled",
    completedAt,
    dueAt: new Date(now.getTime() + REVIEW_DELAY_MS).toISOString(),
    scheduledAt: completedAt,
    reviewUrl: GOOGLE_REVIEW_URL
  };
  await save(booking, reviewRequest);
  return { ...reviewRequest, sent: false };
}

async function sendReviewRequest({
  booking,
  now = new Date(),
  sendSms = (record) => sendCustomerSms(record.phone, buildReviewRequestSms()),
  sendEmail = sendReviewRequestEmail,
  save = saveReviewRequest
}) {
  if (!booking?.id) throw Object.assign(new Error("Booking could not be found."), { statusCode: 404 });
  if (booking.status !== "Completed") throw Object.assign(new Error("A review request can be sent only after the booking is completed."), { statusCode: 409 });

  const previous = booking.estimate?.reviewRequest || {};
  if (previous.sentAt || previous.status === "sent") return { ...previous, status: "already_sent", sent: true };
  const dueAt = new Date(previous.dueAt || 0).getTime();
  if (Number.isFinite(dueAt) && dueAt > now.getTime()) return { ...previous, status: "scheduled", sent: false };
  const claimedAt = new Date(previous.claimedAt || 0).getTime();
  if (previous.status === "sending" && Number.isFinite(claimedAt) && now.getTime() - claimedAt < 10 * 60 * 1000) {
    return { ...previous, status: "already_processing", sent: false };
  }

  const attemptedAt = now.toISOString();
  await save(booking, { ...previous, status: "sending", claimedAt: attemptedAt, lastAttemptAt: attemptedAt, reviewUrl: GOOGLE_REVIEW_URL });
  const [email, sms] = await Promise.all([
    previous.emailStatus === "sent" ? Promise.resolve({ status: "already_sent", messageId: previous.emailMessageId || "" }) : sendEmail(booking),
    previous.smsStatus === "sent" ? Promise.resolve({ status: "already_sent", messageId: previous.smsMessageId || "" }) : sendSms(booking)
  ]);
  const failed = [email, sms].filter((item) => ["failed", "error"].includes(item.status));
  const emailStatus = email.status === "already_sent" ? "sent" : email.status;
  const smsStatus = sms.status === "already_sent" ? "sent" : sms.status;
  const complete = !failed.length;
  const reviewRequest = {
    ...previous,
    claimedAt: complete ? attemptedAt : "",
    status: complete ? "sent" : "failed",
    sentAt: complete ? attemptedAt : "",
    lastAttemptAt: attemptedAt,
    emailStatus,
    emailMessageId: cleanText(email.messageId || previous.emailMessageId, 160),
    smsStatus,
    smsMessageId: cleanText(sms.messageId || previous.smsMessageId, 160),
    error: failed.map((item) => cleanText(item.error, 300)).filter(Boolean).join(" "),
    reviewUrl: GOOGLE_REVIEW_URL
  };
  await save(booking, reviewRequest);
  return { ...reviewRequest, sent: complete };
}

async function processDueReviewRequests({ now = new Date(), listBookings = listAllBookings, send = sendReviewRequest } = {}) {
  const bookings = await listBookings();
  const due = bookings.filter((booking) => {
    const reviewRequest = booking.estimate?.reviewRequest || {};
    const dueAt = new Date(reviewRequest.dueAt || 0).getTime();
    return booking.status === "Completed"
      && !reviewRequest.sentAt
      && ["scheduled", "failed"].includes(reviewRequest.status)
      && Number.isFinite(dueAt)
      && dueAt <= now.getTime();
  }).slice(0, MAX_REVIEW_REQUESTS_PER_RUN);
  const results = [];
  for (const booking of due) {
    try {
      const result = await send({ booking, now });
      results.push({ bookingId: booking.id, status: result.status, emailStatus: result.emailStatus, smsStatus: result.smsStatus });
    } catch (error) {
      results.push({ bookingId: booking.id, status: "failed", error: cleanText(error.message, 300) });
    }
  }
  return {
    checked: bookings.length,
    due: due.length,
    sent: results.filter((result) => result.status === "sent").length,
    failed: results.filter((result) => result.status === "failed").length,
    results
  };
}

module.exports = {
  GOOGLE_REVIEW_URL,
  REVIEW_DELAY_MS,
  REVIEW_REQUEST_MESSAGE,
  buildReviewRequestEmail,
  buildReviewRequestSms,
  processDueReviewRequests,
  scheduleReviewRequest,
  sendReviewRequest,
  sendReviewRequestEmail
};
