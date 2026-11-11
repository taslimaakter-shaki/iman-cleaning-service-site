const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "book-now.html"), "utf8");
const checkout = fs.readFileSync(path.join(root, "api/booking/_checkout.js"), "utf8");
const promo = fs.readFileSync(path.join(root, "api/booking/_promo-validate.js"), "utf8");
const { cleanCustomer } = require("../api/booking/_saved-quote");

const emailInput = html.match(/<input type="email" name="quoteEmail"[^>]*>/)?.[0] || "";
assert(emailInput, "The quote email field must remain visible.");
assert.doesNotMatch(emailInput, /\srequired(?:\s|>)/, "The quote email field must not block an empty submission.");
assert.doesNotMatch(emailInput, /optional/i, "The form must not label the email field optional.");
assert.match(html, /<span>Email address<\/span>/, "The existing email label must remain unchanged.");

assert.deepEqual(cleanCustomer({
  firstName: "Jane",
  lastName: "Example",
  email: "",
  phone: "(212) 555-0123"
}), {
  firstName: "Jane",
  lastName: "Example",
  email: "",
  phone: "+12125550123"
});
assert.throws(() => cleanCustomer({
  firstName: "Jane",
  lastName: "Example",
  email: "not-an-email",
  phone: "(212) 555-0123"
}), /valid email/i, "A supplied email must still be valid.");

assert.match(checkout, /if \(email && !\/\^\[\^@\\s\]\+@/, "Checkout must validate an email only when one is supplied.");
assert.match(checkout, /if \(email\) \{\s*stripeCheckoutParams\.customer_email = email;/, "Stripe email parameters must only be included when an email is supplied.");
assert.match(promo, /if \(!identity\.phone\)/, "Discount lookup must work with a phone number and no email.");

console.log("Optional booking email tests passed.");
