const crypto = require("crypto");
const {
  availableSlotsForPackage,
  cleanText,
  getBooking,
  json,
  readJsonBody,
  updateBooking,
  updateBookingGoogleCalendar
} = require("./_shared");
const {
  formatAppointment,
  sendCustomerSms
} = require("./_notifications");

const TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

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
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
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

function safeBooking(booking) {
  const appointment = new Date(booking.schedule);
  const hoursRemaining = (appointment.getTime() - Date.now()) / 3600000;
  const lateCancellation = hoursRemaining < 24;
  const paidCents = Number(
    booking.estimate?.payment?.paidCents
    || Math.round(Number(booking.estimate?.total || booking.estimate?.high || booking.estimate?.low || 0) * 100)
  );
  const refundCents = lateCancellation ? Math.round(paidCents * 0.75) : paidCents;
  return {
    id: booking.id,
    status: booking.status,
    service: booking.service_label || booking.service,
    schedule: booking.schedule,
    scheduleLabel: booking.schedule_label || formatAppointment(booking.schedule),
    address: booking.address,
    total: Number(booking.estimate?.total || booking.estimate?.high || booking.estimate?.low || 0),
    cancellation: {
      lessThan24Hours: lateCancellation,
      refundPercent: lateCancellation ? 75 : 100,
      retainedPercent: lateCancellation ? 25 : 0,
      paidCents,
      refundCents,
      retainedCents: Math.max(0, paidCents - refundCents)
    }
  };
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
    `Booking reference: ${booking.id}`,
    "Questions? Call 929-803-4053.",
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
      `IMAN Cleaning Service: ${message} Booking: ${booking.id}. Questions? Call 929-803-4053. Reply STOP to opt out.`
    )
  ]);
  return {
    email: email.status === "fulfilled" ? email.value.status : "failed",
    sms: sms.status === "fulfilled" ? sms.value.status : "failed"
  };
}

async function createRefund(booking, amountCents) {
  const secretKey = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key || "";
  const paymentIntentId = cleanText(booking.estimate?.payment?.paymentIntentId, 120);
  if (!secretKey || !paymentIntentId) {
    throw Object.assign(new Error("The original payment could not be located automatically. Please call 929-803-4053."), {
      statusCode: 409
    });
  }
  const encoded = new URLSearchParams({
    payment_intent: paymentIntentId,
    amount: String(amountCents),
    reason: "requested_by_customer",
    "metadata[booking_id]": booking.id,
    "metadata[cancellation_policy]": amountCents < Number(booking.estimate?.payment?.paidCents || 0)
      ? "less_than_24_hours_75_percent_refund"
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
    const token = cleanText(body.token || request.query?.token, 3000);
    const { booking } = await bookingForToken(token);

    if (request.method === "GET") {
      const pkg = { teamHours: Number(booking.estimate?.teamHours || booking.estimate?.hours || 2) };
      const slots = ["Confirmed", "Cleaner assigned"].includes(booking.status)
        ? await availableSlotsForPackage(pkg)
        : [];
      return json(response, 200, { booking: safeBooking(booking), slots });
    }

    const action = cleanText(body.action, 30);
    if (action === "reschedule") {
      if (!["Confirmed", "Cleaner assigned"].includes(booking.status)) {
        return json(response, 409, { error: "This booking can no longer be rescheduled online." });
      }
      const pkg = { teamHours: Number(booking.estimate?.teamHours || booking.estimate?.hours || 2) };
      const slots = await availableSlotsForPackage(pkg);
      const slot = slots.find((item) => item.value === cleanText(body.schedule, 100));
      if (!slot) return json(response, 409, { error: "That appointment is no longer available. Please choose another time." });
      const estimate = {
        ...(booking.estimate || {}),
        rescheduling: {
          previousSchedule: booking.schedule,
          requestedAt: new Date().toISOString()
        }
      };
      const updated = await updateBooking(booking.id, {
        schedule: slot.value,
        schedule_label: slot.label,
        estimate
      });
      const calendar = await updateBookingGoogleCalendar(updated, "reschedule").catch(() => ({ status: "error" }));
      const message = `Your appointment was rescheduled to ${slot.label}.`;
      const delivery = await notifyManagementChange(updated, "Your appointment was rescheduled", message);
      return json(response, 200, { ok: true, action, booking: safeBooking(updated), calendar, delivery });
    }

    if (action === "cancel") {
      if (booking.status === "Cancelled") {
        return json(response, 200, { ok: true, action, alreadyCancelled: true, booking: safeBooking(booking) });
      }
      if (!["Confirmed", "Cleaner assigned"].includes(booking.status)) {
        return json(response, 409, { error: "This booking can no longer be cancelled online." });
      }
      const appointment = new Date(booking.schedule);
      const lessThan24Hours = appointment.getTime() - Date.now() < 24 * 3600000;
      const paidCents = Number(booking.estimate?.payment?.paidCents || Math.round(Number(booking.estimate?.total || 0) * 100));
      const refundCents = lessThan24Hours ? Math.round(paidCents * 0.75) : paidCents;
      const refund = await createRefund(booking, refundCents);
      const estimate = {
        ...(booking.estimate || {}),
        cancellation: {
          cancelledAt: new Date().toISOString(),
          lessThan24Hours,
          retainedPercent: lessThan24Hours ? 25 : 0,
          refundPercent: lessThan24Hours ? 75 : 100,
          refundCents,
          refundId: refund.id || "",
          refundStatus: refund.status || ""
        }
      };
      const updated = await updateBooking(booking.id, { status: "Cancelled", estimate });
      const calendar = await updateBookingGoogleCalendar(updated, "cancel").catch(() => ({ status: "error" }));
      const refundAmount = `$${(refundCents / 100).toFixed(2)}`;
      const message = lessThan24Hours
        ? `Your appointment was cancelled. A 75% refund of ${refundAmount} is being returned to your original payment method; 25% was retained under the less-than-24-hours cancellation policy.`
        : `Your appointment was cancelled. A full refund of ${refundAmount} is being returned to your original payment method.`;
      const delivery = await notifyManagementChange(updated, "Your appointment was cancelled", message);
      return json(response, 200, {
        ok: true,
        action,
        booking: safeBooking(updated),
        refund: { amountCents: refundCents, percent: lessThan24Hours ? 75 : 100, status: refund.status || "" },
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
module.exports.safeBooking = safeBooking;
