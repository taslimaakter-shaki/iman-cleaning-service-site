const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite');
const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260910_shared_booking_calendar.sql'), 'utf8');
const flexibleArrivalMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261025_flexible_arrival_reservations.sql'), 'utf8');
const capacityMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261031_capacity_based_flexible_booking.sql'), 'utf8');
const table = fs.readFileSync(path.join(root, 'supabase-schema.sql'), 'utf8').match(/create table if not exists public.bookings \([\s\S]*?\n\);/)[0];
const shared = require('../api/booking/_shared');

const vacation = {
  id: 'google:nine-day-block', source: 'google-calendar', status: 'Confirmed',
  schedule: '2026-11-07T00:00:00-05:00', estimate: { teamHours: 216 }
};
const smallCleaning = shared.calculateHourlyCleaningQuote(4);
const busy = (id, start, hours) => ({
  id, source: "google-calendar", status: "Confirmed",
  schedule: `2030-11-20T${start}:00-05:00`, estimate: { teamHours: hours }
});
const combined = busy("combined", "08:00", 2);
const expectedAfternoon = shared.availableSlotsForDate(smallCleaning, "2030-11-20", [combined]);
assert(expectedAfternoon.some(slot => slot.time === "14:00"));
for (const events of [
  [busy("a", "08:00", 1), busy("b", "09:00", 1)],
  [busy("b", "09:00", 1), busy("a", "08:00", 1)],
  [busy("a", "08:00", 1.5), busy("b", "09:00", 1)],
  [combined, busy("inside", "08:30", .5), combined]
]) {
  const original = JSON.stringify(events);
  assert.deepEqual(shared.availableSlotsForDate(smallCleaning, "2030-11-20", events), expectedAfternoon);
  assert(shared.planBookingDay("2030-11-20T12:00:00-05:00", 3, events));
  assert.equal(shared.planBookingDay("2030-11-20T11:30:00-05:00", 3, events), null);
  assert.equal(JSON.stringify(events), original, "Calendar normalization must not rewrite source records");
}
assert.deepEqual(
  shared.availableSlotsForDate(smallCleaning, "2030-11-20", [busy("a", "08:00", 1), busy("b", "10:00", 1)]),
  shared.availableSlotsForDate(smallCleaning, "2030-11-20", [busy("span", "08:00", 3)]),
  "An unbookable gap between busy events must not hide the free afternoon"
);
const separated = [busy("a", "08:00", 1), busy("b", "16:00", 1)];
assert(shared.planBookingDay("2030-11-20T11:00:00-05:00", 3, separated), "Keep genuinely bookable gaps");
assert.equal(shared.bookingDurationHours(vacation), 216);
for (const day of ['2026-11-06', '2026-11-16', '2026-11-20']) {
  assert.deepEqual(shared.availableSlotsForDate(smallCleaning, day, [vacation]),
    shared.availableSlotsForDate(smallCleaning, day, []), day + ': unrelated dates stay available');
}
assert.equal(shared.availableSlotsForDate(smallCleaning, '2026-11-10', [vacation]).length, 0);
assert.throws(() => shared.bookingDurationHours({ ...vacation, source: undefined }), /valid appointment duration/);
for (const hours of [0, -1, Infinity, NaN]) {
  assert.throws(() => shared.bookingDurationHours({ ...vacation, estimate: { teamHours: hours } }), /valid appointment duration/);
}
const partial = { ...vacation, schedule: '2026-11-06T08:00:00-05:00', estimate: { teamHours: 216 } };
const afterBlock = shared.availableSlotsForDate(smallCleaning, '2026-11-15', [partial]);
assert(afterBlock.some(slot => slot.time === '12:00'), 'The event ending at 8 AM allows service after its travel buffer');
assert(!afterBlock.some(slot => slot.time === '08:00'), 'The travel buffer still applies');

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
  await db.exec(capacityMigration);
  assert.equal((await db.query('select iman_booking_calendar_version() as v')).rows[0].v, 3);
  assert.equal((await db.query('select count(*)::int as n from booking_calendar_slots')).rows[0].n, 1);
  await assert.rejects(insert(db, record('instant-overlap', '10:00')), /conflicts/);
  await assert.rejects(insert(db, record('instant-too-soon', '18:30')), /conflicts/);
  await insert(db, record('instant-boundary', '19:00', 0.5));
  assert.deepEqual(shared.availableSlotsForDate({teamHours: 2}, '2030-09-12', [record('custom', '08:00', 9)]), []);
  assert.deepEqual(shared.availableSlotsForDate({teamHours: 0.5}, '2030-09-12', [record('custom', '08:00', 9)]).map(s=>s.time)[0], '19:00');
  assert.equal(shared.availableSlotsForDate({teamHours: 4}, '2030-09-12', [record('flexible', '08:00', 3, 'Confirmed', {calendarReservationHours:4})])[0].time, '14:00');
  // Price never determines time; fractional on-site duration is not forced to one hour.
  assert.equal(shared.bookingDurationHours(record('fractional', '08:00', .25)), .25);
  assert.equal(shared.bookingDurationHours(record('flexible', '08:00', 3, 'Confirmed', {calendarReservationHours: 4})), 4);
  await assert.rejects(db.query("update bookings set schedule = '2030-09-12T18:30:00-04:00' where id = 'instant-boundary'"), /conflicts/);
  assert.match((await db.query("select schedule from bookings where id='instant-boundary'")).rows[0].schedule, /19:00/);
  await assert.rejects(db.query("update bookings set estimate = '{\"teamHours\":10}' where id = 'existing-custom'"), /conflicts/);
  await db.query("update bookings set status='Cancelled' where id='existing-custom'");
  await insert(db, record('replacement', '08:00', 1));
  await db.query("update bookings set status='Completed' where id='replacement'");
  await assert.rejects(insert(db, record('completed-travel-overlap', '10:30', 1)), /conflicts/);
  await insert(db, record('after-completed-travel', '11:00', 1));
  await db.query("delete from bookings");

  // A three-hour service reserves four hours including the protected extension,
  // followed by two hours for travel. An 8 AM booking permits a 2 PM start.
  await insert(db, record('flexible-morning', '08:00', 3, 'Confirmed', {calendarReservationHours:4,arrivalPreference:{key:'any_day',flexible:true}}));
  await insert(db, record('flexible-afternoon', '14:00', 3, 'Confirmed', {calendarReservationHours:4,arrivalPreference:{key:'afternoon',flexible:true}}));
  await assert.rejects(insert(db, record('flexible-travel-overlap', '13:30', 3, 'Confirmed', {calendarReservationHours:4})), /reserved service capacity|travel window|conflicts/);
  assert.equal((await db.query('select count(*)::int as n from booking_calendar_slots')).rows[0].n, 2);
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
  console.log('Shared calendar PostgreSQL tests passed: capacity-based same-day bookings, overlap exclusion, competing reservations, cancellation, failed reschedule/duration rollback, drafts, protected checkout and safe migration rollback. Isolated test database only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
