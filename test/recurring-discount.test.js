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
  previousOrderNumber: "12345678",
  schedule: "2026-10-10T16:00:00.000Z",
  customer: { email: "returning@example.com" }
});
assert.equal(verified.percent, 20);
assert.equal(verified.days, 9);
assert.throws(() => verifyRecurringDiscount([previous], {
  previousOrderNumber: "12345678", schedule: "2026-10-10T16:00:00.000Z", customer: { email: "different@example.com" }
}), error => error.code === "RECURRING_CUSTOMER_MISMATCH");
assert.throws(() => verifyRecurringDiscount([{ ...previous, status: "Confirmed" }], {
  previousOrderNumber: "12345678", schedule: "2026-10-10T16:00:00.000Z", customer: { email: "returning@example.com" }
}), error => error.code === "RECURRING_ORDER_NOT_FOUND");
assert.throws(() => verifyRecurringDiscount([{ ...previous, estimate: { ...previous.estimate, payment: { status: "deposit_pending", paidCents: 0 } } }], {
  previousOrderNumber: "12345678", schedule: "2026-10-10T16:00:00.000Z", customer: { email: "returning@example.com" }
}), error => error.code === "RECURRING_ORDER_NOT_FOUND", "Returning discounts require a previously paid booking");

const discounted = applyRecurringDiscount({ serviceKey: "recurring", priceCents: 10000, totalCents: 10000, price: 100, total: 100 }, verified);
assert.equal(discounted.priceCents, 8000);
assert.equal(discounted.recurringDiscount.amountCents, 2000);
console.log("Recurring discount ranges, completed-order verification, identity matching, and pricing passed.");
