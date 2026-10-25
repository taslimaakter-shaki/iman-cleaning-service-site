const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite');
const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260910_shared_booking_calendar.sql'), 'utf8');
const flexibleArrivalMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261025_flexible_arrival_reservations.sql'), 'utf8');
const table = fs.readFileSync(path.join(root, 'supabase-schema.sql'), 'utf8').match(/create table if not exists public.bookings \([\s\S]*?\n\);/)[0];
const shared = require('../api/booking/_shared');

async function database() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(table);
  return db;
}
const record = (id, time, hours = 2, status = 'Confirmed', extra = {}) => ({
  id, status, schedule: `2030-09-12T${time}:00-04:00`, service: 'custom', service_label: 'Test cleaning',
  schedule_label: '', bedrooms_label: '', bathrooms_label: '', client_name: 'Test', phone: '', email: '', address: '',
  estimate: { teamHours: hours, ...extra }
});
async function insert(db, b) {
  return db.query('insert into public.bookings select * from jsonb_populate_record(null::public.bookings, $1::jsonb) returning id', [JSON.stringify({created_at: new Date().toISOString(), sqft: 0, addons: [], notes: '', ...b})]);
}

(async () => {
  const db = await database();
  await insert(db, record('existing-custom', '08:00', 9));
  await db.exec(migration);
  await db.exec(flexibleArrivalMigration);
  assert.equal((await db.query('select iman_booking_calendar_version() as v')).rows[0].v, 2);
  assert.equal((await db.query('select count(*)::int as n from booking_calendar_slots')).rows[0].n, 1);
  await assert.rejects(insert(db, record('instant-overlap', '10:00')), /conflicts/);
  await assert.rejects(insert(db, record('instant-too-soon', '19:30')), /conflicts/);
  await insert(db, record('instant-boundary', '20:00', 0.5));
  assert.deepEqual(shared.availableSlotsForDate({teamHours: 2}, '2030-09-12', [record('custom', '08:00', 9)]), []);
  assert.deepEqual(shared.availableSlotsForDate({teamHours: 0.5}, '2030-09-12', [record('custom', '08:00', 9)]).map(s=>s.time), ['20:00']);
  // Price never determines time; fractional on-site duration is not forced to one hour.
  assert.equal(shared.bookingDurationHours(record('fractional', '08:00', .25)), .25);
  assert.equal(shared.bookingDurationHours(record('flexible', '08:00', 3, 'Confirmed', {calendarReservationHours: 4})), 4);
  await assert.rejects(db.query("update bookings set schedule = '2030-09-12T19:00:00-04:00' where id = 'instant-boundary'"), /conflicts/);
  assert.match((await db.query("select schedule from bookings where id='instant-boundary'")).rows[0].schedule, /20:00/);
  await assert.rejects(db.query("update bookings set estimate = '{\"teamHours\":10}' where id = 'existing-custom'"), /conflicts/);
  await db.query("update bookings set status='Cancelled' where id='existing-custom'");
  await insert(db, record('replacement', '08:00', 1));
  await db.query("update bookings set status='Completed' where id='replacement'");
  await assert.rejects(insert(db, record('completed-buffer', '10:00', 1)), /conflicts/);
  await db.query("delete from bookings");

  // Draft offers do not reserve time. Two racing real reservations cannot both win.
  await insert(db, record('draft', '08:00', 9, 'New', {calendarReservation: {state:'draft'}}));
  const racing = await Promise.allSettled([
    insert(db, record('custom-hold', '08:00', 9, 'New', {calendarReservation: {state:'creating', attempt:'a'}})),
    insert(db, record('instant-hold', '08:00', 2, 'New', {calendarReservation: {state:'creating', attempt:'b'}}))
  ]);
  assert.equal(racing.filter(r=>r.status==='fulfilled').length, 1);
  const heldId = racing[0].status==='fulfilled' ? 'custom-hold' : 'instant-hold';
  await db.query('update bookings set created_at = now() - interval \'3 hours\' where id=$1', [heldId]);
  await assert.rejects(insert(db, record('still-protected', '08:00', 1)), /conflicts/);
  await db.query("update bookings set estimate = jsonb_set(estimate, '{calendarReservation,state}', '\"released\"') where id=$1", [heldId]);
  await insert(db, record('after-expiry', '08:00', 1));
  await db.query("delete from bookings");
  // Expired legacy New entries are removed atomically before checking a new booking.
  await insert(db, {...record('legacy', '08:00', 1, 'New'), created_at: new Date(Date.now()-20*60000).toISOString()});
  await db.query("update booking_calendar_slots set legacy_expires_at = now() - interval '1 minute' where booking_id='legacy'");
  await insert(db, record('legacy-replacement', '08:00', 1));
  assert.equal((await db.query("select has_function_privilege('anon', 'iman_booking_calendar_version()', 'execute') as allowed")).rows[0].allowed, false);
  await db.close();

  // A bad existing schedule stops installation instead of silently dropping bookings.
  const conflict = await database();
  await insert(conflict, record('old-a', '08:00', 9));
  await insert(conflict, record('old-b', '10:00', 2));
  await assert.rejects(conflict.exec(migration), /conflicting key|overlap/);
  await conflict.exec('rollback');
  assert.equal((await conflict.query("select to_regclass('public.booking_calendar_slots') as name")).rows[0].name, null);
  assert.equal((await conflict.query('select count(*)::int as n from bookings')).rows[0].n, 2);
  await conflict.close();
  console.log('Shared calendar PostgreSQL tests passed: backfill, overlap exclusion, 3-hour boundary, competing reservations, cancellation, failed reschedule/duration rollback, drafts, protected checkout and safe migration rollback. Isolated test database only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
