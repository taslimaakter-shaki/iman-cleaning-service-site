const {
  cleanText,
  getGoogleClients,
  json,
  readJsonBody,
  verifyQuoteToken
} = require("./_shared");

const MAX_FILES = 50;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm"
]);

function safeFileName(value) {
  return cleanText(value, "upload-file")
    .replace(/[^\w.()\- ]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 140) || "upload-file";
}

function validateFile(body) {
  const mimeType = cleanText(body.mimeType).toLowerCase();
  const size = Number(body.size || 0);
  const index = Number(body.index || 0);
  if (!Number.isInteger(index) || index < 1 || index > MAX_FILES) {
    throw Object.assign(new Error(`Please upload no more than ${MAX_FILES} files.`), { statusCode: 400 });
  }
  if (!ALLOWED_FILE_TYPES.has(mimeType)) {
    throw Object.assign(new Error("Upload a JPG, PNG, HEIC, HEIF, MP4, MOV, WebM, or PDF file."), { statusCode: 400 });
  }
  if (!Number.isFinite(size) || size < 1 || size > MAX_FILE_BYTES) {
    throw Object.assign(new Error("Each file must be 15 MB or smaller."), { statusCode: 413 });
  }
  return { index, mimeType, size };
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    const body = await readJsonBody(request);
    const session = verifyQuoteToken(body.uploadToken);
    if (session.purpose !== "quote_file_upload" || !session.quoteId || !session.folderId) {
      return json(response, 400, { error: "Invalid walkthrough upload session." });
    }
    const file = validateFile(body);
    const paddedIndex = String(file.index).padStart(3, "0");
    const name = `${session.quoteId}-${paddedIndex}-${safeFileName(body.fileName)}`;
    const { auth } = getGoogleClients();
    const access = await auth.getAccessToken();
    const accessToken = typeof access === "string" ? access : access?.token;
    if (!accessToken) throw Object.assign(new Error("File upload is temporarily unavailable."), { statusCode: 503 });

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
        appProperties: {
          iman_record_type: "quote_uploaded_file",
          quote_id: session.quoteId
        }
      })
    });
    if (!started.ok) {
      throw Object.assign(new Error("File upload could not be prepared."), { statusCode: started.status });
    }
    const uploadUrl = started.headers.get("location");
    if (!uploadUrl) throw new Error("File upload could not be prepared.");
    return json(response, 200, { uploadUrl, name, mimeType: file.mimeType });
  } catch (error) {
    return json(response, error.statusCode || 500, { error: error.message || "File upload could not be prepared." });
  }
};
