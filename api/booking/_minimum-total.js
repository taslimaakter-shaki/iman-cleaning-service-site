const MINIMUM_TOTAL_CENTS = 12000;
function assertMinimumTotal(totalCents) {
  if (!Number.isSafeInteger(totalCents) || totalCents < MINIMUM_TOTAL_CENTS) {
    throw Object.assign(new Error("The minimum booking total is $120 after discounts and taxes. Please edit your service details and add services to book."), { statusCode: 400, code: "BOOKING_MINIMUM" });
  }
}
module.exports = { MINIMUM_TOTAL_CENTS, assertMinimumTotal };
