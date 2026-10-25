const Busboy = require("busboy");
const { Readable } = require("stream");
const {
  cleanText,
  driveWebViewLink,
  getGoogleClients,
  json,
  readJsonBody,
  signQuotePayload,
  verifyQuoteToken
} = require("./_shared");
const { trySendFormSubmissionNotification } = require("../_form-notifications");

const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/jpg", "video/mp4", "video/quicktime", "video/webm"]);
const LINK_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const SUBMISSION_THANK_YOU = "Thank you for submitting a quote request to IMAN Cleaning Service! A member of our team will review your request and reach out to you shortly.";

function normalizePhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shortError(value) {
  return String(value || "Delivery failed.").replace(/[\r\n]+/g, " ").trim().slice(0, 240);
}

function base64Url(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function customerName(record = {}) {
  const fields = record.formFields || {};
  return cleanText(`${fields["First Name"] || ""} ${fields["Last Name"] || ""}`, "Customer");
}

function siteUrl(request) {
  const configured = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configured) return String(configured).replace(/\/$/, "");
  const proto = request?.headers?.["x-forwarded-proto"] || "https";
  const host = request?.headers?.["x-forwarded-host"] || request?.headers?.host || "www.imancleaningservice.com";
  return `${proto}://${host}`;
}

function buildPhotoUploadUrl(record, baseUrl = "https://www.imancleaningservice.com", expiresAt = Date.now() + LINK_LIFETIME_MS) {
  const token = signQuotePayload({
    purpose: "custom_quote_photo_upload",
    quoteId: record.quoteId,
    folderId: record.folderId,
    expiresAt
  });
  return {
    expiresAt,
    url: `${String(baseUrl).replace(/\/$/, "")}/quote-photo-upload.html?token=${encodeURIComponent(token)}`
  };
}

function verifyPhotoUploadToken(token) {
  const payload = verifyQuoteToken(token);
  if (payload.purpose !== "custom_quote_photo_upload" || !payload.quoteId || !payload.folderId) {
    throw Object.assign(new Error("Invalid photo-upload link."), { statusCode: 400 });
  }
  return payload;
}

async function twilioMessage(to, body) {
  const accountSid = cleanText(process.env.TWILIO_ACCOUNT_SID);
  const authToken = cleanText(process.env.TWILIO_AUTH_TOKEN);
  const from = cleanText(process.env.TWILIO_FROM_NUMBER);
  const normalizedTo = normalizePhoneNumber(to);
  if (!accountSid || !authToken || !from || !normalizedTo) return { status: "not_configured", messageId: "" };
  const encoded = new URLSearchParams({ From: from, To: normalizedTo, Body: body });
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
  if (!response.ok) throw Object.assign(new Error(data?.message || "Photo-upload text could not be sent."), { statusCode: response.status });
  return { status: "sent", messageId: cleanText(data.sid) };
}

async function twilioApi(path, options = {}) {
  const accountSid = cleanText(process.env.TWILIO_ACCOUNT_SID);
  const authToken = cleanText(process.env.TWILIO_AUTH_TOKEN);
  if (!accountSid || !authToken) throw new Error("Twilio is not configured.");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw Object.assign(new Error(data?.message || "Twilio request failed."), { statusCode: response.status });
  return data;
}

