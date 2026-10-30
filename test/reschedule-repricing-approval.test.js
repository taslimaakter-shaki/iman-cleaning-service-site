const assert=require('node:assert/strict');
const shared=require('../api/booking/_shared'),payments=require('../api/booking/_payments');
const pricing=require('../api/booking/_reschedule-pricing');
const clone=x=>JSON.parse(JSON.stringify(x));
process.env.SUPABASE_URL='https://example.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='test';process.env.BOOKING_MANAGEMENT_SECRET='test';
let stored,calls=[];
shared.supabaseRequest=async(path,options)=>{const q=new URLSearchParams(path.slice(1));if(q.get('estimate')!=='eq.'+JSON.stringify(stored.estimate))return [];stored={...stored,...JSON.parse(options.body)};return [clone(stored)];};
shared.getBooking=async()=>clone(stored);shared.assertScheduleAvailable=async()=>{};shared.updateBookingGoogleCalendar=async()=>{};
payments.cancelRemainingAuthorization=async()=>{};
payments.stripePost=async call=>{calls.push(call);assert.equal(call.path,'refunds');return {id:'re_test',status:'succeeded'};};
const policy=require('../api/booking/_rescheduling');
const original=()=>({id:'test',status:'Confirmed',email:'customer@example.test',schedule:'2030-11-01T13:00:00Z',service_label:'Deep Cleaning',estimate:{subtotal:200,discountedSubtotal:190,tax:16.86,total:206.86,taxRate:.08875,manHours:4,teamHours:2,arrivalPreference:{key:'any_day',flexible:true,windowLabel:'8:00 AM–4:00 PM'},arrivalDiscount:{amountCents:1000,percent:5},payment:{totalCents:20686,paidCents:5172,depositCents:5172,depositPaymentIntentId:'pi_deposit'}}});
const now=new Date('2030-10-01T12:00:00Z');
async function request(key='exact') {const q=pricing.quote(stored,key);return policy.requestChange(clone(stored),{acceptPolicy:true,policyVersion:policy.VERSION,feeCents:0,directContact:true},{value:'2030-11-05T14:00:00Z',label:'November 5 at 9 AM',pricing:q,preferenceKey:key,choiceId:`new:${key}:test`},now);}
(async()=>{
 stored=original();await request();assert.equal(stored.estimate.total,206.86);assert.equal(stored.schedule,original().schedule);
 let id=stored.estimate.rescheduling.request.id;await policy.decide(clone(stored),id,'approve');
 assert.equal(stored.estimate.total,217.75);assert.equal(stored.estimate.payment.remainingCents,16603);assert.equal(stored.estimate.payment.depositCents,5172);assert.equal(stored.estimate.arrivalDiscount,null);assert.equal(stored.estimate.arrivalPreference.key,'exact');assert.equal(stored.estimate.rescheduling.invoiceHistory.length,1);
 await policy.decide(clone(stored),id,'approve');assert.equal(stored.estimate.rescheduling.invoiceHistory.length,1);assert.equal(calls.length,0);
 stored=original();await request();id=stored.estimate.rescheduling.request.id;await policy.decide(clone(stored),id,'decline');assert.equal(stored.estimate.total,206.86);assert.equal(stored.schedule,original().schedule);assert.equal(stored.estimate.rescheduling.invoiceHistory,undefined);
 stored=original();await request();id=stored.estimate.rescheduling.request.id;stored.estimate.payment.paidCents++;await assert.rejects(policy.decide(clone(stored),id,'approve'),/price or payments changed/);assert.equal(stored.schedule,original().schedule);
 stored=original();stored.estimate.payment.paidCents=22000;stored.estimate.payment.depositCents=22000;await request('morning');id=stored.estimate.rescheduling.request.id;await policy.decide(clone(stored),id,'approve');assert.equal(calls.length,1);assert.equal(calls[0].params.amount,660);assert.equal(calls[0].params.payment_intent,'pi_deposit');assert.equal(stored.estimate.payment.remainingCents,0);await policy.decide(clone(stored),id,'approve');assert.equal(calls.length,1,'Completed refund is not repeated');
 const message=require('../api/booking/_reschedule-customer-notifications').buildDecisionMessages(stored);assert.match(message.sms,/Revised invoice: https/);assert.match(message.text,/Revised cleaning total: \$213.40/);
 let raw='';require('../api/quote/_shared').getGoogleClients=()=>({gmail:{users:{messages:{send:async({requestBody})=>{raw=Buffer.from(requestBody.raw,'base64url').toString();return {data:{id:'mock'}};}}}}});
 await require('../api/booking/_reschedule-customer-notifications').sendDecisionEmail(stored,message);assert.match(raw,/multipart\/mixed/);assert.match(raw,/filename="IMAN-Revised-Invoice.pdf"/);assert.match(raw,/filename="IMAN-Updated-Booking.pdf"/);
 console.log('Repricing approval: pending/decline preservation, approval totals, unchanged deposit, stale consent, refund retry safety and PDF email attachments passed. All providers mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
