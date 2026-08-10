const assert = require("assert");
const {
  automaticBalanceCollection,
  authorizationDue,
  authorizeRemainingBalance,
  cancelRemainingAuthorization,
  captureRemainingBalance,
  paymentAmounts,
  processDuePaymentAuthorizations
} = require("../api/booking/_payments");

function booking(overrides = {}) {
  return {
    id: "BOOK-25",
    client_name: "Test Customer",
    email: "customer@example.com",
    phone: "+15555550100",
    service: "deep",
    service_label: "Deep Cleaning",
    schedule: "2026-08-11T12:00:00.000Z",
    status: "Confirmed",
    estimate: {
      total: 100,
      payment: {
        paymentType: "deposit_25",
        balanceCollection: "automatic_48h_authorization",
        status: "deposit_paid",
        totalCents: 10000,
        paidCents: 2500,
        depositCents: 2500,
        remainingCents: 7500,
        stripeCustomerId: "cus_test",
        paymentMethodId: "pm_test",
        remaining: { status: "pending", amountCents: 7500, attempts: 0 }
      }
    },
    ...overrides
  };
}

async function testAmountsAndEligibility() {
  const current = booking();
  assert.deepStrictEqual(paymentAmounts(current), {
    totalCents: 10000,
    depositCents: 2500,
    remainingCents: 7500
  });
  assert.strictEqual(automaticBalanceCollection(current), true);
  assert.strictEqual(automaticBalanceCollection(booking({
    estimate: { total: 100, payment: { paymentType: "full", paidCents: 10000 } }
  })), false);
}

async function testFortyEightHourWindow() {
  const current = booking();
  assert.strictEqual(authorizationDue(current, new Date("2026-08-09T12:00:00.000Z")), true);
  assert.strictEqual(authorizationDue(current, new Date("2026-08-09T11:59:59.000Z")), false);
  assert.strictEqual(authorizationDue(current, new Date("2026-08-11T12:00:01.000Z")), false);
}

async function testAuthorizationAndIdempotentState() {
  const current = booking();
  const stripeCalls = [];
  const updates = [];
  const stripeCall = async (call) => {
    stripeCalls.push(call);
    return {
      id: "pi_balance",
      status: "requires_capture",
      latest_charge: {
        payment_method_details: { card: { capture_before: 1786550400 } }
      }
    };
  };
  const updateEstimate = async (_id, estimate) => updates.push(estimate);
  const result = await authorizeRemainingBalance({
    booking: current,
    now: new Date("2026-08-09T12:00:00.000Z"),
    stripeCall,
    updateEstimate,
    notify: async () => ({ status: "skipped" })
  });
  assert.strictEqual(result.status, "authorized");
  assert.strictEqual(stripeCalls.length, 1);
  assert.strictEqual(stripeCalls[0].params.amount, 7500);
  assert.strictEqual(stripeCalls[0].params.capture_method, "manual");
  assert.strictEqual(stripeCalls[0].params.off_session, "true");
  assert.strictEqual(updates.at(-1).payment.remaining.paymentIntentId, "pi_balance");

  const repeated = await authorizeRemainingBalance({
    booking: current,
    now: new Date("2026-08-09T13:00:00.000Z"),
    stripeCall,
    updateEstimate,
    notify: async () => ({ status: "skipped" })
  });
  assert.strictEqual(repeated.status, "already_authorized");
  assert.strictEqual(stripeCalls.length, 1);
}

async function testCaptureAndCancellation() {
  const current = booking();
  current.estimate.payment.remaining = {
    status: "authorized",
    amountCents: 7500,
    paymentIntentId: "pi_balance",
    attempts: 1
  };
  const stripeCalls = [];
  const stripeCall = async (call) => {
    stripeCalls.push(call);
    return { id: "pi_balance", status: "succeeded", latest_charge: "ch_balance" };
  };
  const updateEstimate = async (_id, estimate) => { current.estimate = estimate; };
  const captured = await captureRemainingBalance({
    bookingId: current.id,
    now: new Date("2026-08-11T16:00:00.000Z"),
    getBookingRecord: async () => current,
    stripeCall,
    updateEstimate,
    notify: async () => ({ status: "skipped" })
  });
  assert.strictEqual(captured.status, "captured");
  assert.match(stripeCalls[0].path, /\/capture$/);
  assert.strictEqual(current.estimate.payment.paidCents, 10000);
  assert.strictEqual(current.estimate.payment.remainingCents, 0);

  const rescheduled = booking();
  rescheduled.estimate.payment.remaining = {
    status: "authorized",
    amountCents: 7500,
    paymentIntentId: "pi_cancel"
  };
  const canceled = await cancelRemainingAuthorization({
    booking: rescheduled,
    resetForReschedule: true,
    stripeCall: async (call) => {
      assert.match(call.path, /\/cancel$/);
      return { id: "pi_cancel", status: "canceled" };
    },
    updateEstimate: async (_id, estimate) => { rescheduled.estimate = estimate; }
  });
  assert.strictEqual(canceled.status, "pending");
  assert.strictEqual(rescheduled.estimate.payment.remaining.paymentIntentId, "");
}

async function testExistingBookingsAreIgnored() {
  const oldBooking = booking({
    id: "BOOK-OLD",
    estimate: { total: 100, payment: { paymentType: "full", paidCents: 10000 } }
  });
  let authorizeCalls = 0;
  const result = await processDuePaymentAuthorizations({
    now: new Date("2026-08-09T12:00:00.000Z"),
    listBookings: async () => [oldBooking, booking()],
    authorize: async () => {
      authorizeCalls += 1;
      return { status: "authorized" };
    }
  });
  assert.strictEqual(result.checked, 2);
  assert.strictEqual(result.eligible, 1);
  assert.strictEqual(result.due, 1);
  assert.strictEqual(authorizeCalls, 1);
}

async function run() {
  await testAmountsAndEligibility();
  await testFortyEightHourWindow();
  await testAuthorizationAndIdempotentState();
  await testCaptureAndCancellation();
  await testExistingBookingsAreIgnored();
  console.log("booking payment tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