async function twilioMessagingApi(path, options = {}) {
  const accountSid = cleanText(process.env.TWILIO_ACCOUNT_SID);
  const authToken = cleanText(process.env.TWILIO_AUTH_TOKEN);
  if (!accountSid || !authToken) throw new Error("Twilio is not configured.");
  const response = await fetch(`https://messaging.twilio.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw Object.assign(new Error(data?.message || "Twilio Messaging Service request failed."), { statusCode: response.status });
  return data;
}

let messagingServicePromise;

async function resolveMessagingServiceSid() {
  const configured = cleanText(process.env.TWILIO_MESSAGING_SERVICE_SID);
  if (configured) return configured;
  const from = normalizePhoneNumber(process.env.TWILIO_FROM_NUMBER);
  if (!from) return "";
  const list = await twilioApi(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from)}`);
  const phoneRecord = list.incoming_phone_numbers?.[0];
  if (!phoneRecord?.sid) return "";

  // IncomingPhoneNumbers does not reliably expose the Messaging Service that
  // owns a number. Search the services' sender pools before creating one. A
  // serverless cold start must not try to attach the same number to a new
  // service every time reminders are scheduled.
  const servicesResult = await twilioMessagingApi("/Services?PageSize=50");
  const services = Array.isArray(servicesResult.services) ? servicesResult.services : [];
  const senderPools = await Promise.all(services.map(async (service) => {
    const serviceSid = cleanText(service.sid);
    if (!serviceSid) return { serviceSid: "", senders: [] };
    try {
      const result = await twilioMessagingApi(`/Services/${encodeURIComponent(serviceSid)}/PhoneNumbers?PageSize=100`);
      return { serviceSid, senders: Array.isArray(result.phone_numbers) ? result.phone_numbers : [] };
    } catch (_) {
      return { serviceSid, senders: [] };
    }
  }));
  const attached = senderPools.find(({ senders }) => senders.some((sender) => (
    cleanText(sender.sid) === cleanText(phoneRecord.sid)
    || cleanText(sender.phone_number_sid) === cleanText(phoneRecord.sid)
    || normalizePhoneNumber(sender.phone_number) === from
  )));
  if (attached?.serviceSid) return attached.serviceSid;

  const encodedService = new URLSearchParams({ FriendlyName: "IMAN Customer Reminders" });
  const service = await twilioMessagingApi("/Services", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: encodedService.toString()
  });
  const serviceSid = cleanText(service.sid);
  if (!serviceSid) throw new Error("Twilio did not create the reminder Messaging Service.");
  const encodedSender = new URLSearchParams({ PhoneNumberSid: phoneRecord.sid });
  try {
    await twilioMessagingApi(`/Services/${encodeURIComponent(serviceSid)}/PhoneNumbers`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: encodedSender.toString()
    });
  } catch (error) {
    // Another concurrent request may have attached the number after the search.
    const refreshed = await twilioMessagingApi("/Services?PageSize=50");
    const refreshedServices = Array.isArray(refreshed.services) ? refreshed.services : [];
    for (const existingService of refreshedServices) {
      const existingSid = cleanText(existingService.sid);
      if (!existingSid) continue;
      try {
        const result = await twilioMessagingApi(`/Services/${encodeURIComponent(existingSid)}/PhoneNumbers?PageSize=100`);
        const senders = Array.isArray(result.phone_numbers) ? result.phone_numbers : [];
        if (senders.some((sender) => cleanText(sender.sid) === cleanText(phoneRecord.sid)
          || cleanText(sender.phone_number_sid) === cleanText(phoneRecord.sid)
          || normalizePhoneNumber(sender.phone_number) === from)) return existingSid;
      } catch (_) {}
    }
    throw error;
  }
  return serviceSid;
}

function messagingServiceSid() {
  if (!messagingServicePromise) {
    messagingServicePromise = resolveMessagingServiceSid().catch((error) => {
      messagingServicePromise = null;
      throw error;
    });
  }
  return messagingServicePromise;
}

async function scheduleSms(to, body, sendAt) {
  const normalizedTo = normalizePhoneNumber(to);
  const serviceSid = await messagingServiceSid();
  if (!normalizedTo || !serviceSid) return { status: "not_configured", messageId: "" };
  const encoded = new URLSearchParams({
    MessagingServiceSid: serviceSid,
    To: normalizedTo,
    Body: body,
    ScheduleType: "fixed",
    SendAt: sendAt.toISOString()
  });
  const data = await twilioApi("/Messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: encoded.toString()
  });
  return { status: "scheduled", messageId: cleanText(data.sid), sendAt: sendAt.toISOString() };
}

