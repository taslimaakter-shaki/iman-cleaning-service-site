const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const shared = require("../api/service-concern/_shared");
const notifications = require("../api/booking/_notifications");
const formNotifications = require("../api/_form-notifications");
const originalGoogleClients = shared.getGoogleClients;
const originalSms = notifications.sendCustomerSms;
const originalOwnerNotification = formNotifications.trySendFormSubmissionNotification;
const originalSecret = process.env.SERVICE_CONCERN_SECRET;
const records = [];
let emails = 0;
let texts = 0;
const evidenceFiles = {};

shared.getGoogleClients = () => ({
  config: { parentFolderId: "test-parent" },
  drive: { files: { async get({ fileId }) {
    return { data: evidenceFiles[fileId] || {} };
  }, async create(params) {
    records.push(JSON.parse(params.media.body));
    return { data: { id: "test-record" } };
  } } },
  gmail: { users: { messages: { async send() {
    emails++;
    return { data: { id: "test-email" } };
  } } } }
});
notifications.sendCustomerSms = async () => { texts++; return { status: "sent" }; };
formNotifications.trySendFormSubmissionNotification = async () => { texts++; return { status: "sent" }; };
const handler = require("../api/service-concern/_finish");
shared.getGoogleClients = originalGoogleClients;
notifications.sendCustomerSms = originalSms;
formNotifications.trySendFormSubmissionNotification = originalOwnerNotification;

const baseFields = {
  "Full name": "Test Customer", "Email address": "test@example.com", "Phone number": "2025550100",
  "Preferred contact method": "Email", "Service address": "123 Test Street",
  "Date of cleaning service": "2026-09-08", "Type of service": "Standard Cleaning",
  "Approximate time team left": "12:00", "Type of concern": "Area was not cleaned",
  "Areas affected": "Kitchen", "Detailed explanation": "Please review the kitchen counter.",
  "Reported before team left": "No, I noticed it after the team left",
  "When concern first noticed": "Today at noon",
  "Evidence unavailable explanation": "I no longer have access to the property."
};
const legacyFields = Object.fromEntries([
  "Accuracy confirmation", "Resolution disclaimer", "Contact authorization", "Booking-change acknowledgement"
].map(key => [key, "Confirmed"]));

async function request(confirmations, extraFields = {}, uploads = []) {
  const caseNumber = "ICS-SC-TEST-1000";
  const uploadToken = shared.signCase({ caseNumber, folderId: "test-evidence", expiresAt: Date.now() + 60000 });
  const req = Readable.from([JSON.stringify({ uploadToken, caseNumber, fields: { ...baseFields, ...confirmations, ...extraFields }, uploads })]);
  req.method = "POST";
  req.headers = {};
  const res = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
  await handler(req, res);
  return res;
}

(async () => {
  process.env.SERVICE_CONCERN_SECRET = "test-only-service-concern-secret";
  assert.equal((await request({})).statusCode, 400);
  for (const value of [false, true, "", "false", "on", ["Confirmed"]]) {
    assert.equal((await request({ "Customer confirmation": value })).statusCode, 400);
  }
  for (const missing of Object.keys(legacyFields)) {
    const partial = { ...legacyFields };
    delete partial[missing];
    assert.equal((await request(partial)).statusCode, 400);
  }
  assert.equal((await request({ ...legacyFields, "Customer confirmation": "" })).statusCode, 400);
  assert.equal(records.length, 0, "Missing confirmation must not create a case");
  assert.equal(emails + texts, 0, "Missing confirmation must not send notifications");

  const combined = await request({ "Customer confirmation": "Confirmed" });
  assert.equal(combined.statusCode, 200);
  assert.equal(records[0].fields["Customer confirmation"], "Confirmed");
  assert.equal(records[0].confirmationMethod, "single_checkbox");
  assert.match(records[0].fields["Evidence review status"], /Evidence exception/);
  for (const key of Object.keys(legacyFields)) assert.equal(records[0].fields[key], undefined);
  assert.equal(emails, 2);
  assert.equal(texts, 2);

  assert.equal((await request(legacyFields)).statusCode, 200, "Already-open legacy forms must still submit");
  assert.equal(records[1].confirmationMethod, "separate_checkboxes");
  for (const key of Object.keys(legacyFields)) assert.equal(records[1].fields[key], "Confirmed");
  const confirmation = { "Customer confirmation": "Confirmed" };
  const photoFields = { "Evidence unavailable explanation": "", "Evidence timing": "Immediately after the cleaning", "Photos taken before cleaning": "No" };
  const photos = ["photo-a", "photo-b"].map(id => {
    evidenceFiles[id] = { id, name: `${id}.jpg`, mimeType: "image/jpeg", size: 100, parents: ["test-evidence"], appProperties: { iman_record_type: "service_concern_evidence", case_number: "ICS-SC-TEST-1000" } };
    return { id, mimeType: "image/jpeg", size: 100 };
  });
  assert.equal((await request(confirmation, photoFields, [])).statusCode, 400);
  assert.equal((await request(confirmation, photoFields, [photos[0]])).statusCode, 400);
  assert.equal((await request(confirmation, photoFields, Array(11).fill(photos[0]))).statusCode, 400);
  assert.equal((await request(confirmation, photoFields, [photos[0], photos[0]])).statusCode, 400);
  evidenceFiles["photo-b"].parents = ["another-case"];
  assert.equal((await request(confirmation, photoFields, photos)).statusCode, 400);
  evidenceFiles["photo-b"].parents = ["test-evidence"];
  evidenceFiles["photo-b"].mimeType = "application/pdf";
  assert.equal((await request(confirmation, photoFields, photos)).statusCode, 400, "Client cannot claim a PDF is a photo");
  assert.equal(records.length, 2, "Invalid evidence must not create a case or send notifications");
  assert.equal(emails, 4);
  assert.equal(texts, 4);
  evidenceFiles["photo-b"].mimeType = "image/jpeg";
  assert.equal((await request(confirmation, photoFields, photos)).statusCode, 200);
  assert.equal(records[2].uploads.length, 2);
  assert.equal(records[2].uploads[1].webViewLink, "https://drive.google.com/file/d/photo-b/view");
  assert.equal(records[2].fields["Evidence review status"], "Supporting evidence provided");
  console.log("Service concern finish tests passed: required combined confirmation, legacy compatibility, saved records and mocked notifications.");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (originalSecret === undefined) delete process.env.SERVICE_CONCERN_SECRET;
  else process.env.SERVICE_CONCERN_SECRET = originalSecret;
});
