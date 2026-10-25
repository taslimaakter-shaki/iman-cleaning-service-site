const { getGoogleClients } = require("../quote/_shared");

const CONCERN_STATUSES = ["Submitted", "In review", "Waiting on customer", "Resolved"];
const text = (value, max = 10000) => String(value ?? "").replace(/\0/g, "").trim().slice(0, max);
const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const driveId = (value) => /^[\w-]{1,200}$/.test(String(value || ""));

function parseRecord(data) {
  const record = Buffer.isBuffer(data) ? JSON.parse(data.toString("utf8")) : typeof data === "string" ? JSON.parse(data) : data;
  if (!record || record.type !== "service_concern") throw error("Invalid service-concern record.", 500);
  return record;
}

function toClientConcern(record, file) {
  const fields = Object.fromEntries(Object.entries(record.fields || {}).map(([key, value]) => [
    text(key, 160), Array.isArray(value) ? value.map((item) => text(item)).join(", ") : text(value)
  ]));
  return {
    id: file.id,
    caseNumber: text(record.caseNumber || file.appProperties?.case_number || file.id, 100),
    customerName: text(record.customerName || fields["Full name"] || "Customer", 200),
    email: text(record.email || fields["Email address"], 250),
    phone: text(record.phone || fields["Phone number"], 80),
    createdAt: record.createdAt || file.createdTime || "",
    updatedAt: record.updatedAt || record.createdAt || file.createdTime || "",
    status: CONCERN_STATUSES.includes(record.status) ? record.status : "Submitted",
    concernType: fields["Type of concern"] || "Service concern",
    service: fields["Type of service"] || "Cleaning service",
    serviceDate: fields["Date of cleaning service"] || "",
    address: fields["Service address"] || "",
    explanation: fields["Detailed explanation"] || "",
    fields,
    folderLink: driveId(record.folderId) ? `https://drive.google.com/drive/folders/${record.folderId}` : "",
    uploads: (Array.isArray(record.uploads) ? record.uploads : []).map((upload) => ({
      name: text(upload.originalName || upload.name || "Evidence file", 250),
      url: driveId(upload.id) ? `https://drive.google.com/file/d/${upload.id}/view` : ""
    })),
    internalNotes: text(record.internalNotes, 5000),
    resolvedAt: record.resolvedAt || "",
    history: (Array.isArray(record.history) ? record.history : []).map((entry) => ({
      at: text(entry.at, 40), status: text(entry.status, 40), notes: text(entry.notes, 5000)
    }))
  };
}

async function listConcerns() {
  const { drive, config } = getGoogleClients();
  const parent = String(config.parentFolderId).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const files = [];
  let pageToken;
  do {
    const result = await drive.files.list({
      q: `'${parent}' in parents and trashed = false and appProperties has { key='iman_record_type' and value='service_concern' }`,
      fields: "nextPageToken,files(id,createdTime,appProperties)",
      pageSize: 100,
      ...(pageToken ? { pageToken } : {})
    });
    files.push(...(result.data.files || []));
    pageToken = result.data.nextPageToken;
  } while (pageToken);
  const concerns = [];
  for (let index = 0; index < files.length; index += 10) {
    concerns.push(...await Promise.all(files.slice(index, index + 10).map(async (file) => {
      const downloaded = await drive.files.get({ fileId: file.id, alt: "media" });
      return toClientConcern(parseRecord(downloaded.data), file);
    })));
  }
  return concerns.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function updateConcern(body = {}) {
  const id = text(body.id, 200);
  if (!driveId(id)) throw error("A valid concern ID is required.", 400);
  if (!CONCERN_STATUSES.includes(body.status)) throw error("Choose a valid concern status.", 400);
  if (typeof body.internalNotes !== "string" || body.internalNotes.length > 5000) throw error("Internal notes must be 5,000 characters or fewer.", 400);
  const { drive, config } = getGoogleClients();
  let metadata;
  try {
    metadata = await drive.files.get({ fileId: id, fields: "id,parents,trashed,createdTime,appProperties" });
  } catch (failure) {
    if (Number(failure.code || failure.status) === 404) throw error("Concern not found.", 404);
    throw failure;
  }
  const file = metadata.data;
  if (file.trashed || !file.parents?.includes(config.parentFolderId) || file.appProperties?.iman_record_type !== "service_concern") {
    throw error("Concern not found.", 404);
  }
  const downloaded = await drive.files.get({ fileId: id, alt: "media" });
  const record = parseRecord(downloaded.data);
  const previous = toClientConcern(record, file);
  if (body.updatedAt !== previous.updatedAt) throw error("This concern was updated elsewhere. Refresh the CRM before saving.", 409);
  const internalNotes = text(body.internalNotes, 5000);
  if (body.status === previous.status && internalNotes === previous.internalNotes) return previous;
  const now = new Date().toISOString();
  const updated = {
    ...record,
    status: body.status,
    internalNotes,
    updatedAt: now,
    resolvedAt: body.status === "Resolved" ? (record.resolvedAt || now) : "",
    history: [...(Array.isArray(record.history) ? record.history : []), { at: now, status: body.status, notes: internalNotes }]
  };
  await drive.files.update({
    fileId: id,
    requestBody: { appProperties: { ...file.appProperties, concern_status: body.status } },
    media: { mimeType: "application/json", body: JSON.stringify(updated, null, 2) }
  });
  return toClientConcern(updated, file);
}

module.exports = { CONCERN_STATUSES, listConcerns, toClientConcern, updateConcern };
