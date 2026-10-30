const crypto = require("crypto");
const {
  availableSlotsForPackage,
  cleanText,
  getBooking,
  json,
  listAllBookings,
  readJsonBody,
  updateBooking,
  updateBookingEstimate,
  updateBookingGoogleCalendar
} = require("./_shared");
const {
  formatAppointment,
  sendCustomerSms
} = require("./_notifications");
const rescheduling = require("./_rescheduling");
const { cancellationPaymentAmounts } = require("./_payments");
const { cancelRemainingAuthorization } = require("./_payments");
const { trySendFormSubmissionNotification } = require("../_form-notifications");
const { arrivalWindowLabel, slotMatchesArrivalPreference } = require("./_arrival-preference");

const TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const VERIFICATION_LIFETIME_MS = 10 * 60 * 1000;
const VERIFICATION_COOLDOWN_MS = 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 5;

function managementSecret() {
  return process.env.BOOKING_MANAGEMENT_SECRET
    || process.env.QUOTE_APPROVAL_SECRET
    || process.env.ADMIN_TOKEN
    || process.env.STRIPE_SECRET_KEY
    || "";
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function signPayload(payload) {
  return crypto.createHmac("sha256", managementSecret()).update(payload).digest("base64url");
}

function createBookingManagementToken({ bookingId, email, expiresAt = Date.now() + TOKEN_LIFETIME_MS }) {
  const secret = managementSecret();
  if (!secret) {
    throw Object.assign(new Error("Booking management links are not configured."), {
      statusCode: 503,
      setup: "Add BOOKING_MANAGEMENT_SECRET in Vercel."
    });
  }
  const payload = base64Url(JSON.stringify({
    bookingId: cleanText(bookingId, 100),
    email: cleanText(email, 180).toLowerCase(),
    expiresAt
  }));
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
}

function decodeBookingManagementToken(token) {
  const secret = managementSecret();
  const [payload, signature] = String(token || "").split(".");
  if (!secret || !payload || !signature) {
    throw Object.assign(new Error("This booking-management link is invalid."), { statusCode: 401 });
  }
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw Object.assign(new Error("This booking-management link is invalid."), { statusCode: 401 });
  }
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!decoded.bookingId || !decoded.email || Number(decoded.expiresAt) < Date.now()) {
    throw Object.assign(new Error("This booking-management link has expired."), { statusCode: 401 });
  }
  return decoded;
}

function createVerificationChallenge({ bookingId, expiresAt = Date.now() + VERIFICATION_LIFETIME_MS }) {
  if (!managementSecret()) {
    throw Object.assign(new Error("Booking management links are not configured."), {
      statusCode: 503,
      setup: "Add BOOKING_MANAGEMENT_SECRET in Vercel."
    });
  }
  const payload = base64Url(JSON.stringify({ type: "booking_verification", bookingId, expiresAt }));
  return `${payload}.${signPayload(payload)}`;
}

function decodeVerificationChallenge(challenge) {
  const [payload, signature] = String(challenge || "").split(".");
  if (!managementSecret() || !payload || !signature) {
    throw Object.assign(new Error("This verification request is invalid. Please start again."), { statusCode: 401 });
  }
  const expected = Buffer.from(signPayload(payload), "base64url");
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw Object.assign(new Error("This verification request is invalid. Please start again."), { statusCode: 401 });
  }
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (decoded.type !== "booking_verification" || !decoded.bookingId || Number(decoded.expiresAt) < Date.now()) {
    throw Object.assign(new Error("This verification request has expired. Please start again."), { statusCode: 401 });
  }
  return decoded;
}

