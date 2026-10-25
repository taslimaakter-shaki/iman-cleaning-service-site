const assert = require("assert");
const {
  createAdditionalWorkToken,
  laborHours,
  paymentIsSettled,
  readAdditionalWorkToken
} = require("../api/booking/_additional-work");

const secret = "test-secret-with-enough-entropy";
const token = createAdditionalWorkToken("BK-TEST-123", secret);
assert.strictEqual(readAdditionalWorkToken(token, secret), "BK-TEST-123");
assert.strictEqual(readAdditionalWorkToken(`${token}x`, secret), "");
assert.strictEqual(readAdditionalWorkToken(`${token}.extra`, secret), "");
assert.strictEqual(paymentIsSettled({estimate: {payment: {status: "deposit_paid"}}}), false);

assert.strictEqual(laborHours("0.5"), 0.5);
assert.strictEqual(laborHours(2), 2);
assert.throws(() => laborHours(0.25), /half-hour increments/i);
assert.throws(() => laborHours(25), /between 0.5 and 24/i);

assert.strictEqual(paymentIsSettled({ estimate: { payment: { status: "paid", remainingCents: 0 } } }), true);
assert.strictEqual(paymentIsSettled({ estimate: { payment: { status: "deposit_paid", remainingCents: 7500, remaining: { status: "authorized" } } } }), false);
assert.strictEqual(paymentIsSettled({ estimate: { payment: { status: "deposit_paid", remainingCents: 7500, remaining: { status: "captured" } } } }), true);

console.log("additional work tests passed");
