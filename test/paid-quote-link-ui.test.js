const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "book-now.html"), "utf8");
const js = fs.readFileSync(path.join(root, "book-now.js"), "utf8");
const api = fs.readFileSync(path.join(root, "api/booking/_saved-quote.js"), "utf8");

assert.match(html, /data-booked-quote/);
assert.match(html, /Payment has been received and your appointment is confirmed/);
assert.match(html, /This quote link is now closed/);
assert.match(js, /QUOTE_ALREADY_BOOKED/);
assert.match(js, /showBookedQuoteConfirmation/);
assert.match(api, /code:\s*error\.code/);

console.log("Paid quote links render a dedicated booked-and-paid confirmation screen.");
