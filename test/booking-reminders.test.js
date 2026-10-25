const assert = require("node:assert/strict");

const notifications = require("../api/booking/_notifications");
const reminders = require("../api/booking/_reminders");

const now = new Date("2026-10-01T14:00:00.000Z");

function booking(hoursUntil, estimate = {}) {
  return {
    id: `BK-${hoursUntil}`,
    status: "Confirmed",
    schedule: new Date(now.getTime() + hoursUntil * 3600000).toISOString(),
    client_name: "Amina",
    email: "amina@example.com",
    phone: "+19295550123",
    address: "123 Main Street, Queens, NY",
    service: "deep",
    service_label: "Deep Cleaning",
    estimate: { orderNumber: "12345678", payment: { status: "deposit_paid", paidCents: 10000 }, ...estimate }
  };
}

assert.equal(notifications.reminderStageForBooking(booking(24), now), "twenty_four_hours");
assert.equal(notifications.reminderStageForBooking(booking(23), now), "");
assert.equal(notifications.reminderStageForBooking(booking(6), now), "six_hours");
assert.equal(notifications.reminderStageForBooking(booking(5), now), "");
assert.equal(notifications.reminderStageForBooking(booking(1), now), "");
assert.equal(notifications.reminderStageForBooking(booking(-1), now), "");
assert.match(notifications.buildReminderSms(booking(24), "twenty_four_hours"), /in about 24 hours/i);
assert.match(notifications.buildReminderSms(booking(6), "six_hours"), /in about 6 hours/i);

(async () => {
  const sent = [];
  const updates = [];
  const result = await reminders.processDueReminders({
    now,
    listBookings: async () => [booking(24), booking(6)],
    sendEmail: async (_booking, stage) => (sent.push(`email:${stage}`), { status: "sent", messageId: `email-${stage}` }),
    sendSms: async (_booking, stage) => (sent.push(`sms:${stage}`), { status: "sent", messageId: `sms-${stage}` }),
    updateEstimate: async (id, estimate) => updates.push({ id, estimate })
  });
  assert.equal(result.sent, 2);
  assert.deepEqual(sent, ["email:twenty_four_hours", "sms:twenty_four_hours", "email:six_hours", "sms:six_hours"]);
  assert.equal(updates.length, 4, "each reminder is claimed before sending and recorded afterward");
  assert.ok(updates[0].estimate.reminders.twenty_four_hours.claimedAt);
  assert.ok(updates[1].estimate.reminders.twenty_four_hours.emailSentAt);

  const claimed = booking(6, { reminders: { six_hours: { claimedAt: now.toISOString() } } });
  const duplicate = await reminders.processDueReminders({
    now,
    listBookings: async () => [claimed],
    sendEmail: async () => { throw new Error("claimed reminder must not resend"); },
    sendSms: async () => { throw new Error("claimed reminder must not resend"); },
    updateEstimate: async () => { throw new Error("claimed reminder must not be rewritten"); }
  });
  assert.equal(duplicate.results[0].status, "already_sent");
  console.log("Booking reminder timing and duplicate protection tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
