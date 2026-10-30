const assert = require("node:assert/strict");
const { applyRecurringDiscount, completedBookingForOrder, customerFirstName, discountForDays, verifyRecurringDiscount } = require("../api/booking/_recurring-discount");

assert.deepEqual(discountForDays(7), { code: "WEEKLY20", label: "Weekly Cleaning Discount", percent: 20 });
assert.equal(discountForDays(12).percent, 20);
assert.equal(discountForDays(13).percent, 15);
assert.equal(discountForDays(24).percent, 15);
assert.equal(discountForDays(25).percent, 10);
assert.equal(discountForDays(40).percent, 10);
assert.equal(discountForDays(41).percent, 5);
assert.equal(discountForDays(365).percent, 5);
assert.equal(discountForDays(6), null);
assert.equal(discountForDays(366), null);

const previous = {
  id: "booking-1",
  status: "Completed",
  schedule: "2026-10-01T14:00:00.000Z",
  email: "returning@example.com",
  phone: "9295550101",
  client_name: "Zack Radow",
  estimate: { orderNumber: "12345678", payment: { status: "paid", paidCents: 10000 } }
};
assert.equal(customerFirstName(completedBookingForOrder([previous], "12345678")), "Zack");
const verified = verifyRecurringDiscount([previous], {
  recurringPlan: "weekly", previousOrderNumber: "12345678",
  schedule: "2026-10-10T16:00:00.000Z",
  customer: { email: "returning@example.com" }
});
assert.equal(verified.percent, 20);
assert.equal(verified.days, 9);
assert.throws(() => verifyRecurringDiscount([previous], {
  recurringPlan: "weekly", previousOrderNumber: "12345678", schedule: "2026-10-10T16:00:00.000Z", customer: { email: "different@example.com" }
}), error => error.code === "RECURRING_CUSTOMER_MISMATCH");
assert.throws(() => verifyRecurringDiscount([{ ...previous, status: "Confirmed" }], {
  recurringPlan: "weekly", previousOrderNumber: "12345678", schedule: "2026-10-10T16:00:00.000Z", customer: { email: "returning@example.com" }
}), error => error.code === "RECURRING_ORDER_NOT_FOUND");
assert.throws(() => verifyRecurringDiscount([{ ...previous, estimate: { ...previous.estimate, payment: { status: "deposit_pending", paidCents: 0 } } }], {
  recurringPlan: "weekly", previousOrderNumber: "12345678", schedule: "2026-10-10T16:00:00.000Z", customer: { email: "returning@example.com" }
}), error => error.code === "RECURRING_ORDER_NOT_FOUND", "Returning discounts require a previously paid booking");

const discounted = applyRecurringDiscount({ serviceKey: "recurring", priceCents: 10000, totalCents: 10000, price: 100, total: 100 }, verified);
assert.equal(discounted.priceCents, 8000);
assert.equal(discounted.recurringDiscount.amountCents, 2000);
console.log("Recurring discount ranges, completed-order verification, identity matching, and pricing passed.");

assert.equal(completedBookingForOrder([previous], "  booking-1  "), previous, "Reference works even when an order number is also present");
assert.throws(() => completedBookingForOrder([previous], "QUOTE-12345678"), error => error.code === "RECURRING_ORDER_NOT_FOUND");
assert.throws(() => completedBookingForOrder([previous], "87654321"), error => error.code === "RECURRING_ORDER_NOT_FOUND");
for (const status of ["Draft", "Pending", "Confirmed", "Cancelled", "Expired"]) {
  assert.throws(() => completedBookingForOrder([{...previous, status}], "booking-1"), error => error.code === "RECURRING_ORDER_NOT_FOUND");
}
assert.throws(() => verifyRecurringDiscount([previous], {recurringPlan: "weekly", previousOrderNumber:"booking-1",schedule:"2026-10-10",customer:{email:"different@example.com"}}),error=>error.code==="RECURRING_CUSTOMER_MISMATCH");
assert.equal(verifyRecurringDiscount([previous], {recurringPlan: "weekly", previousOrderNumber:"booking-1",schedule:"2026-10-10",customer:{email:"returning@example.com"}}).previousOrderNumber,"12345678");
console.log("Booking references, invalid quotes, unpaid/uncompleted bookings and reference customer matching passed.");

const { recurringContext } = require("../api/booking/_recurring-discount");
const firstRecurring = { ...previous, id: "recurring-1", schedule: "2026-10-10T14:00:00Z", estimate: { ...previous.estimate, orderNumber: "87654321", recurringDiscount: { plan: "weekly", code: "WEEKLY20" } } };
const context = recurringContext([previous, firstRecurring], "12345678");
assert.equal(context.locked, true);
assert.equal(context.windowStart, "2026-10-17");
assert.equal(context.windowEnd, "2026-10-22");
assert.throws(() => recurringContext([previous, firstRecurring], "12345678", "monthly"));
assert.throws(() => verifyRecurringDiscount([previous], { previousOrderNumber: "12345678", recurringPlan: "weekly", schedule: "2026-10-14", customer: {email: previous.email} }));
assert.throws(() => verifyRecurringDiscount([previous], { previousOrderNumber: "12345678", schedule: "2026-10-10", customer: {email: previous.email} }));
console.log("Saved plan, latest completed cleaning, old-reference protection and window enforcement passed.");

// Exercise the actual browser calendar filter, including both date boundaries.
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../book-now.js"), "utf8");
const start = source.indexOf("  const loadSchedulerSlots = (slots = []) => {");
const end = source.indexOf("  calendarPrevious?.addEventListener", start);
const browser = {
  state: {serviceKey: "recurring"}, recurringPlanContext: context,
  monthKeyForDate: date => date.slice(0,7), clearArrivalDiscount() {},
  setSchedulerStatus() {}, scheduleSelect: null, renderCalendar() {}, renderTimeSlots() {},
  persistBookingDraft() {}, longDate: value => value
};
vm.createContext(browser);
vm.runInContext(source.slice(start,end) + "globalThis.load = loadSchedulerSlots;", browser);
browser.load(["2026-10-16","2026-10-17","2026-10-22","2026-10-23"].map(date => ({date})));
assert.equal(JSON.stringify(browser.state.availableDates), JSON.stringify(["2026-10-17","2026-10-22"]));
assert.throws(() => browser.load([{date:"2026-10-23"}]), /contact us/);
for (const [plan, first, last] of [["weekly",7,12],["biweekly",13,24],["monthly",25,40]]) {
  const selected = recurringContext([previous], "12345678", plan);
  assert.equal(selected.locked, false);
  for (const offset of [first,last]) {
    const schedule = new Date(Date.UTC(2026,9,1 + offset)).toISOString();
    assert.equal(verifyRecurringDiscount([previous], {previousOrderNumber:"12345678",recurringPlan:plan,schedule,customer:{email:previous.email}}).plan,plan);
  }
}
console.log("Actual browser calendar filter and all plan boundary dates passed.");
