const crypto = require("crypto");
const { getGoogleClients } = require("../quote/_shared");
const { sendCustomerSms } = require("../booking/_notifications");
const { listCrmQuotes } = require("./_quotes");
const { listManualContacts } = require("./_contacts");
const { listCrmConversations } = require("./_conversations");
const { listEmailSuppressions } = require("./_email-suppressions");

const CAMPAIGN_ID = "fall10-2026";
const CAMPAIGN_NAME = "Fall 10% offer";
const EXCLUDED_NAMES = new Set(["christopher roubik"]);

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

function firstName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  return name ? name.split(" ")[0] : "there";
}

function optedOutConversation(conversation = {}) {
  return /opt(?:ed)?[ _-]?out|unsubscribed|blocked/i.test(String(conversation.status || ""))
    || /^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(String(conversation.lastMessage || "").trim());
}

function eligibleRecipients({ quotes = [], contacts = [], conversations = [], suppressions = [] }) {
  const emailOptOuts = new Set(suppressions.map((item) => normalizeEmail(item.email)).filter(Boolean));
  const smsOptOuts = new Set(conversations.filter(optedOutConversation).map((item) => normalizePhone(item.customerContact)).filter(Boolean));
  const emails = new Map();
  const phones = new Map();
  const add = ({ name, email, phone, emailConsent, smsConsent, source }) => {
    const cleanName = String(name || "Customer").trim();
    if (EXCLUDED_NAMES.has(cleanName.toLowerCase())) return;
    const cleanEmail = normalizeEmail(email);
    const cleanPhone = normalizePhone(phone);
    if (emailConsent && cleanEmail && !emailOptOuts.has(cleanEmail) && !emails.has(cleanEmail)) {
      emails.set(cleanEmail, { name: cleanName, firstName: firstName(cleanName), email: cleanEmail, source });
    }
    if (smsConsent && cleanPhone && !smsOptOuts.has(cleanPhone) && !phones.has(cleanPhone)) {
      phones.set(cleanPhone, { name: cleanName, firstName: firstName(cleanName), phone: cleanPhone, source });
    }
  };
  quotes.forEach((quote) => {
    if (quote.deletedAt) return;
    const consent = quote.communicationConsent || {};
    add({ name: quote.customerName, email: quote.email, phone: quote.phone, emailConsent: consent.marketingEmail === true, smsConsent: consent.marketingSms === true, source: quote.source || "Online quote" });
  });
  contacts.forEach((contact) => add({
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    emailConsent: contact.emailMarketingEligible === true,
    smsConsent: contact.smsMarketingConsent === true,
    source: "Manually added previous customer"
  }));
  return { email: Array.from(emails.values()), sms: Array.from(phones.values()) };
}

