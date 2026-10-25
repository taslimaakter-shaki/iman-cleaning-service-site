const assert = require("node:assert/strict");
const Module = require("node:module");
const { Readable } = require("node:stream");

process.env.QUOTE_APPROVAL_SECRET = "walkthrough-upload-test-only";
const shared = require("../api/quote/_shared");
const originalLoad = Module._load;
const originalFetch = global.fetch;
let preparedRequests = [];

Module._load = function(request, parent, isMain) {
  if (request === "./_shared" && /api\/quote\/_upload-url\.js$/.test(parent?.filename || "")) {
    return {
      ...shared,
      getGoogleClients: () => ({ auth: { getAccessToken: async () => "test-access-token" } })
    };
  }
  return originalLoad(request, parent, isMain);
};

global.fetch = async (url, options) => {
  preparedRequests.push({ url, options });
  return {
    ok: true,
    status: 200,
    headers: { get: name => name.toLowerCase() === "location" ? "https://google.test/resumable-session" : null }
  };
};

const handler = require("../api/quote/_upload-url");
Module._load = originalLoad;

function token(overrides = {}) {
  return shared.signQuotePayload({
    purpose: "quote_file_upload",
    quoteId: "QUOTE-UPLOAD-TEST",
    folderId: "folder-test",
    expiresAt: Date.now() + 60000,
    ...overrides
  });
}

async function request(body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = "POST";
  const res = { setHeader() {}, end(value) { this.data = JSON.parse(value); } };
  await handler(req, res);
  return res;
}

async function main() {
  let response = await request({
    uploadToken: token(), fileName: "Floor Plan.pdf", mimeType: "application/pdf",
    size: 15 * 1024 * 1024, index: 50
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.data.uploadUrl, "https://google.test/resumable-session");
  assert.equal(preparedRequests.length, 1);
  const started = preparedRequests[0];
  assert.equal(started.url, "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size,mimeType");
  assert.equal(started.options.headers["X-Upload-Content-Length"], String(15 * 1024 * 1024));
  assert.equal(JSON.parse(started.options.body).parents[0], "folder-test");

  response = await request({ uploadToken: token(), fileName: "large.pdf", mimeType: "application/pdf", size: 15 * 1024 * 1024 + 1, index: 1 });
  assert.equal(response.statusCode, 413);
  response = await request({ uploadToken: token(), fileName: "photo.jpg", mimeType: "image/jpeg", size: 100, index: 51 });
  assert.equal(response.statusCode, 400);
  response = await request({ uploadToken: token({ purpose: "wrong" }), fileName: "photo.jpg", mimeType: "image/jpeg", size: 100, index: 1 });
  assert.equal(response.statusCode, 400);
  assert.equal(preparedRequests.length, 1);
  console.log("Quote direct-upload tests passed: 15 MB accepted, 50-file boundary enforced, invalid and oversized requests rejected. No real uploads sent.");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; });
