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

// Recurring plan prices can cross the ordinary minimum both before and after discounts.
state.serviceKey = 'recurring';
for (const price of [120, 119.99, 96]) {
  state.package = {price};
  assert.equal(context.test.belowBookingMinimum(), false);
  assert.doesNotThrow(() => assertMinimumTotal(Math.round(price * 100), 'recurring'));
}
state.package = null;
assert.equal(context.test.belowBookingMinimum(), true);
for (const invalid of [NaN, Infinity, 0, -1]) {
  assert.throws(() => assertMinimumTotal(invalid, 'recurring'));
}
state.serviceKey = 'standard';
state.package = {price: 119.99};
assert.equal(context.test.belowBookingMinimum(), true);
