const crypto = require("crypto");
const { getGoogleClients } = require("../quote/_shared");
const bookingStore = require("../booking/_shared");

const SOURCE_TYPES = { saved: "saved_quote", custom: "custom_quote" };
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const text = (value, max = 5000) => String(value ?? "").replace(/\0/g, "").trim().slice(0, max);
const quoteId = value => {
  const id = String(value || "");
  if (!/^[\w-]{1,150}$/.test(id)) throw fail("Invalid quote reference.");
  return id;
};
const parse = data => Buffer.isBuffer(data) ? JSON.parse(data.toString("utf8")) : typeof data === "string" ? JSON.parse(data) : data;
const version = record => crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex");

function paid(booking) {
  const payment = booking?.estimate?.payment || {};
  return Number(payment.paidCents || 0) > 0 || /^(deposit_paid|paid|captured|fully_paid)$/.test(payment.status || "");
}

async function load(source, id) {
  quoteId(id);
  if (source === "legacy") {
    try { return await load("custom", id); } catch (error) { if (error.statusCode !== 404) throw error; }
    const { drive, config } = getGoogleClients();
    const parent = String(config.parentFolderId).replace(/'/g, "\\'");
    const listed = await drive.files.list({ q: `'${parent}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder' and name contains '${id}'`, fields: "files(id,name,createdTime,webViewLink)", pageSize: 100 });
    const matches = (listed.data.files || []).filter(f => f.name === id || f.name.startsWith(`${id} - `));
    if (matches.length !== 1) throw fail("Legacy quote not found or ambiguous.", 404);
    const file = matches[0];
    const record = legacyRecord(file);
    return { source, id, drive, config, file, record, state: {}, version: version(record) };
  }
  if (source === "booking") {
    const record = await bookingStore.getBooking(id);
    if (!record) throw fail("Booking quote not found.", 404);
    return { source, id, record, state: record.estimate?.crmQuote || {}, version: version(record) };
  }
  if (!SOURCE_TYPES[source]) throw fail("Invalid quote source.");
  const { drive, config } = getGoogleClients();
  const parent = String(config.parentFolderId).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const property = source === "saved" ? "saved_quote_id" : "quote_id";
  const listed = await drive.files.list({
    q: `'${parent}' in parents and trashed = false and appProperties has { key='iman_record_type' and value='${SOURCE_TYPES[source]}' } and appProperties has { key='${property}' and value='${id}' }`,
    fields: "files(id,createdTime,appProperties)", pageSize: 2
  });
  if (listed.data.files?.length !== 1) throw fail("Quote not found or its reference is ambiguous.", 404);
  const file = listed.data.files[0];
  const record = parse((await drive.files.get({ fileId: file.id, alt: "media" })).data);
  return { source, id, drive, file, record, state: record.crmQuote || {}, version: version(record) };
}

function legacyRecord(file) {
  const match = String(file.name).match(/^(QUOTE-[A-Z0-9-]+)(?:\s+-\s+(.+))?$/i);
  return { quoteId: match?.[1] || file.id, createdAt: file.createdTime || "", customerName: match?.[2] || "Customer", folderLink: file.webViewLink || `https://drive.google.com/drive/folders/${file.id}`, formFields: {} };
}

async function persist(found, state, { applyFields = false } = {}) {
  // Reload before writing so reminder/payment metadata is not replaced with an older snapshot.
  const latest = await load(found.source, found.id);
  if ((latest.state.revision || "") !== (found.state.revision || "")) throw fail("This quote changed elsewhere. Refresh and try again.", 409);
  // Two saves may share a millisecond; applying an edit must not depend on its timestamp.
  const applyingEdit = applyFields && !state.updating && state.fields;
  if (latest.source === "legacy") {
    await found.drive.files.create({ requestBody: { name: `${found.id}-record.json`, parents: [found.config.parentFolderId], mimeType: "application/json", appProperties: { iman_record_type: "custom_quote", quote_id: found.id } }, media: { mimeType: "application/json", body: JSON.stringify({ ...latest.record, crmQuote: state }) }, fields: "id" });
    return load("custom", found.id);
  } else if (found.source === "booking") {
    if (applyingEdit) {
      if (paid(latest.record)) throw fail("Payment was received while this quote was being edited. Refresh the quote.", 409);
      const changes = bookingChanges(state.fields, latest.record, { source: found.source, id: found.id, revision: state.revision });
      await bookingStore.updateBooking(found.id, { ...changes, estimate: { ...changes.estimate, crmQuote: state } });
    } else await bookingStore.updateBookingEstimate(found.id, { ...latest.record.estimate, crmQuote: state });
  } else {
    let record = { ...latest.record, crmQuote: state };
    if (applyingEdit && found.source === "custom") {
      const f = state.fields;
      const parts = f.customerName.split(/\s+/);
      const fields = Object.fromEntries(f.submittedFields.map(item => [item.name, item.value]));
      Object.assign(fields, { "First Name": parts[0], "Last Name": parts.slice(1).join(" "), Email: f.email, "Phone Number": f.phone, "Service Address": f.address, "Requested Service": f.service });
      for (const key of ["Email Address", "email"]) if (key in fields) fields[key] = f.email;
      for (const key of ["Phone", "phone"]) if (key in fields) fields[key] = f.phone;
      record = { ...record, originalFormFields: record.originalFormFields || record.formFields, formFields: fields, customerName: f.customerName, amountCents: f.amountCents + f.rushFeeCents };
    }
    if (applyingEdit && found.source === "saved") {
      const f = state.fields;
      const parts = f.customerName.split(/\s+/);
      record = { ...record, originalCustomer: record.originalCustomer || record.customer, customer: { ...record.customer, firstName: parts[0], lastName: parts.slice(1).join(" "), email: f.email, phone: f.phone } };
      if (text(latest.record.customer?.phone).replace(/\D/g, "") !== f.phone.replace(/\D/g, "")) {
        const consent = latest.record.communicationConsent || {};
        record.communicationConsent = { ...consent, transactionalSms: { ...consent.transactionalSms, granted: false }, marketingSms: { ...consent.marketingSms, granted: false } };
      }
    }
    await found.drive.files.update({ fileId: found.file.id,
      media: { mimeType: "application/json", body: JSON.stringify(record) }
    });
  }
  return load(found.source, found.id);
}

function publicFields(fields, found) {
  return {
    quoteId: found.id, bookingId: found.state.bookingId || (found.source === "booking" ? found.id : ""),
    customerName: fields.customerName, customerEmail: fields.email, customerPhone: fields.phone,
    serviceLocation: fields.address, service: fields.service, amountCents: fields.amountCents,
    rushFeeCents: fields.rushFeeCents || 0, serviceDate: fields.serviceDate, serviceTime: fields.serviceTime,
    description: fields.details, serviceDescriptionUrl: fields.serviceDescriptionUrl || "", packageItems: fields.packageItems || "", units: fields.units || [], pricing: fields.pricing || null, laborHours: fields.laborHours, cleanerCount: fields.cleanerCount,
    balanceCollection: found.state.checkoutFlow === "instant_booking" && !fields.rushFeeCents ? "automatic_48h_authorization" : found.record.estimate?.payment?.balanceCollection || "after_service",
    agreementUrl: "https://www.imancleaningservice.com/agreement.html",
    managedSource: found.source, managedId: found.id, revision: found.state.revision
  };
}

function validateFields(input = {}) {
  const limits = { customerName: 160, email: 180, phone: 40, address: 400, service: 160, serviceDescriptionUrl: 500, serviceDate: 10, serviceTime: 5, details: 10000, internalNotes: 5000 };
  const fields = {};
  if (input.packageItems != null && (typeof input.packageItems !== "string" || input.packageItems.length > 8000)) throw fail("Cleaning package must be text of at most 8,000 characters.");
  fields.packageItems = text(input.packageItems || "", 8000);
  for (const [key, max] of Object.entries(limits)) {
    const value = key === "serviceDescriptionUrl" && input[key] == null ? "" : input[key];
    if (typeof value !== "string" || value.length > max) throw fail(`Check the ${key} field (maximum ${max} characters).`);
    fields[key] = text(value, max);
  }
  if (!fields.customerName || !fields.service) throw fail("Customer name and service are required.");
  if (fields.serviceDescriptionUrl) {
    let url;
    try { url = new URL(fields.serviceDescriptionUrl); } catch { throw fail("Enter a complete service-description link beginning with https://."); }
    if (url.protocol !== "https:") throw fail("The service-description link must begin with https://.");
    fields.serviceDescriptionUrl = url.toString();
  }
  if (fields.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email)) throw fail("Enter a valid email address.");
  if (fields.phone && !/^\+?[\d ()-.]{7,40}$/.test(fields.phone)) throw fail("Enter a valid phone number.");
  if (fields.serviceDate) {
    const date = new Date(fields.serviceDate + "T12:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.serviceDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== fields.serviceDate) throw fail("Enter a valid service date.");
  }
  if (fields.serviceTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.serviceTime)) throw fail("Enter a valid start time.");
  for (const key of ["amountCents", "rushFeeCents"]) {
    if (!Number.isSafeInteger(input[key]) || input[key] < 0 || input[key] > 10000000) throw fail("Enter a valid price with no more than two decimal places.");
    fields[key] = input[key];
  }
  if (![0, 10000].includes(fields.rushFeeCents)) throw fail("The same-day rush fee must be $0 or $100.");
  if (fields.amountCents > 0 && fields.amountCents < 200) throw fail("Enter at least $2.00 so the 25% deposit can be processed.");
  fields.units = validateUnits(input.units || []);
  fields.discountCents = input.discountCents ?? 0;
  if (input.discountLabel != null && (typeof input.discountLabel !== "string" || input.discountLabel.length > 160)) throw fail("Discount name must be text of at most 160 characters.");
  fields.discountLabel = text(input.discountLabel || "", 160);
  if (!Number.isSafeInteger(fields.discountCents) || fields.discountCents < 0 || fields.discountCents > 10000000) throw fail("Enter a valid dollar discount with no more than two decimal places.");
  if (fields.units.length) {
    fields.pricing = unitPricing(fields.units, fields.discountCents, fields.rushFeeCents, fields.discountLabel);
    if (fields.pricing.totalCents - fields.rushFeeCents !== fields.amountCents) throw fail("The total must equal unit prices plus 8.875% tax, minus the discount. Refresh the price breakdown before saving.");
  } else if (fields.discountCents || input.baseAmountCents != null) {
    fields.baseAmountCents = input.baseAmountCents ?? fields.amountCents + fields.discountCents;
    fields.pricing = require('../booking/_discount').flatPricing(fields.baseAmountCents, fields.rushFeeCents, fields.discountCents, fields.discountLabel, input.pricing?.taxCents);
    if (fields.pricing.totalCents - fields.rushFeeCents !== fields.amountCents) throw fail('The cleaning total must equal its original price minus the discount.');
  }
  fields.cleanerCount = Number(input.cleanerCount);
  fields.laborHours = Number(input.laborHours);
  if (!Number.isInteger(fields.cleanerCount) || fields.cleanerCount < 1 || fields.cleanerCount > 20) throw fail("Enter 1–20 team members.");
  if (!Number.isFinite(fields.laborHours) || fields.laborHours < 0.5 || fields.laborHours > 200) throw fail("Enter 0.5–200 total labor-hours.");
  if (!Array.isArray(input.submittedFields) || input.submittedFields.length > 150) throw fail("Invalid submitted details.");
  fields.submittedFields = input.submittedFields.map(item => {
    if (!item || typeof item.name !== "string" || !item.name.trim() || item.name.length > 160 || typeof item.value !== "string" || item.value.length > 5000) throw fail("Check the submitted-detail names and values.");
    return { name: text(item.name, 160), value: text(item.value, 5000) };
  });
  return fields;
}

