const {
  clean,
  getGoogleClients,
  json,
  makeCaseNumber,
  readJsonBody,
  signCase
} = require("./_shared");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    const body = await readJsonBody(request);
    const customerName = clean(body.customerName, 160);
    if (!customerName) return json(response, 400, { error: "Full name is required." });

    const caseNumber = makeCaseNumber();
    const { config, drive } = getGoogleClients();
    const folder = await drive.files.create({
      requestBody: {
        name: `${caseNumber} - ${customerName}`,
        mimeType: "application/vnd.google-apps.folder",
        parents: [config.parentFolderId],
        appProperties: { iman_record_type: "service_concern_folder", case_number: caseNumber }
      },
      fields: "id,name,webViewLink"
    });
    const folderId = folder.data.id;
    const uploadToken = signCase({
      caseNumber,
      folderId,
      customerName,
      expiresAt: Date.now() + 60 * 60 * 1000
    });
    return json(response, 201, {
      caseNumber,
      folderId,
      folderLink: folder.data.webViewLink || `https://drive.google.com/drive/folders/${folderId}`,
      uploadToken
    });
  } catch (error) {
    return json(response, error.statusCode || 500, { error: error.message || "The service concern could not be started." });
  }
};
