const assert = require("node:assert/strict");

process.env.ADMIN_TOKEN = "quote-reminder-test";
process.env.PUBLIC_SITE_URL = "https://www.imancleaningservice.com";

const reminders = require("../api/booking/_quote-reminders");
const savedQuotes = require("../api/booking/_saved-quote");
const now = new Date("2026-09-29T18:00:00.000Z");
const baseRecord = {
  quoteId: "SAVED-TEST-1",
  createdAt: now.getTime() - 48 * 60 * 60 * 1000,
  quoteReminderEligibleAt: now.getTime() - 48 * 60 * 60 * 1000,
  expiresAt: now.getTime() + 30 * 24 * 60 * 60 * 1000,
  customer: { firstName: "Amina", email: "amina@example.com", phone: "+19295550123" },
  communicationConsent: { transactionalSms: { granted: true } }
};

assert.equal(reminders.reminderStage(baseRecord, now), "fortyEight");
assert.equal(reminders.reminderStage({ ...baseRecord, quoteOpenedAt: now.toISOString() }, now), "");
assert.equal(reminders.reminderStage({ ...baseRecord, quoteReminderEligibleAt: undefined }, now), "");
assert.equal(reminders.reminderStage({ ...baseRecord, quoteReminders: { fortyEight: { completedAt: now.toISOString() } } }, now), "");
assert.equal(reminders.reminderStage({ ...baseRecord, quoteReminders: { twelve: { completedAt: now.toISOString() } } }, now), "", "legacy first-reminder history prevents a duplicate");
const fortySevenHourRecord = { ...baseRecord, createdAt: now.getTime() - 47 * 60 * 60 * 1000, quoteReminderEligibleAt: now.getTime() - 47 * 60 * 60 * 1000 };
assert.equal(reminders.reminderStage(fortySevenHourRecord, now), "");
const oneWeekRecord = { ...baseRecord, createdAt: now.getTime() - 7 * 24 * 60 * 60 * 1000, quoteReminderEligibleAt: now.getTime() - 7 * 24 * 60 * 60 * 1000 };
assert.equal(reminders.reminderStage(oneWeekRecord, now), "oneWeek");
assert.equal(reminders.reminderStage({ ...oneWeekRecord, quoteReminders: { oneWeek: { claimedAt: now.toISOString() } } }, now), "");
assert.equal(reminders.reminderStage({ ...oneWeekRecord, quoteReminders: { twentyFour: { completedAt: now.toISOString() } } }, now), "", "legacy final-reminder history prevents a duplicate");

const fortyEight = reminders.reminderCopy("fortyEight", baseRecord, "https://example.com/q");
assert.equal(fortyEight.subject, "A friendly reminder about your cleaning estimate");
assert.match(fortyEight.sms, /clean, comfortable space/);
assert.match(fortyEight.sms, /https:\/\/example\.com\/q/);
assert.match(fortyEight.sms, /Reply STOP to unsubscribe or HELP for help/);
const finalReminder = reminders.reminderCopy("oneWeek", baseRecord, "https://example.com/q");
assert.equal(finalReminder.subject, "A final reminder about your cleaning estimate");
assert.match(finalReminder.sms, /final reminder/);

assert.deepEqual([...reminders.bookedSavedQuoteIds([{ status: "Confirmed", estimate: { savedQuoteId: "SAVED-1" } }])], ["SAVED-1"]);
assert.deepEqual([...reminders.bookedSavedQuoteIds([{ status: "new", estimate: { savedQuoteId: "SAVED-2", payment: { status: "deposit_paid", paidCents: 0 } } }])], ["SAVED-2"]);
assert.deepEqual([...reminders.bookedSavedQuoteIds([{ status: "new", estimate: { savedQuoteId: "SAVED-3", paymentStatus: "succeeded" } }])], ["SAVED-3"]);
assert.equal(savedQuotes.bookingDisablesQuote({ status: "New", estimate: { savedQuoteId: "SAVED-1", payment: { paidCents: 0, status: "deposit_pending" } } }, "SAVED-1"), false);
assert.equal(savedQuotes.bookingDisablesQuote({ status: "Confirmed", estimate: { savedQuoteId: "SAVED-1", payment: { paidCents: 10000, status: "deposit_paid" } } }, "SAVED-1"), true);
assert.equal(savedQuotes.bookingDisablesQuote({ status: "Confirmed", estimate: { savedQuoteId: "OTHER", payment: { paidCents: 10000, status: "deposit_paid" } } }, "SAVED-1"), false);

