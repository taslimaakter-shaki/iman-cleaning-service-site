const assert = require("assert");
const {
  buildAdditionalWorkCompletionSms,
  buildTimeTrackingSms,
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

const breakStarted = buildTimeTracking(clockedIn, "break_in", new Date("2026-09-02T14:00:00.000Z"));
assert.strictEqual(breakStarted.onBreak, true);
assert.strictEqual(breakStarted.entries[0].breaks.length, 1);
assert.throws(() => buildTimeTracking(breakStarted, "break_in"), /already on a break/i);
assert.throws(() => buildTimeTracking(breakStarted, "clock_out"), /End the active break/i);

const breakEnded = buildTimeTracking(breakStarted, "break_out", new Date("2026-09-02T14:20:00.000Z"));
assert.strictEqual(breakEnded.onBreak, false);
assert.strictEqual(breakEnded.totalBreakMinutes, 20);
assert.strictEqual(breakEnded.entries[0].breaks[0].minutes, 20);

const clockedOut = buildTimeTracking(breakEnded, "clock_out", new Date("2026-09-02T15:35:00.000Z"));
assert.strictEqual(clockedOut.clockedIn, false);
assert.strictEqual(clockedOut.totalMinutes, 155);
assert.strictEqual(clockedOut.totalBreakMinutes, 20);
assert.strictEqual(clockedOut.workedMinutes, 135);
assert.strictEqual(clockedOut.entries[0].minutes, 155);

assert.throws(() => buildTimeTracking(clockedIn, "clock_in"), /already clocked in/i);
assert.throws(() => buildTimeTracking({}, "clock_out"), /Clock in before/i);
assert.throws(() => buildTimeTracking({}, "break_in"), /Clock in before/i);
assert.throws(() => buildTimeTracking(clockedIn, "break_out"), /Start a break before/i);

const smsBooking = { service_label: "Deep Cleaning" };
assert.match(buildTimeTrackingSms(smsBooking, "clock_in", new Date("2026-09-02T13:00:00.000Z")), /clocked in at 9:00 AM/i);
assert.match(buildTimeTrackingSms(smsBooking, "break_in", new Date("2026-09-02T14:00:00.000Z")), /started a break at 10:00 AM/i);
assert.match(buildTimeTrackingSms(smsBooking, "break_out", new Date("2026-09-02T14:20:00.000Z")), /resumed cleaning/i);
const clockOutSms = buildTimeTrackingSms(smsBooking, "clock_out", new Date("2026-09-02T15:35:00.000Z"), clockedOut);
assert.match(clockOutSms, /clocked out at 11:35 AM/i);
assert.match(clockOutSms, /Total cleaning time: 2 hrs 15 min \(2 hrs 35 min on site minus 20 min of breaks\)/i);
assert.match(clockOutSms, /Reply STOP/i);

const noBreakClockOut = buildTimeTracking(clockedIn, "clock_out", new Date("2026-09-02T14:00:00.000Z"));
assert.strictEqual(noBreakClockOut.workedMinutes, 60, "breaks should remain optional");
assert.match(
  buildTimeTrackingSms(smsBooking, "clock_out", new Date("2026-09-02T14:00:00.000Z"), noBreakClockOut),
  /Total cleaning time: 1 hr\./i
);
assert.doesNotMatch(
  buildTimeTrackingSms(smsBooking, "clock_out", new Date("2026-09-02T14:00:00.000Z"), noBreakClockOut),
  /break/i
);

const additionalWorkSms = buildAdditionalWorkCompletionSms({
  timeTracking: {
    entries: [{
      clockInAt: "2026-09-02T17:00:00.000Z",
      clockOutAt: "2026-09-02T18:35:00.000Z",
      seconds: 5700
    }]
  }
});
assert.match(additionalWorkSms, /Your additional work is complete/i);
assert.match(additionalWorkSms, /Additional work clock in: 1:00 PM/i);
assert.match(additionalWorkSms, /Clock out: 2:35 PM/i);
assert.match(additionalWorkSms, /Total time: 1 hr 35 min/i);
assert.match(additionalWorkSms, /Reply STOP/i);

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
