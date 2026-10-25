const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { arrivalConfirmationSchedule } = require("../api/crm/[action]")._test;

const flexibleBooking = {
  schedule: "2030-10-01T13:00:00.000Z",
  estimate: {
    teamHours: 5,
    calendarReservationHours: 6,
    arrivalPreference: {
      key: "any_day",
      flexible: true,
      windowStart: "08:00",
      windowEnd: "16:00",
      windowLabel: "8:00 AM–2:30 PM"
    }
  }
};

assert.equal(arrivalConfirmationSchedule(flexibleBooking, "08:00"), "2030-10-01T08:00:00-04:00");
assert.equal(arrivalConfirmationSchedule(flexibleBooking, "14:30"), "2030-10-01T14:30:00-04:00");
assert.throws(() => arrivalConfirmationSchedule(flexibleBooking, "07:45"), /within the customer's/);
assert.throws(() => arrivalConfirmationSchedule(flexibleBooking, "14:45"), /within the customer's/);
assert.throws(() => arrivalConfirmationSchedule(flexibleBooking, "not-a-time"), /valid appointment time/);
assert.throws(() => arrivalConfirmationSchedule({ ...flexibleBooking, estimate: { arrivalPreference: { flexible: false } } }, "10:00"), /does not have a flexible arrival window/);

const root = path.join(__dirname, "..");
const crmSource = fs.readFileSync(path.join(root, "crm.js"), "utf8");
const apiSource = fs.readFileSync(path.join(root, "api", "crm", "[action].js"), "utf8");
assert.match(crmSource, /data-arrival-confirmation-form/);
assert.match(crmSource, /Confirm time & text customer/);
assert.match(crmSource, /bookingAction: "confirm_arrival"/);
assert.match(apiSource, /arrival time is confirmed for/);
assert.match(apiSource, /updateBookingGoogleCalendar/);

console.log("CRM flexible-arrival confirmation tests passed: window enforcement, dedicated control, calendar update, and customer text.");
