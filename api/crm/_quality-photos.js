const { getGoogleClients } = require("../quote/_shared");
const { cleanText, getBooking, updateBookingEstimate } = require("../booking/_shared");

const MAX_QUALITY_PHOTOS_PER_STAGE = 200;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp"
]);

function stageFor(value) {
  const stage = cleanText(value, 20).toLowerCase();
  if (!new Set(["before", "after"]).has(stage)) {
    throw Object.assign(new Error("Choose Before photos or After photos."), { statusCode: 400 });
  }
  return stage;
}

function validatePhoto(file = {}) {
  const mimeType = cleanText(file.mimeType, 100).toLowerCase();
  const size = Number(file.size || 0);
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw Object.assign(new Error("Upload JPG, PNG, HEIC, or WebP pictures only."), { statusCode: 400 });
  }
  if (!Number.isFinite(size) || size < 1 || size > MAX_FILE_BYTES) {
    throw Object.assign(new Error("Each picture must be 20 MB or smaller."), { statusCode: 413 });
  }
  return { mimeType, size };
}

function safeName(value) {
  return cleanText(value, 140)
    .replace(/[^\w.()\- ]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-") || "quality-photo";
}

function qualityState(booking = {}) {
  const saved = booking.estimate?.qualityPhotos || {};
  return {
    ...saved,
    before: Array.isArray(saved.before) ? saved.before : [],
    after: Array.isArray(saved.after) ? saved.after : []
  };
}

function totalPhotos(state = {}) {
  return (Array.isArray(state.before) ? state.before.length : 0)
    + (Array.isArray(state.after) ? state.after.length : 0);
}

function hasPaidDeposit(booking = {}) {
  const payment = booking.estimate?.payment || {};
  const totalCents = Number(payment.totalCents || Math.round(Number(booking.estimate?.total || 0) * 100));
  const depositCents = Number(payment.depositCents || payment.paidCents || Math.round(totalCents * 0.25));
  const paidCents = Number(payment.paidCents || (payment.status === "deposit_paid" ? depositCents : 0));
  return paidCents > 0 && depositCents > 0 && paidCents >= depositCents;
}

async function createFolder(drive, { name, parentId, properties }) {
  const created = await drive.files.create({
    requestBody: {
      name,
      parents: [parentId],
      mimeType: "application/vnd.google-apps.folder",
      appProperties: properties
    },
    fields: "id,name,webViewLink"
  });
  return created.data;
}

async function ensureFolders(booking, drive, config) {
  const current = qualityState(booking);
  if (current.folderId && current.beforeFolderId && current.afterFolderId) return current;

  const orderNumber = cleanText(booking.estimate?.orderNumber || booking.id, 100);
  const customerName = cleanText(booking.client_name || "Customer", 120);
  const root = await createFolder(drive, {
    name: `QUALITY - ${orderNumber} - ${customerName}`,
    parentId: config.parentFolderId,
    properties: { iman_record_type: "booking_quality_folder", booking_id: booking.id }
  });
  const before = await createFolder(drive, {
    name: "Before photos",
    parentId: root.id,
    properties: { iman_record_type: "booking_quality_stage", booking_id: booking.id, stage: "before" }
  });
  const after = await createFolder(drive, {
    name: "After photos",
    parentId: root.id,
    properties: { iman_record_type: "booking_quality_stage", booking_id: booking.id, stage: "after" }
  });
  const next = {
    ...current,
    folderId: root.id,
    folderLink: root.webViewLink || `https://drive.google.com/drive/folders/${root.id}`,
    beforeFolderId: before.id,
    afterFolderId: after.id
  };
  await updateBookingEstimate(booking.id, { ...(booking.estimate || {}), qualityPhotos: next });
  return next;
}

async function prepareQualityPhoto(body = {}) {
  const bookingId = cleanText(body.bookingId, 120);
  const stage = stageFor(body.stage);
  const file = validatePhoto(body);
  const booking = await getBooking(bookingId);
  if (!booking) throw Object.assign(new Error("Booking not found."), { statusCode: 404 });
  if (!hasPaidDeposit(booking)) {
    throw Object.assign(new Error("Quality photos are available only after the 25% deposit is paid."), { statusCode: 409 });
  }
  if (booking.status === "Cancelled") {
    throw Object.assign(new Error("Pictures cannot be added to a cancelled booking."), { statusCode: 409 });
  }
  const existing = qualityState(booking);
  if (existing[stage].length >= MAX_QUALITY_PHOTOS_PER_STAGE) {
    throw Object.assign(new Error(`This booking already has the maximum of 200 ${stage} pictures.`), { statusCode: 409 });
  }

  const { auth, config, drive } = getGoogleClients();
  const folders = await ensureFolders(booking, drive, config);
  const index = totalPhotos(folders) + 1;
  const name = `${cleanText(booking.estimate?.orderNumber || booking.id, 80)}-${stage}-${String(index).padStart(3, "0")}-${safeName(body.fileName)}`;
  const access = await auth.getAccessToken();
  const accessToken = typeof access === "string" ? access : access?.token;
  if (!accessToken) throw Object.assign(new Error("Picture upload is temporarily unavailable."), { statusCode: 503 });

  const started = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size,mimeType,thumbnailLink,createdTime", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": file.mimeType,
      "X-Upload-Content-Length": String(file.size)
    },
    body: JSON.stringify({
      name,
      parents: [stage === "before" ? folders.beforeFolderId : folders.afterFolderId],
      appProperties: { iman_record_type: "booking_quality_photo", booking_id: booking.id, stage }
    })
  });
  if (!started.ok) {
    throw Object.assign(new Error("Picture upload could not be prepared."), { statusCode: started.status });
  }
  const uploadUrl = started.headers.get("location");
  if (!uploadUrl) throw new Error("Picture upload could not be prepared.");
  return { uploadUrl, name, mimeType: file.mimeType, stage };
}

