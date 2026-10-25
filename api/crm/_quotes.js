const {
  calculateHourlyCleaningQuote,
  calculateResidentialQuoteBundle,
  calculateWindowQuote,
  cleanText,
  listAllBookings
} = require("../booking/_shared");
const crypto = require("crypto");

function driveFolderLink(fileId) {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(fileId)}`;
}

function paidDeposit(booking = {}) {
  const payment = booking.estimate?.payment || {};
  const paid = Number(payment.paidCents || 0);
  return paid > 0 && ["deposit_paid", "paid", "captured", "fully_paid"].includes(String(payment.status || "").toLowerCase());
}

function bookingQuote(booking) {
  return editableQuote({
    id: booking.id,
    orderNumber: booking.estimate?.orderNumber || booking.id,
    type: "Instant quote",
    source: "Online instant checkout",
    createdAt: booking.created_at || "",
    customerName: booking.client_name || "Customer",
    email: booking.email || "",
    phone: booking.phone || "",
    address: booking.address || "",
    service: booking.service_label || booking.service || "Cleaning service",
    amountCents: Number(booking.estimate?.payment?.totalCents || Math.round(Number(booking.estimate?.total || 0) * 100)),
    status: paidDeposit(booking) ? "Booked" : "Awaiting deposit",
    bookingId: booking.id,
    details: booking.notes || ""
  }, booking, "booking");
}

async function listDriveFiles(drive, query) {
  const files = [];
  let pageToken;
  do {
    const result = await drive.files.list({
      q: query,
      fields: "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,webViewLink,appProperties)",
      orderBy: "createdTime desc",
      pageSize: 500,
      ...(pageToken ? { pageToken } : {})
    });
    files.push(...(result.data.files || []));
    pageToken = result.data.nextPageToken || "";
  } while (pageToken);
  return files;
}

function driveJson(data) {
  if (Buffer.isBuffer(data)) return JSON.parse(data.toString("utf8"));
  if (typeof data === "string") return JSON.parse(data);
  return data || {};
}

function instantPrice(record) {
  try {
    const service = cleanText(record.eligibility?.requestedService, 40);
    const units = Array.isArray(record.unitDetails) ? record.unitDetails : [];
    if (service === "organization") throw new Error("Organization Service is no longer available.");
    if (service === "hourly") return calculateHourlyCleaningQuote(units[0]?.hours);
    if (service === "window") return calculateWindowQuote(units[0], record.eligibility?.serviceZip);
    return calculateResidentialQuoteBundle(units, service, record.eligibility);
  } catch {
    return null;
  }
}

function savedQuote(record, file) {
  const basePackage = instantPrice(record);
  const pkg = basePackage ? require('../booking/_discount').applyPackageDiscount(basePackage, record.crmQuote?.fields ? null : record.crmQuote?.manualDiscount) : null;
  const customer = record.customer || {};
  const consent = record.communicationConsent || {};
  return editableQuote({
    id: record.quoteId || file.appProperties?.saved_quote_id || file.id,
    type: "Instant quote",
    source: "Online saved quote",
    createdAt: record.createdAt ? new Date(Number(record.createdAt)).toISOString() : file.createdTime || "",
    customerName: cleanText(`${customer.firstName || ""} ${customer.lastName || ""}`, 160) || "Customer",
    email: customer.email || "",
    phone: customer.phone || "",
    address: record.eligibility?.serviceZip ? `ZIP ${record.eligibility.serviceZip}` : "",
    service: pkg?.serviceLabel || cleanText(record.eligibility?.requestedService, 80) || "Cleaning service",
    amountCents: Number(pkg?.priceCents || 0),
    status: record.expiresAt && Number(record.expiresAt) < Date.now() ? "Expired" : "Quote sent",
    expiresAt: record.expiresAt ? new Date(Number(record.expiresAt)).toISOString() : "",
    details: consent.transactionalSms?.granted
      ? "Secure instant quote sent by email and requested text message."
      : "Secure instant quote sent by email.",
    communicationConsent: {
      capturedAt: consent.capturedAt || "",
      disclosureVersion: consent.version || "",
      transactionalSms: Boolean(consent.transactionalSms?.granted),
      marketingSms: Boolean(consent.marketingSms?.granted),
      marketingEmail: Boolean(customer.email) && consent.marketingEmail?.unsubscribed !== true,
      marketingEmailBasis: consent.marketingEmail?.basis || "can-spam-opt-out"
    }
  }, record, "saved");
}

function field(fields, ...names) {
  for (const name of names) {
    const value = fields?.[name];
    if (value !== undefined && value !== null && String(value).trim()) return cleanText(value, 500);
  }
  return "";
}

function customizedQuote(record, file) {
  if (record.formFields?.["Request Type"] === "Commercial walkthrough") {
    return require("./_walkthroughs").toClient(record);
  }
  const fields = record.formFields || {};
  const createdInCrm = Boolean(record.createdInCrm || record.crmQuote?.createdInCrm);
  const first = field(fields, "First Name", "firstName");
  const last = field(fields, "Last Name", "lastName");
  return editableQuote({
    id: record.quoteId || file.appProperties?.quote_id || file.id,
    type: "Customized quote",
    source: createdInCrm ? "Created in CRM" : "Online custom-quote form",
    createdAt: record.createdAt || file.createdTime || "",
    customerName: cleanText(`${first} ${last}`, 160) || record.customerName || (createdInCrm ? "New custom payment link" : "Customer"),
    email: field(fields, "Email", "Email Address", "email"),
    phone: field(fields, "Phone", "Phone Number", "phone"),
    address: field(fields, "Service Address", "Street Address", "Address", "address") || (field(fields, "ZIP Code") ? `ZIP ${field(fields, "ZIP Code")}` : ""),
    service: field(fields, "Requested Service", "Service Type", "Service", "Cleaning Service", "service", "Service Category") || "Custom cleaning request",
    amountCents: Number(record.amountCents || 0),
    status: record.status || (createdInCrm ? "Draft" : "Submitted"),
    folderLink: record.folderLink || file.webViewLink || "",
    photoCount: Number(record.photoUpload?.photoCount || record.photoCount || 0),
    photoUpload: record.photoUpload || {},
    details: createdInCrm ? "" : Object.entries(fields).slice(0, 80).map(([key, value]) => `${key}: ${cleanText(value, 300)}`).join("\n")
  }, record, "custom");
}

async function createStandaloneCustomQuote() {
  const { getGoogleClients } = require("../quote/_shared");
  const { drive, config } = getGoogleClients();
  const now = new Date().toISOString();
  const quoteId = `CRM-QUOTE-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const record = {
    quoteId,
    createdAt: now,
    createdInCrm: true,
    status: "Draft",
    formFields: {},
    crmQuote: {
      revision: crypto.randomUUID(),
      createdInCrm: true,
      history: []
    }
  };
  const created = await drive.files.create({
    requestBody: {
      name: `${quoteId}-record.json`,
      parents: [config.parentFolderId],
      mimeType: "application/json",
      appProperties: {
        iman_record_type: "custom_quote",
        quote_id: quoteId,
        created_in_crm: "true"
      }
    },
    media: { mimeType: "application/json", body: JSON.stringify(record) },
    fields: "id,name,createdTime,webViewLink,appProperties"
  });
  return customizedQuote(record, {
    id: created.data.id,
    name: created.data.name,
    createdTime: created.data.createdTime || now,
    webViewLink: created.data.webViewLink || "",
    appProperties: created.data.appProperties || { quote_id: quoteId }
  });
}

