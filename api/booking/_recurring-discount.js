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
  if (!submittedOrder) throw recurringError("Enter the order number or booking reference from your previous cleaning confirmation.");
  const booking = (bookings || []).find((item) =>
    [item?.estimate?.orderNumber, item?.orderNumber, item?.id]
      .some(value => cleanText(value, 100).toUpperCase() === submittedOrder));
  if (!booking || cleanText(booking.status, 40).toLowerCase() !== "completed" || !bookingHasSuccessfulPayment(booking)) {
    throw recurringError("We could not verify a completed, paid cleaning with that order number or booking reference. Please use the number from your booking confirmation, not a quote number.", 404, "RECURRING_ORDER_NOT_FOUND");
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

const plans = {
  weekly: { min: 7, max: 12, percent: 20, code: "WEEKLY20", label: "Weekly Cleaning Discount" },
  biweekly: { min: 13, max: 24, percent: 15, code: "BIWEEKLY15", label: "Biweekly Cleaning Discount" },
  monthly: { min: 25, max: 40, percent: 10, code: "MONTHLY10", label: "Monthly Cleaning Discount" }
};
function recurringContext(bookings, previousOrderNumber, requestedPlan) {
  const initial = completedBookingForOrder(bookings, previousOrderNumber);
  const identity = { email: initial.email || initial.customer?.email, phone: initial.phone || initial.customer?.phone,
    accountUserId: initial.estimate?.accountUserId || initial.accountUserId };
  const related = bookings.filter(item => item === initial || sameCustomerOrAddress(item, identity));
  const paid = related.filter(bookingHasSuccessfulPayment);
  const planBooking = paid.filter(item => item.estimate?.recurringDiscount)
    .sort((a, b) => String(a.createdAt || a.schedule).localeCompare(String(b.createdAt || b.schedule)))[0];
  const saved = planBooking?.estimate?.recurringDiscount;
  const lockedPlan = saved?.plan || ({ WEEKLY20: "weekly", BIWEEKLY15: "biweekly", MONTHLY10: "monthly" })[saved?.code] || "";
  if (planBooking && !lockedPlan) throw recurringError("Please contact us to confirm your recurring cleaning plan.", 409);
  if (lockedPlan && requestedPlan && requestedPlan !== lockedPlan) throw recurringError("Your recurring plan is already saved. Please contact us to change plans.", 409);
  const plan = lockedPlan || cleanText(requestedPlan, 20);
  if (plan && !plans[plan]) throw recurringError("Choose weekly, biweekly, or monthly cleaning.");
  const latest = paid.filter(item => String(item.status).toLowerCase() === "completed")
    .sort((a,b) => calendarDate(b.schedule || b.serviceDate) - calendarDate(a.schedule || a.serviceDate))[0] || initial;
  const date = calendarDate(latest.schedule || latest.serviceDate || latest.confirmedServiceDate);
  if (!Number.isFinite(date)) throw recurringError("Please contact us to verify your previous cleaning date.", 409);
  const spec = plans[plan];
  const day = offset => new Date(date + offset * 86400000).toISOString().slice(0,10);
  return { plan, locked: Boolean(lockedPlan), previousOrderNumber: orderNumber(latest), previousServiceDate: day(0),
    windowStart: spec ? day(spec.min) : null, windowEnd: spec ? day(spec.max) : null,
    percent: spec?.percent || null };
}

function verifyRecurringDiscount(bookings, { previousOrderNumber, schedule, customer, recurringPlan }) {
  const booking = completedBookingForOrder(bookings, previousOrderNumber);
  if (!sameCustomerOrAddress(booking, customer || {})) {
    throw recurringError("The previous order does not match your email, phone number, or service address.", 409, "RECURRING_CUSTOMER_MISMATCH");
  }
  const context = recurringContext(bookings, previousOrderNumber, recurringPlan);
  if (!context.plan) throw recurringError("Choose your recurring cleaning plan before booking.");
  const previousDate = calendarDate(context.previousServiceDate);
  const nextDate = calendarDate(schedule);
  if (!Number.isFinite(previousDate) || !Number.isFinite(nextDate)) {
    throw recurringError("The cleaning dates could not be verified.", 409, "RECURRING_DATE_INVALID");
  }
  const days = Math.round((nextDate - previousDate) / 86400000);
  const spec = plans[context.plan];
  const discount = days >= spec.min && days <= spec.max ? spec : null;
  if (!discount) {
    const message = `Choose an appointment between ${context.windowStart} and ${context.windowEnd} for your saved plan. If no dates work, please contact us.`;
    throw recurringError(message, 409, "RECURRING_INTERVAL_INELIGIBLE");
  }
  return { code: discount.code, label: discount.label, percent: discount.percent, days, ...context };
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
    if (body.action === "request-repeat-code" || body.action === "repeat-details") {
      const bookings = await listAllBookings();
      const original = completedBookingForOrder(bookings, body.previousOrderNumber);
      const context = recurringContext(bookings, body.previousOrderNumber);
      const latest = completedBookingForOrder(bookings, context.previousOrderNumber);
      if (!context.locked || !latest.estimate?.recurringDiscount) throw recurringError("Complete your first recurring cleaning before using repeat booking.", 409);
      const management = require("./_manage");
      if (body.action === "request-repeat-code") return json(response, 200, await management.requestVerificationForBooking(original));
      const claims = management.decodeBookingManagementToken(body.token);
      if (claims.bookingId !== original.id) throw recurringError("Please verify this booking before continuing.", 401);
      const estimate = latest.estimate || {};
      if (!estimate.units?.length) throw recurringError("Please contact us to arrange your next cleaning; the previous service details need review.", 409);
      const storedCustomer = estimate.repeatCustomer;
      const parts = String(latest.address || "").split(",").map(part => part.trim());
      const fullName = String(latest.client_name || "").trim().split(/\s+/);
      const customer = storedCustomer || {
        firstName: fullName.shift(), lastName: fullName.join(" "), email: latest.email, phone: latest.phone,
        zip: parts.pop(), state: parts.pop(), city: parts.pop(), address: parts.join(", "), address2: ""
      };
      if (!customer.address || !customer.city || !/^\d{5}$/.test(customer.zip || "")) throw recurringError("Please contact us to confirm your saved service address.", 409);
      return json(response, 200, { ...context, customer, unitDetails: estimate.units,
        eligibility: { ...estimate.eligibility, requestedService: "recurring" }, priorities: latest.addons || [] });
    }
    if (body.lookupOnly === true) {
      const bookings = await listAllBookings();
      const booking = completedBookingForOrder(bookings, body.previousOrderNumber);
      return json(response, 200, { valid: true, firstName: customerFirstName(booking), repeatBooking: Boolean(completedBookingForOrder(bookings, recurringContext(bookings, body.previousOrderNumber, body.recurringPlan).previousOrderNumber).estimate?.recurringDiscount), ...recurringContext(bookings, body.previousOrderNumber, body.recurringPlan) });
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

module.exports.recurringContext = recurringContext;
