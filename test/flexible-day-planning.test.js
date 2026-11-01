const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const shared = require('../api/booking/_shared');
const date = '2030-11-02';
const quarterSlots = shared.availableSlotsForDate({teamHours:4.75}, date, []);
assert(quarterSlots.some(s=>s.time==='14:45'), 'Calculated afternoon start is available off the half-hour grid');
const iso = time => shared.toZonedIso(date, time);
const make = (id, time, labor, flexible = true, start = '08:00', end = '17:30') => ({
  id, status: 'Confirmed', schedule: iso(time), service: 'standard', service_label: 'Cleaning',
  schedule_label: '', bedrooms_label: '', bathrooms_label: '', client_name: 'Test', phone: '', email: '', address: '',
  estimate: { manHours: labor, teamHours: labor / 2, calendarReservationHours: labor / 2 + 1,
    arrivalPreference: { flexible, key: flexible ? 'any_day' : 'exact', windowStart: start, windowEnd: end, confirmationStatus: flexible ? 'pending' : 'confirmed' } }
});
const first = make('first', '08:00', 4);
let plan = shared.planBookingDay(iso('13:00'), 3.5, [first]);
assert(plan); assert.equal(plan.at(-1).end, new Date(iso('16:30')).toISOString());
// A fixed later provisional start must not hide available capacity before/after it.
const late = make('late', '15:00', 4);
plan = shared.planBookingDay(iso('15:00'), 3.5, [late]);
assert(plan); assert.equal(plan.find(j=>j.id === 'late').start, new Date(iso('08:00')).toISOString());
const pinned = make('fixed', '15:00', 4, false);
assert.equal(shared.planBookingDay(iso('15:00'), 3.5, [pinned]), null);
assert(shared.planBookingDay(iso('17:00'), 3.5, [first]), 'Final buffer may end exactly at closing');
assert.equal(shared.planBookingDay(iso('17:30'), 3.5, [first]), null);
assert.equal(shared.planBookingDay(iso('13:00'), 8, [first]), null);
const morning = make('morning', '08:00', 4, true, '08:00', '12:00');
assert.equal(shared.planBookingDay(iso('08:00'), 6, [morning]), null, 'Never move morning booking past noon');
const mirror = { ...late, source: 'google-calendar', estimate: { teamHours: 3 } };
assert(shared.planBookingDay(iso('15:00'), 3.5, [late, mirror]), 'Linked mirror is not another fixed booking');
const external = { ...mirror, id:'google:external' };
assert.equal(shared.planBookingDay(iso('15:00'), 3.5, [late, external]), null);

(async()=>{
 const db = new PGlite();
 await db.exec('create role anon; create role authenticated; create role service_role;');
 const schema = fs.readFileSync('supabase-schema.sql','utf8').match(/create table if not exists public.bookings \([\s\S]*?\n\);/)[0];
 await db.exec(schema);
 for (const name of ['20260910_shared_booking_calendar.sql','20261025_flexible_arrival_reservations.sql','20261031_capacity_based_flexible_booking.sql','20261101_flexible_day_planning.sql']) await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 const insert = b => db.query('insert into bookings select * from jsonb_populate_record(null::bookings, $1::jsonb)', [JSON.stringify({created_at:new Date().toISOString(),sqft:0,addons:[],notes:'',...b})]);
 assert.equal((await db.query('select iman_booking_day_planner_version() as v')).rows[0].v,4);
 await insert(late);
 await insert(make('second','15:00',5));
 const rows = (await db.query('select booking_id, lower(busy) as start, upper(busy) as finish from booking_calendar_slots order by lower(busy)')).rows;
 assert.equal(rows.length,2);
 assert.equal(Date.parse(rows[1].start), Date.parse(rows[0].finish), 'Exactly two travel hours follow the first reserved service block');
 assert.equal(Date.parse(rows[1].finish) - 2*3600000, Date.parse(iso('16:30')), 'Either order fits in 8.5 hours, excluding outbound travel');
 assert.equal((await db.query("select schedule from bookings where id='late'")).rows[0].schedule,late.schedule,'Replanning never rewrites customer schedule or window');
 await assert.rejects(insert(make('third','08:00',6)), /cannot fit|No daily schedule/);
 assert.equal((await db.query('select count(*)::int as n from bookings')).rows[0].n,2);
 await db.exec('delete from bookings');
 await insert(pinned);
 await assert.rejects(insert(make('overlap','15:00',5,false)), /No daily schedule/);
 await db.exec('delete from bookings');
 await insert(first); await insert(make('at-close','17:00',5,false));
 await assert.rejects(db.query("update bookings set schedule=$1 where id='at-close'",[iso('17:30')]),/8:30 PM/);
 await db.exec('delete from bookings');
 await insert(morning);
 await assert.rejects(insert(make('too-long','08:00',10,false)),/No daily schedule/);
 await db.exec('delete from bookings');
 await insert(make('one','08:00',8));
 const competing = await Promise.allSettled([insert(make('two','08:00',8)), insert(make('three','08:00',8))]);
 assert.equal(competing.filter(r=>r.status==='fulfilled').length,1,'Only remaining capacity can be reserved');
 await db.query("update bookings set status='Cancelled' where id='one'");
 await insert(make('replacement','08:00',8));
 assert.equal((await db.query('select count(*)::int as n from booking_calendar_slots')).rows[0].n,2);
 await db.close();
 console.log('Whole-day planning: reordering, exact times, window boundaries, closing buffer, mirrors, external blocks, atomic rollback and competing holds passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
