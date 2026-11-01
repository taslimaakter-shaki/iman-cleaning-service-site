const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const shared=require('../api/booking/_shared');
(async()=>{
 const db=new PGlite();await db.exec('create role anon; create role authenticated; create role service_role;');
 await db.exec(fs.readFileSync('supabase-schema.sql','utf8').match(/create table if not exists public.bookings \([\s\S]*?\n\);/)[0]);
 for(const file of ['20260910_shared_booking_calendar.sql','20261025_flexible_arrival_reservations.sql','20261031_capacity_based_flexible_booking.sql','20261101_flexible_day_planning.sql','20261101_payment_submission_guard.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 const calls=[],intents=new Map(),keys=new Map();let behavior='success',notifications=0;
 const response=(data,status=200)=>({ok:status<400,status,json:async()=>structuredClone(data)});
 const getBooking=async id=>(await db.query('select * from bookings where id=$1',[id])).rows[0];
 const fetch=async(url,options={})=>{
  const u=new URL(url);
  if(u.hostname==='db.test'){
   try{
    if(u.pathname.endsWith('/rpc/iman_payment_order')){const b=JSON.parse(options.body);return response((await db.query('select iman_payment_order($1,$2,$3) as result',[b.p_action,b.p_id,b.p_data])).rows[0].result);}
    if(u.pathname.endsWith('/booking_payment_orders'))return response((await db.query('select * from booking_payment_orders where id=$1',[u.searchParams.get('id').slice(3)])).rows);
    throw Error('Unexpected database request');
   }catch(e){return response({message:e.message},409);}
  }
  assert.equal(u.hostname,'api.stripe.com');calls.push(u.pathname);
  const params=new URLSearchParams(options.body),key=options.headers['Idempotency-Key'];
  if(key&&keys.has(key))return response(keys.get(key));
  let result;
  if(u.pathname==='/v1/customers')result={id:'cus_mock'};
  else if(u.pathname==='/v1/payment_intents'){
   const id='pi_'+(intents.size+1),metadata={};for(const [k,v] of params){const m=k.match(/^metadata\[(.*)\]$/);if(m)metadata[m[1]]=v;}
   result={id,currency:'usd',status:'requires_payment_method',metadata,amount:Number(params.get('amount')),client_secret:id+'_secret_mock',created:1800000000};intents.set(id,result);
  }else{
   const id=u.pathname.split('/')[3],intent=intents.get(id);assert(intent,id);
   if(u.pathname.endsWith('/confirm')){
    if(intent.status==='canceled')return response({error:{message:'Canceled intent cannot charge'}},400);
    if(behavior==='decline'){intent.last_payment_error={message:'declined'};return response({error:{message:'declined',payment_intent:intent}},402);}
    intent.status=behavior==='action'?'requires_action':behavior==='processing'?'processing':'succeeded';intent.amount_received=intent.status==='succeeded'?intent.amount:0;
   }else if(u.pathname.endsWith('/cancel')){
    if(intent.status==='succeeded'||intent.status==='processing')return response({error:{message:'Cannot cancel'}},400);
    intent.status='canceled';
   }
   result=intent;
  }
  if(key)keys.set(key,structuredClone(result));return response(result);
 };
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync('api/booking/_deposit-payment.js','utf8'),{module,require:name=>{
  if(name==='crypto')return crypto;
  if(name==='./_shared')return{getBooking,bookingDurationHours:shared.bookingDurationHours,assertScheduleAvailable:async()=>{},readJsonBody:async req=>req.body,json:(_res,status,body)=>({status,...body})};
  if(name==='../crm/_quote-admin')return{checkSavedCheckout:async()=>{},resolveManaged:async q=>q};
  if(name==='../quote/_payment-record')return{sendPaymentRecordForSessionId:async()=>{notifications++;return{calendarStatus:'synced'};}};
  throw Error(name);
 },process:{env:{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',STRIPE_SECRET_KEY:'sk_test_mock',STRIPE_PUBLISHABLE_KEY:'pk_test_mock',BOOKING_PAYMENT_FLOW:'server'}},fetch,Buffer,URLSearchParams,AbortSignal,Date,console});
 const api=module.exports;
 const make=async(id,day='2030-11-06')=>{
  const b={id,service:'standard',schedule_label:'Test appointment',bedrooms_label:'',bathrooms_label:'',sqft:0,addons:[],phone:'',address:'',notes:'',created_at:new Date().toISOString(),status:'New',schedule:shared.toZonedIso(day,'08:00'),client_name:'Test',email:'test@example.invalid',service_label:'Cleaning',estimate:{calendarReservation:{state:'draft'},calendarReservationHours:7,teamHours:6,arrivalPreference:{flexible:true,windowStart:'08:00',windowEnd:'13:30',confirmationStatus:'pending'},payment:{totalCents:40000,depositCents:10000,paidCents:0}}};
  await db.query('insert into bookings select * from jsonb_populate_record(null::bookings,$1)',[b]);
  const session=await api.prepare(id,{'line_items[0][price_data][unit_amount]':10000,'metadata[booking_id]':id,customer_email:b.email});
  const token=session.url.split('#')[1];return{token,order:await api.get(token.split('.')[0])};
 };
 const a=await make('a'),b=await make('b');assert.equal(calls.length,0,'Opening checkout never contacts Stripe or creates a hold');assert.equal((await db.query('select count(*)::int as n from booking_calendar_slots')).rows[0].n,0);
 const race=await Promise.allSettled([api._test.pay(a.order,'ctoken_a'),api._test.pay(b.order,'ctoken_b')]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal(calls.filter(x=>x.endsWith('/confirm')).length,1,'Only the capacity winner can reach Stripe confirmation');
 const winner=race[0].status==='fulfilled'?a:b,loser=winner===a?b:a;
 assert.equal((await getBooking(winner.order.booking_id)).status,'Confirmed');assert.equal((await getBooking(loser.order.booking_id)).estimate.calendarReservation.state,'draft');
 await assert.rejects(api._test.pay(loser.order,'ctoken_stale'),/capacity|schedule|fit|day/i);
 const paid=await api.get(winner.order.id);await api.cancel(paid);assert.equal((await getBooking(winner.order.booking_id)).status,'Confirmed');
 const repeated=await make('repeat','2030-11-07');const before=intents.size;await Promise.all([api._test.pay(repeated.order,'ctoken_repeat'),api._test.pay(repeated.order,'ctoken_repeat')]);assert.equal(intents.size,before+1,'Repeat clicks create one intent');
 const failed=await make('declined','2030-11-08');behavior='decline';await assert.rejects(api._test.pay(failed.order,'ctoken_decline'),/not completed/);assert.equal((await getBooking('declined')).estimate.calendarReservation.state,'released');
 const old=await api.get(failed.order.id),oldIntent=structuredClone(intents.get(old.intent_id));behavior='success';await api._test.pay(old,'ctoken_retry');await api._test.record(old,oldIntent);assert.equal((await getBooking('declined')).status,'Confirmed');
 const action=await make('action','2030-11-09');behavior='action';const awaiting=await api._test.pay(action.order,'ctoken_action');assert.equal(awaiting.state,'requires_action');assert((await api._test.publicResult(awaiting)).clientSecret);await api.cancel(awaiting);assert.equal((await getBooking('action')).estimate.calendarReservation.state,'released');
 const pending=await make('pending','2030-11-10');behavior='processing';const processing=await api._test.pay(pending.order,'ctoken_pending');await api.cancel(processing);assert.equal((await getBooking('pending')).estimate.calendarReservation.state,'creating','Uncertain payment never releases capacity');
 const changed=await make('changed','2030-11-11');await db.query("update bookings set schedule=$1 where id='changed'",[shared.toZonedIso('2030-11-12','08:00')]);await assert.rejects(api._test.pay(changed.order,'ctoken_changed'),/quote changed/i);
 assert.throws(()=>api._test.verify(a.token+'tampered'),/invalid/);assert.equal(api._test.verify(a.token),a.order.id);
 const session=await api.syntheticSession('bp_'+paid.id);assert.equal(session.payment_status,'paid');assert.equal(session.amount_total,10000);assert.equal(session.metadata.booking_id,winner.order.booking_id);
 const beforeDelivery=notifications;await api.handleEvent({type:'payment_intent.succeeded',data:{object:intents.get(paid.intent_id)}});assert.equal(notifications,beforeDelivery+1,'Webhook delivers confirmation after capacity is committed');
 await api.handleEvent({type:'payment_intent.canceled',data:{object:oldIntent}});assert.equal((await getBooking('declined')).status,'Confirmed','Old failed-attempt events cannot undo a successful retry');
 await db.close();console.log('Payment submission guard: real PostgreSQL capacity race, no hold on browsing, paid/stale blocking, repeated clicks, decline/retry, 3DS cancel, processing retention, stale quote and token checks passed. All providers simulated.');
})().catch(e=>{console.error(e);process.exit(1);});
