const crypto = require("crypto");
const { getGoogleClients } = require("../quote/_shared");

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase().slice(0, 240);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address."), { statusCode: 400 });
  return email;
}
function json(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}
async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
async function existingSuppression(drive, parentFolderId, emailHash) {
  const parent = String(parentFolderId || "").replace(/'/g, "\\'");
  const result = await drive.files.list({
    q: [`'${parent}' in parents`, "trashed = false", `appProperties has { key='email_hash' and value='${emailHash}' }`, "appProperties has { key='iman_record_type' and value='email_marketing_suppression' }"].join(" and "),
    fields: "files(id)", pageSize: 1
  });
  return result.data.files?.[0] || null;
}
module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    const email = cleanEmail((await readBody(request)).email);
    const emailHash = crypto.createHash("sha256").update(email).digest("hex");
    const { drive, config } = getGoogleClients();
    if (!await existingSuppression(drive, config.parentFolderId, emailHash)) {
      const record = { recordType: "email_marketing_suppression", email, unsubscribedAt: new Date().toISOString(), source: "Email unsubscribe page" };
      await drive.files.create({
        requestBody: { name: `EMAIL-UNSUBSCRIBE-${emailHash.slice(0, 12)}.json`, parents: [config.parentFolderId], mimeType: "application/json", appProperties: { iman_record_type: "email_marketing_suppression", email_hash: emailHash } },
        media: { mimeType: "application/json", body: JSON.stringify(record, null, 2) }, fields: "id"
      });
    }
    return json(response, 200, { ok: true });
  } catch (error) {
    return json(response, error.statusCode || 500, { error: error.statusCode ? error.message : "Unable to process the unsubscribe request." });
  }
};
