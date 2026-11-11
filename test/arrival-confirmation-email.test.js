const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
const notifications = require('../api/booking/_notifications');
const filename = path.resolve(__dirname, '../api/crm/[action].js');
const realRequire = createRequire(filename);
const original = {
  id: 'BK-ARRIVAL', status: 'Confirmed', schedule: '2030-10-01T08:00:00-04:00',
  client_name: 'Example Customer', email: 'customer@example.test', phone: '+15555550100',
  service_label: 'Standard Cleaning', address: 'Example address',
  estimate: { teamHours: 2, arrivalPreference: { key: 'any_day', flexible: true,
    windowStart: '08:00', windowEnd: '17:30', confirmationStatus: 'pending' } }
};
(async () => {
  for (const failure of ['', 'sms', 'email', 'missing-email']) {
    let saved = structuredClone(original), emails = [], texts = [];
    if (failure === 'missing-email') saved.email = '';
    const google = require('../api/quote/_shared');
    google.getGoogleClients = () => ({ gmail: { users: { messages: { send: async ({ requestBody }) => {
      if (failure === 'email') throw new Error('Email provider unavailable');
      emails.push(Buffer.from(requestBody.raw, 'base64url').toString());
      return { data: { id: 'email-confirmation' } };
    } } } } });
    const m = { exports: {} };
    const mockRequire = name => {
      if (name === '../booking/_shared') return { ...realRequire(name),
        getBooking: async () => saved,
        assertScheduleAvailable: async () => {},
        updateBooking: async (_id, patch) => { saved = { ...saved, ...patch }; },
        updateBookingGoogleCalendar: async () => ({ status: 'updated' }),
        json: (_response, status, body) => ({ status, body })
      };
      if (name === './_communications') return { ...realRequire(name), sendCustomerMessage: async value => {
        if (failure === 'sms') throw new Error('SMS provider unavailable');
        texts.push(value.message); return { messageId: 'sms-confirmation' };
      } };
      return realRequire(name);
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.confirm = confirmFlexibleArrival;',
      { module: m, exports: m.exports, require: mockRequire, process, console, Buffer, URL, setTimeout });
    const result = await m.exports.confirm({ id: original.id, arrivalTime: '13:00' }, {});
    assert.equal(result.status, 200);
    assert.equal(saved.estimate.arrivalPreference.confirmationStatus, 'confirmed');
    assert.equal(saved.schedule, '2030-10-01T13:00:00-04:00');
    assert.equal(result.body.emailNotification.status, failure === 'email' ? 'failed' : failure === 'missing-email' ? 'skipped' : 'sent');
    assert.equal(result.body.scheduleNotification.status, failure === 'sms' ? 'failed' : 'sent');
    if (emails.length) {
      assert.match(emails[0], /To: customer@example.test/);
      assert.match(emails[0], /Your cleaning arrival time is confirmed/);
      assert.match(emails[0], /October 1, 2030 at 1:00 PM/);
      assert.match(emails[0], /New York time/);
      assert.doesNotMatch(emails[0], /8:00 AM|in about 24 hours|in about six hours/);
      assert.match(emails[0], /Standard Cleaning/);
      assert.match(emails[0], /Example address/);
    }
    if (texts.length) assert.match(texts[0], /1:00 PM/);
  }
  const twoVisits = { ...original, schedule: '2030-10-01T13:00:00-04:00', schedule_label: '',
    estimate: { ...original.estimate, secondVisitSchedule: '2030-10-02T14:00:00-04:00' } };
  const email = notifications.buildReminderEmail(twoVisits, 'arrival_confirmed');
  assert.match(email.text, /October 1, 2030 at 1:00 PM/);
  assert.match(email.text, /October 2, 2030 at 2:00 PM/);
  console.log('Arrival confirmation email: saved exact time, both channels, independent failures, missing email, and two visits passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
