const assert = require('assert');
const { notifyOwner, details, sendOwnerEmail } = require('../api/booking/_reschedule-notifications');
const { buildFormSubmissionSms } = require('../api/_form-notifications');
const booking = { id: 'BK-TEST', client_name: 'Test Customer', phone: '+15555550100', email: 'customer@example.test', estimate: { rescheduling: { request: { previousSchedule: '2030-01-01T13:00:00Z', schedule: '2030-01-04T13:00:00Z', label: 'January 4 at 8 AM', feeCents: 2000 } } } };
(async () => {
  for (const event of ['requested', 'approved', 'declined']) {
    const calls = [];
    const delivery = await notifyOwner(booking, event, { email: async message => { calls.push(message.text); return { status: 'sent' }; }, sms: async payload => { calls.push(buildFormSubmissionSms(payload)); return { status: 'sent' }; } });
    assert.equal(delivery.email.status, 'sent'); assert.equal(delivery.sms.status, 'sent');
    for (const message of calls) { assert.match(message, /BK-TEST/); assert.match(message, /Test Customer/); assert.match(message, /\$20.00/); assert.match(message, /crm.html/); }
  }
  const partial = await notifyOwner(booking, 'requested', { email: async () => { throw new Error('Email outage'); }, sms: async () => ({ status: 'sent' }) });
  assert.equal(partial.email.status, 'error'); assert.equal(partial.sms.status, 'sent');
  const smsFailure = await notifyOwner(booking, 'approved', { email: async () => ({ status: 'sent' }), sms: async () => ({ status: 'not_configured' }) });
  assert.equal(smsFailure.email.status, 'sent'); assert.equal(smsFailure.sms.status, 'not_configured');
  const oldTo = process.env.QUOTE_EMAIL_TO; process.env.QUOTE_EMAIL_TO = 'owner@example.test';
  require('../api/quote/_shared').getGoogleClients = () => ({ gmail: { users: { messages: { send: async ({ requestBody }) => {
    const email = Buffer.from(requestBody.raw, 'base64url').toString();
    assert.match(email, /To: owner@example.test/); assert.match(email, /approval required/); assert.match(email, /original appointment remains confirmed/);
    return { data: { id: 'mock-email' } };
  } } } } });
  assert.equal((await sendOwnerEmail(details(booking, 'requested'))).status, 'sent');
  if (oldTo === undefined) delete process.env.QUOTE_EMAIL_TO; else process.env.QUOTE_EMAIL_TO = oldTo;
  console.log('Reschedule owner email and SMS notification tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