function validateUnits(units) {
  if (!Array.isArray(units) || units.length > 20) throw fail("Enter no more than 20 units.");
  return units.map(unit => {
    if (!unit || typeof unit.name !== "string" || !unit.name.trim() || unit.name.length > 160 || !Array.isArray(unit.items) || !unit.items.length || unit.items.length > 40) throw fail("Name each unit and include 1–40 rooms or add-ons per unit.");
    const items = unit.items.map(item => {
      if (!item || typeof item.name !== "string" || !item.name.trim() || item.name.length > 160 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100 || !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0 || item.unitPriceCents > 10000000) throw fail("Check each item name, quantity (1–100) and price.");
      return { name: text(item.name, 160), quantity: item.quantity, unitPriceCents: item.unitPriceCents, lineTotalCents: item.quantity * item.unitPriceCents, kind: item.kind === "addon" ? "addon" : "room" };
    });
    const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
    if (subtotalCents > 10000000) throw fail("A unit subtotal cannot exceed $100,000.");
    return { name: text(unit.name, 160), items, subtotalCents };
  });
}

function unitPricing(units, discountCents, rushFeeCents, discountLabel = "") {
  const subtotalCents = units.reduce((sum, unit) => sum + unit.subtotalCents, 0);
  // The owner-defined dollar discount is applied to the tax-inclusive total.
  const taxCents = Math.round((subtotalCents + rushFeeCents) * 8875 / 100000);
  const totalCents = subtotalCents + rushFeeCents + taxCents - discountCents;
  if (totalCents - rushFeeCents < 200) throw fail("Reduce the discount: at least $2 of cleaning charges must remain, in addition to any rush fee.");
  if (totalCents > 10000000) throw fail("The final quote total cannot exceed $100,000.");
  return { subtotalCents, rushFeeCents, taxRate: 0.08875, taxCents, discountCents, discountLabel: discountLabel || "Discount", discountApplication: "after_tax", totalCents };
}