(async () => {
  await assert.rejects(
    () => savedQuotes.assertQuoteUnused("SAVED-1", [{ status: "Confirmed", estimate: { savedQuoteId: "SAVED-1", payment: { paidCents: 10000 } } }]),
    error => error.statusCode === 410 && error.code === "QUOTE_ALREADY_BOOKED"
  );
  const record = JSON.parse(JSON.stringify(baseRecord));
  const sent = [];
  const saved = [];
  const result = await reminders.processDueQuoteReminders({
    now,
    listQuotes: async () => [{ record, file: { id: "file-1" } }],
    listBookings: async () => [],
    sendEmail: async () => (sent.push("email"), { status: "sent", messageId: "email-1" }),
    sendSms: async () => (sent.push("sms"), { status: "sent", messageId: "sms-1" }),
    saveQuote: async (_entry, next) => saved.push(next)
  });
  assert.deepEqual(sent, ["email", "sms"]);
  assert.equal(result.due, 1);
  assert.ok(saved[0].quoteReminders.fortyEight.completedAt);

  const bookedResult = await reminders.processDueQuoteReminders({
    now,
    listQuotes: async () => [{ record: JSON.parse(JSON.stringify(baseRecord)), file: { id: "file-1" } }],
    listBookings: async () => [{ status: "Confirmed", estimate: { savedQuoteId: baseRecord.quoteId } }],
    sendEmail: async () => { throw new Error("should not send"); },
    sendSms: async () => { throw new Error("should not send"); },
    saveQuote: async () => { throw new Error("should not save"); }
  });
  assert.equal(bookedResult.due, 0);

  let bookingReads = 0;
  const paidDuringRun = await reminders.processDueQuoteReminders({
    now,
    listQuotes: async () => [{ record: JSON.parse(JSON.stringify(baseRecord)), file: { id: "file-race" } }],
    listBookings: async () => ++bookingReads === 1 ? [] : [{
      status: "Confirmed",
      estimate: { savedQuoteId: baseRecord.quoteId, payment: { status: "deposit_paid", paidCents: 10000 } }
    }],
    sendEmail: async () => { throw new Error("a newly paid customer must not receive email"); },
    sendSms: async () => { throw new Error("a newly paid customer must not receive SMS"); },
    saveQuote: async () => { throw new Error("a newly paid quote must not be claimed"); }
  });
  assert.equal(paidDuringRun.due, 0);

  const olderDuplicate = { ...baseRecord, quoteId: "SAVED-OLDER", createdAt: baseRecord.createdAt - 1000, quoteReminderEligibleAt: baseRecord.createdAt - 1000 };
  const newestDuplicate = { ...baseRecord, quoteId: "SAVED-NEWEST" };
  const dedupeSent = [];
  const dedupeResult = await reminders.processDueQuoteReminders({
    now,
    listQuotes: async () => [
      { record: olderDuplicate, file: { id: "file-old" } },
      { record: newestDuplicate, file: { id: "file-new" } }
    ],
    listBookings: async () => [],
    sendEmail: async record => (dedupeSent.push(record.quoteId), { status: "sent", messageId: "email-dedupe" }),
    sendSms: async () => ({ status: "sent", messageId: "sms-dedupe" }),
    saveQuote: async () => {}
  });
  assert.deepEqual(dedupeSent, ["SAVED-NEWEST"]);
  assert.equal(dedupeResult.due, 1);

  const samePhoneDifferentEmail = {
    ...baseRecord,
    quoteId: "SAVED-SAME-PHONE",
    createdAt: baseRecord.createdAt - 2000,
    quoteReminderEligibleAt: baseRecord.createdAt - 2000,
    customer: { ...baseRecord.customer, email: "another@example.com" }
  };
  const identitySent = [];
  const newestIdentityQuote = JSON.parse(JSON.stringify({ ...baseRecord, quoteId: "SAVED-NEWEST-IDENTITY" }));
  await reminders.processDueQuoteReminders({
    now,
    listQuotes: async () => [
      { record: samePhoneDifferentEmail, file: { id: "file-same-phone" } },
      { record: newestIdentityQuote, file: { id: "file-newest" } }
    ],
    listBookings: async () => [],
    sendEmail: async record => (identitySent.push(record.quoteId), { status: "sent", messageId: "email-identity" }),
    sendSms: async () => ({ status: "sent", messageId: "sms-identity" }),
    saveQuote: async () => {}
  });
  assert.deepEqual(identitySent, ["SAVED-NEWEST-IDENTITY"]);
  console.log("Instant quote reminder tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
