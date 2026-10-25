const assert = require('node:assert/strict');
const Module = require('node:module');
const { Readable } = require('node:stream');

// In-memory providers only. Unexpected requests fail instead of contacting a service.
process.env.QUOTE_APPROVAL_SECRET = 'quote-receipt-test-only-secret';
process.env.QUOTE_EMAIL_FROM = 'info@imancleaningservice.com';
process.env.QUOTE_EMAIL_TO = 'owner@example.com';
process.env.TWILIO_ACCOUNT_SID = 'AC_RECEIPT_TEST';
process.env.TWILIO_AUTH_TOKEN = 'test-only';
process.env.TWILIO_FROM_NUMBER = '+12125550100';
process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG_RECEIPT_TEST';
process.env.PUBLIC_SITE_URL = 'https://www.imancleaningservice.com';
let records, emails, texts, ownerNotices, options, folders;
const clone = value => JSON.parse(JSON.stringify(value));
function reset(config = {}) { records = new Map(); emails = []; texts = []; ownerNotices = []; folders = []; options = config; }
const drive = { files: {
  async generateIds(params) { assert.equal(params.count, 1); return { data: { ids: ['walkthrough-confirmation-reserved'] } }; },
  async create(params) {
    if (options.createFails) throw Error('Mock storage failure');
    if (params.requestBody.mimeType === 'application/vnd.google-apps.folder') {
      folders.push(params.requestBody);
      return { data: { id: 'walkthrough-folder', name: params.requestBody.name, webViewLink: 'https://example.com/test-folder' } };
    }
    const id = 'quote-file-' + records.size;
    records.set(id, JSON.parse(params.media.body));
    return { data: { id } };
  },
  async get(params) {
    if (params.fileId === 'uploaded-photo') return { data: Buffer.from('mock-image') };
    assert.ok(records.has(params.fileId));
    return { data: clone(records.get(params.fileId)) };
  },
  async update(params) {
    if (options.saveFails) throw Error('Mock metadata failure');
    records.set(params.fileId, JSON.parse(params.media.body));
    return { data: { id: params.fileId } };
  }
} };
const gmail = { users: { messages: { async send(params) {
  const raw = Buffer.from(params.requestBody.raw, 'base64url').toString('utf8');
  emails.push(raw);
  const customer = /^To: customer@example.com\r?$/m.test(raw);
  if ((customer && options.emailFails) || (!customer && options.ownerFails)) throw Error('Mock email failure');
  return { data: { id: 'gmail-' + emails.length } };
} } } };
const shared = require('../api/quote/_shared');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === './_shared' && /api\/quote\/(?:_start|_finish|_photo-later)\.js$/.test(parent?.filename || '')) {
    return { ...shared, getGoogleClients: () => ({ config: { parentFolderId: 'parent' }, drive, gmail }) };
  }
  if (request === '../_form-notifications' && /api\/quote\//.test(parent?.filename || '')) {
    return { trySendFormSubmissionNotification: async payload => {
      ownerNotices.push(payload); return { status: 'sent', sent: [{ messageId: 'owner-sms' }] };
    } };
  }
  return originalLoad(request, parent, isMain);
};
const originalFetch = global.fetch;
global.fetch = async (url, request) => {
  assert.equal(url, 'https://api.twilio.com/2010-04-01/Accounts/AC_RECEIPT_TEST/Messages.json');
  const fields = Object.fromEntries(new URLSearchParams(request.body));
  texts.push(fields);
  if (options.smsThrows) throw Error('Mock SMS network failure');
  return { ok: !options.smsFails, status: options.smsFails ? 400 : 201,
    text: async () => JSON.stringify(options.smsFails ? { code: 21610, message: 'Recipient opted out.' } : { sid: 'SM_' + texts.length }) };
};
const finish = require('../api/quote/_finish');
const start = require('../api/quote/_start');
const photoLater = require('../api/quote/_photo-later');
Module._load = originalLoad;

