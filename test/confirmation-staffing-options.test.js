const assert = require('assert');
const { staffingOptions, displayNotes } = require('../api/booking/_staffing-options');
assert.equal(staffingOptions({ manHours: 2 }), '1 team member for up to 2 hours, or 2 team members for up to 1 hour');
assert.equal(staffingOptions({ laborHours: 6.5 }), '1 team member for up to 6 hours 30 minutes, or 2 team members for up to 3 hours 15 minutes');
assert.equal(staffingOptions({ teamHours: 1, cleanerCount: 2 }), staffingOptions({ manHours: 2 }));
assert.equal(staffingOptions({ manHours: 7 }), '2 team members for up to 3 hours 30 minutes');
assert.equal(staffingOptions({ manHours: 8 }), '2 team members for up to 4 hours');
assert.equal(staffingOptions({}), '');
const notes = 'Please clean the kitchen. Maximum labor: 2 labor-hours; two-person team for up to 1 hours. Service may be completed sooner.';
assert.equal(displayNotes(notes, { manHours: 2 }), 'Please clean the kitchen. Maximum labor: 2 labor-hours; 1 team member for up to 2 hours, or 2 team members for up to 1 hour. Service may be completed sooner.');
assert.equal(displayNotes('Customer requested two cleaners.', { manHours: 2 }), 'Customer requested two cleaners.');
console.log('Confirmation staffing options and generated notes tests passed.');

assert.equal(staffingOptions({ laborHours: 8, cleanerCount: 1, teamHours: 8 }), '2 team members for up to 4 hours');
assert.equal(displayNotes('Maximum labor: 8 labor-hours; two-person team for up to 8 hours. Service may be completed sooner.', { manHours: 8 }), 'Maximum labor: 8 labor-hours; 2 team members for up to 4 hours. Service may be completed sooner.');
