const {
  driveFolderLink,
  getGoogleClients,
  json,
  makeFolderName,
  makeQuoteId,
  readJsonBody
} = require("./_shared");
const { isNYCServiceZip } = require("../booking/_shared");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const body = await readJsonBody(request);
    const formFields = body.formFields || {};
    if (!isNYCServiceZip(formFields["ZIP Code"])) {
      return json(response, 400, { error: "Enter a ZIP code within our New York City service area." });
    }
    const quoteId = makeQuoteId();
    const { config, drive } = getGoogleClients();

    const folder = await drive.files.create({
      requestBody: {
        name: makeFolderName(quoteId, formFields),
        mimeType: "application/vnd.google-apps.folder",
        parents: [config.parentFolderId]
      },
      fields: "id, name, webViewLink"
    });

    const folderId = folder.data.id;

    return json(response, 201, {
      quoteId,
      folderId,
      folderName: folder.data.name,
      folderLink: folder.data.webViewLink || driveFolderLink(folderId)
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Quote upload could not be started.",
      setup: error.setup
    });
  }
};
