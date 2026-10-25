const { newYorkNow } = require("../../walkthrough-fields");
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const parse = value => Buffer.isBuffer(value) ? JSON.parse(value.toString("utf8")) : typeof value === "string" ? JSON.parse(value) : value;
const code = error => Number(error.response?.status || error.statusCode || error.code);
const escaped = value => String(value || "").replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const clean = value => String(value || "").replace(/[\r\n\0]+/g, " ").trim();
const validId = id => typeof id === "string" && /^[\w-]{1,180}$/.test(id);

function toClient(record, confirmation = null) {
  const fields = record.formFields || {};
  const name = clean(fields["Full Name"] || [fields["First Name"], fields["Last Name"]].filter(Boolean).join(" "));
  const address = clean(fields["Service Address"] || [fields["Street Address"], fields["Floor or Suite"], fields.City, fields.State, fields["ZIP Code"]].filter(Boolean).join(", "));
  const detailFields = [
    ["Contact role", "Contact Role"], ["Property type", "Commercial Space Type"], ["Other property type", "Other Commercial Space"],
    ["Approximate size", "Approximate Square Footage"], ["Cleaning plan", "Cleaning Plan"],
    ["Areas", "Areas Needing Cleaning"], ["Priorities", "Cleaning Priorities"], ["Conditions to review", "Conditions to Review"],
    ["Condition details", "Condition Details"], ["Preferred cleaning start", "Preferred Service Start Date"],
    ["Preferred cleaning days", "Preferred Cleaning Days"], ["Preferred cleaning time", "Preferred Cleaning Time"],
    ["Construction complete", "Construction Complete Before Cleaning"], ["Contractors removing debris", "Contractors Remove Construction Debris"],
    ["Restaurant specialty work", "Restaurant Specialty Work"], ["Restaurant details", "Restaurant Specialty Details"],
    ["Medical specialty work", "Medical Specialty Work"], ["Medical details", "Medical Specialty Details"]
  ].map(([label, key]) => ({ label, value: clean(fields[key]) })).filter(item => item.value);
  return {
    id: record.quoteId, type: "Walkthrough request", source: "Commercial walkthrough form", createdAt: record.createdAt,
    customerName: name, businessName: clean(fields["Business Name"]), email: clean(fields.Email), phone: clean(fields.Phone || fields["Phone Number"]), address,
    service: "Commercial walkthrough", status: record.crmQuote?.deletedAt ? "Deleted" : confirmation ? "Walkthrough confirmed" : "Walkthrough requested",
    amountCents: 0, deletedAt: record.crmQuote?.deletedAt || "", editSource: "custom", editVersion: require("./_quote-admin").version(record),
    walkthrough: { preferredDate: fields["Preferred Walkthrough Date"] || "", preferredTime: fields["Preferred Walkthrough Time"] || "",
      alternativeDate: fields["Alternative Walkthrough Date"] || "", alternativeTime: fields["Alternative Walkthrough Time"] || "",
      notes: fields["Walkthrough Notes"] || "", details: detailFields, uploadedFileCount: Number(record.photoCount || 0),
      canConfirm: validId(record.walkthroughConfirmationFileId), confirmation }
  };
}

async function readFile(drive, id) {
  if (!validId(id)) throw fail("The walkthrough confirmation record is unavailable.", 409);
  try { return parse((await drive.files.get({ fileId: id, alt: "media" })).data); }
  catch (error) { if (code(error) === 404) return null; throw error; }
}

async function readConfirmation(drive, record) {
  if (!record.walkthroughConfirmationFileId) return null;
  const confirmation = await readFile(drive, record.walkthroughConfirmationFileId);
  if (confirmation && (confirmation.type !== "walkthrough_confirmation" || confirmation.quoteId !== record.quoteId)) {
    throw fail("This confirmation does not match the walkthrough request.", 409);
  }
  return confirmation;
}

