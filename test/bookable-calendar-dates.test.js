const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('book-now.js', 'utf8');
const code = source.slice(source.indexOf('  const pairedSlot ='), source.indexOf('  visitPlanControl?.addEventListener'));
const state = { serviceKey: 'standard' };
const context = vm.createContext({ state, visitPlanControl: null, scheduleSelect: null,
  monthKeyForDate: date => date.slice(0, 7), clearArrivalDiscount() {},
  setSchedulerStatus() {}, renderCalendar() {}, renderTimeSlots() {}, persistBookingDraft() {},
  longDate: date => date, recurringPlanContext: { windowStart: '2030-12-01', windowEnd: '2030-12-31', percent: 10 }
});
vm.runInContext(code, context);
const slot = (date, flexibleEligible, anytimeEligible = true, arrivalOptions = []) => ({ date, flexibleEligible, anytimeEligible, arrivalOptions });
context.slots = [slot('2030-12-01', false), slot('2030-12-02', true),
  slot('2030-12-03', true, false, ['morning']), slot('2030-12-04', true, false, ['afternoon']),
  slot('2030-12-05', true, false), slot('2031-01-01', false)];
vm.runInContext('loadSchedulerSlots(slots)', context);
assert.deepEqual(Array.from(state.availableDates), ['2030-12-02', '2030-12-03', '2030-12-04']);
assert.deepEqual(Array.from(state.availableMonths), ['2030-12']);
context.slots = [slot('2030-12-01', false)];
vm.runInContext('loadSchedulerSlots(slots)', context);
assert.equal(state.availableDates.length, 0, 'A cleaning-only fit must not highlight a date');
assert.equal(state.availableMonths.length, 0);
state.serviceKey = 'recurring';
assert.throws(() => vm.runInContext('loadSchedulerSlots(slots)', context), /No appointments are available/);
console.log('Calendar excludes cleaning-only fits and dates without arrival choices; retains Anytime and fixed choices, and checks recurring availability after filtering.');
