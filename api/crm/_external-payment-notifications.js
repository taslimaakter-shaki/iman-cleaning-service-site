const { buildPaymentReceiptPdf } = require('../booking/_payment-receipt-pdf');
const { buildBookingConfirmationPdf } = require('../booking/_confirmation-pdf');
const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
function content(booking, payment) {
  const method = require('./_external-payment').METHODS[payment.method];
  const status = payment.newlyConfirmed ? 'Your booking is confirmed.' : payment.confirms ? 'Your payment has been recorded against your booking.' : 'Your payment is recorded. The appointment is not confirmed until the required deposit is received and availability is checked.';
  const subject = payment.remainingCents === 0 ? 'Payment received — fully paid' : payment.newlyConfirmed ? 'Booking confirmed — payment received' : payment.confirms ? 'Payment received' : 'Partial payment received';
  const text = [`Hi ${booking.client_name},`, '', status, `Booking: ${booking.estimate.orderNumber || booking.id}`,
    `Service: ${booking.service_label}`, `Appointment: ${booking.schedule_label}`, `Address: ${booking.address}`,
    `Payment received: ${money(payment.amountCents)} via ${method}`, `Payment reference: ${payment.reference}`,
    `Service total: ${money(payment.totalCents)}`, `Total paid: ${money(payment.cumulativePaidCents)}`, `Remaining balance: ${money(payment.remainingCents)}`,
    !payment.confirms ? 'Please complete the required deposit to confirm the appointment. Any service balance will be payable after service.' : payment.remainingCents ? 'The remaining balance is payable separately after service. No automatic card hold or charge will be made for this booking.' : 'Your service balance is paid in full.',
    '',payment.terms,'','For appointment changes or payment questions, reply to this email or call 929-232-1930.','IMAN Cleaning Service LLC'].join('\n');
  return {subject,text,method};
}
async function send(booking,payment,channel) {
  const message=content(booking,payment);
  if (channel==='sms') {
    if (booking.estimate.communicationConsent?.transactionalSms?.granted === false) return {status:'skipped',reason:'Customer did not request text messages.'};
    return require('../booking/_notifications').sendCustomerSms(booking.phone,
      `IMAN Cleaning Service: ${money(payment.amountCents)} received via ${message.method}. Booking ${booking.estimate.orderNumber || booking.id}: ${payment.confirms?'confirmed':'awaiting full deposit and availability confirmation'}. Balance ${money(payment.remainingCents)}${payment.remainingCents?(payment.confirms?' due after service':'; complete the deposit to confirm'):''}. Details emailed. Reply STOP to opt out.`);
  }
  const record={quoteId:booking.id,orderNumber:booking.estimate.orderNumber || booking.id,customerName:booking.client_name,customerEmail:booking.email,customerPhone:booking.phone,
    service:booking.service_label,serviceLocation:booking.address,totalAmount:money(payment.totalCents),paidAmount:money(payment.amountCents),remainingAmount:money(payment.remainingCents),
    paymentType:'external',paymentMethod:message.method,paidAt:payment.receivedAt,paymentStatus:'paid',balanceCollection:'manual_after_service',
    subtotalBeforeTax:money(Math.round(Number(booking.estimate.subtotal || 0)*100)),salesTax:money(Math.round(Number(booking.estimate.tax || 0)*100))};
  const attachments=[{name:'Payment-receipt.pdf',data:await buildPaymentReceiptPdf({booking,record})}];
  if(payment.remainingCents === 0) attachments.push({name:'Paid-in-full-receipt.pdf',data:await require('../booking/_final-payment-receipt-pdf').buildFinalPaymentReceiptPdf({booking})});
  if(payment.newlyConfirmed) attachments.push({name:'Booking-confirmation.pdf',data:await buildBookingConfirmationPdf({booking,record})});
  const boundary='iman_external_'+payment.operationId;
  const safe=value=>String(value||'').replace(/[\r\n]/g,'');
  const lines=[`From: IMAN Cleaning Service LLC <${safe(process.env.QUOTE_EMAIL_FROM || 'Info@imancleaningservice.com')}>`,`To: ${safe(booking.email)}`,
    `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString('base64')}?=`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',
    `--${boundary}`,'Content-Type: text/plain; charset="UTF-8"','Content-Transfer-Encoding: base64','',Buffer.from(message.text).toString('base64')];
  for(const file of attachments) lines.push(`--${boundary}`,`Content-Type: application/pdf; name="${file.name}"`,`Content-Disposition: attachment; filename="${file.name}"`,'Content-Transfer-Encoding: base64','',file.data.toString('base64').match(/.{1,76}/g).join('\r\n'));
  lines.push(`--${boundary}--`,'');
  const {gmail}=require('../quote/_shared').getGoogleClients();
  const sent=await gmail.users.messages.send({userId:'me',requestBody:{raw:Buffer.from(lines.join('\r\n')).toString('base64url')}});
  return {status:'sent',messageId:sent.data.id,sentAt:new Date().toISOString()};
}
module.exports={content,send};