function fields(overrides = {}) {
  return { 'First Name': 'Customer', 'Last Name': 'One', Email: 'customer@example.com', Phone: '(212) 555-0101',
    'ZIP Code': '11432', 'Service Type': 'Deep Cleaning', 'Photo Upload Preference': 'now', ...overrides };
}
function record(overrides = {}) { return { quoteId: 'QUOTE-TEST-RECEIPT', folderId: 'folder', formFields: fields(overrides) }; }
async function submit(overrides = {}, photos = [], method = 'POST') {
  const body = { quoteId: 'QUOTE-TEST-RECEIPT', folderId: 'folder', folderLink: 'https://drive.google.com/drive/folders/folder', formFields: fields(overrides), photos };
  const req = Readable.from([JSON.stringify(body)]); req.method = method; req.headers = {};
  const res = { setHeader() {}, end(text) { this.data = JSON.parse(text); } };
  await finish(req, res);
  return res;
}
const customerEmails = () => emails.filter(raw => /^To: customer@example.com\r?$/m.test(raw));
const immediateTexts = () => texts.filter(message => !message.ScheduleType);
const saved = () => [...records.values()][0];
const thankYou = 'Thank you for submitting a quote request to IMAN Cleaning Service! A member of our team will review your request and reach out to you shortly.';
async function main() {
  reset();
  let result = await submit({}, [{ id: 'uploaded-photo', originalName: 'kitchen.jpg', mimeType: 'image/jpeg' }]);
  assert.equal(result.statusCode, 200);
  assert.equal(emails.length, 2); assert.equal(customerEmails().length, 1);
  assert.equal(texts.length, 1); assert.equal(texts[0].To, '+12125550101');
  assert.ok(texts[0].Body.includes(thankYou)); assert.match(texts[0].Body, /Reply STOP to opt out/);
  assert.match(texts[0].Body, /not a confirmed appointment/);
  assert.ok(customerEmails()[0].includes(thankYou));
  assert.match(customerEmails()[0], /Subject: We received your quote request/);
  assert.match(customerEmails()[0], /Quote reference: QUOTE-TEST-RECEIPT/);
  assert.doesNotMatch(customerEmails()[0], /Content-Disposition: attachment|drive.google.com/);
  assert.match(emails[0], /Content-Disposition: attachment/);
  assert.equal(result.data.attachmentCount, 1); assert.equal(ownerNotices.length, 1);
  assert.equal(saved().customerConfirmation.sms.status, 'sent');
  assert.equal(saved().customerConfirmation.email.status, 'sent');
  assert.match(saved().customerConfirmation.sms.messageId, /^SM_/);
  assert.equal(saved().customerConfirmation.includedWithPhotoUpload, false);

  // All custom services use the same confirmation, even without uploaded files.
  for (const service of ['Extreme Cleaning', 'Office Cleaning', 'Organization']) {
    reset(); result = await submit({ 'Service Type': service });
    assert.equal(result.statusCode, 200); assert.equal(customerEmails().length, 1); assert.equal(texts.length, 1);
  }

  // Upload-later gets ONE combined receipt/link, with the same two scheduled reminders.
  reset(); const before = Date.now();
  result = await submit({ 'Photo Upload Preference': 'later' });
  assert.equal(result.statusCode, 200); assert.equal(customerEmails().length, 1);
  assert.equal(immediateTexts().length, 1); assert.equal(texts.length, 3);
  assert.ok(immediateTexts()[0].Body.includes(thankYou));
  assert.match(immediateTexts()[0].Body, /quote-photo-upload.html\?token=/);
  assert.match(customerEmails()[0], /Subject: Quote request received - upload photos/);
  const scheduled = texts.filter(message => message.ScheduleType === 'fixed');
  assert.equal(scheduled.length, 2);
  scheduled.forEach((message, index) => {
    assert.equal(message.To, '+12125550101');
    assert.ok(Math.abs(Date.parse(message.SendAt) - before - (index + 1) * 12 * 3600000) < 5000);
    assert.doesNotMatch(message.Body, /Thank you for submitting/);
  });
  assert.equal(saved().photoUpload.scheduledReminders.length, 2);
  assert.equal(saved().customerConfirmation.includedWithPhotoUpload, true);
  assert.equal(saved().customerConfirmation.sms.messageId, saved().photoUpload.smsMessageId);
  assert.equal(saved().customerConfirmation.email.messageId, saved().photoUpload.emailMessageId);

  // CRM resends and reminder messages retain their original copy.
  reset(); await photoLater.sendPhotoUploadRequest({ record: record(), baseUrl: 'https://example.com' });
  assert.match(immediateTexts()[0].Body, /We received your custom quote request/);
  assert.doesNotMatch(immediateTexts()[0].Body, /Thank you for submitting/);
  reset(); await photoLater.sendPhotoUploadRequest({ record: record(), baseUrl: 'https://example.com', reminderNumber: 1, submissionReceipt: true });
  assert.equal(texts.length, 1); assert.match(texts[0].Body, /This is a reminder/);
  assert.doesNotMatch(texts[0].Body, /Thank you for submitting/);

  // Either channel can fail independently; the accepted quote still succeeds.
  reset({ smsFails: true }); result = await submit();
  assert.equal(result.statusCode, 200); assert.equal(saved().customerConfirmation.sms.status, 'error');
  assert.equal(saved().customerConfirmation.email.status, 'sent'); assert.equal(texts.length, 1);
  reset({ smsThrows: true }); result = await submit();
  assert.equal(result.statusCode, 200); assert.equal(result.data.customerConfirmation.email.status, 'sent');
  reset({ emailFails: true }); result = await submit();
  assert.equal(result.statusCode, 200); assert.equal(saved().customerConfirmation.email.status, 'error');
  assert.equal(saved().customerConfirmation.sms.status, 'sent');
  reset({ smsFails: true, emailFails: true }); result = await submit({ 'Photo Upload Preference': 'later' });
  assert.equal(result.statusCode, 200); assert.equal(result.data.customerConfirmation.sms.status, 'error');
  assert.equal(result.data.customerConfirmation.email.status, 'error'); assert.equal(customerEmails().length, 1);

  reset(); delete process.env.QUOTE_APPROVAL_SECRET;
  result = await submit({ 'Photo Upload Preference': 'later' });
  assert.equal(result.statusCode, 200); assert.equal(result.data.photoUploadDelivery.status, 'failed');
  assert.equal(result.data.customerConfirmation.sms.status, 'sent');
  assert.equal(result.data.customerConfirmation.includedWithPhotoUpload, false);
  assert.equal(customerEmails().length, 1); assert.equal(texts.length, 1);
  assert.ok(texts[0].Body.includes(thankYou));
  process.env.QUOTE_APPROVAL_SECRET = 'quote-receipt-test-only-secret';

  reset({ saveFails: true }); result = await submit();
  assert.equal(result.statusCode, 200); assert.equal(result.data.customerConfirmation.trackingStatus, 'save_failed');
  assert.equal(customerEmails().length, 1); assert.equal(texts.length, 1);
  reset({ createFails: true }); result = await submit();
  assert.equal(result.statusCode, 500); assert.equal(emails.length, 0); assert.equal(texts.length, 0);
  reset({ ownerFails: true }); result = await submit();
  assert.equal(result.statusCode, 500); assert.equal(customerEmails().length, 0); assert.equal(texts.length, 0);
  reset(); result = await submit({ 'ZIP Code': '90210' });
  assert.equal(result.statusCode, 400); assert.equal(records.size, 0); assert.equal(texts.length, 0);
  result = await submit({}, [], 'GET'); assert.equal(result.statusCode, 405);

  // Commercial walkthroughs use CRM quote storage, but never become a cleaning booking.
  const walkthrough = {
    'Request Type': 'Commercial walkthrough', 'Full Name': 'Walkthrough Customer',
    'Business Name': 'Example Offices', 'Contact Role': 'Office manager',
    Email: 'customer@example.com', Phone: '2125550101',
    'Street Address': '123 Example Street', 'Floor or Suite': 'Suite 2', City: 'Brooklyn', 'ZIP Code': '11201',
    'Commercial Space Type': 'Office', 'Cleaning Plan': 'One-time cleaning', 'Approximate Square Footage': '4500',
    'Areas Needing Cleaning': 'Workspaces | Restrooms', 'Cleaning Priorities': 'Floors and restrooms.',
    'Conditions to Review': 'None', 'Preferred Service Start Date': '2099-09-20',
    'Preferred Walkthrough Date': '2099-09-12', 'Preferred Walkthrough Time': '09:30',
    'Alternative Walkthrough Date': '2099-09-13', 'Alternative Walkthrough Time': '11:00',
    'Walkthrough Notes': 'Discuss floors and restrooms.'
  };
  reset();
  const startReq = Readable.from([JSON.stringify({ formFields: walkthrough })]); startReq.method = 'POST';
  const startRes = { setHeader() {}, end(text) { this.data = JSON.parse(text); } };
  await start(startReq, startRes);
  assert.equal(startRes.statusCode, 201); assert.equal(folders.length, 1);
  assert.match(folders[0].name, /Walkthrough Customer/);
  result = await submit({ ...walkthrough, 'Photo Upload Preference': 'later' });
  assert.equal(result.statusCode, 200); assert.equal(result.data.message, 'Walkthrough request sent.');
  assert.equal(saved().type, 'custom_quote'); assert.equal(saved().status, 'Walkthrough requested');
  assert.equal(saved().walkthroughConfirmationFileId, 'walkthrough-confirmation-reserved');
  assert.equal(saved().formFields['Service Category'], 'Commercial');
  assert.equal(saved().formFields['First Name'], 'Walkthrough'); assert.equal(saved().formFields['Last Name'], 'Customer');
  assert.equal(saved().formFields['Preferred Walkthrough Date'], '2099-09-12');
  assert.equal(saved().formFields['Business Name'], 'Example Offices');
  assert.equal(saved().formFields['Areas Needing Cleaning'], 'Workspaces | Restrooms');
  assert.equal(saved().formFields['Walkthrough Time Zone'], 'America/New_York');
  assert.equal(saved().formFields['Walkthrough Notes'], walkthrough['Walkthrough Notes']);
  assert.equal(saved().photoUpload.status, 'Not requested');
  assert.equal(texts.length, 1); assert.equal(customerEmails().length, 1);
  for (const message of [texts[0].Body, customerEmails()[0]]) {
    assert.match(message, /Thank you for your walkthrough request\./);
    assert.match(message, /A member of our team will reach out shortly to discuss your space and confirm a date and time before we visit\./);
    assert.match(message, /IMAN Cleaning Service LLC/);
    assert.match(message, /\(929\) 232-1930/);
    assert.match(message, /info@imancleaningservice\.com/);
    assert.match(message, /imancleaningservice\.com/);
    assert.doesNotMatch(message, /confirmed|confirmation|Requested visit|2099-09-12|09:30|quote-photo-upload|payment|deposit/);
  }
  assert.match(customerEmails()[0], /Thank you for your walkthrough request/);
  assert.match(emails[0], /New commercial walkthrough request/);
  assert.equal(ownerNotices[0].source, 'Walkthrough request');
  assert.match(ownerNotices[0].summaryLines[0], /2099-09-12 at 09:30/);
  // An omitted time stays unspecified; customer thanks never confirm the preferred visit.
  const withoutTime = { ...walkthrough };
  delete withoutTime['Preferred Walkthrough Time'];
  reset();
  const noTimeReq = Readable.from([JSON.stringify({ formFields: withoutTime })]); noTimeReq.method = 'POST';
  const noTimeRes = { setHeader() {}, end(text) { this.data = JSON.parse(text); } };
  await start(noTimeReq, noTimeRes);
  assert.equal(noTimeRes.statusCode, 201);
  result = await submit(withoutTime);
  assert.equal(result.statusCode, 200);
  assert.equal(saved().formFields['Preferred Walkthrough Time'], '');
  assert.equal(texts.length, 1); assert.equal(customerEmails().length, 1);
  for (const message of [texts[0].Body, customerEmails()[0]]) {
    assert.match(message, /Thank you for your walkthrough request/);
    assert.match(message, /A member of our team will reach out shortly to discuss your space and confirm a date and time before we visit/);
    assert.doesNotMatch(message, /confirmed|confirmation|2099-09-12|Requested visit/);
    assert.doesNotMatch(message, /at\s+\(|00:00|undefined|null/);
  }
  assert.match(ownerNotices[0].summaryLines[0], /2099-09-12 \(time to be confirmed\)/);
  const schema = require('../walkthrough-fields');
  const now = new Date('2026-09-11T16:00:00Z');
  const validatedWalkthrough = schema.validate(walkthrough, now);
  assert.equal(validatedWalkthrough['Business Name'], 'Example Offices');
  assert.equal(validatedWalkthrough['Cleaning Plan'], 'One-time cleaning');
  assert.equal(validatedWalkthrough['Floor or Suite'], 'Suite 2');
  assert.equal(validatedWalkthrough['Approximate Square Footage'], '4500');
  assert.equal(validatedWalkthrough['Alternative Walkthrough Date'], '2099-09-13');
  const simplifiedWalkthrough = { ...walkthrough };
  delete simplifiedWalkthrough['Areas Needing Cleaning'];
  delete simplifiedWalkthrough['Conditions to Review'];
  assert.equal(schema.validate(simplifiedWalkthrough, now)['Areas Needing Cleaning'], '');
  assert.equal(schema.validate(simplifiedWalkthrough, now)['Conditions to Review'], '');
  assert.equal(schema.validate({ ...simplifiedWalkthrough, 'Preferred Service Start Date': '', 'Service Start Unknown': 'Yes' }, now)['Preferred Service Start Date'], 'I’m not sure');
  assert.equal(schema.validate({ ...walkthrough, 'Approximate Square Footage': '', 'Square Footage Unknown': 'Yes' }, now)['Approximate Square Footage'], 'I’m not sure');
  assert.throws(() => schema.validate({ ...walkthrough, 'Cleaning Plan': '' }, now), { statusCode: 400 });
  assert.throws(() => schema.validate({ ...walkthrough, 'Conditions to Review': 'None | Heavy grease' }, now), { statusCode: 400 });
  assert.throws(() => schema.validate({ ...walkthrough, 'Alternative Walkthrough Date': '', 'Alternative Walkthrough Time': '10:00' }, now), { statusCode: 400 });
  const restaurant = schema.validate({ ...walkthrough, 'Commercial Space Type': 'Restaurant / café', 'Restaurant Specialty Work': 'No' }, now);
  assert.equal(restaurant['Restaurant Specialty Work'], 'No');
  const today = { ...withoutTime, 'Preferred Walkthrough Date': '2026-09-11' };
  for (const time of ['', '   ', undefined]) {
    assert.equal(schema.validate({ ...today, 'Preferred Walkthrough Time': time }, now)['Preferred Walkthrough Time'], '');
  }
  assert.equal(schema.validate({ ...today, 'Preferred Walkthrough Time': '13:00' }, now)['Preferred Walkthrough Time'], '13:00');
  for (const invalid of [{ 'Preferred Walkthrough Date': '' }, { 'Preferred Walkthrough Date': '2026-09-10' }, { 'Preferred Walkthrough Time': '11:00' }, { 'Preferred Walkthrough Time': '12:00' }, { 'Preferred Walkthrough Time': '25:00' }]) {
    assert.throws(() => schema.validate({ ...today, ...invalid }, now), { statusCode: 400 });
  }
  for (const invalid of [{ 'Full Name': '' }, { Email: 'bad email' }, { Phone: '123' }, { 'Preferred Walkthrough Date': '2000-01-01' }, { 'Preferred Walkthrough Date': '2099-02-30' }, { 'Preferred Walkthrough Time': '25:00' }, { 'Street Address': '' }, { 'ZIP Code': '90210' }, { 'Walkthrough Notes': 'x'.repeat(2001) }]) {
    reset(); result = await submit({ ...walkthrough, ...invalid });
    assert.equal(result.statusCode, 400, JSON.stringify(invalid));
    assert.equal(records.size, 0); assert.equal(emails.length, 0); assert.equal(texts.length, 0);
    const req = Readable.from([JSON.stringify({ formFields: { ...walkthrough, ...invalid } })]); req.method = 'POST';
    const res = { setHeader() {}, end(text) { this.data = JSON.parse(text); } };
    await start(req, res); assert.equal(res.statusCode, 400); assert.equal(folders.length, 0);
  }
  reset(); result = await submit(walkthrough, [{ id: 'uploaded-photo', originalName: 'floor-plan.pdf', mimeType: 'application/pdf' }]);
  assert.equal(result.statusCode, 200); assert.equal(saved().photoCount, 1); assert.equal(result.data.attachmentCount, 0);
  assert.match(emails[0], /drive\.google\.com/); assert.doesNotMatch(emails[0], /Content-Disposition: attachment/);

  // Customer text is escaped in HTML, and a malformed address cannot add recipients.
  const content = photoLater._test.submissionReceiptContent(record({ 'First Name': '<img src=x>', 'Last Name': '& One' }));
  assert.match(content.html, /&lt;img src=x&gt;/); assert.doesNotMatch(content.html, /<img src=x>/);
  reset(); let delivery = await photoLater.sendQuoteSubmissionReceipt(record({ Email: 'customer@example.com\r\nBcc: someone@example.com' }));
  assert.equal(delivery.emailDelivery.status, 'skipped'); assert.equal(emails.length, 0);
  reset(); delivery = await photoLater.sendQuoteSubmissionReceipt(record({ Email: '', 'Email Address': 'customer@example.com', Phone: '', 'Phone Number': '2125550101' }));
  assert.equal(delivery.emailDelivery.status, 'sent'); assert.equal(texts[0].To, '+12125550101');
  reset(); delete process.env.TWILIO_AUTH_TOKEN;
  delivery = await photoLater.sendQuoteSubmissionReceipt(record());
  assert.equal(delivery.smsDelivery.status, 'not_configured'); assert.equal(delivery.emailDelivery.status, 'sent'); assert.equal(texts.length, 0);
  console.log('Custom-quote confirmation tests passed: correct recipients, one receipt per submission path, photo reminders unchanged, delivery tracking and isolated failures. No real messages sent.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; global.fetch = originalFetch; });
