const assert = require("assert");

process.env.BOOKING_MANAGEMENT_SECRET = "test-booking-management-secret";

const {
  createBookingManagementToken,
  decodeBookingManagementToken,
  matchesBookingLookup,
  orderNumberForBooking,
  safeBooking,
  verificationCodeHash
} = require("../api/booking/_manage");
const { buildManagementMessage } = require("../api/booking/_send-management-link");

const booking = {
  id: "BK-INTERNAL-123",
  status: "Confirmed",
  client_name: "Lubna Jafri",
  phone: "+1 (917) 555-0123",
  email: "lubna@example.com",
  service: "deep",
  service_label: "Deep Cleaning",
  schedule: "2030-09-05T12:00:00.000Z",
  schedule_label: "Thursday, September 5 at 8:00 AM",
  address: "240 East 47th Street, New York, NY",
  estimate: {
    orderNumber: "48276195",
    total: 390,
    payment: { paidCents: 9750 }
  }
};

assert.strictEqual(orderNumberForBooking(booking), "48276195");
assert.strictEqual(matchesBookingLookup(booking, {
  orderNumber: "48276195",
  name: "Lubna Jafri",
  phone: "917-555-0123"
}), true);
assert.strictEqual(matchesBookingLookup(booking, {
  orderNumber: "48276195",
  name: "Another Person",
  phone: "917-555-0123"
}), false);
assert.strictEqual(safeBooking(booking).id, "48276195");

const token = createBookingManagementToken({
  bookingId: booking.id,
  email: booking.email,
  expiresAt: Date.now() + 60000
});
assert.strictEqual(decodeBookingManagementToken(token).bookingId, booking.id);
assert.throws(() => decodeBookingManagementToken(`${token}changed`), /invalid/i);
assert.strictEqual(verificationCodeHash(booking.id, "123456"), verificationCodeHash(booking.id, "123456"));
assert.notStrictEqual(verificationCodeHash(booking.id, "123456"), verificationCodeHash(booking.id, "654321"));

const message = buildManagementMessage();
assert.match(message, /manage-booking\.html/);
assert.match(message, /reschedule or cancel/i);
assert.match(message, /order number, name, and phone number/i);
assert.match(message, /Reply STOP to opt out/i);

console.log("booking management tests passed");
