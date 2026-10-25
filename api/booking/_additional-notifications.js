const { sendCustomerSms } = require('./_notifications');
const { duration, money, cardLabel } = require('./_additional-approval');
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function statusCopy(status) {
  if (status === 'paid') return 'Payment was charged successfully.';
  if (status === 'requires_action') return 'Approval received. Your bank requires verification; payment is not complete. Reopen your additional-work link to continue.';
  if (status === 'payment_failed' || status === 'canceled') return 'Approval received, but payment is not complete. Reopen your additional-work link or contact our team.';
  return 'Approval received. Payment has not yet been confirmed.';
}
function content(snapshot, status) {
  const time = duration(snapshot.total_minutes), amount = money(snapshot.amount_cents), card = cardLabel(snapshot);
  const statement = `You approved ${time} of additional cleaning labor for ${amount} and authorized IMAN Cleaning Service LLC to charge this amount to your ${card}.`;
  const subject = `Additional work approved — Booking ${snapshot.booking_id}`;
  const text = `Hi ${snapshot.customer_name || 'there'},\n\n${statement}\n\nAdditional labor approved: ${time}\nAmount authorized: ${amount}\nPayment method: ${card}\nBooking reference: ${snapshot.booking_id}\nApproval reference: ${snapshot.id}\n\n${statusCopy(status)}\n\nYour original booking payment is unchanged. Additional work remains subject to team availability.\nQuestions? Call (929) 232-1930.\n\nThank you,\nIMAN Cleaning Service LLC`;
  const sms = `IMAN Cleaning Service: You approved ${time} of additional cleaning labor for ${amount} and authorized a charge to ${card}. Booking: ${snapshot.booking_id}. ${statusCopy(status)} Questions? (929) 232-1930. Reply STOP to opt out.`;
  const html = `<html><body style="margin:0;background:#f4f8f7;font-family:Arial,sans-serif;color:#263b40;line-height:1.6"><main style="max-width:620px;margin:auto;padding:28px"><h1 style="color:#073f49;font-size:26px">Additional work approved</h1><p>Hi ${escape(snapshot.customer_name || 'there')},</p><p>${escape(statement)}</p><table><tr><th align="left">Additional labor</th><td>${escape(time)}</td></tr><tr><th align="left">Amount authorized</th><td>${escape(amount)}</td></tr><tr><th align="left">Payment method</th><td>${escape(card)}</td></tr><tr><th align="left">Booking reference</th><td>${escape(snapshot.booking_id)}</td></tr></table><p><strong>${escape(statusCopy(status))}</strong></p><p>Your original booking payment is unchanged. Additional work remains subject to team availability.</p><p>Questions? Call <a href="tel:+19292321930">(929) 232-1930</a>.</p><p>IMAN Cleaning Service LLC</p></main></body></html>`;
  return { subject, text, html, sms };
}
async function send(notice, status) {
  const snapshot = notice.snapshot, message = content(snapshot, status);
  if (notice.channel === 'sms') return sendCustomerSms(snapshot.phone, message.sms);
  if (!snapshot.email || /[\r\n]/.test(snapshot.email)) return { status: 'skipped', error: 'A valid customer email is missing.' };
  const boundary = `iman_aw_${notice.order_id}_${notice.revision}`;
  const from = String(process.env.QUOTE_EMAIL_FROM || 'info@imancleaningservice.com').replace(/[\r\n]/g, '');
  const mime = [`From: IMAN Cleaning Service LLC <${from}>`, `To: ${snapshot.email}`, `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString('base64')}?=`,
    `Message-ID: <additional-${notice.order_id}-${notice.revision}@imancleaningservice.com>`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(message.text).toString('base64'),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(message.html).toString('base64'), `--${boundary}--`].join('\r\n');
  const { gmail } = require('../quote/_shared').getGoogleClients();
  const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: Buffer.from(mime).toString('base64url') } });
  return { status: 'sent', messageId: sent.data.id || '' };
}
module.exports = { content, send, statusCopy };
