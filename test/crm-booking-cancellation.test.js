const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { refundBookingPayment } = require("../api/booking/_payments");
const { cancellationAmountsForSource } = require("../api/crm/[action]")._test;

function booking(payment = {}) {
  return {
    id: "BOOK-CANCEL-25",
    schedule: "2026-10-20T16:00:00.000Z",
    estimate: {
      total: 200,
      payment: {
        status: "deposit_paid",
        totalCents: 20000,
        depositCents: 5000,
        paidCents: 5000,
        paymentIntentId: "pi_deposit",
        ...payment
      }
    }
  };
}

async function run() {
  const now = new Date("2026-10-16T16:00:00.000Z");
  assert.deepStrictEqual(cancellationAmountsForSource(booking(), "iman", now), {
    cancellationSource: "iman",
    lessThan48Hours: false,
    paidCents: 5000,
    depositCents: 5000,
    retainedCents: 0,
    refundCents: 5000
  });
  assert.deepStrictEqual(cancellationAmountsForSource(booking(), "customer", now), {
    cancellationSource: "customer",
    lessThan48Hours: false,
    paidCents: 5000,
    depositCents: 5000,
    retainedCents: 0,
    refundCents: 5000
  });
  assert.deepStrictEqual(cancellationAmountsForSource({
    ...booking({ paidCents: 20000 }),
    schedule: "2026-10-17T16:00:00.000Z"
  }, "customer", now), {
    cancellationSource: "customer",
    lessThan48Hours: true,
    paidCents: 20000,
    depositCents: 5000,
    retainedCents: 5000,
    refundCents: 15000
  });

  const calls = [];
  await refundBookingPayment({
    booking: booking(),
    amountCents: 5000,
    policy: "iman_cancelled_full_refund",
    reason: "",
    stripeCall: async (call) => {
      calls.push(call);
      return { id: "re_full", status: "succeeded" };
    }
  });
  assert.strictEqual(calls[0].params.reason, undefined);
  assert.strictEqual(calls[0].params["metadata[cancellation_policy]"], "iman_cancelled_full_refund");

  const crmScript = fs.readFileSync(path.join(__dirname, "..", "crm.js"), "utf8");
  assert.match(crmScript, /Canceled by Iman Cleaning/);
  assert.match(crmScript, /Canceled by customer/);
  assert.match(crmScript, /name="cancellationSource" value="iman" required/);
  assert.match(crmScript, /name="cancellationSource" value="customer" required/);
  assert.match(crmScript, /48 hours or more: full refund/i);
  assert.match(crmScript, /Less than 48 hours: keep the 25% deposit/i);

  console.log("CRM booking cancellation tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
