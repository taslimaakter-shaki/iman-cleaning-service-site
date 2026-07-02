const {
  attachmentFromDataUrl,
  buildQuoteEmail,
  getGoogleClients,
  json,
  readJsonBody
} = require("./_shared");

const MAX_ATTACHMENT_TOTAL = 2.5 * 1024 * 1024;

function selectAttachments(items) {
  const attachments = [];
  let total = 0;

  for (const item of (items || []).slice(0, 3)) {
    const attachment = attachmentFromDataUrl(item);
    if (!attachment) continue;
    if (total + attachment.size > MAX_ATTACHMENT_TOTAL) {
      return [];
    }
    total += attachment.size;
    attachments.push(attachment);
  }

  return attachments;
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

    const { gmail } = getGoogleClients();
    const attachments = selectAttachments(body.attachments);
    const email = buildQuoteEmail({
      quoteId,
      formFields,
      folderLink,
      photos,
      attachments
    });

    const sent = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: email.raw
      }
    });

    return json(response, 200, {
      message: "Quote request sent.",
      gmailMessageId: sent.data.id,
      attachmentCount: attachments.length
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Quote notification could not be sent.",
      setup: error.setup
    });
  }
};