async function recordQualityPhoto(body = {}) {
  const bookingId = cleanText(body.bookingId, 120);
  const stage = stageFor(body.stage);
  const upload = body.upload && typeof body.upload === "object" ? body.upload : {};
  const id = cleanText(upload.id, 180);
  if (!id) throw Object.assign(new Error("The uploaded picture ID is missing."), { statusCode: 400 });
  const booking = await getBooking(bookingId);
  if (!booking) throw Object.assign(new Error("Booking not found."), { statusCode: 404 });
  const current = qualityState(booking);
  const all = [...current.before, ...current.after];
  if (all.some((photo) => photo.id === id)) return { qualityPhotos: current, duplicate: true };
  if (current[stage].length >= MAX_QUALITY_PHOTOS_PER_STAGE) {
    throw Object.assign(new Error(`This booking already has the maximum of 200 ${stage} pictures.`), { statusCode: 409 });
  }
  const photo = {
    id,
    name: cleanText(upload.name || body.fileName || "Quality photo", 180),
    mimeType: cleanText(upload.mimeType || body.mimeType, 100),
    size: Number(upload.size || body.size || 0),
    webViewLink: cleanText(upload.webViewLink, 1000),
    thumbnailLink: cleanText(upload.thumbnailLink, 1000),
    uploadedAt: cleanText(upload.createdTime, 80) || new Date().toISOString()
  };
  const next = { ...current, [stage]: [...current[stage], photo] };
  await updateBookingEstimate(booking.id, { ...(booking.estimate || {}), qualityPhotos: next });
  return { qualityPhotos: next, photo };
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  MAX_FILE_BYTES,
  MAX_QUALITY_PHOTOS_PER_STAGE,
  prepareQualityPhoto,
  qualityState,
  recordQualityPhoto,
  safeName,
  stageFor,
  totalPhotos,
  validatePhoto
};
