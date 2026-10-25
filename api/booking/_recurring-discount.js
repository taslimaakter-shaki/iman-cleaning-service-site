const { cleanText, json, listAllBookings, readJsonBody } = require("./_shared");
const { bookingHasSuccessfulPayment, sameCustomerOrAddress } = require("./_promo");

function recurringError(message, statusCode = 400, code = "RECURRING_INVALID") {
  return Object.assign(new Error(message), { statusCode, code });
}

function orderNumber(booking) {
  return cleanText(booking?.estimate?.orderNumber || booking?.orderNumber || booking?.id, 100).toUpperCase();
}

function completedBookingForOrder(bookings, previousOrderNumber) {
  const submittedOrder = cleanText(previousOrderNumber, 100).toUpperCase();
  if (!submittedOrder) throw recurringError("Enter your previous appointment or order number.");
  const booking = (bookings || []).find((item) => orderNumber(item) === submittedOrder);
  if (!booking || cleanText(booking.status, 40).toLowerCase() !== "completed" || !bookingHasSuccessfulPayment(booking)) {
    throw recurringError("We could not verify a completed, paid cleaning with that order number.", 404, "RECURRING_ORDER_NOT_FOUND");
  }
  return booking;
}

function customerFirstName(booking) {
  const fullName = cleanText(booking?.client_name || booking?.customer?.name || booking?.customerName, 160);
  return cleanText(fullName.split(/\s+/)[0], 80) || "customer";
}

function calendarDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function discountForDays(days) {
  if (days >= 7 && days <= 12) return { code: "WEEKLY20", label: "Weekly Cleaning Discount", percent: 20 };
  if (days >= 13 && days <= 24) return { code: "BIWEEKLY15", label: "Biweekly Cleaning Discount", percent: 15 };
  if (days >= 25 && days <= 40) return { code: "MONTHLY10", label: "Monthly Cleaning Discount", percent: 10 };
  if (days >= 41 && days <= 365) return { code: "RETURNING5", label: "Returning Customer Discount", percent: 5 };
  return null;
}

function verifyRecurringDiscount(bookings, { previousOrderNumber, schedule, customer }) {
  const booking = completedBookingForOrder(bookings, previousOrderNumber);
  if (!sameCustomerOrAddress(booking, customer || {})) {
    throw recurringError("The previous order does not match your email, phone number, or service address.", 409, "RECURRING_CUSTOMER_MISMATCH");
  }
  const previousDate = calendarDate(booking.schedule || booking.serviceDate || booking.confirmedServiceDate);
  const nextDate = calendarDate(schedule);
  if (!Number.isFinite(previousDate) || !Number.isFinite(nextDate)) {
    throw recurringError("The cleaning dates could not be verified.", 409, "RECURRING_DATE_INVALID");
  }
  const days = Math.round((nextDate - previousDate) / 86400000);
  const discount = discountForDays(days);
  if (!discount) {
    const message = days < 7
      ? "Recurring discounts begin when the new appointment is at least 7 days after the previous cleaning."
      : "The previous cleaning was more than one year ago, so an automatic returning-customer discount is not available.";
    throw recurringError(message, 409, "RECURRING_INTERVAL_INELIGIBLE");
  }
  return { ...discount, days, previousOrderNumber: orderNumber(booking), previousServiceDate: new Date(previousDate).toISOString().slice(0, 10) };
}

function applyRecurringDiscount(pkg, discount) {
  if (!pkg || pkg.serviceKey !== "recurring") throw recurringError("A recurring-cleaning quote is required.");
  if (pkg.manualDiscount?.amountCents || pkg.promoDiscount?.amountCents) {
    throw recurringError("Recurring discounts cannot be combined with another offer.", 409, "DISCOUNT_NOT_COMBINABLE");
  }
  const originalTotalCents = Math.round(Number(pkg.priceCents || pkg.totalCents) || 0);
  const amountCents = Math.round(originalTotalCents * discount.percent / 100);
  const totalCents = originalTotalCents - amountCents;
  const recurringDiscount = { ...discount, amountCents, application: "after_tax" };
  return { ...pkg, originalTotalCents, totalCents, priceCents: totalCents, total: totalCents / 100, price: totalCents / 100,
    promoCode: discount.code, promoDiscount: recurringDiscount, recurringDiscount };
}

async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    const body = await readJsonBody(request);
    if (body.lookupOnly === true) {
      const booking = completedBookingForOrder(await listAllBookings(), body.previousOrderNumber);
      return json(response, 200, { valid: true, firstName: customerFirstName(booking) });
    }
    const discount = verifyRecurringDiscount(await listAllBookings(), body);
    return json(response, 200, { valid: true, ...discount });
  } catch (error) {
    return json(response, error.statusCode || 500, { error: error.message || "The recurring discount could not be verified.", code: error.code || "RECURRING_ERROR" });
  }
}

module.exports = handler;
module.exports.discountForDays = discountForDays;
module.exports.verifyRecurringDiscount = verifyRecurringDiscount;
module.exports.applyRecurringDiscount = applyRecurringDiscount;
module.exports.completedBookingForOrder = completedBookingForOrder;
module.exports.customerFirstName = customerFirstName;