async function hydrate(drive, record) {
  const saved = await readConfirmation(drive, record);
  if (!saved) return toClient(record);
  const confirmation = { date: saved.date, time: saved.time, confirmedAt: saved.confirmedAt };
  for (const channel of ["sms", "email"]) {
    const delivery = await readFile(drive, saved.deliveryIds[channel]);
    if (delivery && (delivery.quoteId !== record.quoteId || delivery.channel !== channel)) throw fail("Message status does not match this request.", 409);
    confirmation[channel] = delivery ? {
      status: delivery.status, sentAt: delivery.sentAt || "", messageId: delivery.messageId || ""
    } : { status: "pending" };
  }
  return toClient(record, confirmation);
}

function validateVisit(date, time, now = new Date()) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw fail("Choose a confirmed date and time.");
  }
  const day = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== date || `${date}T${time}` <= newYorkNow(now)) throw fail("Choose a future walkthrough date and time in New York.");
  // Reject nonexistent or ambiguous local clock times at DST transitions instead
  // of silently confirming a different hour. No calendar or cleaning booking is created.
  const naive = Date.parse(`${date}T${time}:00Z`);
  const matches = [4, 5].filter(offset => newYorkNow(new Date(naive + offset * 3600000)) === `${date}T${time}`);
  if (matches.length !== 1) throw fail("That time is affected by the daylight-saving clock change. Choose another time.");
}

function content(confirmation) {
  const date = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${confirmation.date}T12:00:00Z`));
  const [hour, minute] = confirmation.time.split(":").map(Number);
  const time = `${hour % 12 || 12}:${String(minute).padStart(2,"0")} ${hour < 12 ? "AM" : "PM"} (New York time)`;
  const message = `Your commercial cleaning walkthrough with IMAN Cleaning Service is confirmed for ${date} at ${time}.`;
  const subject = "Your walkthrough is confirmed | IMAN Cleaning Service";
  const text = [`Hi ${confirmation.name},`, "", message, `Address: ${confirmation.address}`, "", "We look forward to meeting you. If you need to make a change, reply to this email or call (929) 232-1930.", "", `Request reference: ${confirmation.quoteId}`, "IMAN Cleaning Service LLC"].join("\n");
  const sms = `${message}\nAddress: ${confirmation.address}\nQuestions or changes? Call (929) 232-1930. Reply STOP to opt out.`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#243c40;line-height:1.6"><h1 style="font-size:22px;color:#073f49">Your walkthrough is confirmed</h1><p>Hi ${escaped(confirmation.name)},</p><p>${escaped(message)}</p><p><strong>Address:</strong> ${escaped(confirmation.address)}</p><p>We look forward to meeting you. If you need to make a change, reply to this email or call <a href="tel:+19292321930">(929) 232-1930</a>.</p><p>Request reference: ${escaped(confirmation.quoteId)}</p><p>IMAN Cleaning Service LLC</p></body></html>`;
  return { subject, sms, text, html };
}

// Pre-generated Drive IDs have create-once semantics (409 on duplicate create).
// https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files
async function createOnce(drive, parent, id, record) {
  try {
    await drive.files.create({ requestBody: { id, name: `${record.quoteId}-${record.channel || "confirmation"}.json`, parents: [parent], mimeType: "application/json" },
      media: { mimeType: "application/json", body: JSON.stringify(record) }, fields: "id" }, { retry: false, timeout: 15000 });
    return true;
  } catch (error) { if (code(error) === 409) return false; throw error; }
}