async function stripe(path, method = "GET") {
  const secret = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
  if (!secret) throw fail("Payment verification is unavailable. No quote changes were applied.", 503);
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method, signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" }
  });
  const data = await response.json();
  if (!response.ok) throw fail(data.error?.message || "Payment verification failed. Please try again.", 502);
  return data;
}

async function matchingSessions(ids, since = 0) {
  const matches = [];
  const startedAt = Date.now();
  let cursor = "";
  for (let page = 0; page < 100; page += 1) {
    if (Date.now() - startedAt > 20000) throw fail("Payment verification took too long. Please try again; the existing quote was retained.", 503);
    const params = new URLSearchParams({ limit: "100" });
    // Existing direct checkout links can last at most 24h; completed payments are checked from record creation.
    if (since) params.set("created[gte]", String(Math.max(0, Math.floor(since / 1000) - 86400)));
    if (cursor) params.set("starting_after", cursor);
    const result = await stripe(`checkout/sessions?${params}`);
    matches.push(...result.data.filter(s => ids.has(s.metadata?.quote_id) || ids.has(s.metadata?.booking_id) || ids.has(s.metadata?.saved_quote_id)));
    if (!result.has_more) return matches;
    const next = result.data.at(-1)?.id;
    if (!next || next === cursor) break;
    cursor = next;
  }
  throw fail("There are too many payment records to verify safely. No changes were applied.", 503);
}

