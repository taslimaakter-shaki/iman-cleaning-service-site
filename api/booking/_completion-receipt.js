const { cleanText, updateBookingEstimate } = require("./_shared");
const { buildFinalPaymentReceiptPdf } = require("./_final-payment-receipt-pdf");

function base64Url(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeMimeWord(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function firstName(value) {
  return cleanText(value, 100).split(/\s+/)[0] || "there";
}

function safeAttachmentName(value) {
  return String(value || "receipt").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
}

function buildCompletionReceiptEmail(booking, receiptPdf) {
  if (!booking?.email) return null;
  const from = process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com";
  const customerName = firstName(booking.client_name);
  const subject = "Your cleaning is complete - final receipt attached";
  const text = [
    `Hi ${customerName},`, "",
    "Your cleaning service is complete, and your final payment has been processed.", "",
    "Your final paid receipt is attached for your records.", "",
    "If you have any questions, reply to this email or call us at 929-232-1930.", "",
    "Thank you for choosing us!",
    "IMAN Cleaning Service LLC",
    "www.imancleaningservice.com"
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#243c40;line-height:1.6;"><div style="max-width:640px;margin:0 auto;padding:24px;"><div style="background:#ffffff;border:1px solid #dbe7e2;border-radius:16px;padding:30px;"><p style="margin-top:0;">Hi ${escapeHtml(customerName)},</p><p>Your cleaning service is complete, and your final payment has been processed.</p><p>Your final paid receipt is attached for your records.</p><p>If you have any questions, reply to this email or call us at <a href="tel:+19292321930" style="color:#0b6474;font-weight:bold;">929-232-1930</a>.</p><p style="margin-bottom:0;">Thank you for choosing us!<br><strong>IMAN Cleaning Service LLC</strong><br><a href="https://www.imancleaningservice.com" style="color:#0b6474;">www.imancleaningservice.com</a></p></div></div></body></html>`;
  const boundary = "iman_completion_receipt_mixed";
  const altBoundary = "iman_completion_receipt_alt";
  const filename = `Iman-Cleaning-Final-Receipt-${safeAttachmentName(booking.id)}.pdf`;
  const encodedPdf = (Buffer.from(receiptPdf).toString("base64").match(/.{1,76}/g) || [""]).join("\r\n");
  const raw = [
    `From: ${encodeMimeWord("IMAN Cleaning Service LLC")} <${from}>`,
    `To: ${booking.email}`,
    `Subject: ${encodeMimeWord(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
    `--${boundary}`, `Content-Type: multipart/alternative; boundary="${altBoundary}"`, "",
    `--${altBoundary}`, "Content-Type: text/plain; charset=\"UTF-8\"", "", text,
    `--${altBoundary}`, "Content-Type: text/html; charset=\"UTF-8\"", "", html,
    `--${altBoundary}--`, "",
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64", "", encodedPdf, "",
    `--${boundary}--`, ""
  ].join("\r\n");
  return { raw: base64Url(raw), subject, text, html, filename };
}

async function sendCompletionReceiptEmail(booking) {
  if (!booking?.email) return { status: "skipped", messageId: "", error: "Customer email is missing." };
  try {
    const pdf = await buildFinalPaymentReceiptPdf({ booking });
    const email = buildCompletionReceiptEmail(booking, pdf);
    const { gmail } = require("../quote/_shared").getGoogleClients();
    const sent = await gmail.users.messages.send({ userId: "me", requestBody: { raw: email.raw } });
    return { status: "sent", messageId: sent.data.id || "", error: "" };
  } catch (error) {
    return { status: "failed", messageId: "", error: cleanText(error.message, 300) };
  }
}

async function saveCompletionReceipt(booking, completionReceipt) {
  const estimate = booking.estimate && typeof booking.estimate === "object" ? booking.estimate : {};
  const nextEstimate = { ...estimate, completionReceipt };
  await updateBookingEstimate(booking.id, nextEstimate);
  booking.estimate = nextEstimate;
}

async function sendCompletionReceipt({ booking, now = new Date(), sendEmail = sendCompletionReceiptEmail, save = saveCompletionReceipt }) {
  if (!booking?.id) throw Object.assign(new Error("Booking could not be found."), { statusCode: 404 });
  if (booking.status !== "Completed") throw Object.assign(new Error("A final receipt can be sent only after the booking is completed."), { statusCode: 409 });
  const payment = booking.estimate?.payment || {};
  const totalCents = Math.max(0, Math.round(Number(payment.totalCents) || Number(booking.estimate?.total || 0) * 100));
  const paidCents = Math.max(0, Math.round(Number(payment.paidCents) || 0));
  if (!totalCents || paidCents < totalCents || Number(payment.remainingCents || 0) > 0) {
    throw Object.assign(new Error("The final receipt cannot be sent until the booking is paid in full."), { statusCode: 409 });
  }
  const previous = booking.estimate?.completionReceipt || {};
  if (previous.sentAt || previous.status === "sent") return { ...previous, status: "already_sent", sent: true };
  const attemptedAt = now.toISOString();
  await save(booking, { ...previous, status: "sending", lastAttemptAt: attemptedAt });
  const email = await sendEmail(booking);
  const completionReceipt = {
    ...previous,
    status: email.status,
    sentAt: email.status === "sent" ? attemptedAt : "",
    lastAttemptAt: attemptedAt,
    emailMessageId: cleanText(email.messageId, 160),
    error: cleanText(email.error, 300)
  };
  await save(booking, completionReceipt);
  return { ...completionReceipt, sent: email.status === "sent" };
}

module.exports = { buildCompletionReceiptEmail, sendCompletionReceipt, sendCompletionReceiptEmail };
