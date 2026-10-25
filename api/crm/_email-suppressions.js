const { getGoogleClients } = require("../quote/_shared");
async function listEmailSuppressions() {
  const { drive, config } = getGoogleClients();
  const parent = String(config.parentFolderId || "").replace(/'/g, "\\'");
  const result = await drive.files.list({ q: [`'${parent}' in parents`, "trashed = false", "appProperties has { key='iman_record_type' and value='email_marketing_suppression' }"].join(" and "), fields: "files(id)", pageSize: 500 });
  const records = [];
  for (let index = 0; index < (result.data.files || []).length; index += 10) {
    const loaded = await Promise.all(result.data.files.slice(index, index + 10).map(async (file) => {
      try {
        const downloaded = await drive.files.get({ fileId: file.id, alt: "media" });
        const record = Buffer.isBuffer(downloaded.data) ? JSON.parse(downloaded.data.toString("utf8")) : (typeof downloaded.data === "string" ? JSON.parse(downloaded.data) : downloaded.data);
        return { email: String(record?.email || "").trim().toLowerCase(), unsubscribedAt: record?.unsubscribedAt || "" };
      } catch { return null; }
    }));
    records.push(...loaded.filter((record) => record?.email));
  }
  return records;
}
module.exports = { listEmailSuppressions };
