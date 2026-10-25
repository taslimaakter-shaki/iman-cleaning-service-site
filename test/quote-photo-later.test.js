const assert = require("assert");

process.env.QUOTE_APPROVAL_SECRET = "test-photo-link-secret";

const photoLater = require("../api/quote/_photo-later");

async function run() {
  const record = { quoteId: "QUOTE-202609080001", folderId: "drive-folder-123" };
  const link = photoLater._test.buildPhotoUploadUrl(record, "https://www.imancleaningservice.com", Date.now() + 3600000);
  const token = new URL(link.url).searchParams.get("token");
  const payload = photoLater._test.verifyPhotoUploadToken(token);
  assert.equal(payload.purpose, "custom_quote_photo_upload");
  assert.equal(payload.quoteId, record.quoteId);
  assert.equal(payload.folderId, record.folderId);
  assert.equal(photoLater._test.normalizePhoneNumber("(929) 232-1930"), "+19292321930");
  assert.equal(photoLater._test.normalizePhoneNumber("+1 929 232 1930"), "+19292321930");
  const reminders = photoLater._test.photoUploadReminderMessages("https://example.com/upload/abc123");
  assert.match(reminders.reminder12, /Reminder—please upload photos/);
  assert.match(reminders.reminder24, /Final reminder—please upload photos/);
  assert.match(reminders.reminder12, /https:\/\/example\.com\/upload\/abc123/);
  assert.match(reminders.reminder24, /https:\/\/example\.com\/upload\/abc123/);
  const reminderRecord = {
    quoteId: "QUOTE-REMINDER-1",
    formFields: { "First Name": "Jane", Email: "jane@example.com" },
    photoUpload: {
      uploadUrl: "https://example.com/upload/abc123",
      scheduledReminders: [
        { stage: "12_hours", status: "scheduled", messageId: "SM_DELIVERED" },
        { stage: "24_hours_final", status: "scheduled", messageId: "SM_FAILED" }
      ]
    }
  };
  const emails = [];
  const notifications = [];
  const refreshed = await photoLater.refreshPhotoUploadReminders(reminderRecord, {
    now: new Date("2026-09-24T12:00:00.000Z"),
    statusLookup: async (messageId) => messageId === "SM_DELIVERED"
      ? { status: "delivered", messageId }
      : { status: "undelivered", messageId, error: "Carrier rejected the message." },
    sendEmail: async (...args) => { emails.push(args); return { status: "sent", messageId: "email-1" }; },
    notify: async (payload) => { notifications.push(payload); return { status: "sent" }; }
  });
  assert.strictEqual(refreshed[0].status, "delivered");
  assert.strictEqual(refreshed[0].deliveredAt, "2026-09-24T12:00:00.000Z");
  assert.strictEqual(refreshed[1].status, "undelivered");
  assert.strictEqual(refreshed[1].fallbackEmail.status, "sent");
  assert.strictEqual(emails.length, 1);
  assert.strictEqual(notifications.length, 1);
  console.log("Quote photo-later tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
