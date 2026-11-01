const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const clone=x=>JSON.parse(JSON.stringify(x));
const sharedReal=require('../api/booking/_shared');
function fixture(options={}) {
  let bookings=[{id:'BK-TEST',status:'New',created_at:'2026-01-01',client_name:'Jane Example',email:'jane@example.test',phone:'+12125550123',address:'123 Test St, Queens NY 11432',service:'standard',service_label:'Standard Cleaning',schedule:'2030-12-10T09:00:00-05:00',schedule_label:'December 10, 9 AM',estimate:{total:206.09,teamHours:2,manHours:4,calendarReservation:{state:'draft'},payment:{totalCents:20609,depositCents:5152,paidCents:0}}}];
  if(options.saved) bookings=[];
  const calls=[], faults={};
  const get=id=>clone(bookings.find(b=>b.id===id)||null);
  const shared={...sharedReal,availableSlotsForPackage:async()=>[{value:'2030-12-10T09:00:00-05:00',date:'2030-12-10',time:'09:00',flexibleEligible:true}],listAllBookings:async()=>clone(bookings),getBooking:async id=>get(id),assertScheduleAvailable:async()=>{if(faults.busy)throw new Error('Slot unavailable');},
    confirmBooking:async id=>{calls.push('calendar');return {booking:get(id),calendarSync:{status:'synced'}};},
    createBooking:async b=>{if(bookings.some(x=>x.id===b.id))throw new Error('duplicate');bookings.push(clone(b));return get(b.id);},
    supabaseRequest:async(query,options)=>{
      const q=new URLSearchParams(query),id=q.get('id').slice(3),b=bookings.find(x=>x.id===id);
      if(!b || q.get('status')!=='eq.'+b.status || q.get('estimate')!=='eq.'+JSON.stringify(b.estimate))return [];
      if(faults.rejectCas) return [];
      Object.assign(b,JSON.parse(options.body));return [get(id)];
    }};
  const quoteAdmin={load:async(source,id)=>({source,id,record:options.saved || get(id),state:{},version:JSON.stringify(options.saved || get(id))}),closeSessions:async()=>{calls.push('expire');if(faults.stripe)throw new Error('Stripe verification unavailable');}};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../api/crm/_external-payment'),'utf8'),{module,require:name=>{
    if(name==='../booking/_additional-store')return {rpc:async(name,body)=>{
      if(name==='iman_external_payment_version')return 1;
      assert.equal(name,'iman_update_external_payment_booking');
      const b=bookings.find(x=>x.id===body.p_booking_id);
      if(!b || b.status!==body.p_expected_status || JSON.stringify(b.estimate)!==JSON.stringify(body.p_expected_estimate) || faults.rejectCas)return [];
      b.estimate=clone(body.p_estimate);if(body.p_status)b.status=body.p_status;return [get(b.id)];
    }};
    if(name==='../booking/_shared')return shared;
    if(name==='./_quote-admin')return quoteAdmin;
    if(name==='../quote/_photo-later')return {sendWalkthroughEmail:async()=>{calls.push('balance-email');return {status:'sent'};}};
    if(name==='../booking/_notifications')return {sendCustomerSms:async()=>{calls.push('balance-sms');return {status:'sent'};}};
    if(name==='./_walkthroughs')return require('../api/crm/_walkthroughs');
    if(name==='./_external-payment-notifications')return {send:async(b,p,c)=>{calls.push(c);if(faults[c])throw new Error('Provider timeout');return {status:'sent'};}};
    if(name.startsWith('../booking/'))return require('../api/booking/'+name.split('/').at(-1));
    return require(name);
  },Date,Intl,URL,URLSearchParams,Buffer,console});
  const api=module.exports;
  const input={source:'booking',id:'BK-TEST',operationId:'operation-00000001',method:'zelle',amountCents:5152,reference:'BANK-123',receivedAt:'2026-10-01',verified:true,agreementVerified:true,agreementEvidence:'Customer accepted by email on October 1.'};
  async function request(extra={}) {const body={...input,...extra};const preview=await api.resolve(body);return {...body,previewToken:preview.token};}
  return {api,request,get,bookings,calls,faults};
}
(async()=>{
  let f=fixture();let body=await f.request();let result=await f.api.record(body);
  assert.equal(result.paidCents,5152);assert.equal(result.remainingCents,15457);assert.equal(f.get('BK-TEST').status,'Confirmed');
  assert.equal(f.get('BK-TEST').estimate.payment.balanceCollection,'manual_after_service');
  await f.api.record(body);assert.equal(f.get('BK-TEST').estimate.payment.externalPayments.length,1);assert.equal(f.calls.filter(x=>x==='email').length,1);
  await f.api.record(await f.request({amountCents:15457,reference:'BANK-124',operationId:'operation-00000002'}));
  assert.equal(f.get('BK-TEST').estimate.payment.status,'fully_paid');assert.equal(f.get('BK-TEST').estimate.payment.remainingCents,0);
  assert.equal(f.get('BK-TEST').estimate.payment.externalPayments.length,2);
  f=fixture();await f.api.record(await f.request({amountCents:1000}));assert.equal(f.get('BK-TEST').status,'New');assert.equal(f.get('BK-TEST').estimate.payment.status,'partial');
  f.faults.busy=true;await assert.rejects(f.api.record(await f.request({amountCents:4152,reference:'BANK-125',operationId:'operation-00000003'})),/unavailable/);assert.equal(f.get('BK-TEST').estimate.payment.paidCents,1000);
  f.faults.busy=false;await f.api.record(await f.request({amountCents:4152,reference:'BANK-125',operationId:'operation-00000003'}));assert.equal(f.get('BK-TEST').status,'Confirmed');
  f=fixture();await assert.rejects(f.api.record(await f.request({verified:false})),/Verify/);assert.equal(f.calls.length,0);
  await assert.rejects(f.api.record(await f.request({amountCents:20610})),/outstanding/);
  await assert.rejects(f.api.record(await f.request({agreementEvidence:''})),/accepted/);
  body=await f.request();f.bookings[0].estimate.total=210;f.bookings[0].estimate.payment.totalCents=21000;await assert.rejects(f.api.record(body),/changed/);
  f=fixture();f.faults.stripe=true;await assert.rejects(f.api.record(await f.request()),/verification/);assert.equal(f.get('BK-TEST').estimate.payment.paidCents,0);
  f=fixture();body=await f.request();const competing=await Promise.allSettled([f.api.record(body),f.api.record({...body,operationId:'operation-00000099',reference:'BANK-OTHER'})]);assert(competing.some(r=>r.status==='fulfilled'));assert.equal(f.get('BK-TEST').estimate.payment.externalPayments.length,1);
  f=fixture();f.faults.email=true;body=await f.request();result=await f.api.record(body);assert.equal(result.delivery.email.status,'needs_review');await f.api.record(body);assert.equal(f.calls.filter(x=>x==='email').length,1);assert.equal(f.get('BK-TEST').estimate.payment.paidCents,5152);
  f=fixture();f.bookings[0].estimate.payment={paidCents:5152,totalCents:20609,paymentIntentId:'pi_paid'};await assert.rejects(f.api.resolve({source:'booking',id:'BK-TEST'}),/card payment/);
  f=fixture();await f.api.record(await f.request());await assert.rejects(f.api.record(await f.request({operationId:'operation-00000009'})),/already recorded/);
  f.bookings[0].status='Completed';
  await f.api.notifyBalanceDue('BK-TEST');await f.api.notifyBalanceDue('BK-TEST');
  assert.equal(f.calls.filter(x=>x==='balance-email').length,1);assert.equal(f.calls.filter(x=>x==='balance-sms').length,1);
  const signed=fixture();
  signed.bookings[0].estimate.manHours=4;signed.bookings[0].estimate.packageId='PKG-TEST';
  const acceptance={signedName:'Jane Example',recordHash:'saved-evidence-hash',serverRecordedAt:'2026-10-31T14:00:00Z',customerAcceptedAt:'2026-10-31T13:59:00Z',
    context:{scheduledFor:signed.bookings[0].schedule,totalCents:20609,laborHours:4,packageId:'PKG-TEST',service:'Standard Cleaning'}};
  signed.bookings[0].estimate.agreementAcceptance=clone(acceptance);
  const signedPreview=await signed.api.resolve({source:'booking',id:'BK-TEST'});
  assert.equal(signed.api.summary(signedPreview).agreement.signedName,'Jane Example');
  await signed.api.record(await signed.request({agreementVerified:false,agreementEvidence:''}));
  assert.deepEqual(signed.get('BK-TEST').estimate.agreementAcceptance,acceptance);
  assert.equal(signed.get('BK-TEST').estimate.payment.externalPayments[0].agreementSource,'instant_quote');
  signed.bookings[0].schedule='2030-12-11T09:00:00-05:00';
  assert.equal(signed.api.summary(await signed.api.resolve({source:'booking',id:'BK-TEST'})).agreement,null);
  await assert.rejects(signed.api.record(await signed.request({operationId:'operation-00000022',reference:'BANK-NEW',agreementVerified:false,agreementEvidence:''})),/accepted/);
  const {content}=require('../api/crm/_external-payment-notifications');
  const b=f.get('BK-TEST'),entry=b.estimate.payment.externalPayments[0];const message=content(b,entry);assert.match(message.text,/Zelle/);assert.match(message.text,/154.57/);assert.match(message.text,/No automatic card hold/);
  const saved={quoteId:'SAVED-TEST',pricingMode:'hourly_formula',eligibility:{serviceIntent:'cleaning',requestedService:'hourly',serviceZip:'11432'},unitDetails:[{hours:4}],customer:{firstName:'Jane',lastName:'Example',email:'jane@example.test',phone:'+12125550123'}};
  const savedFixture=fixture({saved});
  const savedInput={source:'saved',id:'SAVED-TEST',serviceDate:'2030-12-10',serviceTime:'09:00',address:'123 Test St, Queens NY 11432',arrivalPreference:'any_day'};
  const savedPreview=await savedFixture.api.resolve(savedInput);
  assert.equal(savedPreview.booking.estimate.arrivalDiscount.percent,5);
  const savedRequest=await savedFixture.request({...savedInput,amountCents:Math.round(savedPreview.booking.estimate.payment.totalCents*.25)});
  const savedResult=await savedFixture.api.record(savedRequest);
  assert.equal(savedFixture.get(savedResult.bookingId).status,'Confirmed');
  assert.equal(savedFixture.get(savedResult.bookingId).estimate.savedQuoteId,'SAVED-TEST');
  assert.equal(savedFixture.get(savedResult.bookingId).estimate.arrivalPreference.key,'any_day');
  assert.equal(savedFixture.get(savedResult.bookingId).estimate.payment.totalCents,savedPreview.booking.estimate.payment.totalCents);
  await assert.rejects(savedFixture.api.resolve({...savedInput,source:'custom'}),/instant quotes/);
  const {captureRemainingBalance,processDuePaymentAuthorizations}=require('../api/booking/_payments');
  assert.equal((await captureRemainingBalance({bookingId:b.id,getBookingRecord:async()=>b,stripeCall:()=>{throw new Error('No card calls allowed');}})).status,'not_applicable');
  console.log('External payments: deposits/full/partial/balance, stale preview, card isolation, availability, duplicate and concurrent submissions, delivery claims, and receipt content passed. No live payments or messages.');
})().catch(error=>{console.error(error);process.exitCode=1;});
