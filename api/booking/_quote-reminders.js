const { cleanText, json, listAllBookings } = require("./_shared");
const { encodeSavedQuote } = require("./_saved-quote");
const { sendCustomerSms } = require("./_notifications");

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_REMINDERS_PER_RUN = 10;

function authorized(request) {
  const secret = process.env.CRON_SECRET || "";
  return Boolean(secret) && request.headers.authorization === `Bearer ${secret}`;
}

function parseJson(data) {
  if (Buffer.isBuffer(data)) return JSON.parse(data.toString("utf8"));
  if (typeof data === "string") return JSON.parse(data);
  return data || {};
}

function siteUrl() {
  return String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || "https://www.imancleaningservice.com").replace(/\/$/, "");
}

function secureQuoteUrl(record) {
  const token = encodeSavedQuote({ version: 1, quoteId: record.quoteId, expiresAt: record.expiresAt });
  return `${siteUrl()}/book-now.html?quote=${encodeURIComponent(token)}`;
}

function reminderStage(record, now = new Date()) {
  const createdAt = Number(record?.createdAt || 0);
  const age = now.getTime() - createdAt;
  const reminders = record?.quoteReminders || {};
  if (!createdAt || Number(record?.quoteReminderEligibleAt || 0) !== createdAt || age < 12 * HOUR_MS || record?.quoteOpenedAt || record?.crmQuote?.deletedAt || Number(record?.expiresAt || 0) <= now.getTime()) return "";
  if (age >= DAY_MS) return reminders.twentyFour?.completedAt || reminders.twentyFour?.claimedAt ? "" : "twentyFour";
  if (!reminders.twelve?.completedAt && !reminders.twelve?.claimedAt) return "twelve";
  return "";
}

function reminderCopy(stage, record, quoteUrl) {
  const firstName = cleanText(record?.customer?.firstName, 80) || "there";
  if (stage === "twentyFour") {
    return {
      subject: "A final reminder about your cleaning estimate",
      sms: `A clean space gives you more time for what matters most. A final reminder from IMAN Cleaning Service: Your estimate remains available. Review it here: ${quoteUrl} For assistance, call 929-232-1930. Reply STOP to unsubscribe or HELP for help.`,
      firstName,
      lead: "A consistently clean and comfortable space can make daily life feel easier and leave more time for what matters most.",
      reminder: "This is a final reminder that your cleaning estimate remains available.",
      button: "Review Your Estimate"
    };
  }
  return {
    subject: "A friendly reminder about your cleaning estimate",
    sms: `A clean, comfortable space can make your everyday routine feel lighter. A friendly reminder from IMAN Cleaning Service: Your cleaning estimate is ready. Review it here: ${quoteUrl} For assistance, call 929-232-1930. Reply STOP to unsubscribe or HELP for help.`,
    firstName,
    lead: "A professionally cared-for space can bring more comfort, calm, and ease to your everyday routine.",
    reminder: "This is a friendly reminder that your cleaning estimate is ready.",
    button: "Review Your Estimate"
  };
}