async function closeSessions(found, { allowPaid = false } = {}) {
  const ids = new Set([found.id, found.state.bookingId, found.record.estimate?.savedQuoteId].filter(Boolean));
  const sessions = await matchingSessions(ids, new Date(found.record.createdAt || found.record.created_at || 0).getTime());
  if (!allowPaid && sessions.some(s => s.status === "complete" || s.payment_status === "paid")) throw fail("This quote already has a payment. Its agreed price and payment history cannot be overwritten. Use a separate additional-work order or refund workflow.", 409);
  for (const session of sessions) {
    // Deleting a quote must not disable a paid booking's separate balance or additional-work collection.
    if (allowPaid && session.metadata?.payment_type && !["deposit_25", "same_day_deposit", "full"].includes(session.metadata.payment_type)) continue;
    if (session.status === "open") await stripe(`checkout/sessions/${encodeURIComponent(session.id)}/expire`, "POST");
  }
  const linkedId = found.state.bookingId || (found.source === 'booking' ? found.id : '');
  if (linkedId && !paid(await linkedBooking(found))) await require('../booking/_calendar').expireBookingCheckout(linkedId);
  return sessions;
}

async function linkedBooking(found) {
  if (found.source === "booking") return found.record;
  return found.state.bookingId ? bookingStore.getBooking(found.state.bookingId) : null;
}

function ready(fields) {
  return Boolean(fields.amountCents > 0 && fields.email && fields.phone && fields.address && fields.service
    && Boolean(fields.serviceDate) === Boolean(fields.serviceTime));
}

