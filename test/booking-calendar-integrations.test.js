const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = x => JSON.parse(JSON.stringify(x));
const root = path.join(__dirname, '..');
function load(file, dependencies, extra={}) {
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'), {
    module,exports:module.exports,require:name=>dependencies[name] || (name === '../booking/_staffing-options' ? require('../api/booking/_staffing-options') : require(name)),Buffer,Date,Intl,URLSearchParams,AbortSignal,
    console,process:{env:{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',STRIPE_SECRET_KEY:'sk_test_mock',BOOKING_MANAGEMENT_SECRET:'test-only'}},
    fetch:async()=>{throw new Error('Unexpected network call');},...extra
  },{filename:file}); return module.exports;
}
async function googleTests() {
  const events = [], calls = [];
  let outage=false, duplicate=false;
  const google={events:{
    list:async args=>{
      calls.push({action:'list',...args}); assert.equal(args.calendarId,'info@imancleaningservice.com');
      if(outage)throw new Error('Provider unavailable');
      if(args.privateExtendedProperty)return {data:{items:[]}};
      if(args.maxResults===1)return {data:{accessRole:'owner',items:[]}};
      return {data:args.pageToken?{items:events.slice(1)}:{items:events.slice(0,1),nextPageToken:'page-two'}};
    },
    insert:async args=>{calls.push({action:'insert',...args});if(duplicate)throw {code:409};return {data:{id:args.requestBody.id}};},
    patch:async()=>{throw new Error('Unexpected patch');},delete:async()=>{throw new Error('Unexpected delete');}
  }};
  const shared=load('api/booking/_shared.js',{
    'googleapis/build/src/apis/calendar':{calendar:()=>google},
    '../quote/_shared':{getGoogleClients:()=>({auth:{getAccessToken:async()=>({token:'test-token-never-returned'}),getTokenInfo:async()=>({scopes:['https://www.googleapis.com/auth/calendar.events']})}})},
    '../google-calendar/_connection':{calendarAuth:async()=>({getAccessToken:async()=>({token:'test-token-never-returned'}),getTokenInfo:async()=>({scopes:['https://www.googleapis.com/auth/calendar.events']})})},
    './_calendar':{reconcileReservation:async b=>b}
  },{
    process:{env:{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',GOOGLE_REFRESH_TOKEN:'test'}},
    fetch:async()=>({ok:true,text:async()=>JSON.stringify([])})
  });
  assert.deepEqual(clone(await shared.googleCalendarConnectionStatus()),{connected:true,writable:true,calendarId:'info@imancleaningservice.com'});
  const event=(id,start,end,extra={})=>({id,start:{dateTime:start},end:{dateTime:end},...extra});
  events.push(event('free','2030-09-12T07:00:00-04:00','2030-09-12T22:00:00-04:00',{transparency:'transparent'}));
  events.push(event('busy','2030-09-12T08:00:00-04:00','2030-09-12T17:00:00-04:00'));
  let slots=await shared.availableSlotsForPackage({teamHours:.5},2,new Date('2030-09-10T12:00:00Z'));
  assert.deepEqual(slots.filter(s=>s.date==='2030-09-12').map(s=>s.time).join(','),'20:00');
  assert(calls.some(c=>c.pageToken==='page-two'),'All Google pages must be read');
  events[1].extendedProperties={private:{iman_booking_id:'booking-own'}};
  slots=await shared.availableSlotsForPackage({teamHours:9},2,new Date('2030-09-10T12:00:00Z'),'booking-own');
  assert(slots.some(s=>s.date==='2030-09-12'&&s.time==='08:00'),'Own Google mirror does not prevent rescheduling');
  outage=true;await assert.rejects(shared.assertScheduleAvailable('2030-09-12T08:00:00-04:00',2),/could not be verified/);outage=false;
  const booking={id:'booking-own',schedule:'2030-09-12T08:00:00-04:00',estimate:{teamHours:9},client_name:'Test',email:''};
  const first=await shared.updateBookingGoogleCalendar(booking);
  const inserted=calls.find(c=>c.action==='insert');
  assert.equal(inserted.requestBody.end.dateTime,'2030-09-12T21:00:00.000Z');
  assert.equal(inserted.calendarId,'info@imancleaningservice.com');
  duplicate=true;const retry=await shared.updateBookingGoogleCalendar(booking);
  assert.equal(first.eventId,retry.eventId);assert.equal(retry.status,'already_exists');
  duplicate=false;calls.length=0;
  await shared.syncBookingToGoogleCalendar({...booking,id:'existing-before-activation',email:'customer@example.test'},{notifyCustomer:false});
  const silent=calls.find(c=>c.action==='insert');
  assert.equal(silent.sendUpdates,'none');assert.equal(silent.requestBody.attendees.length,0);
  assert.equal(silent.requestBody.start.dateTime,'2030-09-12T12:00:00.000Z');
  assert.equal(silent.requestBody.end.dateTime,'2030-09-12T21:00:00.000Z');
}
async function rescheduleTests() {
  const original={id:'BK-1',status:'Confirmed',email:'test@example.test',phone:'',schedule:'2030-09-12T08:00:00-04:00',estimate:{teamHours:9,total:720,payment:{paidCents:18000}}};
  const calls=[];
  const shared={cleanText:x=>String(x||''),getBooking:async()=>clone(original),readJsonBody:async req=>req.body,json:(r,s,b)=>Object.assign(r,{status:s,body:b}),
    availableSlotsForPackage:async(pkg,days,now,exclude)=>{assert.equal(exclude,original.id);assert.equal(pkg.teamHours,9);return [{value:'2030-09-13T08:00:00-04:00',label:'September 13 at 8 AM'}];}
  };
  const handler=load('api/booking/_manage.js',{
    './_shared':shared,
    './_reschedule-notifications':{notifyOwner:async()=>{calls.push('team-alert');return {}; }},
    './_rescheduling':{recordOwnerNotification:async()=>{},VERSION:'test', POLICY:'test', terms:()=>({feeCents:0,count:0,state:{}}), cancellationProtection:()=>({locked:false}), requestChange:async(booking,body,slot)=>{calls.push('request');assert.equal(slot.value,body.schedule);return {...booking,estimate:{...booking.estimate,rescheduling:{request:{feeCents:0,id:"test"}}}};}},
    './_notifications':{formatAppointment:x=>x},
    './_payments':{cancellationPaymentAmounts:()=>({lessThan48Hours:false,paidCents:18000,retainedCents:0,refundCents:18000})},
    './_arrival-preference':{arrivalWindowLabel:()=>'',slotMatchesArrivalPreference:()=>true},
    '../_form-notifications':{trySendFormSubmissionNotification:async()=>{calls.push('team-alert');}}
  });
  const token=handler.createBookingManagementToken({bookingId:original.id,email:original.email});
  const res={};await handler({method:'POST',body:{action:'reschedule',token,schedule:'2030-09-13T08:00:00-04:00'}},res);
  assert.equal(res.status,200);assert.equal(res.body.booking.schedule,original.schedule);assert.deepEqual(calls,['request','team-alert']);
  assert.match(res.body.message,/original appointment remains confirmed/);
  const unavailable={};await handler({method:'POST',body:{action:'reschedule',token,schedule:'2030-09-14T08:00:00-04:00'}},unavailable);
  assert.equal(unavailable.status,409);
}
async function paidConfirmationTests() {
  const calls=[];let paid=true,booking={id:'BK-PAID',status:'New',estimate:{teamHours:9}};
  const shared={cleanText:x=>String(x||''),centsToDollars:x=>(x/100).toFixed(2),getGoogleClients:()=>{calls.push('notify');throw new Error('Mock notification outage');}};
  const handler=load('api/quote/_payment-record.js',{
    './_shared':shared,
    '../booking/_shared':{confirmBooking:async()=>{calls.push('confirm');booking.status='Confirmed';return {booking:clone(booking)};},updateBooking:async(id,patch)=>{calls.push('payment-record');booking={...booking,...clone(patch)};return booking;}},
    '../booking/_confirmation-pdf':{},'../booking/_payment-receipt-pdf':{},'../booking/_notifications':{}
  },{fetch:async()=>({ok:true,text:async()=>JSON.stringify({id:'cs_test',payment_status:paid?'paid':'unpaid',amount_total:10000,metadata:{booking_id:'BK-PAID',total_amount_cents:'40000',payment_type:'deposit_25',balance_collection:'automatic_48h_authorization'},payment_intent:{id:'pi_test',payment_method:'pm_test'}})})});
  await assert.rejects(handler.sendPaymentRecordForSessionId({sessionId:'cs_test',siteUrl:'https://example.test'}),/notification outage/);
  assert.deepEqual(calls,['confirm','payment-record','notify']);assert.equal(booking.status,'Confirmed');
  booking.estimate.payment.remaining={status:'authorized',paymentIntentId:'pi_remaining'};
  calls.length=0;await assert.rejects(handler.sendPaymentRecordForSessionId({sessionId:'cs_test',siteUrl:'https://example.test'}),/notification outage/);
  assert.deepEqual(calls,['confirm','notify']);assert.equal(booking.estimate.payment.remaining.status,'authorized');
  paid=false;calls.length=0;await assert.rejects(handler.sendPaymentRecordForSessionId({sessionId:'cs_test',siteUrl:'https://example.test'}),/not marked paid/);assert.equal(calls.length,0);
}
(async()=>{await googleTests();await rescheduleTests();await paidConfirmationTests();console.log('Calendar integration tests passed: business calendar, Google pagination/busy/free, own-event rescheduling, outage protection, duplicate-event prevention, approval-request-before-schedule-change, confirmed-before-notifications. All providers mocked.');})().catch(e=>{console.error(e);process.exitCode=1;});