function recipientIdentity(record) {
  return {
    email: String(record?.customer?.email || "").trim().toLowerCase(),
    phone: String(record?.customer?.phone || "").replace(/\D/g, "")
  };
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function base64Url(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeMimeWord(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
}

function reminderEmail(record, stage, quoteUrl) {
  const copy = reminderCopy(stage, record, quoteUrl);
  const from = process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com";
  const text = [
    `Hi ${copy.firstName},`, "", copy.lead, "", copy.reminder, "",
    `Review Your Estimate: ${quoteUrl}`, "",
    "If you need assistance, please call (929) 232-1930.", "", "IMAN Cleaning Service LLC"
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f8f7;font-family:Arial,sans-serif;color:#263b40;line-height:1.6"><div style="max-width:640px;margin:0 auto;padding:28px 18px"><div style="background:#fff;border:1px solid #d9e6e3;border-radius:18px;padding:30px"><p style="margin-top:0">Hi ${escapeHtml(copy.firstName)},</p><p>${escapeHtml(copy.lead)}</p><p>${escapeHtml(copy.reminder)}</p><p style="margin:26px 0"><a href="${escapeHtml(quoteUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#0b6474;color:#fff;text-decoration:none;font-weight:bold">${escapeHtml(copy.button)}</a></p><p>If you need assistance, please call <a href="tel:+19292321930" style="color:#0b6474;font-weight:bold">(929) 232-1930</a>.</p><p style="margin-bottom:0"><strong>IMAN Cleaning Service LLC</strong></p></div></div></body></html>`;
  const boundary = `quote_reminder_${stage}`;
  const raw = [
    `From: ${encodeMimeWord("IMAN Cleaning Service LLC")} <${from}>`,
    `To: ${record.customer.email}`,
    `Subject: ${encodeMimeWord(copy.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=\"UTF-8\"", "", text,
    `--${boundary}`, "Content-Type: text/html; charset=\"UTF-8\"", "", html,
    `--${boundary}--`, ""
  ].join("\r\n");
  return { raw: base64Url(raw), subject: copy.subject, text, html };
}

async function sendReminderEmail(record, stage, quoteUrl) {
  if (!record?.customer?.email) return { status: "skipped", messageId: "", error: "Customer email is missing." };
  try {
    const { gmail } = require("../quote/_shared").getGoogleClients();
    const sent = await gmail.users.messages.send({ userId: "me", requestBody: { raw: reminderEmail(record, stage, quoteUrl).raw } });
    return { status: "sent", messageId: sent.data.id || "", error: "" };
  } catch (error) {
    return { status: "failed", messageId: "", error: cleanText(error.message, 300) };
  }
}

async function listSavedQuotes() {
  const { drive, config } = require("../quote/_shared").getGoogleClients();
  const parent = String(config.parentFolderId).replace(/'/g, "\\'");
  const listed = await drive.files.list({
    q: `'${parent}' in parents and trashed = false and appProperties has { key='iman_record_type' and value='saved_quote' }`,
    fields: "files(id,createdTime,appProperties)", pageSize: 500
  });
  return Promise.all((listed.data.files || []).map(async file => ({
    file,
    record: parseJson((await drive.files.get({ fileId: file.id, alt: "media" })).data),
    drive
  })));
}

async function saveSavedQuote(entry, record) {
  const current = parseJson((await entry.drive.files.get({ fileId: entry.file.id, alt: "media" })).data);
  await entry.drive.files.update({
    fileId: entry.file.id,
    media: {
      mimeType: "application/json",
      body: JSON.stringify({
        ...current,
        quoteReminders: { ...(current.quoteReminders || {}), ...(record.quoteReminders || {}) }
      })
    }
  });
}

function bookedSavedQuoteIds(bookings) {
  return new Set((bookings || []).filter(booking => {
    const payment = booking?.estimate?.payment || {};
    const bookingStatus = cleanText(booking?.status, 80).toLowerCase();
    const paymentStatus = cleanText(payment.status || booking?.estimate?.paymentStatus || booking?.payment_status, 80).toLowerCase();
    return ["confirmed", "cleaner assigned", "in progress", "completed"].includes(bookingStatus)
      || Number(payment.paidCents || 0) > 0
      || /^(deposit_paid|paid|captured|fully_paid|succeeded|complete|completed)$/.test(paymentStatus);
  }).map(booking => cleanText(booking?.estimate?.savedQuoteId, 150)).filter(Boolean));
}

async function processDueQuoteReminders({
  now = new Date(),
  listQuotes = listSavedQuotes,
  listBookings = listAllBookings,
  sendEmail = sendReminderEmail,
  sendSms = async (record, stage, quoteUrl) => sendCustomerSms(record.customer?.phone, reminderCopy(stage, record, quoteUrl).sms),
  saveQuote = saveSavedQuote
} = {}) {
  const [entries, bookings] = await Promise.all([listQuotes(), listBookings()]);
  const bookedIds = bookedSavedQuoteIds(bookings);
  const results = [];
  const newestByRecipient = [];
  const seenEmails = new Set();
  const seenPhones = new Set();
  for (const entry of entries.sort((a, b) => Number(b.record?.createdAt || 0) - Number(a.record?.createdAt || 0))) {
    const { email, phone } = recipientIdentity(entry.record);
    if (!email && !phone) continue;
    if ((email && seenEmails.has(email)) || (phone && seenPhones.has(phone))) continue;
    newestByRecipient.push(entry);
    if (email) seenEmails.add(email);
    if (phone) seenPhones.add(phone);
  }
  const candidates = newestByRecipient
    .filter(entry => !bookedIds.has(entry.record?.quoteId) && reminderStage(entry.record, now))
    .slice(0, MAX_REMINDERS_PER_RUN);
  for (const entry of candidates) {
    const record = entry.record;
    if (bookedIds.has(record.quoteId)) continue;
    // Re-read bookings immediately before claiming each reminder. This closes
    // the gap where a customer pays after the run's initial booking snapshot.
    if (bookedSavedQuoteIds(await listBookings()).has(record.quoteId)) continue;
    const stage = reminderStage(record, now);
    if (!stage) continue;
    const quoteUrl = secureQuoteUrl(record);
    const prior = record.quoteReminders?.[stage] || {};
    const claimedAt = now.toISOString();
    record.quoteReminders = {
      ...(record.quoteReminders || {}),
      [stage]: { ...prior, claimedAt }
    };
    await saveQuote(entry, record);
    const email = prior.emailSentAt ? { status: "already_sent", messageId: prior.emailMessageId || "" } : await sendEmail(record, stage, quoteUrl);
    const smsAllowed = record.communicationConsent?.transactionalSms?.granted === true;
    const sms = !smsAllowed ? { status: "not_requested", messageId: "" }
      : prior.smsSentAt ? { status: "already_sent", messageId: prior.smsMessageId || "" }
      : await sendSms(record, stage, quoteUrl);
    const sentAt = now.toISOString();
    const nextStage = {
      ...prior,
      ...(email.status === "sent" ? { emailSentAt: sentAt, emailMessageId: email.messageId || "" } : {}),
      ...(sms.status === "sent" ? { smsSentAt: sentAt, smsMessageId: sms.messageId || "" } : {}),
      ...(sms.status === "not_requested" ? { smsSkippedAt: sentAt } : {})
    };
    const emailDone = Boolean(nextStage.emailSentAt) || email.status === "skipped";
    const smsDone = !smsAllowed || Boolean(nextStage.smsSentAt);
    if (emailDone && smsDone) nextStage.completedAt = nextStage.completedAt || sentAt;
    record.quoteReminders = { ...(record.quoteReminders || {}), [stage]: nextStage };
    await saveQuote(entry, record);
    results.push({ quoteId: record.quoteId, stage, email: email.status, sms: sms.status, completed: Boolean(nextStage.completedAt) });
  }
  return { checked: entries.length, due: results.length, results };
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "GET") return json(response, 405, { error: "Method not allowed." });
    if (!authorized(request)) return json(response, 401, { error: "Unauthorized." });
    if (process.env.QUOTE_REMINDERS_ENABLED !== "true") {
      return json(response, 200, { ok: true, disabled: true, checked: 0, due: 0, results: [] });
    }
    return json(response, 200, { ok: true, ...(await processDueQuoteReminders()) });
  } catch (error) {
    return json(response, error.statusCode || 500, { error: error.message || "Quote reminders could not be processed." });
  }
};

module.exports.reminderStage = reminderStage;
module.exports.reminderCopy = reminderCopy;
module.exports.reminderEmail = reminderEmail;
module.exports.bookedSavedQuoteIds = bookedSavedQuoteIds;
module.exports.processDueQuoteReminders = processDueQuoteReminders;
