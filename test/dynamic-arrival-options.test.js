const assert = require('node:assert/strict');
const arrival = require('../api/booking/_arrival-preference');
function slots(times, date = '2030-11-06') {
  return times.map(time => ({ date, time, value: `${date}T${time}:00-05:00`, flexibleEligible: true, teamHours: 2.5 }));
}
function offered(times) {
  return arrival.markArrivalOptions(slots(times)).flatMap(slot => slot.arrivalOptions.map(key => [key, slot.time]));
}
assert.deepEqual(offered(['08:00','09:00','11:30','12:00','12:30']), [['morning','08:00'],['afternoon','12:30']]);
assert.deepEqual(offered(['08:00','10:00','11:00']), [['morning','11:00']]);
assert.deepEqual(offered(['10:30','11:00','12:00','17:00']), [['morning','10:30'],['afternoon','17:00']]);
assert.deepEqual(offered(['12:00','17:00']), [['afternoon','17:00']]);
assert.deepEqual(offered([]), []);
assert.deepEqual(offered(['11:45','12:00']), [['morning','11:45'],['afternoon','12:00']]);
const marked = arrival.markArrivalOptions([...slots(['08:00','11:00']), ...slots(['08:00','12:30'], '2030-11-07')]);
assert.equal(marked.filter(s => s.arrivalOptions.length).length, 3);
const chosen = marked.find(s => s.time === '12:30');
const base = arrival.arrivalPreferenceForKey('afternoon', 2.5);
assert.equal(arrival.slotMatchesArrivalPreference(chosen, base), true);
assert.equal(arrival.slotMatchesArrivalPreference(marked[0], arrival.arrivalPreferenceForKey('morning', 2.5)), false);
const resolved = arrival.preferenceForSlot(base, chosen);
assert.equal(resolved.start, '12:30');
assert.equal(resolved.end, '12:30');
assert.equal(arrival.arrivalWindowLabel(resolved, 2.5), '12:30 PM');
assert.equal(arrival.applyArrivalDiscount({ teamHours: 2.5, subtotalCents: 10000 }, resolved).arrivalPreference.start, '12:30');
console.log('Dynamic arrival choices: both periods, morning-only, afternoon-only, later morning, noon boundary, per-day selection and exact saved start passed.');

const shared = require('../api/booking/_shared');
const day = '2030-11-06';
const fixed = { id: 'fixed', status: 'Confirmed', schedule: shared.toZonedIso(day, '18:00'), estimate: { calendarReservationHours: 2.5 } };
function actualOptions(teamHours, records) {
  return arrival.markArrivalOptions(shared.availableSlotsForDate({ teamHours }, day, records).map(slot => ({ ...slot, flexibleEligible: !!shared.planBookingDay(slot.value, teamHours + 1, records) })))
    .flatMap(slot => slot.arrivalOptions.map(key => [key, slot.time]));
}
assert.deepEqual(actualOptions(2.5, [fixed]), [['morning', '08:00'], ['afternoon', '12:30']]);
assert.deepEqual(actualOptions(4, [fixed]), [['morning', '11:00']]);
assert.deepEqual(actualOptions(2.25, [fixed]), [['morning', '08:00'], ['afternoon', '12:45']]);
const flexible = { id: 'flex', status: 'Confirmed', schedule: shared.toZonedIso(day, '08:00'), estimate: { calendarReservationHours: 2.5, arrivalPreference: { flexible: true, windowStart: '08:00', windowEnd: '18:00', confirmationStatus: 'pending' } } };
assert.deepEqual(actualOptions(2.5, [flexible]), [['morning','08:00'], ['afternoon','17:00']]);
