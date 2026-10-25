const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const shared = require("../api/quote/_shared");
const originalGoogleClients = shared.getGoogleClients;
const originalToken = process.env.ADMIN_TOKEN;
let downloadsFail = false;
let writes = 0;
let listCalls = [];
const records = {
  "concern-a": { type: "service_concern", caseNumber: "ICS-SC-TEST-1", status: "Submitted", createdAt: "2026-09-01T12:00:00Z", customerName: "Test Customer", folderId: "evidence-a", fields: { "Type of concern": ["Missed areas", "Damage"], "Detailed explanation": "Please review the kitchen.", "Service address": "Test address" }, uploads: [{ id: "photo-a", name: "photo.jpg", webViewLink: "javascript:alert(1)" }] },
  "concern-b": { type: "service_concern", caseNumber: "ICS-SC-TEST-2", status: "Submitted", createdAt: "2026-09-02T12:00:00Z", fields: {}, uploads: [] }
};
const metadata = (id) => ({ id, parents: ["parent-test"], appProperties: { iman_record_type: "service_concern", case_number: records[id]?.caseNumber } });
const drive = { files: {
  async list(params) {
    listCalls.push(params);
    return { data: params.pageToken ? { files: [metadata("concern-b")] } : { files: [metadata("concern-a")], nextPageToken: "page-2" } };
  },
  async get(params) {
    if (params.alt !== "media") return { data: params.fileId === "unrelated" ? { id: "unrelated", parents: ["somewhere-else"], appProperties: {} } : metadata(params.fileId) };
    if (downloadsFail) throw new Error("Drive unavailable");
    return { data: JSON.stringify(records[params.fileId]) };
  },
  async update(params) {
    writes++;
    assert.equal(params.requestBody.appProperties.iman_record_type, "service_concern");
    records[params.fileId] = JSON.parse(params.media.body);
    return { data: { id: params.fileId } };
  }
} };
shared.getGoogleClients = () => ({ drive, config: { parentFolderId: "parent-test" } });
const { listConcerns, updateConcern, toClientConcern } = require("../api/crm/_concerns");
const handler = require("../api/crm/[action]");
shared.getGoogleClients = originalGoogleClients;

async function request(method, body, token = "test-admin") {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.query = { action: "concerns" };
  req.headers = { "x-admin-token": token };
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(data) { this.body = JSON.parse(data); } };
  await handler(req, response);
  return response;
}

(async () => {
  process.env.ADMIN_TOKEN = "test-admin";
  assert.equal((await request("GET", undefined, "wrong-token")).statusCode, 401);
  assert.equal((await request("PATCH", {}, "")).statusCode, 401);
  assert.equal(listCalls.length, 0, "unauthenticated requests must not access records");
  assert.equal((await request("POST", {})).statusCode, 405);

  const all = await listConcerns();
  assert.deepEqual(all.map((item) => item.id), ["concern-b", "concern-a"]);
  assert.equal(listCalls[1].pageToken, "page-2", "all pages must be included");
  assert.match(listCalls[0].q, /service_concern/);
  assert.match(listCalls[0].q, /'parent-test' in parents/);
  assert.equal(all[1].concernType, "Missed areas, Damage");
  assert.equal(all[1].uploads[0].url, "https://drive.google.com/file/d/photo-a/view");
  assert.equal(toClientConcern({ type: "service_concern", folderId: 'bad/id', uploads: [{ id: 'bad/id' }] }, { id: "test" }).folderLink, "");

  downloadsFail = true;
  await assert.rejects(listConcerns, /Drive unavailable/, "record errors must not produce an incomplete list silently");
  downloadsFail = false;
  const payload = { id: "concern-a", status: "In review", internalNotes: "Called the customer.", updatedAt: records["concern-a"].createdAt };
  await assert.rejects(() => updateConcern({ ...payload, id: "unrelated" }), { statusCode: 404 });
  await assert.rejects(() => updateConcern({ ...payload, status: "Refunded" }), { statusCode: 400 });
  await assert.rejects(() => updateConcern({ ...payload, internalNotes: "x".repeat(5001) }), { statusCode: 400 });
  await assert.rejects(() => updateConcern({ ...payload, updatedAt: "stale" }), { statusCode: 409 });
  assert.equal(writes, 0);

  const updated = await request("PATCH", payload);
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.concern.status, "In review");
  assert.equal(updated.body.concern.internalNotes, "Called the customer.");
  assert.equal(records["concern-a"].fields["Detailed explanation"], "Please review the kitchen.");
  assert.equal(records["concern-a"].uploads[0].id, "photo-a");
  assert.equal(updated.body.concern.history.length, 1);
  const resolved = await updateConcern({ ...payload, status: "Resolved", updatedAt: updated.body.concern.updatedAt });
  assert.ok(resolved.resolvedAt);
  const reopened = await updateConcern({ ...payload, status: "Waiting on customer", updatedAt: resolved.updatedAt });
  assert.equal(reopened.resolvedAt, "");
  const refreshed = await request("GET");
  assert.equal(refreshed.statusCode, 200);
  assert.equal(refreshed.headers["Cache-Control"], "no-store");
  assert.equal(refreshed.body.concerns.find((item) => item.id === "concern-a").history.length, 3);
  console.log("CRM concerns tests passed: authentication, pagination, evidence links, statuses, persistence, and validation.");
})().catch((failure) => { console.error(failure); process.exitCode = 1; }).finally(() => {
  if (originalToken === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = originalToken;
});
