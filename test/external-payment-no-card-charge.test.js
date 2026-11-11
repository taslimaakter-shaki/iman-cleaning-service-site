const assert = require('node:assert/strict');
const payments = require('../api/booking/_payments');
const shared = require('../api/booking/_shared');
const deposit = require('../api/booking/_deposit-payment');
(async () => {
  const booking = { id: 'BK-ZELLE', status: 'New', schedule: '2030-01-01T14:00:00Z', estimate: { payment: {
    provider: 'external', method: 'zelle', paymentType: 'deposit_25',
    // Even stale card settings must never override an externally paid booking.
    balanceCollection: 'automatic_48h_authorization', totalCents: 20609, depositCents: 5152,
    paidCents: 5152, remainingCents: 15457, stripeCustomerId: 'cus_old', paymentMethodId: 'pm_old',
    remaining: { status: 'authorized', paymentIntentId: 'pi_old', amountCents: 15457 }
  } } };
  const before = JSON.stringify(booking);
  const forbidden = async () => { throw new Error('External payment must not call Stripe or rewrite paid amounts'); };
  assert.equal(payments.automaticBalanceCollection(booking), false);
  assert.equal((await payments.authorizeRemainingBalance({ booking, force: true, stripeCall: forbidden, updateEstimate: forbidden })).status, 'not_applicable');
  assert.equal((await payments.captureRemainingBalance({ bookingId: booking.id, getBookingRecord: async () => booking, stripeCall: forbidden, updateEstimate: forbidden })).status, 'not_applicable');
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_no_live_charges';
  const originalGetBooking = shared.getBooking;
  shared.getBooking = async () => booking;
  try {
    await assert.rejects(deposit.prepare(booking.id, {}), /external payment/);
    await assert.rejects(deposit._test.pay({ booking_id: booking.id, state: 'draft', draft: { guard: {} } }, 'ctoken_test'), /external payment/);
  } finally { shared.getBooking = originalGetBooking; }
  assert.equal(JSON.stringify(booking), before, 'Deposit and remaining balance stay recorded without being marked paid');
  const fs = require('node:fs'), vm = require('node:vm');
  const file = require('node:path').resolve(__dirname, '../api/crm/[action].js');
  const realRequire = require('node:module').createRequire(file);
  const m = { exports: {} };
  let captureCalls = 0, balanceNotices = 0;
  const reviewChoices = [];
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports.complete = updateStatus;', {
    module: m, process, console, Buffer, URL,
    require: name => {
      if (name === '../booking/_shared') return { ...realRequire(name),
        getBooking: async () => booking,
        updateBooking: async (_id, patch) => Object.assign(booking, patch),
        json: (_res, status, body) => ({ status, body })
      };
      if (name === '../booking/_payments') return { ...payments, captureRemainingBalance: async () => { captureCalls++; throw new Error('Must not capture'); } };
      if (name === './_external-payment') return { notifyBalanceDue: async () => { balanceNotices++; return {}; } };
      if (name === '../booking/_review-request') return {
        scheduleReviewRequest: async () => { reviewChoices.push(true); return { status: 'scheduled' }; },
        cancelPendingReviewRequest: async () => { reviewChoices.push(false); return { status: 'not_requested' }; }
      };
      return realRequire(name);
    }
  });
  for (const [current, target] of [
    ['New', 'Completed'],
    ['In progress', 'Confirmed'],
    ['Completed', 'New'],
    ['Completed', 'Confirmed'],
    ['Cancelled', 'Confirmed'],
    ['Cancelled', 'Cancelled']
  ]) {
    booking.status = current;
    const rejected = await m.exports.complete({ id: booking.id, status: target }, {}, {});
    assert.equal(rejected.status, 409, `${current} → ${target}`);
    assert.equal(booking.status, current);
  }
  assert.equal(captureCalls, 0);
  assert.equal(balanceNotices, 0);
  assert.deepEqual(reviewChoices, []);
  booking.status = "Confirmed";
  booking.estimate.payment.status = "refunded";
  assert.equal((await m.exports.complete({ id: booking.id, status: "In progress" }, {}, {})).status, 409);
  delete booking.estimate.payment.status;
  booking.estimate.rescheduling = { cancellationOperation: { source: "customer" } };
  assert.equal((await m.exports.complete({ id: booking.id, status: "Completed" }, {}, {})).status, 409);
  delete booking.estimate.rescheduling;
  assert.equal((await m.exports.complete({ id: booking.id, status: "Completed", expectedStatus: "New" }, {}, {})).status, 409);
  booking.status = "Confirmed";
  const result = await m.exports.complete({ id: booking.id, status: 'Completed' }, {}, {});
  assert.equal(result.status, 200);
  assert.equal(booking.status, 'Completed');
  assert.equal(captureCalls, 0);
  assert.equal(balanceNotices, 1);
  assert.deepEqual(reviewChoices, [false]);
  await m.exports.complete({ id: booking.id, status: 'Completed', sendReviewRequest: true }, {}, {});
  assert.deepEqual(reviewChoices, [false, true]);
  assert.equal(booking.estimate.payment.paidCents, 5152);
  assert.equal(booking.estimate.payment.remainingCents, 15457);
  console.log('External payments block card deposit, authorization, and capture, including stale card settings; recorded amounts preserved.');
})().catch(error => { console.error(error); process.exitCode = 1; });