async function saveEdit(body) {
  let found = await load(body.source, body.id);
  if (body.version !== found.version) throw fail("This quote was updated elsewhere. Refresh before saving.", 409);
  if (found.state.deletedAt) throw fail("Restore this quote before editing it.", 409);
  if (found.state.updating) throw fail("A quote update is already in progress. Try again shortly.", 409);
  const fields = validateFields(body.fields);
  if (body.operation === "payment_link") {
    if (!["custom", "legacy"].includes(found.source)) throw fail("Use this payment-link setup for a custom quote.");
    if (!ready(fields)) throw fail("Enter the price, service, customer email, phone and full address. Enter both the service date and start time, or leave both blank.");
    if (/^ZIP\s*\d/i.test(fields.address)) throw fail("Enter the full service address, not just the ZIP code.");
  }
  if (found.source === "booking" && !ready(fields)) throw fail("A booking quote requires a price, complete contact details, address, date and time.");
  const booking = await linkedBooking(found);
  if (paid(booking)) throw fail("This quote already has a payment. Keep its payment history unchanged; use the booking's additional-work or refund workflow instead.", 409);
  if (ready(fields) && fields.serviceDate && body.operation !== 'discount') await bookingStore.assertScheduleAvailable(bookingStore.toZonedIso(fields.serviceDate, fields.serviceTime), fields.laborHours / fields.cleanerCount, booking?.id || '');
  const original = found.state;
  const revision = crypto.randomUUID();
  found = await persist(found, { ...original, revision, updating: true, updateStartedAt: Date.now() });
  try {
    await closeSessions(found);
    const history = [...(original.history || []), { at: new Date().toISOString(), action: body.operation === 'discount' ? `Discount updated: ${fields.discountLabel || 'Discount'} — $${(fields.discountCents / 100).toFixed(2)}` : "edited", fields: original.fields || null,
      ...(!original.fields ? { original: { customer: found.record.customer, formFields: found.record.formFields, customerName: found.record.customerName,
        amountCents: found.record.amountCents, client_name: found.record.client_name, email: found.record.email, phone: found.record.phone,
        address: found.record.address, service: found.record.service, service_label: found.record.service_label, schedule: found.record.schedule,
        notes: found.record.notes, estimate: found.record.estimate ? { ...found.record.estimate, crmQuote: undefined } : undefined } } : {}) }];
    let next = { ...original, revision, updating: false, fields, updatedAt: new Date().toISOString(), history };
    if (body.operation === "payment_link") next.checkoutFlow = "instant_booking";
    if (ready(fields)) {
      if (fields.serviceDate && new Date(bookingStore.toZonedIso(fields.serviceDate, fields.serviceTime)).getTime() <= Date.now()) throw fail("Choose a future service date and time before creating an updated payment link.");
      const { createShortApproval } = require("../quote/_short-approval");
      // Codes store only a pointer. Existing managed codes continue resolving the newest saved revision.
      const link = original.approvalCode && Number(original.approvalExpiresAt || 0) > Date.now() ? { code: original.approvalCode, expiresAt: original.approvalExpiresAt } : await createShortApproval({
        quoteId: found.id, managedSource: found.source, managedId: found.id,
        expiresAt: Date.now() + 90 * 86400000
      });
      next.approvalCode = link.code;
      next.approvalExpiresAt = link.expiresAt;
    }
    found = await persist(found, next, { applyFields: true });
    return { ok: true, approvalUrl: next.approvalCode && ready(fields) ? `https://www.imancleaningservice.com/q/${next.approvalCode}` : "", paymentReady: ready(fields) };
  } catch (error) {
    // Restore the old offer if verification/expiry fails; any already-expired sessions stay expired.
    const latest = await load(body.source, body.id);
    if (latest.state.revision === revision && latest.state.updating) await persist(latest, { ...original, revision: crypto.randomUUID(), lastError: text(error.message, 500) });
    throw error;
  }
}

async function saveDiscount(body) {
  const { validateDiscount, flatPricing, packageFingerprint } = require('../booking/_discount');
  const discount = validateDiscount(body.discountCents, body.discountLabel);
  let found = await load(body.source, body.id);
  if (body.version !== found.version) throw fail('This quote was updated elsewhere. Refresh before saving.', 409);
  if (found.state.deletedAt || found.state.updating) throw fail('Restore or refresh this quote before changing the discount.', 409);
  if (paid(await linkedBooking(found))) throw fail('Payment has already been received. Use the refund workflow instead of changing the paid quote.', 409);
  if (found.source === 'saved' && !found.state.fields) {
    const pkg = require('../booking/_saved-quote').validateAndPrice(found.record).pkg;
    flatPricing(pkg.priceCents, 0, discount.amountCents, discount.label, pkg.taxCents);
    const original = found.state, revision = crypto.randomUUID();
    found = await persist(found, { ...original, revision, updating: true });
    try {
      await closeSessions(found);
      await persist(found, { ...original, revision, updating: false, manualDiscount: { ...discount, packageFingerprint: packageFingerprint(pkg) },
        updatedAt: new Date().toISOString(), history: [...(original.history || []), { at: new Date().toISOString(),
          action: `Discount updated: ${discount.label} — $${(discount.amountCents / 100).toFixed(2)}`, previousDiscount: original.manualDiscount || null }] });
      return { ok: true, discountSaved: true, paymentReady: true };
    } catch (error) {
      const latest = await load(body.source, body.id);
      if (latest.state.revision === revision && latest.state.updating) await persist(latest, { ...original, revision: crypto.randomUUID() });
      throw error;
    }
  }
  const converters = require('./_quotes');
  const quote = found.source === 'booking' ? converters.bookingQuote(found.record)
    : found.source === 'saved' ? converters.savedQuote(found.record, found.file)
    : converters.customizedQuote(found.record, found.file);
  const fields = { ...quote.editFields, discountCents: discount.amountCents, discountLabel: discount.label };
  if (fields.units.length) {
    fields.pricing = unitPricing(validateUnits(fields.units), discount.amountCents, fields.rushFeeCents, discount.label);
  } else {
    fields.baseAmountCents = quote.editFields.baseAmountCents ?? quote.editFields.amountCents + (quote.editFields.discountCents || 0);
    fields.pricing = flatPricing(fields.baseAmountCents, fields.rushFeeCents, discount.amountCents, discount.label,
      fields.pricing?.taxCents ?? (found.record.estimate?.tax != null ? Math.round(found.record.estimate.tax * 100) : undefined));
  }
  fields.amountCents = fields.pricing.totalCents - fields.rushFeeCents;
  return saveEdit({ ...body, operation: 'discount', fields });
}

