const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {assertMinimumTotal} = require('../api/booking/_minimum-total');
for (const cents of [0,11999,NaN,Infinity]) assert.throws(()=>assertMinimumTotal(cents),/minimum booking total/);
for (const cents of [12000,12001]) assert.doesNotThrow(()=>assertMinimumTotal(cents));
const source=fs.readFileSync(require.resolve('../book-now.js'),'utf8');
let step=2, edits=0, focused=false;
const listeners={}, cancelButton={}, editButton={}, withoutButton={}, amount={}, shortfall={};
for (const button of [cancelButton,editButton,withoutButton]) button.addEventListener=(type,fn)=>button[type]=fn;
const dialog={open:false,querySelector:s=>s==='[data-minimum-without-discounts]'?withoutButton:s==='[data-minimum-current-total]'?amount:s==='[data-minimum-shortfall]'?shortfall:s==='[data-minimum-edit]'?editButton:cancelButton,showModal(){this.open=true;},close(){this.open=false;},addEventListener:(type,fn)=>listeners[type]=fn};
const state={package:{price:119.99}};
const context={state,Intl,Number,money:n=>"$"+n,packageWithoutPromo:p=>p.promoDiscount?{...p,price:p.originalTotalCents/100,promoDiscount:null}:p,removePromo(){state.package={...state.package,price:120};state.promo=null;},resetAppointmentSelection(){state.arrivalPreference="";},showSavedQuoteDelivery(){},document:{querySelector:s=>s==='[data-minimum-dialog]'?dialog:s==='[data-load-availability]'?{focus(){focused=true;}}:{click(){edits++;}}},goToStep:n=>step=n};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  const minimumDialog ='),source.indexOf('  const availabilityButtons ='))+'\n globalThis.test={belowBookingMinimum,showBookingMinimum};',context);
assert(context.test.belowBookingMinimum());context.test.showBookingMinimum();assert(dialog.open);assert.equal(amount.textContent,'$119.99');assert.equal(shortfall.textContent,'$0.01');
cancelButton.click();assert(!dialog.open);assert.equal(step,2);assert(focused);assert.equal(state.package.price,119.99);
context.test.showBookingMinimum();editButton.click();assert.equal(edits,1);assert(!dialog.open);
context.test.showBookingMinimum();listeners.cancel({preventDefault(){}});assert(!dialog.open);assert.equal(step,2);
state.package.price=120;assert(!context.test.belowBookingMinimum());
state.package.price=112.50;assert(context.test.belowBookingMinimum(),'Discounted final total is checked');
console.log('Minimum popup: $120 boundary, edit, cancel, Escape, preserved quote and discounts passed.');

state.package={price:114,originalTotalCents:12000,promoDiscount:{amountCents:600}};
state.promo=state.package.promoDiscount;
context.test.showBookingMinimum();
assert.equal(withoutButton.hidden,false);
assert.match(withoutButton.textContent,/120/);
withoutButton.click();
assert.equal(state.package.price,120);
assert.equal(state.promo,null);
assert.equal(step,2);
state.package={price:110,originalTotalCents:11500,promoDiscount:{amountCents:500}};
state.promo=state.package.promoDiscount;
context.test.showBookingMinimum();
assert.equal(withoutButton.hidden,true);

// A fixed arrival meets the minimum with the weekly discount still applied.
dialog.close();
const weekly = {code: 'WEEKLY20', amountCents: 3000};
const fixedArrival = {price: 120, promoDiscount: weekly};
Object.assign(state, {
  serviceKey: 'recurring', selectedDate: '2030-11-05', arrivalPreference: 'any_day',
  promo: weekly, packageBeforeArrivalDiscount: fixedArrival,
  package: {price: 112.50, promoDiscount: weekly}, arrivalDiscount: {percent: 5}
});
let guidance;
Object.assign(context, {
  scheduleSelect: {value: '2030-11-05T08:00:00-05:00'}, arrivalOptions: null, calendarGrid: null,
  renderQuoteOverview() {}, renderPriceBreakdown() {}, renderCalendar() {}, renderTimeSlots() {},
  setSchedulerStatus(message) { guidance = message; }
});
vm.runInContext(source.slice(source.indexOf('  const clearArrivalDiscount ='), source.indexOf('  const resetAppointmentSelection =')), context);
context.test.showBookingMinimum();
assert.equal(step, 3);
assert.equal(dialog.open, false);
assert.equal(state.selectedDate, '2030-11-05');
assert.equal(state.package, fixedArrival);
assert.equal(state.promo, weekly);
assert.equal(state.arrivalDiscount, null);
assert.equal(state.arrivalPreference, '');
assert.equal(context.scheduleSelect.value, '');
assert.match(guidance, /Morning or Afternoon/);
assert.equal(context.test.belowBookingMinimum(), false);

// A fixed arrival below $120 must still use the ordinary minimum notice.
state.packageBeforeArrivalDiscount = {price: 119.99, promoDiscount: weekly};
state.package = {price: 112.49, promoDiscount: weekly};
state.arrivalPreference = 'any_day';
context.test.showBookingMinimum();
assert.equal(dialog.open, true);
assert.equal(withoutButton.hidden, true);
