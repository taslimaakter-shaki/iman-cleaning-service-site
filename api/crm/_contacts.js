const crypto = require("crypto");
const { getGoogleClients } = require("../quote/_shared");

function cleanText(value, maxLength = 1000) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function contactId() {
  return `CONTACT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function sanitize(body = {}, existing = {}) {
  const type = ["monthly_recurring", "past_inactive"].includes(body.customerType) ? body.customerType : (existing.customerType || "past_inactive");
  const smsConsent = body.smsMarketingConsent === true;
  const now = new Date().toISOString();
  return {
    ...existing,
    id: existing.id || contactId(),
    recordType: "crm_manual_contact",
    name: cleanText(body.name, 160),
    email: cleanText(body.email, 240).toLowerCase(),
    phone: cleanText(body.phone, 60),
    address: cleanText(body.address, 300),
    customerType: type,
    lastServiceDate: cleanText(body.lastServiceDate, 30),
    notes: cleanText(body.notes, 1000),
    emailMarketingEligible: body.emailMarketingEligible === true,
    smsMarketingConsent: smsConsent,
    smsConsentSource: smsConsent ? cleanText(body.smsConsentSource, 200) : "",
    smsConsentCapturedAt: smsConsent ? (existing.smsConsentCapturedAt || now) : "",
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function validate(record) {
  if (!record.name) throw Object.assign(new Error("Customer name is required."), { statusCode: 400 });
  if (!record.email && !record.phone) throw Object.assign(new Error("Enter an email address or phone number."), { statusCode: 400 });
  if (record.emailMarketingEligible && !record.email) throw Object.assign(new Error("An email address is required for email marketing."), { statusCode: 400 });
  if (record.smsMarketingConsent && !record.phone) throw Object.assign(new Error("A phone number is required for SMS marketing."), { statusCode: 400 });
  if (record.smsMarketingConsent && !record.smsConsentSource) throw Object.assign(new Error("Record how the customer gave SMS marketing permission."), { statusCode: 400 });
}

function driveJson(data) {
  if (Buffer.isBuffer(data)) return JSON.parse(data.toString("utf8"));
  if (typeof data === "string") return JSON.parse(data);
  return data || {};
}

async function listContactFiles(drive, parentFolderId) {
  const parent = String(parentFolderId || "").replace(/'/g, "\\'");
  const files = [];
  let pageToken;
  do {
    const result = await drive.files.list({
      q: [`'${parent}' in parents`, "trashed = false", "appProperties has { key='iman_record_type' and value='crm_manual_contact' }"].join(" and "),
      fields: "nextPageToken,files(id,name,createdTime,appProperties)",
      pageSize: 500,
      ...(pageToken ? { pageToken } : {})
    });
    files.push(...(result.data.files || []));
    pageToken = result.data.nextPageToken || "";
  } while (pageToken);
  return files;
}

async function listManualContacts() {
  const { drive, config } = getGoogleClients();
  const files = await listContactFiles(drive, config.parentFolderId);
  const contacts = [];
  for (let index = 0; index < files.length; index += 10) {
    const batch = files.slice(index, index + 10);
    const records = await Promise.all(batch.map(async (file) => {
      try {
        const downloaded = await drive.files.get({ fileId: file.id, alt: "media" });
        return { ...driveJson(downloaded.data), driveFileId: file.id };
      } catch { return null; }
    }));
    contacts.push(...records.filter(Boolean));
  }
  return contacts.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

async function createManualContact(body) {
  const record = sanitize(body);
  validate(record);
  const { drive, config } = getGoogleClients();
  const created = await drive.files.create({
    requestBody: {
      name: `${record.id}-${record.name}.json`,
      parents: [config.parentFolderId],
      mimeType: "application/json",
      appProperties: { iman_record_type: "crm_manual_contact", contact_id: record.id }
    },
    media: { mimeType: "application/json", body: JSON.stringify(record, null, 2) },
    fields: "id"
  });
  return { ...record, driveFileId: created.data.id };
}

async function updateManualContact(body) {
  const id = cleanText(body.id, 120);
  if (!id) throw Object.assign(new Error("Contact ID is required."), { statusCode: 400 });
  const contacts = await listManualContacts();
  const existing = contacts.find((contact) => contact.id === id);
  if (!existing) throw Object.assign(new Error("Contact was not found."), { statusCode: 404 });
  const record = sanitize(body, existing);
  delete record.driveFileId;
  validate(record);
  const { drive } = getGoogleClients();
  await drive.files.update({ fileId: existing.driveFileId, media: { mimeType: "application/json", body: JSON.stringify(record, null, 2) } });
  return { ...record, driveFileId: existing.driveFileId };
}

async function deleteManualContact(body = {}) {
  const id = cleanText(body.id, 120);
  if (!id) throw Object.assign(new Error("Contact ID is required."), { statusCode: 400 });
  const contacts = await listManualContacts();
  const existing = contacts.find((contact) => contact.id === id);
  if (!existing) throw Object.assign(new Error("Contact was not found."), { statusCode: 404 });
  const { drive } = getGoogleClients();
  await drive.files.delete({ fileId: existing.driveFileId });
  return { id };
}

function phoneKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

async function confirmManualSmsConsent(body = {}) {
  const source = cleanText(body.smsConsentSource, 200);
  if (!source) throw Object.assign(new Error("A consent source is required."), { statusCode: 400 });
  const contacts = await listManualContacts();
  const conversations = await require("./_conversations").listCrmConversations();
  const optedOut = new Set(conversations
    .filter((conversation) => (
      /opt(?:ed)?[ _-]?out|unsubscribed|blocked/i.test(String(conversation.status || ""))
      || /^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(String(conversation.lastMessage || "").trim())
    ))
    .map((conversation) => phoneKey(conversation.customerContact))
    .filter(Boolean));
  const now = new Date().toISOString();
  const { drive } = getGoogleClients();
  let updated = 0;
  let suppressed = 0;
  let missingPhone = 0;
  for (const contact of contacts) {
    const key = phoneKey(contact.phone);
    if (!key) { missingPhone += 1; continue; }
    if (optedOut.has(key)) { suppressed += 1; continue; }
    const record = {
      ...contact,
      emailMarketingEligible: Boolean(contact.email),
      emailConsentSource: source,
      emailConsentCapturedAt: contact.emailConsentCapturedAt || now,
      smsMarketingConsent: true,
      smsConsentSource: source,
      smsConsentCapturedAt: contact.smsConsentCapturedAt || now,
      updatedAt: now
    };
    delete record.driveFileId;
    await drive.files.update({
      fileId: contact.driveFileId,
      media: { mimeType: "application/json", body: JSON.stringify(record, null, 2) }
    });
    updated += 1;
  }
  return { updated, suppressed, missingPhone };
}

module.exports = { confirmManualSmsConsent, createManualContact, deleteManualContact, listManualContacts, sanitize, updateManualContact, validate };