async function applySavedDiscount(token, pkg, revision) {
  if (!token) return pkg;
  await checkSavedCheckout(token, undefined, revision);
  const { decodeSavedQuote } = require('../booking/_saved-quote');
  const found = await load('saved', decodeSavedQuote(token).quoteId);
  if ((found.state.revision || '') !== (revision || '') || found.state.updating || found.state.fields || found.state.deletedAt) throw fail('Your quote changed. Reopen the saved quote link before continuing.', 409);
  return require('../booking/_discount').applyPackageDiscount(pkg, found.state.manualDiscount);
}

async function deleteQuote(body) {
  let found = await load(body.source, body.id);
  if (body.version !== found.version) throw fail("This quote changed elsewhere. Refresh before deleting.", 409);
  if (body.confirmation !== found.id) throw fail("Confirm the exact quote reference to delete it.");
  if (found.state.updating) throw fail("A quote update is in progress. Try again shortly.", 409);
  if (found.state.deletedAt) return { ok: true };
  const prior = found.state;
  found = await persist(found, { ...prior, revision: crypto.randomUUID(), updating: true, updateStartedAt: Date.now() });
  try {
    // Paid bookings are retained; deletion removes only the quote and disables unused payment links.
    await closeSessions(found, { allowPaid: true });
    if (found.source === "custom") {
      const { cancelPhotoUploadReminders } = require("../quote/_photo-later");
      const results = await cancelPhotoUploadReminders(found.record);
      if (results.some(r => r.status === "error")) throw fail("A photo reminder could not be cancelled. The quote was not deleted; try again.", 502);
    }
    await persist(found, { ...prior, revision: crypto.randomUUID(), updating: false, deletedAt: new Date().toISOString(), history: [...(prior.history || []), { at: new Date().toISOString(), action: "deleted" }] });
    return { ok: true };
  } catch (error) {
    await persist(found, { ...prior, revision: crypto.randomUUID() });
    throw error;
  }
}

async function restoreQuote(body) {
  const found = await load(body.source, body.id);
  if (body.version !== found.version) throw fail("This quote changed elsewhere. Refresh and try again.", 409);
  if (found.state.updating) throw fail("A quote update is in progress.", 409);
  await persist(found, { ...found.state, revision: crypto.randomUUID(), deletedAt: "", history: [...(found.state.history || []), { at: new Date().toISOString(), action: "restored" }] });
  return { ok: true };
}

async function findManaged(quote) {
  if (quote.managedSource && quote.managedId) return load(quote.managedSource, quote.managedId);
  if (!/^[\w-]{1,150}$/.test(quote.quoteId || "")) return null;
  for (const source of ["custom", "saved", "booking"]) {
    try {
      const found = await load(source, quote.quoteId);
      if (Object.keys(found.state).length) return found;
    } catch (error) { if (error.statusCode !== 404) throw error; }
  }
  if (quote.bookingId && quote.bookingId !== quote.quoteId) {
    try { const found = await load("booking", quote.bookingId); if (Object.keys(found.state).length) return found; }
    catch (error) { if (error.statusCode !== 404) throw error; }
  }
  return null;
}

async function resolveManaged(quote) {
  const found = await findManaged(quote);
  if (!found) return quote;
  if (found.state.deletedAt) throw fail("This quote is no longer available. Please contact IMAN Cleaning Service.", 410);
  if (found.state.updating) throw fail("Your quote is being updated. Please try again shortly.", 409);
  if (!found.state.fields) return quote;
  if (!ready(found.state.fields)) throw fail("Our team is finalizing this quote. Please contact IMAN Cleaning Service.", 409);
  if (paid(await linkedBooking(found))) throw fail("Payment has already been received for this quote. Please contact us if you need help with your booking.", 409);
  return { ...publicFields(found.state.fields, found), expiresAt: Date.now() + 86400000 };
}

async function ensureManagedBooking(quote) {
  if (!quote.managedSource) return quote;
  let found = await load(quote.managedSource, quote.managedId);
  if (found.state.revision !== quote.revision || found.state.updating || found.state.deletedAt) throw fail("Your quote changed. Please reload it before paying.", 409);
  const fields = found.state.fields;
  let booking = await linkedBooking(found);
  if (paid(booking)) throw fail("This quote has already been paid.", 409);
  const id = booking?.id || `BK-CRM-${crypto.createHash("sha256").update(`${found.source}:${found.id}`).digest("hex").slice(0, 20).toUpperCase()}`;
  if (!booking) booking = await bookingStore.getBooking(id);
  if (paid(booking)) throw fail("This quote has already been paid.", 409);
  // Retrying the same offer must never reset a payment that is being recorded.
  if (booking?.estimate?.managedQuote?.revision !== quote.revision) {
    const changes = bookingChanges(fields, booking, { source: found.source, id: found.id, revision: quote.revision, balanceCollection: quote.balanceCollection });
    if (booking) await bookingStore.updateBooking(id, changes);
    else await bookingStore.createBooking({ id, status: "New", ...changes, addons: [], estimate: { ...changes.estimate, calendarReservation: { state: 'draft' }, orderNumber: id } });
  }
  if (found.source !== "booking" && !found.state.bookingId) found = await persist(found, { ...found.state, bookingId: id });
  return { ...quote, bookingId: id };
}

