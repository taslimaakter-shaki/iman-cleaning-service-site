const assert = require('node:assert/strict');
const shared = require('../api/quote/_shared');
const messages = [];
shared.getGoogleClients = () => ({gmail:{users:{messages:{send:async request => {
  messages.push(Buffer.from(request.requestBody.raw,'base64url').toString());
  return {data:{id:'MOCK-NO-NETWORK'}};
}}}}});
const {send,paymentRecord} = require('../api/crm/_external-payment-notifications');
const booking = {id:'BK-MOCK',status:'Confirmed',client_name:'Jane Example',email:'jane@example.test',phone:'+12125550123',
  address:'123 Example St, Queens NY 11432',service:'standard',service_label:'Standard Cleaning',schedule:'2030-12-10T14:00:00Z',
  estimate:{orderNumber:'ORDER-MOCK',total:206.09,subtotal:210.33,discountedSubtotal:189.29,tax:16.80,manHours:4,teamHours:2,cleanerCount:2,
    promoDiscount:{label:'FALL10',amountCents:1052},arrivalDiscount:{label:'Anytime that day arrival discount',amountCents:1052},
    arrivalPreference:{flexible:true,windowLabel:'8 AM–6 PM'},payment:{provider:'external',paidCents:5152,remainingCents:15457,totalCents:20609,depositCents:5152}}};
const payment = {operationId:'mock-operation-001',method:'zelle',reference:'MOCK-ONLY',receivedAt:'2026-10-31T14:00:00Z',amountCents:5152,
  cumulativePaidCents:5152,remainingCents:15457,totalCents:20609,confirms:true,newlyConfirmed:true,terms:'No automatic card charge.'};
(async()=>{
  await send(booking,payment,'email');
  const raw=messages[0];
  for(const expected of ['multipart/alternative','Appointment Details','Your Payment Summary','Before Our Team Arrives',
    'Payment method: Zelle','Fall Cleaning Discount: -$10.52','Anytime that day arrival discount: -$10.52','Deposit paid: -$51.52',
    'Remaining balance: $154.57','Iman-Cleaning-Payment-Receipt.pdf','Iman-Cleaning-Booking-Record-BK-MOCK.pdf',
    'No automatic card hold or charge will be made.']) assert(raw.includes(expected),expected);
  assert(!raw.includes('temporarily authorized approximately 48 hours'),'Zelle must not promise a card hold');
  assert(!raw.includes('Manage Your Appointment'),'Do not link to unsupported automatic fee/refund flow');
  assert.equal(messages.length,1);
  const record=paymentRecord({...booking,estimate:{...booking.estimate,manualDiscount:{amountCents:1000,label:'Courtesy'}}},payment);
  assert.equal(record.manualDiscountAmount,'-$10.00');assert.equal(record.discountAmount,'-$10.52');
  await send(booking,{...payment,newlyConfirmed:false,confirms:false,amountCents:1000,cumulativePaidCents:1000,remainingCents:19609},'email');
  assert(!messages[1].includes('Iman-Cleaning-Booking-Record'),'Partial payment must not send confirmation');
  console.log('External confirmation uses standard branded email and both PDF attachments, preserves discounts and Zelle terms; partial deposits stay unconfirmed. Gmail mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
