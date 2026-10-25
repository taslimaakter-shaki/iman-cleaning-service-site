const crypto = require("crypto");
const {
  cleanText,
  createBooking,
  json,
  makeBookingId,
  makeUniqueOrderNumber,
  toZonedIso,
  assertScheduleAvailable,
  readJsonBody
} = require("./_shared");
const { cleanCustomer, validateAndPrice } = require("./_saved-quote");
const { sendCustomerSms } = require("./_notifications");
const { createShortApproval } = require("../quote/_short-approval");
const { trySendFormSubmissionNotification } = require("../_form-notifications");

const OWNER_ALERT_NUMBER = "+19298034053";
const RUSH_FEE_CENTS = 10000;
const STATUSES = new Set(["New request", "Payment pending", "Unavailable", "Booked"]);

function siteUrl(request) {
  const configured = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return `${request.headers["x-forwarded-proto"] || "https"}://${request.headers["x-forwarded-host"] || request.headers.host}`;
}

function driveJson(data) {
  if (Buffer.isBuffer(data)) return JSON.parse(data.toString("utf8"));
  if (typeof data === "string") return JSON.parse(data);
  return data || {};
}

function recordId() {
  return `SD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function validSavedQuoteUrl(value, request) {
  try {
    const url = new URL(String(value || ""), siteUrl(request));
    if (!url.searchParams.get("quote") || !/\/book-now\.html$/.test(url.pathname)) throw new Error();
    return url.toString();
  } catch {
    throw Object.assign(new Error("A valid saved quote is required for a same-day request."), { statusCode: 400 });
  }
}

async function createRecord(record) {
  const { drive, config } = require("../quote/_shared").getGoogleClients();
  const created = await drive.files.create({
    requestBody: {
      name: `${record.id}-same-day-request.json`,
      parents: [config.parentFolderId],
      mimeType: "application/json",
      appProperties: {
        iman_record_type: "same_day_request",
        same_day_request_id: record.id,
        same_day_status: record.status
      }
    },
    media: { mimeType: "application/json", body: JSON.stringify(record, null, 2) },
    fields: "id,name,createdTime,appProperties"
  });
  return { ...record, driveFileId: created.data.id };
}

async function listFiles() {
  const { drive, config } = require("../quote/_shared").getGoogleClients();
  const parent = String(config.parentFolderId || "").replace(/'/g, "\\'");
  const listed = await drive.files.list({
    q: [`'${parent}' in parents`, "trashed = false", "appProperties has { key='iman_record_type' and value='same_day_request' }"].join(" and "),
    fields: "files(id,name,createdTime,appProperties)",
    orderBy: "createdTime desc",
    pageSize: 500
  });
  return { drive, files: listed.data.files || [] };
}

async function listSameDayRequests() {
  const { drive, files } = await listFiles();
  const records = await Promise.all(files.map(async (file) => {
    const downloaded = await drive.files.get({ fileId: file.id, alt: "media" });
    return { ...driveJson(downloaded.data), driveFileId: file.id };
  }));
  return records.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function findRecord(id) {
  const safe = cleanText(id, 100).replace(/'/g, "\\'");
  const { drive, config } = require("../quote/_shared").getGoogleClients();
  const parent = String(config.parentFolderId || "").replace(/'/g, "\\'");
  const listed = await drive.files.list({
    q: [`'${parent}' in parents`, "trashed = false", "appProperties has { key='iman_record_type' and value='same_day_request' }", `appProperties has { key='same_day_request_id' and value='${safe}' }`].join(" and "),
    fields: "files(id,name,appProperties)",
    pageSize: 1
  });
  const file = listed.data.files?.[0];
  if (!file) throw Object.assign(new Error("Same-day request not found."), { statusCode: 404 });
  const downloaded = await drive.files.get({ fileId: file.id, alt: "media" });
  return { drive, file, record: driveJson(downloaded.data) };
}

async function saveRecord(drive, file, record) {
  await drive.files.update({
    fileId: file.id,
    requestBody: { appProperties: { ...(file.appProperties || {}), same_day_status: record.status } },
    media: { mimeType: "application/json", body: JSON.stringify(record, null, 2) },
    fields: "id,appProperties"
  });
  return record;
}

function newYorkDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function buildUnavailableMessage(record) {
  return `IMAN Cleaning Service: Unfortunately, we’re unavailable for a same-day appointment today. You can use your saved quote to choose another available date and time: ${record.savedQuoteUrl} Questions? Call 929-232-1930. Reply STOP to opt out.`;
}

async function updateSameDayRequest(body, request) {
  const id = cleanText(body.id, 100);
  const action = cleanText(body.action, 30).toLowerCase();
  const found = await findRecord(id);
  const record = found.record;
  const now = new Date().toISOString();

  if (action === 'discount') {
    if (record.status !== 'New request' || record.bookingId) throw Object.assign(new Error('Open the related quote to update its payment-link discount.'), { statusCode: 409 });
    if (body.updatedAt !== record.updatedAt) throw Object.assign(new Error('This request changed. Refresh before saving the discount.'), { statusCode: 409 });
    const { validateDiscount, flatPricing } = require('./_discount');
    const discount = validateDiscount(body.discountCents, body.discountLabel);
    const before = record.quote.priceCents + (record.quote.manualDiscount?.amountCents || 0);
    const pricing = flatPricing(before, 0, discount.amountCents, discount.label, record.quote.taxCents);
    record.discountHistory = [...(record.discountHistory || []), { at: now, previousDiscount: record.quote.manualDiscount || null }];
    record.quote = { ...record.quote, priceCents: pricing.totalCents, price: pricing.totalCents / 100, manualDiscount: { ...pricing, ...discount } };
    record.updatedAt = now;
    return saveRecord(found.drive, found.file, record);
  }

  if (action === "unavailable") {
    const delivery = await sendCustomerSms(record.customer?.phone, buildUnavailableMessage(record));
    record.status = "Unavailable";
    record.updatedAt = now;
    record.customerDelivery = { type: "unavailable", ...delivery, sentAt: now };
    return saveRecord(found.drive, found.file, record);
  }

  if (action !== "approve") throw Object.assign(new Error("Choose approve or unavailable."), { statusCode: 400 });
  const serviceDate = cleanText(body.serviceDate || newYorkDate(), 20);
  const serviceTime = cleanText(body.serviceTime, 30);
  if (!serviceTime) throw Object.assign(new Error("Enter the confirmed start time."), { statusCode: 400 });
  const bookingId = makeBookingId();
  const orderNumber = await makeUniqueOrderNumber();
  const baseCents = Number(record.quote?.priceCents || 0);
  const depositCents = Math.max(1, Math.round(baseCents * 0.25));
  const schedule = toZonedIso(serviceDate, serviceTime);
  const teamHours = Number(record.quote?.teamHours || (record.quote?.manHours && record.quote.manHours / (record.quote.cleanerCount || 2)));
  await assertScheduleAvailable(schedule, teamHours);
  await createBooking({
    id: bookingId,
    status: "New",
    service: record.serviceKey,
    service_label: record.quote?.serviceLabel || "Same-day cleaning",
    schedule,
    schedule_label: `${serviceDate} at ${serviceTime}`,
    bedrooms_label: record.quote?.bedroomsLabel || "",
    bathrooms_label: record.quote?.bathroomsLabel || "",
    sqft: Number(record.eligibility?.squareFootage || 0),
    addons: [],
    client_name: `${record.customer.firstName} ${record.customer.lastName}`.trim(),
    phone: record.customer.phone,
    email: record.customer.email,
    address: record.serviceAddress,
    notes: `Same-day request ${record.id}. Preferred time: ${record.preferredTime}. Flexibility: ${record.flexibility}. ${record.notes || ""}`.trim(),
    estimate: {
      hours: teamHours, teamHours, manHours: record.quote?.manHours,
      cleanerCount: record.quote?.cleanerCount || 2,
      calendarReservation: { state: 'draft' },
      orderNumber,
      low: baseCents / 100 + 100,
      high: baseCents / 100 + 100,
      total: baseCents / 100 + 100,
      pricingMode: record.pricingMode,
      eligibility: record.eligibility,
      sameDayRequestId: record.id,
      manualDiscount: record.quote?.manualDiscount || null,
      customQuotePricing: record.quote?.manualDiscount ? { ...record.quote.manualDiscount, rushFeeCents: RUSH_FEE_CENTS, totalCents: baseCents + RUSH_FEE_CENTS } : null,
      rushFeeCents: RUSH_FEE_CENTS,
      paymentStatus: "deposit_pending",
      payment: {
        paymentType: "same_day_deposit",
        balanceCollection: "after_service",
        status: "deposit_pending",
        totalCents: baseCents + RUSH_FEE_CENTS,
        baseServiceCents: baseCents,
        rushFeeCents: RUSH_FEE_CENTS,
        paidCents: 0,
        depositCents: depositCents + RUSH_FEE_CENTS,
        remainingCents: baseCents - depositCents
      }
    }
  });
  const approval = await createShortApproval({
    quoteId: record.id,
    bookingId,
    customerName: `${record.customer.firstName} ${record.customer.lastName}`.trim(),
    customerEmail: record.customer.email,
    customerPhone: record.customer.phone,
    serviceLocation: record.serviceAddress,
    service: record.quote?.serviceLabel || "Same-day cleaning",
    amountCents: baseCents,
    pricing: record.quote?.manualDiscount ? { ...record.quote.manualDiscount, rushFeeCents: RUSH_FEE_CENTS, totalCents: baseCents + RUSH_FEE_CENTS } : undefined,
    rushFeeCents: RUSH_FEE_CENTS,
    serviceDate,
    serviceTime,
    description: `Same-day appointment. $100 rush fee applies. Request ${record.id}.`,
    agreementUrl: `${siteUrl(request)}/agreement.html`,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 60 * 1000
  });
  const approvalUrl = `${siteUrl(request)}/q/${approval.code}`;
  const dueNowCents = depositCents + RUSH_FEE_CENTS;
  const message = `IMAN Cleaning Service: We can accept your same-day request for ${serviceTime}. Pay $${(dueNowCents / 100).toFixed(2)} now ($100 rush fee plus 25% deposit) within 30 minutes to confirm: ${approvalUrl} Reply STOP to opt out.`;
  const delivery = await sendCustomerSms(record.customer.phone, message);
  record.status = "Payment pending";
  record.updatedAt = now;
  record.bookingId = bookingId;
  record.confirmedServiceDate = serviceDate;
  record.confirmedServiceTime = serviceTime;
  record.approvalUrl = approvalUrl;
  record.approvalExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  record.customerDelivery = { type: "payment_link", ...delivery, sentAt: now };
  return saveRecord(found.drive, found.file, record);
}

async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    const body = await readJsonBody(request);
    if (body.rushFeeAccepted !== true) return json(response, 400, { error: "Please acknowledge the $100 same-day rush fee." });
    const customer = cleanCustomer(body.customer);
    const { eligibility, serviceKey, unitDetails, pkg: originalPackage } = validateAndPrice(body);
    const savedQuoteUrl = validSavedQuoteUrl(body.savedQuoteUrl, request);
    const token = new URL(savedQuoteUrl).searchParams.get('quote');
    const pkg = await require('../crm/_quote-admin').applySavedDiscount(token, originalPackage, body.quoteRevision || '');
    const serviceAddress = cleanText(body.serviceAddress, 400);
    const preferredTime = cleanText(body.preferredTime, 20);
    const flexibility = cleanText(body.flexibility, 80);
    if (!serviceAddress || !preferredTime || !flexibility) return json(response, 400, { error: "Enter the service address, preferred time, and time flexibility." });
    const createdAt = new Date().toISOString();
    const record = await createRecord({
      id: recordId(),
      status: "New request",
      createdAt,
      updatedAt: createdAt,
      customer,
      serviceAddress,
      preferredTime,
      flexibility,
      notes: cleanText(body.notes, 1200),
      savedQuoteUrl,
      serviceKey,
      pricingMode: body.pricingMode,
      eligibility,
      unitDetails,
      rushFeeCents: RUSH_FEE_CENTS,
      rushFeeAccepted: true,
      quote: { serviceLabel: pkg.serviceLabel, priceCents: pkg.priceCents, price: pkg.price, teamHours: pkg.teamHours, manHours: pkg.manHours,
        cleanerCount: pkg.cleanerCount, taxCents: pkg.taxCents, manualDiscount: pkg.manualDiscount || null }
    });
    const ownerDelivery = await trySendFormSubmissionNotification({
      source: "Same-day appointment request",
      eventLabel: "submitted",
      recipientOverride: [OWNER_ALERT_NUMBER],
      recordId: record.id,
      fields: {
        "Customer Name": `${customer.firstName} ${customer.lastName}`,
        "Phone Number": customer.phone,
        "Email Address": customer.email,
        "Service": pkg.serviceLabel,
        "Service Address": serviceAddress,
        "Notes": body.notes
      },
      summaryLines: [
        `Preferred today: ${preferredTime} (${flexibility})`,
        `Base quote: $${(pkg.priceCents / 100).toFixed(2)}; rush fee: $100`,
        "Open the Same-day Requests section in CRM to approve or mark unavailable."
      ]
    });
    return json(response, 201, { ok: true, id: record.id, ownerAlert: ownerDelivery.status });
  } catch (error) {
    return json(response, error.statusCode || 500, { error: error.message || "Same-day request could not be submitted." });
  }
}

module.exports = handler;
module.exports.listSameDayRequests = listSameDayRequests;
module.exports.updateSameDayRequest = updateSameDayRequest;
module.exports._test = { buildUnavailableMessage, validSavedQuoteUrl, RUSH_FEE_CENTS, STATUSES };
