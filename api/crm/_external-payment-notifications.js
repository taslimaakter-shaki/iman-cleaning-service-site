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
function paymentRecord(booking, payment) {
  const estimate = booking.estimate || {};
  const discount = estimate.promoDiscount || estimate.recurringDiscount || {};
  const arrival = estimate.arrivalDiscount || {};
  const manual = estimate.crmQuote?.fields
    ? {amountCents:estimate.crmQuote.fields.discountCents, label:estimate.crmQuote.fields.discountLabel}
    : estimate.manualDiscount || {};
  const subtotal = Math.round(Number(estimate.subtotal || 0)*100);
  const discountedSubtotal = estimate.discountedSubtotal != null ? Math.round(Number(estimate.discountedSubtotal)*100)
    : subtotal - Number(discount.amountCents || 0) - Number(arrival.amountCents || 0);
  return {quoteId:booking.id, orderNumber:estimate.orderNumber || booking.id, customerName:booking.client_name,
    customerEmail:booking.email, customerPhone:booking.phone, service:booking.service_label, serviceLocation:booking.address,
    serviceDescriptionUrl:estimate.serviceDescriptionUrl || '', totalAmount:money(payment.totalCents), paidAmount:money(payment.amountCents),
    remainingAmount:money(payment.remainingCents), paymentProvider:'external',
    paymentType:payment.newlyConfirmed && payment.remainingCents > 0 ? 'deposit_25' : 'external',
    paymentMethod:require('./_external-payment').METHODS[payment.method], paidAt:payment.receivedAt,
    paymentStatus:'paid', balanceCollection:'manual_after_service',
    subtotalBeforeTax:subtotal ? money(subtotal) : '', salesTax:money(Math.round(Number(estimate.tax || 0)*100)),
    discountedSubtotalBeforeTax:subtotal ? money(discountedSubtotal) : '',
    discountLabel:discount.label || discount.code || 'Discount', discountAmount:discount.amountCents ? '-'+money(discount.amountCents) : '',
    arrivalDiscountLabel:arrival.label || 'Flexible arrival discount', arrivalDiscountAmount:arrival.amountCents ? '-'+money(arrival.amountCents) : '',
    manualDiscountLabel:manual.label || 'Manual discount (after tax)', manualDiscountAmount:manual.amountCents ? '-'+money(manual.amountCents) : ''};
}
async function send(booking,payment,channel) {
  if (channel==='ownerSms') return require('../_form-notifications').trySendFormSubmissionNotification({source:'Appointment booked',eventLabel:'confirmed',recordId:booking.estimate.orderNumber || booking.id,fields:{'Customer Name':booking.client_name,'Phone':booking.phone,'Service':booking.service_label,'Address':booking.address},summaryLines:[`Appointment: ${booking.schedule_label || booking.schedule}`]});
  const message=content(booking,payment);
  if (channel==='sms') {
    if (booking.estimate.communicationConsent?.transactionalSms?.granted === false) return {status:'skipped',reason:'Customer did not request text messages.'};
    return require('../booking/_notifications').sendCustomerSms(booking.phone,
      `IMAN Cleaning Service: ${money(payment.amountCents)} received via ${message.method}. Booking ${booking.estimate.orderNumber || booking.id}: ${payment.confirms?'confirmed':'awaiting full deposit and availability confirmation'}. Balance ${money(payment.remainingCents)}${payment.remainingCents?(payment.confirms?' due after service':'; complete the deposit to confirm'):''}. Details emailed. Reply STOP to opt out.`);
  }
  const record=paymentRecord(booking,payment);
  if (payment.newlyConfirmed) {
    const invoicePdf=await buildPaymentReceiptPdf({booking,record});
    const confirmationPdf=await buildBookingConfirmationPdf({booking,record});
    const email=require('../quote/_payment-record').buildCustomerEmail({booking,
      record:{...record,paidAmount:money(payment.cumulativePaidCents)},invoicePdf,confirmationPdf,managementUrl:''});
    const {gmail}=require('../quote/_shared').getGoogleClients();
    const sent=await gmail.users.messages.send({userId:'me',requestBody:{raw:email.raw}});
    return {status:'sent',messageId:sent.data.id,sentAt:new Date().toISOString()};
  }
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
module.exports={content,send,paymentRecord};
