function clean(value, max = 500) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function encodeMimeWord(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
}

function rawEmail(quote, from) {
  const name = clean(quote.customerName, 160) || "there";
  const service = clean(quote.service, 160) || "cleaning service";
  const subject = `Your ${service} estimate — IMAN Cleaning Service`;
  const text = [
    `Hi ${name},`, "", "Your personalized cleaning estimate is ready.",
    `Review your service details, choose an appointment, sign the agreement, and pay your deposit securely: ${quote.approvalUrl}`,
    "", "Questions? Call 929-232-1930.", "", "IMAN Cleaning Service LLC"
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f8f7;font-family:Arial,sans-serif;color:#263b40;line-height:1.55"><div style="max-width:640px;margin:0 auto;padding:28px 18px"><div style="background:#fff;border:1px solid #d9e6e3;border-radius:18px;padding:30px"><p>Hi ${escapeHtml(name)},</p><h1 style="color:#073f49;font-size:26px">Your personalized cleaning estimate is ready.</h1><p>Review your service details, choose an appointment, sign the agreement, and pay your deposit securely.</p><p style="margin:26px 0"><a href="${escapeHtml(quote.approvalUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#0b6474;color:#fff;text-decoration:none;font-weight:bold">Review estimate and choose an appointment</a></p><p>Questions? Call <a href="tel:+19292321930" style="color:#0b6474;font-weight:bold">929-232-1930</a>.</p><p>IMAN Cleaning Service LLC</p></div></div></body></html>`;
  const boundary = `payment_link_${Date.now().toString(36)}`;
  const mime = [
    `From: ${encodeMimeWord("IMAN Cleaning Service LLC")} <${from}>`,
    `To: ${quote.email}`,
    `Subject: ${encodeMimeWord(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', "", text,
    `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', "", html,
    `--${boundary}--`, ""
  ].join("\r\n");
  return Buffer.from(mime).toString("base64url");
}

async function sendPaymentLinkEmail(body = {}) {
  const id = clean(body.id, 200);
  if (!id) throw Object.assign(new Error("Quote ID is required."), { statusCode: 400 });
  const quotes = await require("./_quotes").listCrmQuotes();
  const quote = quotes.find(item => item.id === id);
  if (!quote || quote.deletedAt) throw Object.assign(new Error("Quote not found."), { statusCode: 404 });
  if (!quote.paymentReady || !quote.approvalUrl) throw Object.assign(new Error("Create the payment link before emailing it."), { statusCode: 409 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(quote.email || ""))) throw Object.assign(new Error("This customer does not have a valid email address."), { statusCode: 400 });
  const { gmail, config } = require("../quote/_shared").getGoogleClients();
  const sent = await gmail.users.messages.send({ userId: "me", requestBody: { raw: rawEmail(quote, config.emailFrom) } });
  return { status: "sent", messageId: clean(sent.data.id, 100), email: quote.email };
}

module.exports = { rawEmail, sendPaymentLinkEmail };