function editableQuote(quote, record, source) {
  const { version, paid, ready } = require("./_quote-admin");
  const edit = (source === "booking" ? record.estimate?.crmQuote : record.crmQuote) || {};
  const pkg = source === "saved" ? instantPrice(record) : null;
  const awaitingSchedule = Boolean(record.estimate?.awaitingSchedule || record.estimate?.managedQuote?.awaitingSchedule);
  const schedule = source === "booking" && record.schedule && !awaitingSchedule ? new Date(record.schedule) : null;
  const dateParts = schedule && Number.isFinite(schedule.getTime())
    ? Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(schedule).map(p => [p.type, p.value])) : null;
  const defaults = {
    customerName: quote.customerName, email: quote.email, phone: quote.phone, address: quote.address,
    service: quote.service, amountCents: quote.amountCents - Number(record.estimate?.payment?.rushFeeCents || 0),
    rushFeeCents: Number(record.estimate?.payment?.rushFeeCents || 0),
    serviceDate: dateParts ? `${dateParts.year}-${dateParts.month}-${dateParts.day}` : "",
    serviceTime: dateParts ? `${dateParts.hour}:${dateParts.minute}` : "",
    laborHours: Number(record.estimate?.manHours || pkg?.manHours || 4),
    cleanerCount: Number(record.estimate?.cleanerCount || pkg?.cleanerCount || 2),
    details: quote.details || "", serviceDescriptionUrl: String(record.estimate?.serviceDescriptionUrl || ""), packageItems: "", units: [], discountCents: 0, discountLabel: "", internalNotes: "",
    submittedFields: Object.entries(record.formFields || {}).map(([name, value]) => ({ name, value: String(value ?? "") }))
  };
  const fields = { ...defaults, ...(edit.fields || {}) };
  if (source === 'booking' && !edit.fields && record.estimate?.manualDiscount) {
    const discount = record.estimate.manualDiscount;
    fields.discountCents = discount.amountCents;
    fields.discountLabel = discount.label;
    fields.baseAmountCents = fields.amountCents + fields.discountCents;
    fields.pricing = discount;
  }
  if (source === 'saved' && !edit.fields && edit.manualDiscount) {
    fields.discountCents = edit.manualDiscount.amountCents;
    fields.discountLabel = edit.manualDiscount.label;
    fields.baseAmountCents = quote.amountCents + fields.discountCents;
  }
  if (["custom", "legacy"].includes(source) && !edit.fields) {
    const submitted = record.formFields || {};
    fields.laborHours = 0;
    fields.cleanerCount = 0;
    fields.serviceDate = field(submitted, "1st Priority Available Day", "Service Date");
    const time = field(submitted, "1st Priority Start Time", "Start Time");
    const clock = time.match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i);
    fields.serviceTime = clock ? `${String(Number(clock[1]) % 12 + (clock[3].toUpperCase() === "PM" ? 12 : 0)).padStart(2, "0")}:${clock[2]}` : /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "";
    fields.details = field(submitted, "Project Details", "Cleaning Details", "Additional Details") || "";
    if (!field(submitted, "Service Address", "Address", "address") && field(submitted, "Street Address")) {
      fields.address = [field(submitted, "Street Address"), field(submitted, "City"), field(submitted, "State"), field(submitted, "ZIP Code")].filter(Boolean).join(", ");
    }
  }
  return { ...quote,
    ...(edit.fields ? { customerName: fields.customerName, email: fields.email, phone: fields.phone, address: fields.address,
      service: fields.service, amountCents: fields.amountCents + fields.rushFeeCents, details: fields.details,
      status: edit.deletedAt ? "Deleted" : source === "booking" && paid(record) ? "Booked" : "Revised quote" } : {}),
    deletedAt: edit.deletedAt || "", editSource: source, editVersion: version(record), editFields: fields,
    bookingId: edit.bookingId || quote.bookingId || "",
    editLocked: source === "booking" && paid(record),
    approvalUrl: edit.approvalCode ? `https://www.imancleaningservice.com/q/${edit.approvalCode}` : "",
    paymentReady: Boolean(edit.approvalCode && Number(edit.approvalExpiresAt || 0) > Date.now() && ready(fields) && !edit.deletedAt && !edit.updating),
    checkoutFlow: edit.checkoutFlow || "",
    editHistory: (edit.history || []).map(item => ({ at: item.at, action: item.action })),
    originalDetails: quote.details || "",
    instantDiscountOnly: source === 'saved' && !edit.fields,
    discountRevision: edit.revision || ''
  };
}

