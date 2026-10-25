const {
  buildQuoteEmail,
  cleanText,
  getGoogleClients,
  json,
  readJsonBody,
  validateQuoteFormFields
} = require("./_shared");
const { isNYCServiceZip } = require("../booking/_shared");
const { trySendFormSubmissionNotification } = require("../_form-notifications");
const { sendPhotoUploadRequest, sendQuoteSubmissionReceipt, saveCustomQuoteRecord, siteUrl } = require("./_photo-later");
const walkthrough = require("../../walkthrough-fields");

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
    const isWalkthrough = walkthrough.isWalkthrough(body.formFields);
    const formFields = isWalkthrough ? walkthrough.validate(body.formFields) : validateQuoteFormFields(body.formFields || {});
    const photos = Array.isArray(body.photos) ? body.photos : [];
    if (!quoteId || !folderLink) {
      return json(response, 400, { error: "quoteId and folderLink are required." });
    }
    if (!isNYCServiceZip(formFields["ZIP Code"])) {
      return json(response, 400, { error: "Enter a ZIP code within our New York City service area." });
    }

    const { config, drive, gmail } = getGoogleClients();
    const uploadLater = String(formFields["Photo Upload Preference"] || "").toLowerCase() === "later";
    const customQuoteRecord = {
      quoteId,
      type: "custom_quote",
      status: isWalkthrough ? "Walkthrough requested" : uploadLater ? "Awaiting photos" : "Submitted",
      createdAt: new Date().toISOString(),
      folderId: String(body.folderId || ""),
      folderLink,
      formFields,
      photoCount: photos.length,
      photoUpload: uploadLater ? {
        status: "Awaiting photos",
        photoCount: 0,
        requestedAt: new Date().toISOString(),
        remindersSent: []
      } : {
        status: photos.length ? "Photos received" : "Not requested",
        photoCount: photos.length,
        receivedAt: photos.length ? new Date().toISOString() : ""
      }
    };
    if (isWalkthrough) {
      // Reserve an immutable confirmation ID before saving the request. Drive rejects
      // duplicate creates for this ID, including concurrent CRM confirmation attempts.
      const reserved = await drive.files.generateIds({ count: 1, space: "drive", type: "files" });
      if (!reserved.data.ids?.[0]) throw new Error("Could not prepare the walkthrough request. Please try again.");
      customQuoteRecord.walkthroughConfirmationFileId = reserved.data.ids[0];
    }
    const recordFile = await drive.files.create({
      requestBody: {
        name: `${quoteId}-custom-quote.json`,
        parents: [config.parentFolderId],
        mimeType: "application/json",
        appProperties: {
          iman_record_type: "custom_quote",
          quote_id: quoteId
        }
      },
      media: { mimeType: "application/json", body: JSON.stringify(customQuoteRecord, null, 2) },
      fields: "id"
    });
    // Walkthrough submissions may contain up to 50 large files. Keep their
    // originals in Drive and send links instead of downloading and attaching
    // hundreds of megabytes to email.
    const attachments = isWalkthrough ? [] : await downloadAllPhotoAttachments(drive, photos);
    const attachmentFailureCount = isWalkthrough ? 0 : Math.max(0, photos.length - attachments.length);
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
      source: isWalkthrough ? "Walkthrough request" : "Quote request",
      fields: formFields,
      recordId: quoteId,
      folderLink,
      summaryLines: isWalkthrough ? [
        `Preferred walkthrough: ${formFields["Preferred Walkthrough Date"]}${formFields["Preferred Walkthrough Time"] ? ` at ${formFields["Preferred Walkthrough Time"]} (New York time)` : " (time to be confirmed)"}`,
        `Commercial property: ${formFields["Commercial Space Type"] || "Not specified"}`,
        `Files uploaded: ${photos.length}`,
        "Visit is requested, not confirmed."
      ] : [`Uploaded photos: ${photos.length}`]
    });

    let photoUploadDelivery = { status: uploadLater ? "pending" : "not_requested" };
    let customerConfirmation;
    const confirmationRecord = (delivery, includedWithPhotoUpload = false) => ({
      attemptedAt: new Date().toISOString(),
      includedWithPhotoUpload,
      sms: delivery.smsDelivery,
      email: delivery.emailDelivery
    });
    if (uploadLater) {
      try {
        const delivery = await sendPhotoUploadRequest({
          record: customQuoteRecord,
          baseUrl: siteUrl(request),
          submissionReceipt: true
        });
        customerConfirmation = confirmationRecord(delivery, true);
        customQuoteRecord.customerConfirmation = customerConfirmation;
        const sentAt = new Date().toISOString();
        customQuoteRecord.photoUpload = {
          ...customQuoteRecord.photoUpload,
          status: "Awaiting photos",
          uploadUrl: delivery.link.url,
          linkExpiresAt: new Date(delivery.link.expiresAt).toISOString(),
          lastSentAt: sentAt,
          smsStatus: delivery.smsDelivery.status,
          smsMessageId: delivery.smsDelivery.messageId || "",
          emailStatus: delivery.emailDelivery.status,
          emailMessageId: delivery.emailDelivery.messageId || "",
          scheduledReminders: delivery.scheduledReminders || []
        };
        await saveCustomQuoteRecord(drive, recordFile.data.id, customQuoteRecord);
        photoUploadDelivery = {
          status: [delivery.smsDelivery.status, delivery.emailDelivery.status].includes("sent") ? "sent" : "failed",
          smsStatus: delivery.smsDelivery.status,
          emailStatus: delivery.emailDelivery.status
        };
      } catch (error) {
        customQuoteRecord.photoUpload = {
          ...customQuoteRecord.photoUpload,
          status: "Awaiting photos",
          deliveryStatus: "failed",
          lastDeliveryError: cleanText(error.message || "Photo-upload request could not be sent.").slice(0, 300)
        };
        await saveCustomQuoteRecord(drive, recordFile.data.id, customQuoteRecord).catch(() => {});
        photoUploadDelivery = { status: "failed", error: customQuoteRecord.photoUpload.lastDeliveryError };
      }
    }
    if (!customerConfirmation) {
      // A separate receipt is needed only when the customer is not already
      // receiving the submission acknowledgement with their photo-upload link
      // (including when the upload link could not be generated).
      try {
        customerConfirmation = confirmationRecord(await sendQuoteSubmissionReceipt(customQuoteRecord));
      } catch (_) {
        customerConfirmation = confirmationRecord({
          smsDelivery: { status: "error", error: "Quote confirmation could not be sent." },
          emailDelivery: { status: "error", error: "Quote confirmation could not be sent." }
        });
      }
      customQuoteRecord.customerConfirmation = customerConfirmation;
      try {
        await saveCustomQuoteRecord(drive, recordFile.data.id, customQuoteRecord);
      } catch (_) {
        // The quote is saved and delivery may already have succeeded. Do not
        // tell the customer to resubmit because notification metadata failed.
        customerConfirmation = { ...customerConfirmation, trackingStatus: "save_failed" };
      }
    }

    return json(response, 200, {
      message: isWalkthrough ? "Walkthrough request sent." : "Quote request sent.",
      gmailMessageId: gmailMessageIds[0],
      gmailMessageIds,
      emailCount: gmailMessageIds.length,
      attachmentCount: attachments.length,
      attachmentFailureCount,
      ownerSmsStatus: ownerSms.status,
      ownerSmsMessageIds: ownerSms.sent.map((item) => item.messageId),
      photoUploadDelivery,
      customerConfirmation
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Quote notification could not be sent.",
      field: error.field,
      setup: error.setup
    });
  }
};