async function selectCustomerSchedule(quote, selectedSchedule) {
  if (!quote?.managedSource) throw fail("This quote cannot be scheduled online.", 409);
  let found = await load(quote.managedSource, quote.managedId);
  if (found.state.revision !== quote.revision || found.state.updating || found.state.deletedAt) throw fail("Your quote changed. Please reload it before choosing a time.", 409);
  if (found.state.fields.serviceDate || found.state.fields.serviceTime) return resolveManaged(quote);
  const pkg = { teamHours: found.state.fields.laborHours / found.state.fields.cleanerCount };
  const slots = await bookingStore.availableSlotsForPackage(pkg);
  const slot = slots.find(item => item.value === text(selectedSchedule, 100));
  if (!slot) throw fail("That appointment is no longer available. Please choose another time.", 409);
  const fields = { ...found.state.fields, serviceDate: slot.date, serviceTime: slot.time };
  found = await persist(found, { ...found.state, fields, customerSelectedScheduleAt: new Date().toISOString() }, { applyFields: true });
  return { ...publicFields(fields, found), expiresAt: Date.now() + 86400000 };
}

function bookingRoomLabels(fields, booking) {
  // Custom prices do not use the instant package builder, so copy its required
  // booking labels from the rooms the owner actually included. Never infer a
  // room count from an arbitrary add-on name or invent counts for other services.
  const counts = { bedroom: 0, bathroom: 0, full: 0, half: 0 };
  const roomTypes = { bedroom: "bedroom", bedrooms: "bedroom", bathroom: "bathroom", bathrooms: "bathroom",
    "full bathroom": "full", "full bathrooms": "full", "half bathroom": "half", "half bathrooms": "half" };
  for (const unit of fields.units || []) {
    for (const item of unit.items || []) {
      if (item.kind === "addon") continue;
      const type = roomTypes[text(item.name, 160).toLowerCase().replace(/\s+/g, " ")];
      if (type && Number.isInteger(item.quantity) && item.quantity > 0) counts[type] += item.quantity;
    }
  }
  const label = (count, name) => `${count} ${name}${count === 1 ? "" : "s"}`;
  return {
    bedrooms_label: counts.bedroom ? label(counts.bedroom, "bedroom") : text(booking?.bedrooms_label, 160),
    bathrooms_label: [counts.bathroom && label(counts.bathroom, "bathroom"), counts.full && label(counts.full, "full bathroom"), counts.half && label(counts.half, "half bathroom")].filter(Boolean).join(", ") || text(booking?.bathrooms_label, 160)
  };
}

