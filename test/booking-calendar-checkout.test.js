const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require(process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite');
const root = path.join(__dirname, '..');
const clone = x => JSON.parse(JSON.stringify(x));

(async () => {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(fs.readFileSync(path.join(root,'supabase-schema.sql'),'utf8').match(/create table if not exists public.bookings \([\s\S]*?\n\);/)[0]);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260910_shared_booking_calendar.sql'),'utf8'));
  const sessions = new Map(), calls = [];
  let ready = true, stripeDown = false;
  const response = (data, status = 200) => ({ok:status < 400,status,json:async()=>clone(data),text:async()=>JSON.stringify(data)});
  const fetch = async (url, options = {}) => {
    calls.push({url,method:options.method || 'GET'});
    const u = new URL(url);
    if (u.origin === 'https://calendar.test') {
      if (u.pathname.endsWith('/rpc/iman_booking_day_planner_version')) return response(ready ? 4 : {error:'missing'}, ready ? 200 : 404);
      assert.equal(u.pathname, '/rest/v1/bookings');
      try {
        const params = [], filters = [];
        const equal = (field, expression = field) => {
          const v = u.searchParams.get(field);
          if (!v) return;
          if (v === 'is.null') filters.push(`${expression} is null`);
          else if (v.startsWith('eq.')) { params.push(v.slice(3)); filters.push(`${expression}=$${params.length}`); }
        };
        equal('id');equal('status');equal('estimate->calendarReservation->>attempt', "estimate #>> '{calendarReservation,attempt}'");
        const where = filters.length ? ` where ${filters.join(' and ')}` : '';
        if (!options.method || options.method === 'GET') return response((await db.query('select * from bookings'+where+' order by id',params)).rows);
        const data = JSON.parse(options.body);
        if (options.method === 'POST') {
          const row = {created_at:new Date().toISOString(),sqft:0,addons:[],notes:'',...data};
          return response((await db.query('insert into bookings select * from jsonb_populate_record(null::bookings,$1::jsonb) returning *',[JSON.stringify(row)])).rows,201);
        }
        assert.equal(options.method,'PATCH');
        const values = Object.entries(data).map(([key,value]) => {
          assert(['estimate','status','schedule','schedule_label','notes'].includes(key));
          params.push(key === 'estimate' ? JSON.stringify(value) : value);return `${key}=$${params.length}${key==='estimate'?'::jsonb':''}`;
        });
        return response((await db.query(`update bookings set ${values.join(',')}${where} returning *`,params)).rows);
      } catch(error) { return response({code:error.code,message:error.message},409); }
    }
    assert.equal(u.origin,'https://api.stripe.com','No notifications or live providers are allowed');
    if (stripeDown) throw new Error('Mock provider outage');
    const id = u.pathname.split('/')[4];
    const session = sessions.get(id);assert(session,`Unexpected Stripe session ${id}`);
    if (options.method === 'POST') { assert.equal(u.pathname.split('/')[5],'expire');assert.equal(session.status,'open');session.status='expired'; }
    return response(session);
  };
  const env={SUPABASE_URL:'https://calendar.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',STRIPE_SECRET_KEY:'sk_test_mock'};
  const cache = new Map();
  function load(relative) {
    const file = path.join(root,relative);if(cache.has(file)) return cache.get(file).exports;
    const module = {exports:{}};cache.set(file,module);
    vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,
      require:name=>name.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(file),name+'.js'))):require(name),
      process:{env},
      fetch,Buffer,URLSearchParams,Date,Intl,AbortSignal,console
    },{filename:file});return module.exports;
  }
  const shared = load('api/booking/_shared.js'), calendar = load('api/booking/_calendar.js');
  const row = (id,hours=9) => ({id,status:'New',service:'custom',service_label:'Test',schedule:'2030-09-12T08:00:00-04:00',schedule_label:'',bedrooms_label:'',bathrooms_label:'',client_name:'Test',phone:'',email:'',address:'',estimate:{teamHours:hours,calendarReservation:{state:'draft'}}});
  ready=false;await assert.rejects(shared.createBooking(row('not-ready')),/database update/);ready=true;
  await shared.createBooking(row('custom'));
  assert.equal((await db.query('select count(*)::int as n from booking_calendar_slots')).rows[0].n,0);
  const reserved = await calendar.reserveBooking('custom');
  await assert.rejects(shared.createBooking({...row('instant'),estimate:{teamHours:2,calendarReservation:calendar.newReservation()}}),e=>e.statusCode===409);
  const session = {id:'cs_calendar',status:'open',payment_status:'unpaid',expires_at:Math.floor(Date.now()/1000)+1800,metadata:{booking_id:'custom'}};
  sessions.set(session.id,session);
  await calendar.attachCheckout('custom',reserved.estimate.calendarReservation.attempt,session);
  const reused = await calendar.reserveBooking('custom',session);assert.equal(reused.estimate.calendarReservation.attempt,reserved.estimate.calendarReservation.attempt);
  await assert.rejects(calendar.reserveBooking('custom'),/already being prepared/);
  session.expires_at=Math.floor(Date.now()/1000)-1;
  let booking=await shared.getBooking('custom');
  booking=await calendar.changeReservation(booking,{...booking.estimate.calendarReservation,expiresAt:new Date(session.expires_at*1000).toISOString()});
  stripeDown=true;
  assert(shared.activeBooking(await calendar.reconcileReservation(booking)),'Provider outage cannot free a possibly paid reservation');stripeDown=false;
  session.status='complete';session.payment_status='paid';
  assert(shared.activeBooking(await calendar.reconcileReservation(booking)),'Paid session stays blocked even if webhook is late');
  session.status='expired';session.payment_status='unpaid';
  booking=await calendar.reconcileReservation(booking);assert.equal(booking.estimate.calendarReservation.state,'released');
  assert(!shared.activeBooking(booking));
  const renewed=await calendar.reserveBooking('custom');assert.notEqual(renewed.estimate.calendarReservation.attempt,reserved.estimate.calendarReservation.attempt);
  await calendar.releaseExpiredSession(session);
  assert.equal((await shared.getBooking('custom')).estimate.calendarReservation.state,'creating','Old expiry does not release a new attempt');
  await assert.rejects(calendar.changeReservation(reserved,{state:'released'}),/reservation changed/);
  await calendar.cleanupCheckout('custom',renewed.estimate.calendarReservation.attempt,null,{statusCode:400});
  assert.equal((await shared.getBooking('custom')).estimate.calendarReservation.state,'released');
  const cancelHold=await calendar.reserveBooking('custom');
  const cancelSession={...session,id:'cs_cancel',status:'open',payment_status:'unpaid',expires_at:Math.floor(Date.now()/1000)+1800};
  sessions.set(cancelSession.id,cancelSession);
  await calendar.attachCheckout('custom',cancelHold.estimate.calendarReservation.attempt,cancelSession);
  await calendar.expireBookingCheckout('custom','stale-attempt');
  assert.equal(cancelSession.status,'open','Old cancel links cannot expire a newer session');
  await calendar.expireBookingCheckout('custom',cancelHold.estimate.calendarReservation.attempt);
  assert.equal(cancelSession.status,'expired');
  assert.equal((await shared.getBooking('custom')).estimate.calendarReservation.state,'released');
  await calendar.expireBookingCheckout('custom',cancelHold.estimate.calendarReservation.attempt);
  const timedHold=await calendar.reserveBooking('custom');
  const timedSession={...cancelSession,id:'cs_timed',status:'open',expires_at:Math.floor(Date.now()/1000)+1800};
  sessions.set(timedSession.id,timedSession);
  await calendar.attachCheckout('custom',timedHold.estimate.calendarReservation.attempt,timedSession);
  let timedBooking=await shared.getBooking('custom');
  assert(Math.abs(Date.parse(timedBooking.estimate.calendarReservation.expiresAt)-Date.now()-300000)<3000,'Hosted capacity deadline is five minutes');
  timedBooking=await calendar.changeReservation(timedBooking,{...timedBooking.estimate.calendarReservation,expiresAt:new Date(Date.now()-1000).toISOString()});
  const released=await calendar.reconcileReservation(timedBooking);
  assert.equal(timedSession.status,'expired','Five-minute timeout must expire the still-open Stripe session');
  assert.equal(released.estimate.calendarReservation.state,'released');
  const last=await calendar.reserveBooking('custom');
  const open={...session,id:'cs_next',status:'open',expires_at:Math.floor(Date.now()/1000)+1800};sessions.set(open.id,open);
  await calendar.attachCheckout('custom',last.estimate.calendarReservation.attempt,open);
  await shared.confirmBooking('custom');
  await calendar.releaseExpiredSession({...open,status:'expired'});
  assert.equal((await shared.getBooking('custom')).status,'Confirmed');
  await shared.updateBooking('custom',{status:'Cleaner assigned'});await shared.confirmBooking('custom');
  assert.equal((await shared.getBooking('custom')).status,'Cleaner assigned','Duplicate payment event does not reset work status');
  await shared.updateBooking('custom',{status:'Cancelled'});
  await assert.rejects(shared.confirmBooking('custom'),/cancelled/);
  assert.equal((await db.query('select count(*)::int as n from booking_calendar_slots')).rows[0].n,0);
  env.BOOKING_PAYMENT_FLOW='hosted_unreserved';
  const a={...row('paid-first'),estimate:{teamHours:9,acceptPaidConflict:true,calendarReservation:{state:'draft'}}};
  const b={...a,id:'paid-second'};
  await shared.createBooking(a);await shared.createBooking(b);
  const draft=await calendar.reserveBooking(a.id);
  const hosted={id:'cs_unreserved',status:'open',payment_status:'unpaid',expires_at:Math.floor(Date.now()/1000)+1800,metadata:{booking_id:a.id}};
  sessions.set(hosted.id,hosted);
  await calendar.attachCheckout(a.id,draft.estimate.calendarReservation.attempt,hosted);
  assert.equal((await db.query('select count(*)::int as n from booking_calendar_slots')).rows[0].n,0,'Opening hosted checkout does not reserve capacity');
  await shared.confirmBooking(a.id);
  const conflict=await shared.confirmBooking(b.id);
  assert.equal(conflict.calendarSync.status,'conflict');
  assert.equal(conflict.booking.status,'New');
  assert.equal(conflict.booking.estimate.schedulingConflict.status,'pending');
  assert.equal((await shared.confirmBooking(b.id)).calendarSync.status,'conflict','Retries preserve the paid conflict for manual follow-up');
  assert.equal((await shared.getBooking(a.id)).status,'Confirmed');
  assert.equal((await db.query('select count(*)::int as n from booking_calendar_slots')).rows[0].n,1);
  await db.close();
  console.log('Actual booking/calendar modules + isolated PostgreSQL passed: readiness, draft vs checkout, custom/instant conflict, checkout reuse, expired vs paid/outage, retry fencing, definite failure cleanup, confirmation and cancellation. No live requests.');
})().catch(error=>{console.error(error);process.exitCode=1;});
