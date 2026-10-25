const {
  clean,
  MAX_FILES,
  getGoogleClients,
  json,
  readJsonBody,
  safeFileName,
  validateFile,
  verifyCase
} = require("./_shared");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    const body = await readJsonBody(request);
    const session = verifyCase(body.uploadToken);
    const index = Number(body.index || 1);
    if (!Number.isInteger(index) || index < 1 || index > MAX_FILES) {
      return json(response, 400, { error: `Please upload no more than ${MAX_FILES} files.` });
    }
    const file = validateFile({ mimeType: body.mimeType, size: body.size });
    const name = `${session.caseNumber}-${safeFileName(body.fileName, index)}`;
    const { auth } = getGoogleClients();
    const access = await auth.getAccessToken();
    const accessToken = typeof access === "string" ? access : access?.token;
    if (!accessToken) throw Object.assign(new Error("Evidence upload is temporarily unavailable."), { statusCode: 503 });

    const started = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size,mimeType", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": file.mimeType,
        "X-Upload-Content-Length": String(file.size)
      },
      body: JSON.stringify({
        name,
        parents: [session.folderId],
        appProperties: { iman_record_type: "service_concern_evidence", case_number: session.caseNumber }
      })
    });
    if (!started.ok) {
      const details = await started.text();
      throw Object.assign(new Error("Evidence upload could not be prepared."), { statusCode: started.status, details: clean(details, 500) });
    }
    const uploadUrl = started.headers.get("location");
    if (!uploadUrl) throw new Error("Evidence upload could not be prepared.");
    return json(response, 200, { uploadUrl, name, mimeType: file.mimeType });
  } catch (error) {
    return json(response, error.statusCode || 500, { error: error.message || "Evidence upload could not be prepared." });
  }
};