function recipientHash(channel, recipient) {
  return crypto.createHash("sha256").update(`${CAMPAIGN_ID}:${channel}:${recipient}`).digest("hex");
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

function emailContent(contact, siteUrl) {
  const unsubscribeUrl = `${siteUrl}/unsubscribe.html?email=${encodeURIComponent(contact.email)}`;
  const subject = "🍂 Welcome fall with 10% off your next cleaning";
  const text = [
    `Hi ${contact.firstName},`, "",
    "Welcome fall with a cleaner, cozier space—and 10% off any eligible IMAN cleaning service.", "",
    "Use promo code FALL10 when booking by December 20, 2026.", "",
    `Get your instant quote: ${siteUrl}/book-now.html`, "",
    "Thank you for choosing IMAN Cleaning Service LLC!", "",
    "IMAN Cleaning Service LLC", "88-56 77th Street, Woodhaven, NY 11421", siteUrl, "",
    "One use per customer. Cannot be combined with other offers. Valid for eligible cleaning services.", "",
    `Unsubscribe: ${unsubscribeUrl}`
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7f3;font-family:Arial,sans-serif;color:#263b40;line-height:1.6"><div style="max-width:620px;margin:auto;padding:24px"><div style="background:#fff;border:1px solid #dbe7e2;border-radius:18px;padding:30px"><p>Hi ${escapeHtml(contact.firstName)},</p><h1 style="color:#073f49;font-size:27px">Welcome fall with a cleaner, cozier space 🍂</h1><p>Enjoy <strong>10% off</strong> any eligible IMAN cleaning service.</p><p>Use promo code <strong>FALL10</strong> when booking by <strong>December 20, 2026</strong>.</p><p><a href="${escapeHtml(siteUrl)}/book-now.html" style="display:inline-block;background:#0b6474;color:#fff;text-decoration:none;font-weight:bold;padding:13px 20px;border-radius:999px">Get Your Instant Quote</a></p><p>Thank you for choosing IMAN Cleaning Service LLC!</p><hr style="border:0;border-top:1px solid #dbe7e2;margin:24px 0"><p style="font-size:12px;color:#64777a">IMAN Cleaning Service LLC<br>88-56 77th Street, Woodhaven, NY 11421<br>One use per customer. Cannot be combined with other offers. Valid for eligible cleaning services.<br><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p></div></div></body></html>`;
  return { subject, text, html, unsubscribeUrl };
}

function emailMime(contact, siteUrl) {
  const content = emailContent(contact, siteUrl);
  const from = process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com";
  const boundary = `fall10_${Date.now()}`;
  const raw = [
    `From: ${encodeMimeWord("IMAN Cleaning Service LLC")} <${from}>`,
    `To: ${contact.email}`,
    `Subject: ${encodeMimeWord(content.subject)}`,
    `List-Unsubscribe: <${content.unsubscribeUrl}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=\"UTF-8\"", "", content.text,
    `--${boundary}`, "Content-Type: text/html; charset=\"UTF-8\"", "", content.html,
    `--${boundary}--`, ""
  ].join("\r\n");
  return { raw: base64Url(raw), ...content };
}

function smsContent(contact, siteUrl) {
  return `Hi ${contact.firstName}! 🍂 Welcome fall with a cleaner, cozier space—and 10% off any eligible IMAN cleaning service. Use FALL10 by Dec. 20: ${siteUrl}/book-now.html\n\nOne use per customer. Cannot combine offers. Reply STOP to opt out.`;
}

async function loadRecipients() {
  const [quotes, contacts, conversations, suppressions] = await Promise.all([listCrmQuotes(), listManualContacts(), listCrmConversations(), listEmailSuppressions()]);
  return eligibleRecipients({ quotes, contacts, conversations, suppressions });
}

async function sentHashes(drive, parentFolderId, channel) {
  const parent = String(parentFolderId || "").replace(/'/g, "\\'");
  const result = await drive.files.list({
    q: [`'${parent}' in parents`, "trashed = false", "appProperties has { key='iman_record_type' and value='marketing_campaign_delivery' }", `appProperties has { key='campaign_id' and value='${CAMPAIGN_ID}' }`, `appProperties has { key='channel' and value='${channel}' }`, "appProperties has { key='delivery_status' and value='sent' }"].join(" and "),
    fields: "files(id,appProperties)", pageSize: 500
  });
  return new Set((result.data.files || []).map((file) => file.appProperties?.recipient_hash).filter(Boolean));
}

async function saveDelivery(drive, parentFolderId, record) {
  const body = JSON.stringify(record, null, 2);
  const requestBody = {
    name: `${CAMPAIGN_ID}-${record.channel}-${record.recipientHash.slice(0, 12)}.json`,
    parents: [parentFolderId], mimeType: "application/json",
    appProperties: { iman_record_type: "marketing_campaign_delivery", campaign_id: CAMPAIGN_ID, channel: record.channel, recipient_hash: record.recipientHash, delivery_status: record.status }
  };
  const created = await drive.files.create({ requestBody, media: { mimeType: "application/json", body }, fields: "id" });
  return created.data.id;
}

async function campaignPreview() {
  const recipients = await loadRecipients();
  const { drive, config } = getGoogleClients();
  const [emailSent, smsSent] = await Promise.all([sentHashes(drive, config.parentFolderId, "email"), sentHashes(drive, config.parentFolderId, "sms")]);
  const remainingEmail = recipients.email.filter((item) => !emailSent.has(recipientHash("email", item.email)));
  const remainingSms = recipients.sms.filter((item) => !smsSent.has(recipientHash("sms", item.phone)));
  return { campaignId: CAMPAIGN_ID, name: CAMPAIGN_NAME, eligible: { email: recipients.email.length, sms: recipients.sms.length }, sent: { email: emailSent.size, sms: smsSent.size }, remaining: { email: remainingEmail.length, sms: remainingSms.length } };
}

async function sendCampaignBatch({ channel, confirmation, siteUrl, batchSize = 10 }) {
  if (!["email", "sms"].includes(channel)) throw Object.assign(new Error("Choose email or SMS."), { statusCode: 400 });
  if (confirmation !== `SEND ${CAMPAIGN_ID.toUpperCase()} ${channel.toUpperCase()}`) throw Object.assign(new Error("Campaign confirmation did not match."), { statusCode: 400 });
  const recipients = await loadRecipients();
  const { drive, gmail, config } = getGoogleClients();
  const alreadySent = await sentHashes(drive, config.parentFolderId, channel);
  const key = channel === "email" ? "email" : "phone";
  const pending = recipients[channel].filter((item) => !alreadySent.has(recipientHash(channel, item[key]))).slice(0, Math.max(1, Math.min(10, Number(batchSize) || 10)));
  let sent = 0;
  const failures = [];
  for (const contact of pending) {
    const hash = recipientHash(channel, contact[key]);
    try {
      const delivery = channel === "email"
        ? await gmail.users.messages.send({ userId: "me", requestBody: { raw: emailMime(contact, siteUrl).raw } }).then((result) => ({ status: "sent", messageId: result.data.id || "" }))
        : await sendCustomerSms(contact.phone, smsContent(contact, siteUrl));
      const status = delivery.status === "sent" ? "sent" : "failed";
      await saveDelivery(drive, config.parentFolderId, { campaignId: CAMPAIGN_ID, channel, recipientHash: hash, recipient: contact[key], customerName: contact.name, status, messageId: delivery.messageId || "", error: delivery.error || "", sentAt: new Date().toISOString() });
      if (status === "sent") sent += 1;
      else failures.push({ recipient: contact[key], error: delivery.error || "Delivery failed." });
    } catch (error) {
      failures.push({ recipient: contact[key], error: String(error.message || "Delivery failed.").slice(0, 250) });
      await saveDelivery(drive, config.parentFolderId, { campaignId: CAMPAIGN_ID, channel, recipientHash: hash, recipient: contact[key], customerName: contact.name, status: "failed", error: String(error.message || "Delivery failed.").slice(0, 250), sentAt: new Date().toISOString() });
    }
  }
  const preview = await campaignPreview();
  return { ok: failures.length === 0, attempted: pending.length, sent, failures, preview };
}

module.exports = { campaignPreview, eligibleRecipients, emailContent, sendCampaignBatch, smsContent };
