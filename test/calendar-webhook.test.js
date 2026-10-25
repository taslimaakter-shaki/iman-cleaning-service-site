const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const secret = 'whsec_test_only';
let confirmed = 0, expired = 0, additional = 0, approvals = 0, calendarStatus = 'created';
const moduleBox = { exports: {} };
const dependencies = {
  '../quote/_shared': { cleanText: value => String(value || ''), json: (r, status, body) => Object.assign(r, { status, body }) },
  '../quote/_payment-record': { sendPaymentRecordForSessionId: async ({ sessionId }) => { assert.equal(sessionId, 'cs_test_mock'); confirmed++; return { bookingConfirmed: true, calendarStatus }; } },
  '../booking/_additional-work': { recordAdditionalWorkPayment: async () => { additional++; return {}; } },
  '../booking/_additional-approval': { handlePaymentEvent: async () => { approvals++; return { orderId: 'mock-order', status: 'paid' }; } },
  '../booking/_calendar': { releaseExpiredSession: async () => { expired++; } }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/stripe/webhook.js'), 'utf8'), {
  module: moduleBox, require: name => dependencies[name] || require(name), Buffer, Date,
  process: { env: { STRIPE_WEBHOOK_SECRET: secret, PUBLIC_SITE_URL: 'https://www.imancleaningservice.com' } }
});
const base = { type: 'checkout.session.completed', data: { object: { id: 'cs_test_mock', mode: 'payment', payment_status: 'paid', metadata: { agreement_accepted: 'true', booking_id: 'BK-TEST' } } } };
async function call(event, options = {}) {
  const body = Buffer.from(JSON.stringify(event));
  const timestamp = options.timestamp || Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', options.secret || secret).update(`${timestamp}.`).update(body).digest('hex');
  const req = Readable.from([body]); req.method = 'POST'; req.headers = options.noSignature ? {} : { 'stripe-signature': `t=${timestamp},v1=${signature}` };
  const res = {}; await moduleBox.exports(req, res); return res;
}
(async () => {
  assert.equal((await call(base, { noSignature: true })).status, 400);
  assert.equal((await call(base, { secret: 'wrong' })).status, 400);
  assert.equal((await call(base, { timestamp: Math.floor(Date.now()/1000)-3600 })).status, 400);
  assert.equal(confirmed, 0);
  assert.equal((await call({ ...base, data: { object: { ...base.data.object, payment_status: 'unpaid' } } })).body.processed, false);
  assert.equal((await call(base)).status, 200); assert.equal(confirmed, 1);
  calendarStatus = 'error'; assert.equal((await call(base)).status, 503); assert.equal(confirmed, 2);
  calendarStatus = 'already_exists'; assert.equal((await call(base)).status, 200);
  assert.equal((await call({ type: 'checkout.session.expired', data: { object: { status: 'expired' } } })).status, 200); assert.equal(expired, 1);
  assert.equal((await call({ ...base, type: 'checkout.session.async_payment_succeeded' })).status, 200);
  assert.equal((await call({ ...base, data: { object: { ...base.data.object, metadata: { agreement_accepted: 'true', payment_type: 'additional_work' } } } })).status, 200); assert.equal(additional, 1);
  assert.equal((await call({ type: 'calendar.activation.check', data: { object: {} } })).body.processed, false);
  for (const type of ['payment_intent.succeeded','payment_intent.payment_failed','payment_intent.processing','payment_intent.requires_action','payment_intent.canceled']) {
    const event = { type, data: { object: { id: 'pi_mock', metadata: { payment_type: 'additional_work_approval' } } } };
    assert.equal((await call(event, { noSignature: true })).status, 400);
    assert.equal((await call(event)).body.orderId, 'mock-order');
    assert.equal((await call({ ...event, data: { object: { ...event.data.object, metadata: { payment_type: 'deposit_25' } } } })).body.processed, false);
  }
  assert.equal(approvals, 5);
  console.log('Calendar webhook tests passed: signed raw body, invalid/stale signature rejection, paid-only processing, calendar retries, expiry, asynchronous payments and unchanged additional-work routing.');
})().catch(error => { console.error(error); process.exitCode = 1; });
