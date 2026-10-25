const assert = require("node:assert/strict");
const shared = require("../api/booking/_shared");

const quote = shared.calculateHourlyCleaningQuote(4);
assert.equal(quote.serviceKey, "hourly");
assert.equal(quote.pricingMode, "hourly_formula");
assert.equal(quote.manHourRate, 80);
assert.equal(quote.manHours, 4);
assert.equal(quote.priceCents, 32000);
assert.equal(quote.teamHours, 2);
assert.equal(quote.units[0].baseItems[0].label, "4 work-hours");
assert.doesNotMatch(quote.units[0].baseItems[0].label, /\$|per (?:work-)?hour/i);
assert.throws(() => shared.calculateHourlyCleaningQuote(3), /4 to 24 work-hours/);
assert.throws(() => shared.calculateHourlyCleaningQuote(4.5), /whole number/);

console.log("Hourly cleaning instant quote passed: 4-hour minimum, correct total, and no customer-facing hourly rate.");