async function cancelScheduledMessage(messageId) {
  if (!cleanText(messageId)) return { status: "not_scheduled" };
  const encoded = new URLSearchParams({ Status: "canceled" });
  try {
    const current = await twilioApi(`/Messages/${encodeURIComponent(messageId)}.json`, { method: "GET" });
    if (["canceled", "sent", "delivered", "undelivered", "failed"].includes(current.status)) return { status: current.status };
    const data = await twilioApi(`/Messages/${encodeURIComponent(messageId)}.json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: encoded.toString()
    });
    return { status: cleanText(data.status, "canceled") };
  } catch (error) {
    return { status: "error", error: shortError(error.message) };
  }
}

async function scheduledMessageStatus(messageId) {
  if (!cleanText(messageId)) return { status: "not_scheduled", messageId: "" };
  try {
    const data = await twilioApi(`/Messages/${encodeURIComponent(messageId)}.json`, { method: "GET" });
    return {
      status: cleanText(data.status, "unknown"),
      messageId: cleanText(data.sid || messageId),
      errorCode: cleanText(data.error_code),
      error: data.error_message ? shortError(data.error_message) : ""
    };
  } catch (error) {
    return { status: "status_unavailable", messageId: cleanText(messageId), error: shortError(error.message) };
  }
}

async function refreshPhotoUploadReminders(record = {}, {
  statusLookup = scheduledMessageStatus,
  sendEmail = customerEmail,
  notify = trySendFormSubmissionNotification,
  now = new Date()
} = {}) {
  const reminders = Array.isArray(record.photoUpload?.scheduledReminders) ? record.photoUpload.scheduledReminders : [];
  const refreshedAt = now.toISOString();
  const refreshed = await Promise.all(reminders.map(async (reminder) => {
    const live = await statusLookup(reminder.messageId);
    const deliveredAt = live.status === "delivered" ? (reminder.deliveredAt || refreshedAt) : (reminder.deliveredAt || "");
    const next = {
      ...reminder,
      ...live,
      deliveredAt,
      lastCheckedAt: refreshedAt
    };
    const finalFailure = ["failed", "undelivered"].includes(live.status);
    if (finalFailure && reminder.fallbackEmail?.status !== "sent") {
      const fields = record.formFields || {};
      const email = fields.Email || fields["Email Address"];
      const uploadUrl = cleanText(record.photoUpload?.uploadUrl);
      const finalReminder = reminder.stage === "24_hours_final";
      const subject = finalReminder
        ? "Final reminder: upload files for your cleaning quote"
        : "Reminder: upload files for your cleaning quote";
      const intro = finalReminder
        ? "This is your final reminder to upload photos or short videos for your custom quote."
        : "This is a reminder to upload photos or short videos for your custom quote.";
      const text = [`Hi ${customerName(record)},`, "", intro, uploadUrl, "", `Quote reference: ${record.quoteId}`, "", "Questions? Call 929-232-1930."].join("\n");
      const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#243c40;line-height:1.55"><p>Hi ${escapeHtml(customerName(record))},</p><p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(uploadUrl)}" style="display:inline-block;padding:13px 20px;background:#0b6474;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold">Upload photos or videos</a></p><p>Quote reference: <strong>${escapeHtml(record.quoteId)}</strong></p><p>Questions? Call 929-232-1930.</p></body></html>`;
      try {
        next.fallbackEmail = await sendEmail(email, subject, text, html);
        next.fallbackEmail.sentAt = refreshedAt;
      } catch (error) {
        next.fallbackEmail = { status: "error", error: shortError(error.message), attemptedAt: refreshedAt };
      }
      if (!reminder.failureNotifiedAt) {
        await notify({
          source: "Photo upload reminder",
          eventLabel: "delivery failed",
          recordId: record.quoteId,
          fields: record.formFields,
          summaryLines: [`${reminder.stage}: ${live.status}`, live.error || "Twilio did not provide a failure explanation."]
        }).catch(() => {});
        next.failureNotifiedAt = refreshedAt;
      }
    }
    return next;
  }));
  return refreshed;
}

async function cancelPhotoUploadReminders(record = {}) {
  const reminders = Array.isArray(record.photoUpload?.scheduledReminders) ? record.photoUpload.scheduledReminders : [];
  return Promise.all(reminders.map(async (reminder) => ({
    stage: reminder.stage,
    messageId: reminder.messageId || "",
    ...(await cancelScheduledMessage(reminder.messageId))
  })));
}