function bookingChanges(fields, booking, managedQuote) {
  const total = fields.amountCents + fields.rushFeeCents;
  const deposit = Math.round(fields.amountCents * .25) + fields.rushFeeCents;
  const awaitingSchedule = !fields.serviceDate;
  // The bookings table requires a timestamp. This distant internal placeholder
  // is never shown, reserved, reminded or synced while awaitingSchedule is true.
  const schedule = awaitingSchedule ? "2099-12-31T17:00:00.000Z" : bookingStore.toZonedIso(fields.serviceDate, fields.serviceTime);
  if (!awaitingSchedule && (!Number.isFinite(new Date(schedule).getTime()) || new Date(schedule).getTime() <= Date.now())) throw fail("This service time has passed. Please contact us for an updated quote.", 409);
  const taxRate = Number(booking?.estimate?.taxRate ?? 0.08875);
  const subtotal = fields.pricing ? (fields.pricing.subtotalCents + fields.rushFeeCents) / 100 : Math.round(total / (1 + taxRate)) / 100;
  return {
    service: booking?.service || "custom", service_label: fields.service,
    ...bookingRoomLabels(fields, booking), sqft: booking?.sqft ?? 0,
    client_name: fields.customerName, email: fields.email, phone: fields.phone, address: fields.address,
    schedule, schedule_label: awaitingSchedule ? "To be scheduled by IMAN Cleaning Service" : `${fields.serviceDate} at ${fields.serviceTime}`, notes: [fields.packageItems, fields.details].filter(Boolean).join("\n\n"),
    estimate: { ...(booking?.estimate || {}), total: total / 100, low: total / 100, high: total / 100, subtotal, tax: fields.pricing ? fields.pricing.taxCents / 100 : Math.round((total / 100 - subtotal) * 100) / 100, taxRate,
      customQuotePricing: fields.pricing || null,
      pricingMode: "crm_custom_quote", originalUnits: booking?.estimate?.originalUnits || booking?.estimate?.units || [],
      customQuoteUnits: fields.units || [], unitCount: fields.units?.length || 1,
      units: fields.units?.length ? fields.units.map((unit, index) => ({ unitNumber: index + 1, name: unit.name, total: unit.subtotalCents / 100,
        baseItems: unit.items.filter(item => item.kind !== "addon").map(item => ({ label: `${item.quantity} × ${item.name}`, amount: item.lineTotalCents / 100 })),
        addOns: unit.items.filter(item => item.kind === "addon").map(item => ({ label: `${item.quantity} × ${item.name}`, amount: item.lineTotalCents / 100 })) })) : (booking?.estimate?.units || []),
      manHours: fields.laborHours, cleanerCount: fields.cleanerCount, teamHours: fields.laborHours / fields.cleanerCount, hours: fields.laborHours / fields.cleanerCount,
      managedQuote: { ...managedQuote, awaitingSchedule }, awaitingSchedule, customPackageItems: fields.packageItems || "", serviceDescriptionUrl: fields.serviceDescriptionUrl || "",
      payment: { ...(booking?.estimate?.payment || {}), status: "deposit_pending", balanceCollection: managedQuote.balanceCollection || booking?.estimate?.payment?.balanceCollection || "after_service", totalCents: total, depositCents: deposit, remainingCents: total - deposit, rushFeeCents: fields.rushFeeCents, paidCents: 0, remaining: { ...(booking?.estimate?.payment?.remaining || {}), status: "pending", amountCents: total - deposit } }
    }
  };
}

async function expireStaleCheckout(session) {
  const path = `checkout/sessions/${encodeURIComponent(session.id)}`;
  try { await stripe(`${path}/expire`, 'POST'); }
  catch (error) {
    // Another discount save may already have expired this same checkout.
    const current = await stripe(path);
    if (current.status !== 'expired') throw error;
  }
}

async function guardCheckout(quote, session) {
  if (!quote.managedSource) return;
  let current;
  try { current = await resolveManaged(quote); } catch {}
  if (!current || current.revision !== quote.revision) {
    await expireStaleCheckout(session);
    throw fail("Your quote changed. Please reopen the payment link to review the latest details.", 409);
  }
}

async function currentCheckout(quote, options = {}) {
  if (!quote.managedSource) return {};
  const sessions = await matchingSessions(new Set([quote.quoteId, quote.bookingId].filter(Boolean)), 0);
  if (sessions.some(s => s.status === "complete" || s.payment_status === "paid")) throw fail("Payment has already been received. Please contact us about your booking.", 409);
  const revisionSessions = sessions.filter(s => s.metadata?.quote_revision === quote.revision);
  const openSessions = revisionSessions.filter(s => s.status === "open");
  const summaryVersion = text(options.summaryVersion, 32);
  const compatibleSession = openSessions.find(s => !summaryVersion || s.metadata?.checkout_summary_version === summaryVersion);
  if (summaryVersion) {
    for (const session of openSessions) {
      if (session.id !== compatibleSession?.id) await expireStaleCheckout(session);
    }
  }
  return { session: compatibleSession, previousId: revisionSessions[0]?.id || "first" };
}

async function checkSavedCheckout(token, session, revision) {
  if (!token) return "";
  const { assertQuoteUnused, decodeSavedQuote } = require("../booking/_saved-quote");
  const decoded = decodeSavedQuote(token);
  await assertQuoteUnused(decoded.quoteId);
  const found = await load("saved", decoded.quoteId);
  if (found.state.fields || found.state.deletedAt || found.state.updating || (revision !== undefined && (found.state.revision || '') !== revision)) {
    if (session?.id) await expireStaleCheckout(session);
    throw Object.assign(fail("This quote has changed. Reopen your saved quote link to review the latest details before paying.", 409), { reviewRequired: true, reviewUrl: found.state.approvalCode && !found.state.deletedAt ? `/q/${found.state.approvalCode}` : undefined });
  }
  return found.id;
}

module.exports = { load, version, paid, validateFields, validateUnits, unitPricing, ready, saveEdit, saveDiscount, applySavedDiscount, deleteQuote, restoreQuote, resolveManaged, ensureManagedBooking, selectCustomerSchedule, guardCheckout, legacyRecord, currentCheckout, checkSavedCheckout };
