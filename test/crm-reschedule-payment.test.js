const assert = require("assert");
const {
  authorizationDue,
  authorizeRemainingBalance,
  cancelRemainingAuthorization
} = require("../api/booking/_payments");
const { shouldResetAuthorizationForReschedule } = require("../api/crm/[action]")._test;

const NOW = new Date("2026-09-23T12:00:00.000Z");
const PREVIOUS_SCHEDULE = "2026-09-24T12:00:00.000Z";

function authorizedBooking(schedule) {
  return {
    id: `BOOK-${schedule}`,
    client_name: "Reschedule Test",
    email: "customer@example.com",
    phone: "+15555550100",
    service: "deep",
    service_label: "Deep Cleaning",
    schedule,
    status: "Confirmed",
    estimate: {
      total: 800,
      payment: {
        paymentType: "deposit_25",
        balanceCollection: "automatic_48h_authorization",
        status: "deposit_paid",
        totalCents: 80000,
        depositCents: 20000,
        paidCents: 20000,
        remainingCents: 60000,
        stripeCustomerId: "cus_test",
        paymentMethodId: "pm_test",
        remaining: {
          status: "authorized",
          amountCents: 60000,
          attempts: 1,
          paymentIntentId: "pi_old_hold"
        }
      }
    }
  };
}

async function runScenario(hoursUntilNewAppointment) {
  const schedule = new Date(NOW.getTime() + hoursUntilNewAppointment * 3600000).toISOString();
  const booking = authorizedBooking(schedule);
  const stripeCalls = [];
  const stripeCall = async (call) => {
    stripeCalls.push(call);
    if (call.path.endsWith("/cancel")) return { id: "pi_old_hold", status: "canceled" };
    return { id: "pi_replacement_hold", status: "requires_capture", latest_charge: {} };
  };
  const updateEstimate = async (_id, estimate) => { booking.estimate = estimate; };

  if (shouldResetAuthorizationForReschedule(PREVIOUS_SCHEDULE, schedule, NOW)) {
    await cancelRemainingAuthorization({
      booking,
      resetForReschedule: true,
      now: NOW,
      stripeCall,
      updateEstimate
    });
    if (authorizationDue(booking, NOW)) {
      await authorizeRemainingBalance({
        booking,
        now: NOW,
        stripeCall,
        updateEstimate,
        notify: async () => ({ status: "skipped" })
      });
    }
  }
  return { booking, stripeCalls };
}

async function run() {
  const future = await runScenario(72);
  assert.deepStrictEqual(future.stripeCalls.map((call) => call.path), ["payment_intents/pi_old_hold/cancel"]);
  assert.strictEqual(future.booking.estimate.payment.remaining.status, "pending");
  assert.strictEqual(future.booking.estimate.payment.remaining.paymentIntentId, "");
  assert.strictEqual(future.booking.estimate.payment.paidCents, 20000, "The deposit must remain paid.");

  const withinWindow = await runScenario(36);
  assert.deepStrictEqual(withinWindow.stripeCalls.map((call) => call.path), [
    "payment_intents/pi_old_hold/cancel",
    "payment_intents"
  ]);
  assert.strictEqual(withinWindow.booking.estimate.payment.remaining.status, "authorized");
  assert.strictEqual(withinWindow.booking.estimate.payment.remaining.paymentIntentId, "pi_replacement_hold");
  assert.strictEqual(withinWindow.booking.estimate.payment.paidCents, 20000, "The deposit must remain paid.");

  const shortNotice = await runScenario(20);
  assert.strictEqual(shortNotice.stripeCalls.length, 0);
  assert.strictEqual(shortNotice.booking.estimate.payment.remaining.status, "authorized");
  assert.strictEqual(shortNotice.booking.estimate.payment.remaining.paymentIntentId, "pi_old_hold");
  assert.strictEqual(shortNotice.booking.estimate.payment.paidCents, 20000, "The deposit must remain paid.");

  console.log("CRM reschedule payment tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
