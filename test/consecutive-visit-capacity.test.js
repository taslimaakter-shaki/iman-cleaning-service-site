const assert = require('node:assert/strict');
const fs = require('node:fs');
const {PGlite} = require('@electric-sql/pglite');
const shared = require('../api/booking/_shared');
const iso = (day,time='08:00') => shared.toZonedIso('2030-11-'+day,time);
(async()=>{
  const db = new PGlite();
  try {
    await db.exec('create role anon;create role authenticated;create role service_role;');
    await db.exec(fs.readFileSync('supabase-schema.sql','utf8').match(/create table if not exists public.bookings \([\s\S]*?\n\);/)[0]);
    for (const name of ['20260910_shared_booking_calendar','20261025_flexible_arrival_reservations','20261031_capacity_based_flexible_booking','20261101_flexible_day_planning','20261102_calendar_safe_delete','20261101_six_hour_anytime_rule','20261105_consecutive_visits']) {
      await db.exec(fs.readFileSync('supabase/migrations/'+name+'.sql','utf8'));
    }
    const booking=(id,schedule,estimate,status='Confirmed')=>({id,schedule,estimate,status,created_at:new Date().toISOString(),service:'deep',service_label:'Test',schedule_label:'',bedrooms_label:'',bathrooms_label:'',sqft:0,client_name:'Test',phone:'',email:'',address:'',addons:[],notes:''});
    const insert=b=>db.query('insert into bookings select * from jsonb_populate_record(null::bookings,$1)',[JSON.stringify(b)]);
    const pair=booking('pair',iso(20),{arrivalPreference:{key:'morning',flexible:false},secondVisitSchedule:iso(21),calendarReservationHours:7.64,calendarReservation:{state:'creating'}},'New');
    await insert(booking('block',iso(21),{teamHours:2}));
    await assert.rejects(insert(pair),/cannot fit|No daily schedule/);
    assert.equal((await db.query("select count(*)::int n from bookings where id='pair'")).rows[0].n,0);
    await db.exec("delete from bookings where id='block'");
    await insert(pair);
    const rows=()=>db.query("select visit_number,lower(busy) s from booking_calendar_slots where booking_id='pair' order by visit_number");
    assert.deepEqual((await rows()).rows.map(r=>[r.visit_number,Date.parse(r.s)]),[[1,Date.parse(iso(20))],[2,Date.parse(iso(21))]]);
    await assert.rejects(insert(booking('competitor',iso(21),{teamHours:2})),/cannot fit|No daily schedule/);
    await assert.rejects(db.query("update bookings set estimate=jsonb_set(estimate,'{secondVisitSchedule}',to_jsonb($1::text)) where id='pair'",[iso(22)]),/iman_consecutive_visits/);
    await db.exec("update bookings set status='Confirmed' where id='pair'");
    assert.equal((await rows()).rows.length,2);
    await db.exec("update bookings set status='Cancelled' where id='pair'");
    assert.equal((await rows()).rows.length,0);
    await insert({...pair,id:'expires'});
    await db.exec("update bookings set estimate=jsonb_set(estimate,'{calendarReservation,state}', '\"released\"') where id='expires'");
    assert.equal((await db.query('select count(*)::int n from booking_calendar_slots')).rows[0].n,0);
    await insert(booking('long-on-second',iso(21,'16:30'),{teamHours:3,manHours:6}));
    const anytime={...pair,id:'flex',estimate:{...pair.estimate,arrivalPreference:{key:'any_day',flexible:true,windowStart:'08:00',windowEnd:'12:00'}}};
    await assert.rejects(insert(anytime), /Anytime is unavailable/);
    await db.exec("delete from bookings where id='long-on-second'");
    await insert({...anytime,estimate:{...anytime.estimate,secondVisitSchedule:iso(21,'09:00')}});
    assert.equal((await db.query("select count(*)::int n from booking_calendar_slots where booking_id='flex'")).rows[0].n,2);
    await assert.rejects(insert({...pair,id:'different-times',schedule:iso(23),estimate:{...pair.estimate,secondVisitSchedule:iso(24,'09:00')}}),/iman_consecutive_visits/);
    const morningPair=booking('shared-days',iso(25),{teamHours:398/60,calendarReservationHours:458/60,
      secondVisitSchedule:iso(26),arrivalPreference:{key:'morning',flexible:false}});
    await insert(morningPair);
    for(const day of [25,26]) {
      const existing=[{...morningPair,schedule:iso(day)}];
      assert(shared.planBookingDay(iso(day,'17:38'),2.5,existing),'A later 90-minute cleaning plus its buffer fits');
      assert.equal(shared.planBookingDay(iso(day,'17:37'),2.5,existing),null,'Travel gap is required');
      assert.equal(shared.planBookingDay(iso(day,'17:38'),3,existing),null,'Cleaning and buffer must finish before closing');
      await assert.rejects(insert(booking('too-early-'+day,iso(day,'17:37'),{calendarReservationHours:2.5})),/cannot fit|No daily schedule/);
      await assert.rejects(insert(booking('too-long-'+day,iso(day,'17:38'),{calendarReservationHours:3})),/within 8 AM to 8:30 PM|cannot fit|No daily schedule/);
      await insert(booking('later-'+day,iso(day,'17:38'),{teamHours:1.5,calendarReservationHours:2.5}));
    }
    assert.equal((await db.query("select count(*)::int n from booking_calendar_slots where booking_id in ('shared-days','later-25','later-26')")).rows[0].n,4);
    console.log('Consecutive visit capacity: both dates reserved, conflict rolls back both, cancel and expiry release both.');
  } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
