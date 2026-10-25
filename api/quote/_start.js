const {
  driveFolderLink,
  getGoogleClients,
  json,
  makeFolderName,
  makeQuoteId,
  readJsonBody,
  signQuotePayload,
  validateQuoteFormFields
} = require("./_shared");
const { isNYCServiceZip } = require("../booking/_shared");
const walkthrough = require("../../walkthrough-fields");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const body = await readJsonBody(request);
    const formFields = walkthrough.isWalkthrough(body.formFields)
      ? walkthrough.validate(body.formFields)
      : validateQuoteFormFields(body.formFields || {});
    if (!isNYCServiceZip(formFields["ZIP Code"])) {
      return json(response, 400, { error: "Enter a ZIP code within our New York City service area." });
    }
    const quoteId = makeQuoteId();
    const { config, drive } = getGoogleClients();

    const folder = await drive.files.create({
      requestBody: {
        name: makeFolderName(quoteId, formFields),
        mimeType: "application/vnd.google-apps.folder",
        parents: [config.parentFolderId],
        appProperties: {
          iman_record_type: walkthrough.isWalkthrough(formFields) ? "walkthrough_upload_folder" : "quote_upload_folder",
          quote_id: quoteId
        }
      },
      fields: "id, name, webViewLink"
    });

    const folderId = folder.data.id;
    const uploadToken = signQuotePayload({
      purpose: "quote_file_upload",
      quoteId,
      folderId,
      expiresAt: Date.now() + 60 * 60 * 1000
    });

    return json(response, 201, {
      quoteId,
      folderId,
      folderName: folder.data.name,
      folderLink: folder.data.webViewLink || driveFolderLink(folderId),
      uploadToken
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Quote upload could not be started.",
      field: error.field,
      setup: error.setup
    });
  }
};
