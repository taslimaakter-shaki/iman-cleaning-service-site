const crypto = require("crypto");
const { cleanText, getGoogleClients } = require("./_shared");

const RECORD_TYPE = "quote_approval_link";
const CODE_PATTERN = /^[A-Za-z0-9_-]{12}$/;

function approvalCode() {
  return crypto.randomBytes(9).toString("base64url");
}

function normalizeCode(value) {
  const code = cleanText(value, "");
  if (!CODE_PATTERN.test(code)) {
    const error = new Error("Invalid quote approval link.");
    error.statusCode = 400;
    throw error;
  }
  return code;
}

function driveJson(data) {
  if (Buffer.isBuffer(data)) return JSON.parse(data.toString("utf8"));
  if (typeof data === "string") return JSON.parse(data);
  return data || {};
}

async function createShortApproval(payload) {
  const code = approvalCode();
  const now = Date.now();
  const record = {
    version: 1,
    code,
    createdAt: now,
    expiresAt: Number(payload.expiresAt || now + 14 * 24 * 60 * 60 * 1000),
    quote: payload
  };
  const { drive, config } = getGoogleClients();
  await drive.files.create({
    requestBody: {
      name: `approval-${code}.json`,
      parents: [config.parentFolderId],
      mimeType: "application/json",
      appProperties: {
        iman_record_type: RECORD_TYPE,
        approval_code: code
      }
    },
    media: { mimeType: "application/json", body: JSON.stringify(record) },
    fields: "id"
  });
  return { code, expiresAt: record.expiresAt };
}

async function resolveShortApproval(value) {
  const code = normalizeCode(value);
  const { drive, config } = getGoogleClients();
  const parent = String(config.parentFolderId || "").replace(/'/g, "\\'");
  const listed = await drive.files.list({
    q: [
      `'${parent}' in parents`,
      "trashed = false",
      `appProperties has { key='iman_record_type' and value='${RECORD_TYPE}' }`,
      `appProperties has { key='approval_code' and value='${code}' }`
    ].join(" and "),
    fields: "files(id)",
    pageSize: 1
  });
  const file = listed.data.files?.[0];
  if (!file) {
    const error = new Error("Invalid quote approval link.");
    error.statusCode = 404;
    throw error;
  }
  const downloaded = await drive.files.get({ fileId: file.id, alt: "media" });
  const record = driveJson(downloaded.data);
  if (!record.quote || record.code !== code) {
    const error = new Error("Invalid quote approval link.");
    error.statusCode = 400;
    throw error;
  }
  if (record.expiresAt && Date.now() > Number(record.expiresAt)) {
    const error = new Error("This quote approval link has expired.");
    error.statusCode = 410;
    throw error;
  }
  return require("../crm/_quote-admin").resolveManaged(record.quote);
}

module.exports = { createShortApproval, resolveShortApproval };
module.exports._test = { approvalCode, normalizeCode, CODE_PATTERN };
