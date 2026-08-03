const {
  buildQuoteEmail,
  cleanText,
  getGoogleClients,
  json,
  readJsonBody
} = require("./_shared");
const { trySendFormSubmissionNotification } = require("../_form-notifications");

const MAX_ATTACHMENT_BATCH_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 4;

function safeAttachmentName(photo, index) {
  const source = cleanText(photo.originalName || photo.name || `quote-photo-${index + 1}.jpg`);
  return source.replace(/[^\w.\- ()]+/g, "-").replace(/-+/g, "-").slice(0, 120) || `quote-photo-${index + 1}.jpg`;
}

async function downloadPhotoAttachment(drive, photo, index) {
  if (!photo?.id) return null;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const downloaded = await drive.files.get({
        fileId: photo.id,
        alt: "media"
      }, {
        responseType: "arraybuffer"
      });
      const buffer = Buffer.isBuffer(downloaded.data)
        ? downloaded.data
        : Buffer.from(downloaded.data || []);
      if (!buffer.length) throw new Error("Downloaded photo is empty.");
      return {
        filename: safeAttachmentName(photo, index),
        mimeType: photo.mimeType || "image/jpeg",
        content: buffer.toString("base64"),
        size: buffer.length
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Photo could not be downloaded from Google Drive.");
}

async function downloadAllPhotoAttachments(drive, photos) {
  const results = new Array(photos.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < photos.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await downloadPhotoAttachment(drive, photos[index], index);
      } catch (error) {
        results[index] = null;
      }
    }
  }
  const workerCount = Math.min(DOWNLOAD_CONCURRENCY, photos.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results.filter(Boolean);
}

function batchAttachments(attachments) {
  const batches = [];
  let batch = [];
  let batchBytes = 0;

  for (const attachment of attachments) {
    if (batch.length && batchBytes + attachment.size > MAX_ATTACHMENT_BATCH_BYTES) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(attachment);
    batchBytes += attachment.size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const body = await readJsonBody(request, 4 * 1024 * 1024);
    const quoteId = String(body.quoteId || "").trim();
    const folderLink = String(body.folderLink || "").trim();
    const formFields = body.formFields || {};
    const photos = Array.isArray(body.photos) ? body.photos : [];

    if (!quoteId || !folderLink) {
      return json(response, 400, { error: "quoteId and folderLink are required." });
    }

    const { drive, gmail } = getGoogleClients();
    const attachments = await downloadAllPhotoAttachments(drive, photos);
    const attachmentFailureCount = Math.max(0, photos.length - attachments.length);
    const attachmentBatches = batchAttachments(attachments);
    const emailBatches = attachmentBatches.length ? attachmentBatches : [[]];
    const gmailMessageIds = [];

    for (let index = 0; index < emailBatches.length; index += 1) {
      const attachmentBatchLabel = emailBatches.length > 1
        ? `Photo attachments ${index + 1} of ${emailBatches.length}`
        : "";
      const email = buildQuoteEmail({
        quoteId,
        formFields,
        folderLink,
        photos,
        attachments: emailBatches[index],
        attachmentBatchLabel,
        attachmentFailureCount
      });
      const sent = await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: email.raw
        }
      });
      gmailMessageIds.push(sent.data.id);
    }

    const ownerSms = await trySendFormSubmissionNotification({
      source: "Quote request",
      fields: formFields,
      recordId: quoteId,
      folderLink,
      summaryLines: [
        `Uploaded photos: ${photos.length}`
      ]
    });

    return json(response, 200, {
      message: "Quote request sent.",
      gmailMessageId: gmailMessageIds[0],
      gmailMessageIds,
      emailCount: gmailMessageIds.length,
      attachmentCount: attachments.length,
      attachmentFailureCount,
      ownerSmsStatus: ownerSms.status,
      ownerSmsMessageIds: ownerSms.sent.map((item) => item.messageId)
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Quote notification could not be sent.",
      setup: error.setup
    });
  }
};
