const { trySendFormSubmissionNotification, cleanText } = require('../_form-notifications');
const { formatAppointment } = require('./_notifications');
const CRM_URL = 'https://www.imancleaningservice.com/crm.html';
const header = value => String(value || '').replace(/[\r\n]/g, '').trim();
function details(booking, event) {
  const request = booking.estimate?.rescheduling?.request || {};
  const labels = { requested: 'approval required', approved: 'approved', declined: 'declined' };
  const label = labels[event];
  if (!label) throw new Error('Unknown appointment notification event.');
  const order = booking.estimate?.orderNumber || booking.id;
  const lines = [
    `Original appointment: ${formatAppointment(request.previousSchedule)}`,
    `Requested appointment: ${request.label || formatAppointment(request.schedule)}`,
    `Late-rescheduling fee: $${(Number(request.feeCents || 0) / 100).toFixed(2)}`,
    event === 'requested' ? 'Approval is required. The original appointment remains confirmed. Open CRM to approve or decline.' : event === 'approved' ? 'The appointment change is approved. Any applicable fee was charged to the deposit payment method.' : 'The change was declined. The original appointment remains confirmed. Any fee collected for this request was refunded.'
  ];
  return { subject: `IMAN appointment change ${label} - ${order}`, payload: {
    source: 'Appointment change', eventLabel: label, recordId: order, pageUrl: CRM_URL,
    fields: { 'Customer Name': booking.client_name, 'Customer Phone': booking.phone, 'Customer Email': booking.email, 'Service': booking.service_label || booking.service },
    summaryLines: lines
  }, text: [`IMAN appointment change: ${label}`, `Booking: ${order}`, `Customer: ${booking.client_name || ''}`, `Phone: ${booking.phone || ''}`, `Email: ${booking.email || ''}`, ...lines, `CRM: ${CRM_URL}`].join('\n') };
}
async function sendOwnerEmail(message) {
  const { gmail } = require('../quote/_shared').getGoogleClients();
  const raw = [`From: IMAN Cleaning Service LLC <${header(process.env.QUOTE_EMAIL_FROM || 'Info@imancleaningservice.com')}>`, `To: ${header(process.env.QUOTE_EMAIL_TO || 'Info@imancleaningservice.com')}`, `Subject: ${header(message.subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', '', message.text].join('\r\n');
  const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: Buffer.from(raw).toString('base64url') } });
  return { status: 'sent', messageId: sent.data.id || '' };
}
async function notifyOwner(booking, event, { email = sendOwnerEmail, sms = trySendFormSubmissionNotification } = {}) {
  const message = details(booking, event);
  const results = await Promise.allSettled([email(message), sms(message.payload)]);
  const result = value => value.status === 'fulfilled' ? value.value : { status: 'error', error: cleanText(value.reason?.message || 'Notification failed', 240) };
  return { event, attemptedAt: new Date().toISOString(), email: result(results[0]), sms: result(results[1]) };
}
module.exports = { notifyOwner, details, sendOwnerEmail };
