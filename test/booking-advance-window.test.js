const assert = require('node:assert/strict');
const { advanceBookingDays } = require('../api/booking/_shared');
for (const [date, days] of [
  ['2026-11-02T17:00Z', 92], // November 2 through February 2.
  ['2026-01-31T17:00Z', 89], // Clamp to April 30.
  ['2027-11-30T17:00Z', 91], // Leap-year February 29.
  ['2026-12-01T02:00Z', 90] // Still November 30 in New York.
]) assert.equal(advanceBookingDays(new Date(date)), days, date);
console.log('Three calendar months: month-end, leap-year and New York date boundaries passed.');