async function customerEmail(to, subject, text, html, requestOptions) {
  if (!cleanText(to)) return { status: "not_configured", messageId: "" };
  const { gmail } = getGoogleClients();
  const from = process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com";
  const raw = [
    `From: Iman Cleaning Service LLC <${from}>`,
    `To: ${cleanText(to)}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: multipart/alternative; boundary=iman_photo_upload",
    "",
    "--iman_photo_upload",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text,
    "--iman_photo_upload",
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
    "--iman_photo_upload--",
    ""
  ].join("\r\n");
  const sent = await gmail.users.messages.send({ userId: "me", requestBody: { raw: base64Url(raw) } }, requestOptions);
  return { status: "sent", messageId: cleanText(sent.data.id) };
}

async function settleDelivery(promises) {
  const results = await Promise.allSettled(promises);
  return results.map((result) => result.status === "fulfilled"
    ? result.value
    : { status: "error", error: shortError(result.reason?.message) });
}

function submissionReceiptContent(record = {}) {
  const name = customerName(record);
  const quoteId = cleanText(record.quoteId);
  if (record.formFields?.["Request Type"] === "Commercial walkthrough") {
    // Submission acknowledges the request only. A preferred visit is not a confirmed appointment.
    const thankYou = "Thank you for your walkthrough request.";
    const nextStep = "A member of our team will reach out shortly to discuss your space and confirm a date and time before we visit.";
    const contact = ["IMAN Cleaning Service LLC", "Phone: (929) 232-1930", "Email: info@imancleaningservice.com", "Website: https://www.imancleaningservice.com"];
    const subject = "Thank you for your walkthrough request | IMAN Cleaning Service";
    const sms = [thankYou, nextStep, "", ...contact, "Reply STOP to opt out."].join("\n");
    const text = [`Hi ${name},`, "", thankYou, nextStep, "", `Request reference: ${quoteId}`, "", ...contact].join("\n");
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#243c40;line-height:1.55"><h1 style="font-size:22px;color:#073f49">${escapeHtml(thankYou)}</h1><p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(nextStep)}</p><p>Request reference: <strong>${escapeHtml(quoteId)}</strong></p><p><strong>IMAN Cleaning Service LLC</strong><br>Phone: <a href="tel:+19292321930">(929) 232-1930</a><br>Email: <a href="mailto:info@imancleaningservice.com">info@imancleaningservice.com</a><br>Website: <a href="https://www.imancleaningservice.com">www.imancleaningservice.com</a></p></body></html>`;
    return { subject, sms, text, html };
  }
  const disclaimer = "This is a quote request, not a confirmed appointment.";
  const subject = "We received your quote request | IMAN Cleaning Service";
  const sms = `${SUBMISSION_THANK_YOU}\n${disclaimer}\nReply STOP to opt out.`;
  const text = [
    `Hi ${name},`, "", SUBMISSION_THANK_YOU, "", disclaimer,
    `Quote reference: ${quoteId}`, "",
    "If you have any questions, reply to this email or call (929) 232-1930.",
    "", "Thank you,", "IMAN Cleaning Service LLC"
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#243c40;line-height:1.55"><h1 style="font-size:24px;color:#073f49">We received your quote request</h1><p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(SUBMISSION_THANK_YOU)}</p><p>${escapeHtml(disclaimer)}</p><p>Quote reference: <strong>${escapeHtml(quoteId)}</strong></p><p>If you have any questions, reply to this email or call <a href="tel:+19292321930">(929) 232-1930</a>.</p><p>Thank you,<br>IMAN Cleaning Service LLC</p></body></html>`;
  return { subject, sms, text, html };
}

async function sendQuoteSubmissionReceipt(record) {
  const fields = record.formFields || {};
  const message = submissionReceiptContent(record);
  const email = String(fields.Email || fields["Email Address"] || "").trim();
  const [smsDelivery, emailDelivery] = await settleDelivery([
    twilioMessage(fields.Phone || fields["Phone Number"], message.sms),
    /^[^@\s<>;,]+@[^@\s<>;,]+\.[^@\s<>;,]+$/.test(email)
      ? customerEmail(email, message.subject, message.text, message.html)
      : Promise.resolve({ status: "skipped", messageId: "", error: "A valid customer email is missing." })
  ]);
  return { smsDelivery, emailDelivery };
}

function photoUploadReminderMessages(uploadUrl) {
  return {
    reminder12: [
      "IMAN Cleaning Service: Reminder—please upload photos or short videos for your custom quote so we can start reviewing your request:",
      uploadUrl,
      "Questions? Call 929-232-1930. Reply STOP to opt out."
    ].join("\n"),
    reminder24: [
      "IMAN Cleaning Service: Final reminder—please upload photos or short videos so we can review your custom quote request:",
      uploadUrl,
      "Questions? Call 929-232-1930. Reply STOP to opt out."
    ].join("\n")
  };
}

async function schedulePhotoUploadReminders({ record, now = new Date() }) {
  const photoUpload = record.photoUpload || {};
  const uploadUrl = cleanText(photoUpload.uploadUrl);
  const linkExpiresAt = Date.parse(photoUpload.linkExpiresAt || "");
  const nowTime = now.getTime();
  if (!uploadUrl) {
    throw Object.assign(new Error("This quote does not have an existing photo-upload link."), { statusCode: 409 });
  }
  if (!Number.isFinite(linkExpiresAt) || linkExpiresAt <= nowTime + 24 * 60 * 60 * 1000) {
    throw Object.assign(new Error("The existing photo-upload link expires too soon. Resend the upload link instead."), { statusCode: 409 });
  }
  if (photoUpload.status === "Photos received" || Number(photoUpload.photoCount || record.photoCount || 0) > 0) {
    throw Object.assign(new Error("Photos have already been received for this quote."), { statusCode: 409 });
  }
  const fields = record.formFields || {};
  const phone = fields.Phone || fields["Phone Number"];
  const { reminder12, reminder24 } = photoUploadReminderMessages(uploadUrl);
  const scheduled = await settleDelivery([
    scheduleSms(phone, reminder12, new Date(nowTime + 12 * 60 * 60 * 1000)),
    scheduleSms(phone, reminder24, new Date(nowTime + 24 * 60 * 60 * 1000))
  ]);
  return [
    { stage: "12_hours", ...scheduled[0] },
    { stage: "24_hours_final", ...scheduled[1] }
  ];
}

async function sendPhotoUploadRequest({ record, baseUrl, reminderNumber = 0, submissionReceipt = false }) {
  const link = buildPhotoUploadUrl(record, baseUrl);
  const name = customerName(record);
  const fields = record.formFields || {};
  const isSubmissionReceipt = submissionReceipt && !reminderNumber;
  const reminderIntro = reminderNumber ? "This is a reminder about your custom quote request." : isSubmissionReceipt ? SUBMISSION_THANK_YOU : "We received your custom quote request.";
  const sms = [
    "IMAN Cleaning Service:",
    reminderIntro,
    "Please upload clear photos or short videos of the areas you would like cleaned so we can prepare an accurate quote:",
    link.url,
    "Questions? Call 929-232-1930.",
    "Reply STOP to opt out."
  ].join("\n");
  const emailText = [
    `Hi ${name},`, "", reminderIntro,
    "Please upload clear photos or short videos of the areas you would like cleaned so we can prepare an accurate quote:",
    link.url, "", `Quote reference: ${record.quoteId}`, "", "Questions? Call 929-232-1930."
  ].join("\n");
  const emailHtml = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#243c40;line-height:1.55"><p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(reminderIntro)}</p><p>Please upload clear photos or short videos of the areas you would like cleaned so we can prepare an accurate quote.</p><p><a href="${escapeHtml(link.url)}" style="display:inline-block;padding:13px 20px;background:#0b6474;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold">Upload photos or videos</a></p><p>Quote reference: <strong>${escapeHtml(record.quoteId)}</strong></p><p>Questions? Call 929-232-1930.</p></body></html>`;
  const [smsDelivery, emailDelivery] = await settleDelivery([
    twilioMessage(fields.Phone || fields["Phone Number"], sms),
    customerEmail(fields.Email || fields["Email Address"], reminderNumber ? "Reminder: upload files for your cleaning quote" : isSubmissionReceipt ? "Quote request received - upload photos for your quote" : "Upload photos or videos for your cleaning quote", emailText, emailHtml)
  ]);
  let scheduledReminders = [];
  if (!reminderNumber) {
    const phone = fields.Phone || fields["Phone Number"];
    const { reminder12, reminder24 } = photoUploadReminderMessages(link.url);
    const scheduled = await settleDelivery([
      scheduleSms(phone, reminder12, new Date(Date.now() + 12 * 60 * 60 * 1000)),
      scheduleSms(phone, reminder24, new Date(Date.now() + 24 * 60 * 60 * 1000))
    ]);
    scheduledReminders = [
      { stage: "12_hours", ...scheduled[0] },
      { stage: "24_hours_final", ...scheduled[1] }
    ];
  }
  return { link, smsDelivery, emailDelivery, scheduledReminders };
}

async function sendPhotoUploadConfirmation(record, photoCount) {
  const name = customerName(record);
  const fields = record.formFields || {};
  const sms = `IMAN Cleaning Service: We received ${photoCount} file${photoCount === 1 ? "" : "s"} for quote ${record.quoteId}. Our team will review them and contact you about your custom quote. Questions? Call 929-232-1930. Reply STOP to opt out.`;
  const text = `Hi ${name},\n\nWe received ${photoCount} file${photoCount === 1 ? "" : "s"} for quote ${record.quoteId}. Our team will review them and contact you about your custom quote.\n\nQuestions? Call 929-232-1930.`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#243c40;line-height:1.55"><p>Hi ${escapeHtml(name)},</p><p>We received <strong>${photoCount} file${photoCount === 1 ? "" : "s"}</strong> for quote <strong>${escapeHtml(record.quoteId)}</strong>.</p><p>Our team will review them and contact you about your custom quote.</p><p>Questions? Call 929-232-1930.</p></body></html>`;
  return settleDelivery([
    twilioMessage(fields.Phone || fields["Phone Number"], sms),
    customerEmail(fields.Email || fields["Email Address"], "Your cleaning files were received", text, html)
  ]);
}

async function findCustomQuoteRecord(drive, quoteId) {
  const safeId = String(quoteId || "").replace(/'/g, "\\'");
  const result = await drive.files.list({
    q: ["trashed = false", "appProperties has { key='iman_record_type' and value='custom_quote' }", `appProperties has { key='quote_id' and value='${safeId}' }`].join(" and "),
    fields: "files(id,name)",
    pageSize: 2
  });
  const file = result.data.files?.[0];
  if (!file) throw Object.assign(new Error("Quote request was not found."), { statusCode: 404 });
  const downloaded = await drive.files.get({ fileId: file.id, alt: "media" });
  const record = Buffer.isBuffer(downloaded.data) ? JSON.parse(downloaded.data.toString("utf8")) : (typeof downloaded.data === "string" ? JSON.parse(downloaded.data) : downloaded.data);
  if (record.crmQuote?.deletedAt) throw Object.assign(new Error("This quote is no longer available."), { statusCode: 410 });
  return { fileId: file.id, record };
}

async function saveCustomQuoteRecord(drive, fileId, record) {
  const response = await drive.files.get({ fileId, alt: "media" });
  const latest = Buffer.isBuffer(response.data) ? JSON.parse(response.data.toString("utf8")) : typeof response.data === "string" ? JSON.parse(response.data) : response.data;
  if (latest?.crmQuote?.deletedAt) throw Object.assign(new Error("This quote is no longer available."), { statusCode: 410 });
  if (latest?.crmQuote?.updating || (latest?.crmQuote?.revision || "") !== (record.crmQuote?.revision || "")) throw Object.assign(new Error("This quote was updated. Please refresh before trying again."), { statusCode: 409 });
  await drive.files.update({
    fileId,
    media: { mimeType: "application/json", body: JSON.stringify(record, null, 2) }
  });
}

function parseMultipart(request) {
  return new Promise((resolve, reject) => {
    let upload = null;
    let totalBytes = 0;
    const busboy = Busboy({ headers: request.headers, limits: { fileSize: MAX_MEDIA_BYTES, files: 1, fields: 4 } });
    busboy.on("file", (name, file, info) => {
      const chunks = [];
      file.on("data", (chunk) => { totalBytes += chunk.length; chunks.push(chunk); });
      file.on("limit", () => reject(Object.assign(new Error("The uploaded photo or video is too large."), { statusCode: 413 })));
      file.on("end", () => { upload = { filename: info.filename || "quote-photo.jpg", mimeType: info.mimeType || "image/jpeg", buffer: Buffer.concat(chunks) }; });
    });
    busboy.on("error", reject);
    busboy.on("finish", () => {
      if (!upload?.buffer?.length) return reject(Object.assign(new Error("A photo or video file is required."), { statusCode: 400 }));
      if (totalBytes > MAX_MEDIA_BYTES) return reject(Object.assign(new Error("The uploaded photo or video is too large."), { statusCode: 413 }));
      resolve(upload);
    });
    request.pipe(busboy);
  });
}

function requestToken(request) {
  if (request.query?.token) return String(request.query.token);
  const url = new URL(request.url || "", "https://www.imancleaningservice.com");
  return url.searchParams.get("token") || "";
}

async function handler(request, response) {
  try {
    const token = requestToken(request);
    const payload = verifyPhotoUploadToken(token);
    const { drive } = getGoogleClients();
    const found = await findCustomQuoteRecord(drive, payload.quoteId);
    if (found.record.folderId !== payload.folderId) throw Object.assign(new Error("Invalid photo-upload link."), { statusCode: 400 });

    if (request.method === "GET") {
      return json(response, 200, {
        quoteId: found.record.quoteId,
        customerName: customerName(found.record),
        status: found.record.photoUpload?.status || "Awaiting photos",
        photoCount: Number(found.record.photoUpload?.photoCount || found.record.photoCount || 0),
        maxPhotos: 100
      });
    }

    if (request.method === "POST") {
      const upload = await parseMultipart(request);
      if (!ALLOWED_MEDIA_TYPES.has(String(upload.mimeType || "").toLowerCase())) return json(response, 400, { error: "Upload a JPEG photo or an MP4, MOV, or WebM video." });
      const index = Math.max(1, Number(request.query?.index || 1));
      const safeName = upload.filename.replace(/[^\w.\- ]+/g, "").trim() || "photo.jpg";
      const created = await drive.files.create({
        requestBody: { name: `${payload.quoteId}-later-${String(index).padStart(3, "0")}-${safeName}`, parents: [payload.folderId] },
        media: { mimeType: upload.mimeType, body: Readable.from(upload.buffer) },
        fields: "id,name,webViewLink,size"
      });
      return json(response, 201, {
        id: created.data.id,
        name: created.data.name,
        originalName: upload.filename,
        size: upload.buffer.length,
        mimeType: upload.mimeType,
        webViewLink: created.data.webViewLink || driveWebViewLink(created.data.id)
      });
    }

    if (request.method === "PATCH") {
      const body = await readJsonBody(request, 512 * 1024);
      const photos = Array.isArray(body.photos) ? body.photos.slice(0, 100) : [];
      if (!photos.length) return json(response, 400, { error: "Upload at least one photo or video before submitting." });
      const now = new Date().toISOString();
      const existing = found.record.photoUpload || {};
      const priorPhotos = Array.isArray(existing.photos) ? existing.photos : [];
      const combined = Array.from(new Map([...priorPhotos, ...photos].filter((photo) => photo?.id).map((photo) => [photo.id, photo])).values()).slice(0, 100);
      found.record.photoCount = combined.length;
      found.record.status = "Photos received";
      found.record.photoUpload = { ...existing, status: "Photos received", photoCount: combined.length, photos: combined, receivedAt: now, updatedAt: now };
      found.record.photoUpload.reminderCancellations = await cancelPhotoUploadReminders(found.record);
      await saveCustomQuoteRecord(drive, found.fileId, found.record);
      const confirmation = await sendPhotoUploadConfirmation(found.record, combined.length);
      await trySendFormSubmissionNotification({
        source: "Custom quote photos",
        eventLabel: "received",
        recordId: found.record.quoteId,
        fields: found.record.formFields,
        folderLink: found.record.folderLink,
        summaryLines: [`Uploaded photos: ${combined.length}`]
      });
      return json(response, 200, { ok: true, status: "Photos received", photoCount: combined.length, confirmation });
    }

    return json(response, 405, { error: "Method not allowed." });
  } catch (error) {
    return json(response, error.statusCode || 500, { error: error.message || "Photo upload could not be completed." });
  }
}

module.exports = handler;
module.exports._test = { buildPhotoUploadUrl, normalizePhoneNumber, photoUploadReminderMessages, verifyPhotoUploadToken, submissionReceiptContent };
module.exports.findCustomQuoteRecord = findCustomQuoteRecord;
module.exports.saveCustomQuoteRecord = saveCustomQuoteRecord;
module.exports.sendPhotoUploadRequest = sendPhotoUploadRequest;
module.exports.sendQuoteSubmissionReceipt = sendQuoteSubmissionReceipt;
module.exports.schedulePhotoUploadReminders = schedulePhotoUploadReminders;
module.exports.cancelPhotoUploadReminders = cancelPhotoUploadReminders;
module.exports.refreshPhotoUploadReminders = refreshPhotoUploadReminders;
module.exports.siteUrl = siteUrl;
// Only the authenticated CRM walkthrough action calls this after a durable send claim.
module.exports.sendWalkthroughEmail = (recipient, content) =>
  customerEmail(recipient, content.subject, content.text, content.html, { retry: false, timeout: 15000 });