function legacyFolderQuote(file) {
  const match = String(file.name || "").match(/^(QUOTE-[A-Z0-9-]+)(?:\s+-\s+(.+))?$/i);
  return editableQuote({
    id: match?.[1] || file.id,
    type: "Customized quote",
    source: "Online custom-quote form (legacy)",
    createdAt: file.createdTime || "",
    customerName: match?.[2] || "Customer",
    email: "",
    phone: "",
    address: "",
    service: "Custom cleaning request",
    amountCents: 0,
    status: "Submitted",
    folderLink: file.webViewLink || driveFolderLink(file.id),
    details: "Older customized quote. Open its Google Drive folder for uploaded photos and available records."
  }, require("./_quote-admin").legacyRecord(file), "legacy");
}

async function downloadQuoteFiles(drive, files, converter) {
  const results = [];
  for (let index = 0; index < files.length; index += 10) {
    const batch = files.slice(index, index + 10);
    results.push(...(await Promise.all(batch.map(async (file) => {
      try {
        const downloaded = await drive.files.get({ fileId: file.id, alt: "media" });
        const record = driveJson(downloaded.data);
        const quote = converter(record, file);
        if (quote.walkthrough) {
          try { return await require("./_walkthroughs").hydrate(drive, record); }
          catch { quote.status = "Status unavailable"; quote.walkthrough.error = "The confirmation status could not be loaded."; quote.walkthrough.canConfirm = false; }
        }
        return quote;
      } catch { return null; }
    }))));
  }
  return results;
}