function normalizedName(value) {
  return cleanText(value, 160).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

function orderNumberForBooking(booking) {
  return cleanText(booking?.estimate?.orderNumber || booking?.id, 100);
}

function matchesBookingLookup(booking, { orderNumber, name, phone }) {
  const submittedOrder = cleanText(orderNumber, 100).toUpperCase();
  const storedOrder = orderNumberForBooking(booking).toUpperCase();
  return Boolean(
    submittedOrder && submittedOrder === storedOrder &&
    normalizedName(name) && normalizedName(name) === normalizedName(booking?.client_name) &&
    phoneDigits(phone).length === 10 && phoneDigits(phone) === phoneDigits(booking?.phone)
  );
}

function verificationCodeHash(bookingId, code) {
  return crypto.createHmac("sha256", managementSecret())
    .update(`booking-verification:${bookingId}:${cleanText(code, 12)}`)
    .digest("hex");
}

function paidBooking(booking) {
  const payment = booking?.estimate?.payment || {};
  return Number(payment.paidCents || 0) > 0 && ["Confirmed", "Cleaner assigned"].includes(booking?.status);
}

async function bookingForLookup(fields) {
  const bookings = await listAllBookings();
  const booking = bookings.find((item) => paidBooking(item) && matchesBookingLookup(item, fields));
  if (!booking) {
    throw Object.assign(new Error("We could not verify those booking details. Check the order number, name, and phone number."), { statusCode: 404 });
  }
  return booking;
}

async function requestVerificationCode(body) {
  const booking = await bookingForLookup({
    orderNumber: body.orderNumber,
    name: body.name,
    phone: body.phone
  });
  return requestVerificationForBooking(booking);
}

async function requestVerificationForBooking(booking) {
  const prior = booking.estimate?.managementVerification || {};
  const requestedAt = new Date(prior.requestedAt || 0).getTime();
  if (Number.isFinite(requestedAt) && Date.now() - requestedAt < VERIFICATION_COOLDOWN_MS) {
    throw Object.assign(new Error("Please wait one minute before requesting another verification code."), { statusCode: 429 });
  }
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = Date.now() + VERIFICATION_LIFETIME_MS;
  await updateBookingEstimate(booking.id, {
    ...(booking.estimate || {}),
    managementVerification: {
      codeHash: verificationCodeHash(booking.id, code),
      expiresAt,
      requestedAt: new Date().toISOString(),
      failedAttempts: 0
    }
  });
  const sms = await sendCustomerSms(
    booking.phone,
    `IMAN Cleaning Service verification code: ${code}. It expires in 10 minutes. Do not share this code. Reply STOP to opt out.`
  );
  let email = { status: "skipped" };
  if (sms.status !== "sent") {
    email = await sendManagementEmail(
      booking,
      "Your booking verification code",
      `Your verification code is ${code}. It expires in 10 minutes. Do not share this code.`
    );
  }
  if (sms.status !== "sent" && email.status !== "sent") {
    throw Object.assign(new Error("We could not deliver a verification code. Please call 929-232-1930."), { statusCode: 503 });
  }
  return {
    challenge: createVerificationChallenge({ bookingId: booking.id, expiresAt }),
    destination: sms.status === "sent" ? "the phone number on your booking" : "the email address on your booking"
  };
}

async function verifyBookingCode(body) {
  const claims = decodeVerificationChallenge(cleanText(body.challenge, 3000));
  const booking = await getBooking(claims.bookingId);
  const verification = booking?.estimate?.managementVerification || {};
  if (!booking || !verification.codeHash || Number(verification.expiresAt) < Date.now()) {
    throw Object.assign(new Error("This verification code has expired. Please request a new one."), { statusCode: 401 });
  }
  const attempts = Number(verification.failedAttempts || 0);
  if (attempts >= MAX_VERIFICATION_ATTEMPTS) {
    throw Object.assign(new Error("Too many incorrect attempts. Please request a new verification code."), { statusCode: 429 });
  }
  const submittedHash = verificationCodeHash(booking.id, body.code);
  const valid = crypto.timingSafeEqual(Buffer.from(submittedHash), Buffer.from(verification.codeHash));
  if (!valid) {
    await updateBookingEstimate(booking.id, {
      ...(booking.estimate || {}),
      managementVerification: { ...verification, failedAttempts: attempts + 1 }
    });
    throw Object.assign(new Error("That verification code is incorrect."), { statusCode: 401 });
  }
  await updateBookingEstimate(booking.id, {
    ...(booking.estimate || {}),
    managementVerification: {
      requestedAt: verification.requestedAt,
      verifiedAt: new Date().toISOString(),
      codeHash: "",
      expiresAt: 0,
      failedAttempts: attempts
    }
  });
  return createBookingManagementToken({ bookingId: booking.id, email: booking.email });
}

function safeBooking(booking) {
  const { lessThan48Hours: lateCancellation, paidCents, retainedCents, refundCents } = cancellationPaymentAmounts(booking);
  const totalCents = Number(booking.estimate?.payment?.totalCents || Math.round(Number(booking.estimate?.total || 0) * 100));
  const rescheduleTerms = rescheduling.terms(booking);
  return {
    id: orderNumberForBooking(booking),
    status: booking.status,
    service: booking.service_label || booking.service,
    schedule: booking.schedule,
    scheduleLabel: booking.schedule_label || formatAppointment(booking.schedule),
    cancellationReceiptAvailable: Boolean(booking.status === "Cancelled" && booking.estimate?.cancellation?.receipt),
    arrivalPreference: booking.estimate?.arrivalPreference || null,
    duration: require("./_staffing-options").staffingOptions(booking.estimate),
    address: booking.address,
    total: Number(booking.estimate?.total || booking.estimate?.high || booking.estimate?.low || 0),
    rescheduling: { policyVersion: rescheduling.VERSION, policy: rescheduling.POLICY, feeCents: rescheduleTerms.feeCents, count: rescheduleTerms.count, requestStatus: rescheduleTerms.state.request?.status || "", cancellationLocked: rescheduling.cancellationProtection(booking).locked },
    cancellation: {
      lessThan48Hours: lateCancellation,
      refundPercent: paidCents ? Math.round((refundCents / paidCents) * 100) : 0,
      retainedPercentOfTotal: totalCents ? Math.round((retainedCents / totalCents) * 100) : 0,
      paidCents,
      refundCents,
      retainedCents
    }
  };
}

function customerRescheduleSlots(booking, slots) {
  const preference = booking.estimate?.arrivalPreference;
  if (!preference?.key) return slots;
  const eligibleSlots = (slots || []).filter((slot) => slotMatchesArrivalPreference(slot, preference.key));
  if (!preference.flexible) return eligibleSlots;
  const seenDates = new Set();
  return eligibleSlots
    .filter((slot) => {
      if (seenDates.has(slot.date)) return false;
      seenDates.add(slot.date);
      return true;
    })
    .map((slot) => ({
      ...slot,
      label: `${new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric"
      }).format(new Date(slot.value))} · Estimated arrival ${preference.windowLabel || arrivalWindowLabel(preference.key)}`
    }));
}

async function bookingForToken(token) {
  const claims = decodeBookingManagementToken(token);
  const booking = await getBooking(claims.bookingId);
  if (!booking || cleanText(booking.email, 180).toLowerCase() !== claims.email) {
    throw Object.assign(new Error("This booking could not be found."), { statusCode: 404 });
  }
  return { claims, booking };
}

async function sendManagementEmail(booking, subject, message) {
  if (!booking.email) return { status: "skipped" };
  const { getGoogleClients } = require("../quote/_shared");
  const { gmail } = getGoogleClients();
  const from = process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com";
  const raw = [
    `From: IMAN Cleaning Service LLC <${from}>`,
    `To: ${booking.email}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "",
    `Hi ${booking.client_name || "there"},`,
    "",
    message,
    "",
    `Order number: ${orderNumberForBooking(booking)}`,
    "Questions? Call 929-232-1930.",
    "",
    "Iman Cleaning Service LLC"
  ].join("\r\n");
  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: Buffer.from(raw).toString("base64url") }
  });
  return { status: "sent", messageId: sent.data.id || "" };
}

async function notifyManagementChange(booking, subject, message) {
  const [email, sms] = await Promise.allSettled([
    sendManagementEmail(booking, subject, message),
    sendCustomerSms(
      booking.phone,
      `IMAN Cleaning Service: ${message} Order: ${orderNumberForBooking(booking)}. Questions? Call 929-232-1930. Reply STOP to opt out.`
    )
  ]);
  return {
    email: email.status === "fulfilled" ? email.value.status : "failed",
    sms: sms.status === "fulfilled" ? sms.value.status : "failed"
  };
}

async function createRefund(booking, amountCents) {
  if (amountCents <= 0) return { id: "", status: "not_refunded" };
  const secretKey = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key || "";
  const paymentIntentId = cleanText(booking.estimate?.payment?.paymentIntentId, 120);
  if (!secretKey || !paymentIntentId) {
    throw Object.assign(new Error("The original payment could not be located automatically. Please call 929-232-1930."), {
      statusCode: 409
    });
  }
  const encoded = new URLSearchParams({
    payment_intent: paymentIntentId,
    amount: String(amountCents),
    reason: "requested_by_customer",
    "metadata[booking_id]": booking.id,
    "metadata[cancellation_policy]": amountCents < Number(booking.estimate?.payment?.paidCents || 0)
      ? "less_than_48_hours_deposit_retained"
      : "full_refund"
  });
  const response = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `booking-cancellation-${booking.id}`
    },
    body: encoded.toString()
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw Object.assign(new Error(data?.error?.message || "The refund could not be completed."), {
      statusCode: response.status,
      details: data
    });
  }
  return data;
}

async function handler(request, response) {
  try {
    if (!["GET", "POST"].includes(request.method)) {
      return json(response, 405, { error: "Method not allowed." });
    }
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    const requestedAction = cleanText(body.action, 30);
    if (request.method === "POST" && requestedAction === "request-code") {
      const result = await requestVerificationCode(body);
      return json(response, 200, { ok: true, ...result });
    }
    if (request.method === "POST" && requestedAction === "verify-code") {
      const verifiedToken = await verifyBookingCode(body);
      return json(response, 200, { ok: true, token: verifiedToken });
    }
    const token = cleanText(body.token || request.query?.token, 3000);
    let { booking } = await bookingForToken(token);

    if (request.method === "GET" && request.query?.document === "cancellation-receipt") {
      const receipts = require("./_cancellation-receipt");
      const pdf = await receipts.buildPdf(await receipts.refreshRefundStatus(booking));
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Disposition", 'inline; filename="IMAN-Cancellation-Receipt.pdf"');
      return response.end(pdf);
    }
    if (request.method === "GET" && request.query?.document === "invoice") {
      const invoice = booking.estimate?.rescheduling?.invoiceHistory?.at(-1);
      if (!invoice) return json(response, 404, { error: "No revised invoice is available." });
      const pdf = await require("./_reschedule-invoice").buildInvoice({ ...booking, schedule:invoice.schedule, schedule_label:invoice.schedule_label, estimate:{...booking.estimate,rescheduling:{...booking.estimate.rescheduling,request:invoice.request}} });
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Disposition", 'inline; filename="IMAN-Revised-Invoice.pdf"');
      return response.end(pdf);
    }
    if (request.method === "GET") {
      const pkg = { teamHours: Number(booking.estimate?.teamHours || booking.estimate?.hours || 2) };
      const slots = ["Confirmed", "Cleaner assigned"].includes(booking.status)
        ? await availableSlotsForPackage(pkg, undefined, new Date(), booking.id)
        : [];
      return json(response, 200, { booking: safeBooking(booking), slots: customerRescheduleSlots(booking, slots), appointmentChoices: require("./_reschedule-pricing").choices(booking, slots) });
    }

    const action = cleanText(body.action, 30);
    if (action === "reschedule") {
      if (!["Confirmed", "Cleaner assigned"].includes(booking.status)) {
        return json(response, 409, { error: "This booking can no longer be rescheduled online." });
      }
      const pkg = { teamHours: Number(booking.estimate?.teamHours || booking.estimate?.hours || 2) };
      const rawSlots = await availableSlotsForPackage(pkg, undefined, new Date(), booking.id);
      const slots = body.choiceId ? require("./_reschedule-pricing").choices(booking, rawSlots) : customerRescheduleSlots(booking, rawSlots);
      const slot = slots.find((item) => item.value === cleanText(body.schedule, 100) && (!body.choiceId || item.choiceId === body.choiceId));
      if (body.choiceId && slot && (body.quoteId !== slot.pricing.id || body.acceptPrice !== true)) return json(response, 409, { error: "The price has changed. Refresh and accept the updated total before submitting." });
      if (!slot) return json(response, 409, { error: "That appointment is no longer available. Please choose another time." });
      const updated = await rescheduling.requestChange(booking, body, slot);
      const delivery = await require("./_reschedule-notifications").notifyOwner(updated, "requested");
      await rescheduling.recordOwnerNotification(updated.id, updated.estimate.rescheduling.request.id, delivery).catch(() => {});
      return json(response, 200, { ok: true, action, booking: safeBooking(updated), message: "Your request was submitted for approval. Your original appointment remains confirmed." });
    }

    if (action === "cancel") {
      if (booking.status === "Cancelled") {
        const delivery = booking.estimate?.cancellation?.receipt ? await require("./_cancellation-receipt").notify(booking).catch(error => ({status:"error",error:error.message})) : null;
        return json(response, 200, { ok: true, action, alreadyCancelled: true, booking: safeBooking(booking), delivery });
      }
      if (!["Confirmed", "Cleaner assigned"].includes(booking.status)) {
        return json(response, 409, { error: "This booking can no longer be cancelled online." });
      }
      if (booking.estimate?.rescheduling?.request?.status === "processing") return json(response, 409, { error: "Your appointment change payment is being reviewed. Please contact us before canceling." });
      booking = await rescheduling.beginCancellation(booking, "customer");
      const { lessThan48Hours, paidCents, retainedCents, refundCents } = cancellationPaymentAmounts(booking);
      const totalCents = Number(booking.estimate?.payment?.totalCents || Math.round(Number(booking.estimate?.total || 0) * 100));
      const beforeAuthorization = JSON.parse(JSON.stringify(booking));
      const authorization = await cancelRemainingAuthorization({ booking });
      const refund = await createRefund(booking, refundCents);
      const estimate = {
        ...(booking.estimate || {}),
        payment: { ...booking.estimate?.payment, paidCents: retainedCents, remainingCents: 0, status: refundCents ? (retainedCents ? "partially_refunded" : "refunded") : "deposit_retained" },
        cancellation: {
          cancelledAt: new Date().toISOString(),
          lessThan48Hours,
          retainedPercentOfTotal: totalCents ? Math.round((retainedCents / totalCents) * 100) : 0,
          refundPercentOfPaid: paidCents ? Math.round((refundCents / paidCents) * 100) : 0,
          retainedCents,
          refundCents,
          refundId: refund.id || "",
          refundStatus: refund.status || ""
        }
      };
      estimate.cancellation.receipt = require("./_cancellation-receipt").snapshot(beforeAuthorization, {...estimate.cancellation, source:"customer", paidCents}, authorization);
      const updated = await updateBooking(booking.id, { status: "Cancelled", estimate });
      const calendar = await updateBookingGoogleCalendar(updated, "cancel").catch(() => ({ status: "error" }));
      const refundAmount = `$${(refundCents / 100).toFixed(2)}`;
      const message = lessThan48Hours
        ? `Your appointment was cancelled. $${(retainedCents / 100).toFixed(2)} was retained from your booking payment under the cancellation policy, after crediting paid late-rescheduling fees${refundCents ? `, and ${refundAmount} is being returned to your original payment method` : ""}. Any uncaptured authorization for the remaining balance was released.`
        : `Your appointment was cancelled. A full refund of ${refundAmount} is being returned to your original payment method.`;
      const delivery = await require("./_cancellation-receipt").notify(updated).catch(error => ({status:"error",error:error.message}));
      return json(response, 200, {
        ok: true,
        action,
        booking: safeBooking(updated),
        refund: {
          amountCents: refundCents,
          percent: paidCents ? Math.round((refundCents / paidCents) * 100) : 0,
          retainedCents,
          status: refund.status || ""
        },
        calendar,
        delivery
      });
    }

    return json(response, 400, { error: "Choose reschedule or cancel." });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "The booking could not be updated.",
      setup: error.setup,
      details: error.details
    });
  }
}

module.exports = handler;
module.exports.createBookingManagementToken = createBookingManagementToken;
module.exports.decodeBookingManagementToken = decodeBookingManagementToken;
module.exports.matchesBookingLookup = matchesBookingLookup;
module.exports.orderNumberForBooking = orderNumberForBooking;
module.exports.safeBooking = safeBooking;
module.exports.verificationCodeHash = verificationCodeHash;

module.exports.notifyManagementChange = notifyManagementChange;

module.exports.requestVerificationForBooking = requestVerificationForBooking;
module.exports.verifyBookingCode = verifyBookingCode;
