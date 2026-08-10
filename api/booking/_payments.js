const {
  cleanText,
  getBooking,
  json,
  listPaymentBookings,
  updateBookingEstimate
} = require("./_shared");
const { trySendFormSubmissionNotification } = require("../_form-notifications");

const AUTHORIZATION_DUE_HOURS = 48;
const MAX_AUTHORIZATION_ATTEMPTS = 3;

function authorized(request) {
  const secret = process.env.CRON_SECRET || "";
  return Boolean(secret) && request.headers.authorization === `Bearer ${secret}`;
}

function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key || "";
}

function appendParams(encoded, params = {}) {
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") encoded.append(key, String(value));
  });
  return encoded;
}

async function stripePost({
  path,
  params,
  idempotencyKey,
  secretKey = stripeSecretKey(),
  fetchImpl = fetch
}) {
  if (!secretKey || !String(secretKey).startsWith("sk_")) {
    throw Object.assign(new Error("Stripe is not configured for booking balance collection."), {
      statusCode: 503
    });
  }
  const response = await fetchImpl(`https://api.stripe.com/v1/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body: appendParams(new URLSearchParams(), params).toString()
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw Object.assign(new Error(data?.error?.message || "Stripe could not process the booking balance."), {
      statusCode: response.status,
      details: data,
      paymentIntent: data?.error?.payment_intent || null
    });
  }
  return data;
}

function paymentAmounts(booking) {
  const payment = booking?.estimate?.payment || {};
  const totalCents = Number(payment.totalCents || Math.round(Number(booking?.estimate?.total || 0) * 100));
  const depositCents = Number(payment.depositCents || payment.paidCents || Math.round(totalCents * 0.25));
  const remainingCents = Number(payment.remainingCents || Math.max(0, totalCents - depositCents));
  return {
    totalCents: Math.max(0, Math.round(totalCents)),
    depositCents: Math.max(0, Math.round(depositCents)),
    remainingCents: Math.max(0, Math.round(remainingCents))
  };
}

function automaticBalanceCollection(booking) {
  const payment = booking?.estimate?.payment || {};
  return payment.paymentType === "deposit_25"
    && payment.balanceCollection === "automatic_48h_authorization";
}

function authorizationDue(booking, now = new Date()) {
  const appointment = new Date(booking?.schedule);
  if (!Number.isFinite(appointment.getTime())) return false;
  const hoursUntil = (appointment.getTime() - now.getTime()) / 3600000;
  return hoursUntil > 0 && hoursUntil <= AUTHORIZATION_DUE_HOURS;
}

function currentRemainingState(booking) {
  const state = booking?.estimate?.payment?.remaining;
  return state && typeof state === "object"
    ? state
    : { status: "pending", attempts: 0, paymentIntentId: "" };
}

async function savePaymentState(booking, paymentPatch, updateEstimate = updateBookingEstimate) {
  const estimate = booking?.estimate && typeof booking.estimate === "object" ? booking.estimate : {};
  const payment = estimate.payment && typeof estimate.payment === "object" ? estimate.payment : {};
  const nextEstimate = {
    ...estimate,
    payment: {
      ...payment,
      ...paymentPatch
    }
  };
  await updateEstimate(booking.id, nextEstimate);
  booking.estimate = nextEstimate;
  return nextEstimate.payment;
}

async function notifyPaymentAttention(booking, message, notify = trySendFormSubmissionNotification) {
  return notify({
    source: "Booking payment",
    eventLabel: "requires attention",
    recordId: booking.id,
    fields: {
      "Customer Name": booking.client_name,
      "Customer Email": booking.email,
      "Customer Phone": booking.phone,
      "Service": booking.service_label || booking.service
    },
    summaryLines: [message, `Appointment: ${booking.schedule}`]
  });
}

function captureBeforeFromIntent(intent) {
  const seconds = Number(intent?.latest_charge?.payment_method_details?.card?.capture_before || 0);
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : "";
}

async function authorizeRemainingBalance({
  booking,
  now = new Date(),
  force = false,
  stripeCall = stripePost,
  updateEstimate = updateBookingEstimate,
  notify = trySendFormSubmissionNotification
}) {
  if (!booking) throw Object.assign(new Error("Booking could not be found."), { statusCode: 404 });
  if (!automaticBalanceCollection(booking)) return { status: "not_applicable" };
  if (!force && !authorizationDue(booking, now)) return { status: "not_due" };

  const payment = booking.estimate?.payment || {};
  const previous = currentRemainingState(booking);
  const amounts = paymentAmounts(booking);
  if (!amounts.remainingCents) return { status: "nothing_due", amountCents: 0 };
  if (previous.status === "captured") return { status: "already_captured", paymentIntentId: previous.paymentIntentId || "" };
  if (previous.status === "authorized" && previous.paymentIntentId) {
    return { status: "already_authorized", paymentIntentId: previous.paymentIntentId };
  }
  if (["requires_action", "setup_missing", "canceled"].includes(previous.status)) {
    return { status: previous.status, paymentIntentId: previous.paymentIntentId || "" };
  }
  if (Number(previous.attempts || 0) >= MAX_AUTHORIZATION_ATTEMPTS) {
    return { status: "attempts_exhausted", paymentIntentId: previous.paymentIntentId || "" };
  }

  const customerId = cleanText(payment.stripeCustomerId, 120);
  const paymentMethodId = cleanText(payment.paymentMethodId, 120);
  const attemptedAt = now.toISOString();
  const attempts = Number(previous.attempts || 0) + 1;
  if (!customerId || !paymentMethodId) {
    const remaining = {
      ...previous,
      status: "setup_missing",
      amountCents: amounts.remainingCents,
      attempts,
      attemptedAt,
      lastError: "The saved Stripe customer or payment method is missing."
    };
    await savePaymentState(booking, { remaining }, updateEstimate);
    await notifyPaymentAttention(booking, remaining.lastError, notify);
    return { status: remaining.status, error: remaining.lastError };
  }

  try {
    const intent = await stripeCall({
      path: "payment_intents",
      idempotencyKey: `booking-balance-authorization-${booking.id}-${booking.schedule}`.slice(0, 240),
      params: {
        amount: amounts.remainingCents,
        currency: "usd",
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: "true",
        confirm: "true",
        capture_method: "manual",
        "payment_method_types[0]": "card",
        "expand[0]": "latest_charge",
        description: `Remaining balance for ${booking.service_label || booking.service || "cleaning service"}`,
        receipt_email: booking.email,
        "metadata[booking_id]": booking.id,
        "metadata[payment_type]": "remaining_75_authorization",
        "metadata[total_amount_cents]": amounts.totalCents,
        "metadata[deposit_amount_cents]": amounts.depositCents,
        "metadata[remaining_amount_cents]": amounts.remainingCents
      }
    });
    if (intent.status !== "requires_capture") {
      throw Object.assign(new Error(`Stripe returned unexpected authorization status: ${intent.status || "unknown"}.`), {
        paymentIntent: intent
      });
    }
    const remaining = {
      ...previous,
      status: "authorized",
      amountCents: amounts.remainingCents,
      attempts,
      attemptedAt,
      authorizedAt: attemptedAt,
      paymentIntentId: intent.id || "",
      captureBefore: captureBeforeFromIntent(intent),
      lastError: ""
    };
    await savePaymentState(booking, { remaining }, updateEstimate);
    return { status: remaining.status, paymentIntentId: remaining.paymentIntentId, captureBefore: remaining.captureBefore };
  } catch (error) {
    const intent = error.paymentIntent || {};
    const stripeCode = cleanText(error.details?.error?.code, 120);
    const declineCode = cleanText(error.details?.error?.decline_code, 120);
    const requiresAction = intent.status === "requires_action"
      || stripeCode === "authentication_required"
      || declineCode === "authentication_required";
    const remaining = {
      ...previous,
      status: requiresAction ? "requires_action" : "authorization_failed",
      amountCents: amounts.remainingCents,
      attempts,
      attemptedAt,
      paymentIntentId: cleanText(intent.id, 120),
      lastError: cleanText(error.message || "The remaining balance could not be authorized.", 500)
    };
    await savePaymentState(booking, { remaining }, updateEstimate);
    if (!previous.lastNotifiedAt) {
      await notifyPaymentAttention(booking, remaining.lastError, notify);
      remaining.lastNotifiedAt = attemptedAt;
      await savePaymentState(booking, { remaining }, updateEstimate);
    }
    return { status: remaining.status, paymentIntentId: remaining.paymentIntentId, error: remaining.lastError };
  }
}

async function captureRemainingBalance({
  bookingId,
  now = new Date(),
  getBookingRecord = getBooking,
  stripeCall = stripePost,
  updateEstimate = updateBookingEstimate,
  notify = trySendFormSubmissionNotification
}) {
  let booking = await getBookingRecord(bookingId);
  if (!booking) throw Object.assign(new Error("Booking could not be found."), { statusCode: 404 });
  if (!automaticBalanceCollection(booking)) return { status: "not_applicable" };
  let remaining = currentRemainingState(booking);
  if (remaining.status === "captured") {
    return { status: "already_captured", paymentIntentId: remaining.paymentIntentId || "" };
  }
  if (remaining.status !== "authorized" || !remaining.paymentIntentId) {
    const authorization = await authorizeRemainingBalance({
      booking,
      now,
      force: true,
      stripeCall,
      updateEstimate,
      notify
    });
    if (!["authorized", "already_authorized"].includes(authorization.status)) return authorization;
    booking = await getBookingRecord(bookingId) || booking;
    remaining = currentRemainingState(booking);
  }

  try {
    const intent = await stripeCall({
      path: `payment_intents/${encodeURIComponent(remaining.paymentIntentId)}/capture`,
      idempotencyKey: `booking-balance-capture-${booking.id}`,
      params: {}
    });
    const capturedAt = now.toISOString();
    const nextRemaining = {
      ...remaining,
      status: "captured",
      capturedAt,
      chargeId: typeof intent.latest_charge === "string" ? intent.latest_charge : (intent.latest_charge?.id || ""),
      lastError: ""
    };
    const payment = booking.estimate?.payment || {};
    await savePaymentState(booking, {
      status: "paid",
      paidCents: Number(payment.depositCents || payment.paidCents || 0) + Number(nextRemaining.amountCents || 0),
      remainingCents: 0,
      completedPaymentAt: capturedAt,
      remaining: nextRemaining
    }, updateEstimate);
    return { status: nextRemaining.status, paymentIntentId: nextRemaining.paymentIntentId, capturedAt };
  } catch (error) {
    const failedAt = now.toISOString();
    const nextRemaining = {
      ...remaining,
      status: "capture_failed",
      failedAt,
      lastError: cleanText(error.message || "The remaining balance could not be captured.", 500)
    };
    await savePaymentState(booking, { remaining: nextRemaining }, updateEstimate);
    await notifyPaymentAttention(booking, nextRemaining.lastError, notify);
    return { status: nextRemaining.status, paymentIntentId: nextRemaining.paymentIntentId, error: nextRemaining.lastError };
  }
}

async function cancelRemainingAuthorization({
  booking,
  resetForReschedule = false,
  now = new Date(),
  stripeCall = stripePost,
  updateEstimate = updateBookingEstimate
}) {
  if (!booking) return { status: "not_found" };
  if (!automaticBalanceCollection(booking)) return { status: "not_applicable" };
  const remaining = currentRemainingState(booking);
  if (remaining.status === "captured") return { status: "already_captured", paymentIntentId: remaining.paymentIntentId || "" };
  if (remaining.paymentIntentId && ["authorized", "capture_failed", "requires_action"].includes(remaining.status)) {
    try {
      await stripeCall({
        path: `payment_intents/${encodeURIComponent(remaining.paymentIntentId)}/cancel`,
        idempotencyKey: `booking-balance-cancel-${booking.id}-${booking.schedule}`.slice(0, 240),
        params: { cancellation_reason: "requested_by_customer" }
      });
    } catch (error) {
      if (![400, 404].includes(error.statusCode)) throw error;
    }
  }
  const nextRemaining = resetForReschedule
    ? {
      status: "pending",
      amountCents: paymentAmounts(booking).remainingCents,
      attempts: 0,
      paymentIntentId: "",
      authorizationDueHours: AUTHORIZATION_DUE_HOURS,
      resetAt: now.toISOString(),
      previousPaymentIntentId: remaining.paymentIntentId || ""
    }
    : {
      ...remaining,
      status: "canceled",
      canceledAt: now.toISOString()
    };
  await savePaymentState(booking, { remaining: nextRemaining }, updateEstimate);
  return { status: nextRemaining.status, paymentIntentId: remaining.paymentIntentId || "" };
}

async function processDuePaymentAuthorizations({
  now = new Date(),
  listBookings = listPaymentBookings,
  authorize = authorizeRemainingBalance
} = {}) {
  const bookings = await listBookings();
  const eligible = bookings.filter(automaticBalanceCollection);
  const due = eligible.filter((booking) => authorizationDue(booking, now));
  const results = [];
  for (const booking of due) {
    try {
      results.push({ bookingId: booking.id, ...(await authorize({ booking, now })) });
    } catch (error) {
      results.push({ bookingId: booking.id, status: "error", error: cleanText(error.message, 500) });
    }
  }
  return {
    checked: bookings.length,
    eligible: eligible.length,
    due: due.length,
    authorized: results.filter((item) => ["authorized", "already_authorized"].includes(item.status)).length,
    attention: results.filter((item) => ["requires_action", "setup_missing", "authorization_failed", "attempts_exhausted", "error"].includes(item.status)).length,
    results
  };
}

async function handler(request, response) {
  try {
    if (request.method !== "GET") return json(response, 405, { error: "Method not allowed." });
    if (!authorized(request)) return json(response, 401, { error: "Unauthorized." });
    return json(response, 200, { ok: true, ...(await processDuePaymentAuthorizations()) });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Booking payment authorizations could not be processed.",
      details: error.details
    });
  }
}

module.exports = handler;
module.exports.AUTHORIZATION_DUE_HOURS = AUTHORIZATION_DUE_HOURS;
module.exports.automaticBalanceCollection = automaticBalanceCollection;
module.exports.authorizationDue = authorizationDue;
module.exports.authorizeRemainingBalance = authorizeRemainingBalance;
module.exports.cancelRemainingAuthorization = cancelRemainingAuthorization;
module.exports.captureRemainingBalance = captureRemainingBalance;
module.exports.paymentAmounts = paymentAmounts;
module.exports.processDuePaymentAuthorizations = processDuePaymentAuthorizations;
module.exports.stripePost = stripePost;