async function listCrmQuotes() {
  const bookingsPromise = listAllBookings().catch(() => []);
  const { getGoogleClients } = require("../quote/_shared");
  const { drive, config } = getGoogleClients();
  const parent = String(config.parentFolderId || "").replace(/'/g, "\\'");
  const savedFilesPromise = listDriveFiles(drive, [
    `'${parent}' in parents`,
    "trashed = false",
    "appProperties has { key='iman_record_type' and value='saved_quote' }"
  ].join(" and "));
  const customFilesPromise = listDriveFiles(drive, [
    `'${parent}' in parents`,
    "trashed = false",
    "appProperties has { key='iman_record_type' and value='custom_quote' }"
  ].join(" and "));
  const legacyFoldersPromise = listDriveFiles(drive, [
    `'${parent}' in parents`,
    "trashed = false",
    "mimeType = 'application/vnd.google-apps.folder'",
    "name contains 'QUOTE-'"
  ].join(" and "));

  const [bookings, savedFiles, customFiles, legacyFolders] = await Promise.all([
    bookingsPromise,
    savedFilesPromise,
    customFilesPromise,
    legacyFoldersPromise
  ]);
  const saved = await downloadQuoteFiles(drive, savedFiles, savedQuote);
  const custom = await downloadQuoteFiles(drive, customFiles, customizedQuote);
  const customIds = new Set(custom.filter(Boolean).map((quote) => quote.id));
  const legacy = legacyFolders.map(legacyFolderQuote).filter((quote) => !customIds.has(quote.id));
  const combined = [...bookings.filter(b => !b.estimate?.managedQuote || b.estimate.managedQuote.source === "booking").map(bookingQuote), ...saved.filter(Boolean), ...custom.filter(Boolean), ...legacy];
  for (const quote of combined) {
    const booking = bookings.find(b => b.id === quote.bookingId || (quote.editSource === 'saved' && b.estimate?.savedQuoteId === quote.id && require('./_quote-admin').paid(b)));
    if (booking && require("./_quote-admin").paid(booking)) { quote.editLocked = true; if (!quote.deletedAt) quote.status = "Booked"; }
  }
  return Array.from(new Map(combined.map((quote) => [quote.id, quote])).values())
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

module.exports = { bookingQuote, createStandaloneCustomQuote, customizedQuote, legacyFolderQuote, listCrmQuotes, savedQuote, editableQuote };