async function sendClaimed(drive, parent, confirmation, channel) {
  const id = confirmation.deliveryIds[channel];
  const attempt = { type: "walkthrough_delivery", quoteId: confirmation.quoteId, channel, status: "sending", attemptedAt: new Date().toISOString() };
  // A stored claim is never retried automatically: a provider may have accepted a
  // message even if its response or the subsequent tracking update was lost.
  if (!await createOnce(drive, parent, id, attempt)) return;
  let result;
  try {
    const message = content(confirmation);
    if (channel === "sms") {
      // A team-initiated confirmation uses the normal CRM message history and
      // human-reply handoff rule, rather than starting an AI conversation.
      const sent = await require("./_communications").sendCustomerMessage({ phone: confirmation.sms, customerName: confirmation.name, message: message.sms });
      result = { status: "sent", messageId: sent.messageId };
    } else result = await require("../quote/_photo-later").sendWalkthroughEmail(confirmation.email, message);
    result = result?.status === "sent" && result.messageId
      ? { status: "sent", messageId: result.messageId, sentAt: new Date().toISOString() }
      : { status: "failed" };
  } catch (error) {
    result = { status: code(error) >= 400 && code(error) < 500 && code(error) !== 408 ? "failed" : "unknown" };
  }
  await drive.files.update({ fileId: id, media: { mimeType: "application/json", body: JSON.stringify({ ...attempt, ...result }) } }, { retry: false, timeout: 15000 });
}

async function confirm(body = {}) {
  if (!validId(body.id)) throw fail("Invalid walkthrough reference.");
  const { load } = require("./_quote-admin");
  const found = await load("custom", body.id);
  const record = found.record;
  if (record.formFields?.["Request Type"] !== "Commercial walkthrough" || record.crmQuote?.deletedAt) throw fail("Walkthrough request not found.", 404);
  if (!validId(record.walkthroughConfirmationFileId)) throw fail("This older request needs a manual confirmation from your team.", 409);
  if (body.version !== found.version) throw fail("This request changed. Refresh before confirming.", 409);
  const view = toClient(record);
  const fields = record.formFields || {};
  const email = String(fields.Email || "").trim();
  const phone = require("./_communications").customerPhone(view.phone);
  if (!/^[^@\s<>;,]+@[^@\s<>;,]+\.[^@\s<>;,]+$/.test(email) || !view.address) throw fail("A valid customer email, phone number and address are required.");
  const parent = require("../quote/_shared").getGoogleClients().config.parentFolderId;
  let saved = await readConfirmation(found.drive, record);
  if (!saved) {
    validateVisit(body.date, body.time);
    const reserved = await found.drive.files.generateIds({ count: 2, space: "drive", type: "files" });
    if (reserved.data.ids?.length !== 2) throw fail("Could not prepare the confirmation messages.", 503);
    const candidate = { type: "walkthrough_confirmation", quoteId: record.quoteId, date: body.date, time: body.time,
      confirmedAt: new Date().toISOString(), name: view.customerName, address: view.address, sms: phone, email,
      deliveryIds: { sms: reserved.data.ids[0], email: reserved.data.ids[1] } };
    // Recheck contact information and trash state immediately before the durable confirmation.
    const latest = await load("custom", body.id);
    if (latest.version !== found.version) throw fail("This request changed. Refresh before confirming.", 409);
    if (await createOnce(found.drive, parent, record.walkthroughConfirmationFileId, candidate)) saved = candidate;
    else saved = await readConfirmation(found.drive, record);
  }
  if (!saved || saved.date !== body.date || saved.time !== body.time || saved.email !== email || saved.sms !== phone || saved.address !== view.address) {
    throw fail("A confirmation already exists with different details. Refresh to review it; no new messages were sent.", 409);
  }
  // Only unclaimed channels can send. Claims and results are separate files, so
  // concurrent senders cannot overwrite each other's statuses or duplicate texts.
  const current = await hydrate(found.drive, record);
  if (["sms", "email"].some(channel => current.walkthrough.confirmation[channel].status === "pending")) validateVisit(saved.date, saved.time);
  await Promise.allSettled(["sms", "email"].map(channel => sendClaimed(found.drive, parent, saved, channel)));
  return hydrate(found.drive, record);
}

module.exports = { toClient, hydrate, confirm, validateVisit, content };
