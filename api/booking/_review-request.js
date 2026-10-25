const { cleanText, updateBookingEstimate } = require("./_shared");
const { sendCustomerSms } = require("./_notifications");

const GOOGLE_REVIEW_URL = "https://g.page/r/CZr1C9xnMwR3EBM/review";
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
  if (previous.claimedAt || previous.sentAt || previous.status === "sent") return { ...previous, status: "already_sent", sent: true };

  const attemptedAt = now.toISOString();
  await save(booking, { ...previous, status: "sending", claimedAt: attemptedAt, lastAttemptAt: attemptedAt, reviewUrl: GOOGLE_REVIEW_URL });
  const [email, sms] = await Promise.all([sendEmail(booking), sendSms(booking)]);
  const delivered = [email, sms].filter((item) => item.status === "sent");
  const failed = [email, sms].filter((item) => ["failed", "error"].includes(item.status));
  const reviewRequest = {
    ...previous,
    claimedAt: attemptedAt,
    status: delivered.length ? "sent" : (failed.length ? "failed" : "skipped"),
    sentAt: delivered.length ? attemptedAt : "",
    lastAttemptAt: attemptedAt,
    emailStatus: email.status,
    emailMessageId: cleanText(email.messageId, 160),
    smsStatus: sms.status,
    smsMessageId: cleanText(sms.messageId, 160),
    error: failed.map((item) => cleanText(item.error, 300)).filter(Boolean).join(" "),
    reviewUrl: GOOGLE_REVIEW_URL
  };
  await save(booking, reviewRequest);
  return { ...reviewRequest, sent: delivered.length > 0 };
}

module.exports = { GOOGLE_REVIEW_URL, REVIEW_REQUEST_MESSAGE, buildReviewRequestEmail, buildReviewRequestSms, sendReviewRequest, sendReviewRequestEmail };
