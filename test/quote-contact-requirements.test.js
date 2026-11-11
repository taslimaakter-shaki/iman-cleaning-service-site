const assert = require("node:assert/strict");
const fs = require("node:fs");
const { cleanCustomer } = require("../api/booking/_saved-quote");
const html = fs.readFileSync("book-now.html", "utf8");
const emailInput = html.match(/<input type="email" name="quoteEmail"[^>]*>/)[0];
const phoneInput = html.match(/<input type="tel" name="quotePhone"[^>]*>/)[0];
assert.match(emailInput, /\srequired(?:\s|>)/);
assert.doesNotMatch(phoneInput, /\srequired(?:\s|>)/);
assert.match(html, /<span>Email address<\/span>/);
assert.match(html, /<span>Phone number<\/span>/);
assert.doesNotMatch(emailInput + phoneInput, /optional|mandatory/i);
const customer = { firstName: "Jane", lastName: "Example", email: " Jane@Example.test ", phone: "" };
assert.deepEqual(cleanCustomer(customer), { ...customer, email: "jane@example.test" });
assert.equal(cleanCustomer({ ...customer, phone: "(212) 555-0123" }).phone, "+12125550123");
for (const email of ["", " ", "not-an-email"]) {
  assert.throws(() => cleanCustomer({ ...customer, email }), /valid email/i);
}
assert.throws(() => cleanCustomer({ ...customer, phone: "bad-number" }), /valid phone/i);
assert.equal(cleanCustomer({ ...customer, phone: "  " }).phone, "");
console.log("Quote contact requirements passed: email validation, optional phone, unchanged labels.");

const phonePattern = new RegExp('^(?:' + phoneInput.match(/pattern="([^"]+)"/)[1] + ')$', 'v');
for (const phone of ['x', '123', '2125550123x', '++12125550123', '1234567890123456']) {
  assert.equal(phonePattern.test(phone), false, phone);
  assert.throws(() => cleanCustomer({ ...customer, phone }), /valid phone/i);
}
for (const phone of ['(212) 555-0123', '+1 212-555-0123', '+44 20 7946 0123']) {
  assert.equal(phonePattern.test(phone), true, phone);
  assert(cleanCustomer({ ...customer, phone }).phone);
}
