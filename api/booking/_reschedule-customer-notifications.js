const { staffingOptions, workHours } = require('./_staffing-options');
const { sendCustomerSms } = require('./_notifications');
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const header = value => String(value || '').replace(/[\r\n]/g, ' ').trim();
const money = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;
function buildDecisionMessages(booking) {
  const request = booking.estimate?.rescheduling?.request || {};
  if (!['approved', 'declined'].includes(request.status)) throw new Error('The appointment change has not been decided.');
  const approved = request.status === 'approved';
  const firstName = String(booking.client_name || '').trim().split(/\s+/)[0] || 'there';
  const order = booking.estimate?.orderNumber || booking.id;
  const date = new Date(approved ? booking.schedule : request.previousSchedule || booking.schedule);
  const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
  const time = booking.estimate?.arrivalPreference?.flexible && booking.estimate.arrivalPreference.windowLabel
    ? booking.estimate.arrivalPreference.windowLabel
    : new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(date);
  const duration = staffingOptions(booking.estimate) || 'Please contact us to confirm the work duration.';
  const hours = workHours(booking.estimate);
  const work = hours ? `${hours} total work-hours. ${duration}.` : duration;
  const { createBookingManagementToken } = require('./_manage');
  const link = booking.email ? `https://www.imancleaningservice.com/manage-booking.html?token=${encodeURIComponent(createBookingManagementToken({ bookingId: booking.id, email: booking.email }))}` : 'https://www.imancleaningservice.com/manage-booking.html';
  let fee;
  if (approved) fee = request.feeCents > 0
    ? `A late-rescheduling fee of ${money(request.feeCents)} (10%) was charged to the payment method used for your deposit. This fee is separate from your cleaning payment. If you later cancel this booking, the 25% cancellation fee still applies regardless of the new date, with this fee credited toward it.`
    : 'No rescheduling fee applies.';
  else if (request.feeRefund?.status === 'succeeded') fee = `Your ${money(request.feeRefund.amountCents)} rescheduling fee has been refunded to the original payment method. Your bank may take several business days to display the refund.`;
  else if (request.feeRefund) fee = `A refund of your ${money(request.feeRefund.amountCents)} rescheduling fee has been requested to the original payment method. We will follow up if it needs attention.`;
  else fee = 'No rescheduling fee was charged for this request.';
  const subject = approved ? 'Your appointment change is approved - IMAN Cleaning Service' : 'Your appointment change request could not be approved - IMAN Cleaning Service';
  const intro = approved ? 'Your rescheduling request has been approved.' : "We're unable to approve your requested appointment change.";
  const heading = approved ? 'Your updated appointment' : 'Your original appointment remains confirmed';
  const rows = [['Service', booking.service_label || booking.service], ['Date', dateLabel], ['Estimated arrival (New York time)', time], ['Work duration', work], ['Order number', order]];
  const invoiceLink = approved && request.pricing ? link.replace('/manage-booking.html?', '/api/booking/manage?document=invoice&') : '';
  if (approved && request.pricing) rows.push(...require('./_reschedule-invoice').invoiceRows(booking));
  const closing = approved ? 'Any further appointment changes require our approval. For help, call or text 929-232-1930.' : "To discuss another date, call or text 929-232-1930. Cancellation remains subject to your booking's cancellation policy.";
  const text = [`Hi ${firstName},`, '', intro, '', heading, ...rows.map(([key, value]) => `${key}: ${value || ''}`), '', fee, ...(invoiceLink ? ['', 'View revised invoice:', invoiceLink] : []), '', 'Manage Your Appointment:', link, '', closing, '', 'Thank you,', 'IMAN Cleaning Service LLC'].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;color:#16363d;max-width:640px;margin:auto;padding:24px"><p>Hi ${escapeHtml(firstName)},</p><p>${escapeHtml(intro)}</p><h2>${heading}</h2><table style="width:100%;border-collapse:collapse">${rows.map(([key,value])=>`<tr><th style="text-align:left;padding:10px;border-bottom:1px solid #d7e5e3">${escapeHtml(key)}</th><td style="padding:10px;border-bottom:1px solid #d7e5e3">${escapeHtml(value)}</td></tr>`).join('')}</table><p>${escapeHtml(fee)}</p>${invoiceLink ? `<p><a href="${escapeHtml(invoiceLink)}">View revised invoice</a></p>` : ""}<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 22px;background:#0b6474;color:white;text-decoration:none;border-radius:24px">Manage Your Appointment</a></p><p>${escapeHtml(closing)}</p><p>Thank you,<br>IMAN Cleaning Service LLC</p></div>`;
  const sms = `IMAN Cleaning Service: Hi ${firstName}, ${approved ? 'your appointment change is approved' : "we couldn't approve your appointment change. Your original appointment remains confirmed"} for ${dateLabel}, ${time} (New York time). Service: ${booking.service_label || booking.service || 'Cleaning'}. Work duration: ${work} Order #${order}. ${fee}${invoiceLink ? ` Revised cleaning total: ${money(request.pricing.totalCents)}. Balance: ${money(request.pricing.remainingCents)}. Revised invoice: ${invoiceLink}` : ""} Manage your appointment: ${link} Questions? Call/text 929-232-1930.${approved ? '' : ' Cancellation policy applies.'} Reply STOP to opt out.`;
  return { subject, text, html, sms, link, event: request.status };
}
async function sendDecisionEmail(booking, message) {
  if (!booking.email) return { status: 'skipped' };
  const boundary = 'iman_appointment_decision';
  let raw = [`From: IMAN Cleaning Service LLC <${header(process.env.QUOTE_EMAIL_FROM || 'Info@imancleaningservice.com')}>`, `To: ${header(booking.email)}`, `Subject: ${message.subject}`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', '', message.text, `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', '', message.html, `--${boundary}--`, ''].join('\r\n');
  if (booking.estimate?.rescheduling?.request?.status === 'approved' && booking.estimate.rescheduling.request.pricing) {
    const attachments = [
      ['IMAN-Revised-Invoice.pdf', await require('./_reschedule-invoice').buildInvoice(booking)],
      ['IMAN-Updated-Booking.pdf', await require('./_confirmation-pdf').buildBookingConfirmationPdf({ booking, record: {} })]
    ];
    const mixed = 'iman_decision_attachments';
    const split = raw.indexOf('Content-Type: multipart/alternative');
    const headers = raw.slice(0,split);
    const alternative = raw.slice(split);
    raw = headers + `Content-Type: multipart/mixed; boundary="${mixed}"\r\n\r\n--${mixed}\r\n` + alternative + attachments.map(([name,bytes]) => `\r\n--${mixed}\r\nContent-Type: application/pdf; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${bytes.toString('base64').match(/.{1,76}/g).join('\r\n')}`).join('') + `\r\n--${mixed}--\r\n`;
  }
  const { gmail } = require('../quote/_shared').getGoogleClients();
  const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: Buffer.from(raw).toString('base64url') } });
  return { status: 'sent', messageId: sent.data.id || '' };
}
async function notifyCustomerDecision(booking, { email = sendDecisionEmail, sms = sendCustomerSms } = {}) {
  const message = buildDecisionMessages(booking);
  const prior = booking.estimate?.rescheduling?.customerNotifications?.[message.event];
  const results = await Promise.allSettled([
    prior?.email?.status === 'sent' ? prior.email : email(booking, message),
    prior?.sms?.status === 'sent' ? prior.sms : sms(booking.phone, message.sms)
  ]);
  const result = item => item.status === 'fulfilled' ? item.value : { status: 'error', error: String(item.reason?.message || 'Delivery failed').slice(0, 240) };
  return { event: message.event, attemptedAt: new Date().toISOString(), email: result(results[0]), sms: result(results[1]) };
}
module.exports = { buildDecisionMessages, notifyCustomerDecision, sendDecisionEmail };
