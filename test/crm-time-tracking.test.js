const assert = require("assert");
const {
  buildTimeTracking,
  hasPaidDeposit,
  shouldResetAuthorizationForReschedule
} = require("../api/crm/[action]")._test;

const paidBooking = {
  estimate: {
    total: 400,
    payment: { status: "deposit_paid", paidCents: 10000, depositCents: 10000 }
  }
};
const unpaidBooking = { estimate: { total: 400 } };

assert.strictEqual(hasPaidDeposit(paidBooking), true);
assert.strictEqual(hasPaidDeposit(unpaidBooking), false);

const clockedIn = buildTimeTracking({}, "clock_in", new Date("2026-09-02T13:00:00.000Z"));
assert.strictEqual(clockedIn.clockedIn, true);
assert.strictEqual(clockedIn.entries.length, 1);

const clockedOut = buildTimeTracking(clockedIn, "clock_out", new Date("2026-09-02T15:35:00.000Z"));
assert.strictEqual(clockedOut.clockedIn, false);
assert.strictEqual(clockedOut.totalMinutes, 155);
assert.strictEqual(clockedOut.entries[0].minutes, 155);

assert.throws(() => buildTimeTracking(clockedIn, "clock_in"), /already clocked in/i);
assert.throws(() => buildTimeTracking({}, "clock_out"), /Clock in before/i);

const rescheduleNow = new Date("2026-09-23T12:00:00.000Z");
assert.strictEqual(shouldResetAuthorizationForReschedule(
  "2026-09-24T12:00:00.000Z",
  "2026-09-28T12:00:00.000Z",
  rescheduleNow
), true);
assert.strictEqual(shouldResetAuthorizationForReschedule(
  "2026-09-24T12:00:00.000Z",
  "2026-09-24T11:59:59.000Z",
  rescheduleNow
), false);
assert.strictEqual(shouldResetAuthorizationForReschedule(
  "2026-09-24T12:00:00.000Z",
  "2026-09-24T12:00:00.000Z",
  rescheduleNow
), false);

console.log("CRM time tracking tests passed");
