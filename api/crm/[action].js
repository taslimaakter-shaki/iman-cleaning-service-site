const {
  assertScheduleAvailable,
  bookingDurationHours,
  getBooking,
  json,
  listAllBookings,
  readJsonBody,
  toZonedIso,
  updateBooking,
  updateBookingEstimate,
  updateBookingGoogleCalendar
} = require("../booking/_shared");
const {
  authorizationDue,
  authorizeRemainingBalance,
  cancelRemainingAuthorization,
  captureRemainingBalance,
  refundBookingPayment
} = require("../booking/_payments");
const { sendAdditionalWorkOffer } = require("../booking/_additional-work");
const { sendReviewRequest } = require("../booking/_review-request");
const { createStandaloneCustomQuote, listCrmQuotes } = require("./_quotes");
const { prepareQualityPhoto, recordQualityPhoto } = require("./_quality-photos");
const { confirmManualSmsConsent, createManualContact, deleteManualContact, listManualContacts, updateManualContact } = require("./_contacts");
const { listEmailSuppressions } = require("./_email-suppressions");
const { listCallbacks, updateCallback } = require("./_callbacks");
const { listCalls } = require("./_calls");
const { listCrmConversations } = require("./_conversations");
const { finishCustomerCall, sendCustomerMessage, startCustomerCall } = require("./_communications");
const { listConcerns, updateConcern } = require("./_concerns");
const { createBrowserVoiceToken, handleVoiceCall } = require("./_voice");
const { listSameDayRequests, updateSameDayRequest } = require("../booking/_same-day");
const { campaignPreview, sendCampaignBatch } = require("./_marketing-campaign");
const {
  findCustomQuoteRecord,
  saveCustomQuoteRecord,
  sendPhotoUploadRequest,
  schedulePhotoUploadReminders,
  cancelPhotoUploadReminders,
  refreshPhotoUploadReminders
} = require("../quote/_photo-later");

const allowedStatuses = new Set([
  "New",
  "Confirmed",
  "Cleaner assigned",
  "In progress",
  "Completed",
  "Cancelled"
]);

function isAdmin(request) {
  const configuredToken = String(process.env.ADMIN_TOKEN || "");
  const providedToken = String(request.headers["x-admin-token"] || "");
  return Boolean(configuredToken && providedToken && configuredToken === providedToken);
}

function getSiteUrl(request) {
  const configuredUrl = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

function toClientBooking(record = {}) {
  return {
    id: record.id,
    orderNumber: record.estimate?.orderNumber || record.id,
    createdAt: record.created_at,
    status: record.status,
    service: record.service,
    serviceLabel: record.service_label,
    schedule: record.schedule,
    scheduleLabel: record.schedule_label,
    bedroomsLabel: record.bedrooms_label,
    bathroomsLabel: record.bathrooms_label,
    sqft: record.sqft,
    addons: record.addons || [],
    clientName: record.client_name,
    phone: record.phone,
    email: record.email,
    address: record.address,
    notes: record.notes,
    estimate: record.estimate || {}
  };
}

function hasPaidDeposit(booking = {}) {
  const payment = booking.estimate?.payment || {};
  const totalCents = Number(payment.totalCents || Math.round(Number(booking.estimate?.total || 0) * 100));
  const depositCents = Number(payment.depositCents || payment.paidCents || Math.round(totalCents * 0.25));
  const paidCents = Number(payment.paidCents || (payment.status === "deposit_paid" ? depositCents : 0));
  return paidCents > 0 && (
    ["deposit_paid", "paid", "captured", "fully_paid"].includes(String(payment.status || "").toLowerCase()) ||
    (depositCents > 0 && paidCents >= depositCents)
  );
}

function cancellationAmountsForSource(booking = {}, cancellationSource = "", now = new Date()) {
  const payment = booking.estimate?.payment || {};
  const totalCents = Math.max(0, Math.round(Number(
    payment.totalCents || Number(booking.estimate?.total || 0) * 100
  )));
  const statedDepositCents = Math.max(0, Math.round(Number(
    payment.depositCents || totalCents * 0.25
  )));
  const paidCents = Math.max(0, Math.round(Number(
    payment.paidCents || (payment.status === "deposit_paid" ? statedDepositCents : 0)
  )));
  const depositCents = Math.min(paidCents, statedDepositCents);
  const appointmentTime = new Date(booking.schedule).getTime();
  const lessThan48Hours = !Number.isFinite(appointmentTime)
    || appointmentTime - now.getTime() < 48 * 3600000;
  const retainedCents = cancellationSource === "customer" && lessThan48Hours ? depositCents : 0;
  return {
    cancellationSource,
    lessThan48Hours,
    paidCents,
    depositCents,
    retainedCents,
    refundCents: Math.max(0, paidCents - retainedCents)
  };
}

function parseCleanerNames(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[\n,]+/);
  const seen = new Set();
  return values.map((name) => String(name || "").trim().replace(/\s+/g, " "))
    .filter((name) => {
      if (!name) return false;
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function text(value, maximum = 5000) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function numberBetween(value, minimum, maximum, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw Object.assign(new Error(`${label} must be between ${minimum} and ${maximum}.`), { statusCode: 400 });
  }
  return parsed;
}

function bookingScheduleLabel(schedule) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(schedule));
}

const RESCHEDULE_AUTHORIZATION_RESET_HOURS = 24;

function shouldResetAuthorizationForReschedule(previousSchedule, nextSchedule, now = new Date()) {
  const previousTime = new Date(previousSchedule).getTime();
  const nextTime = new Date(nextSchedule).getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime) || previousTime === nextTime) return false;
  return nextTime - now.getTime() > RESCHEDULE_AUTHORIZATION_RESET_HOURS * 3600000;
}

async function updateBookingDetails(body, response) {
  const id = text(body.id, 200);
  if (!id) return json(response, 400, { error: "Booking ID is required." });
  const booking = await getBooking(id);
  if (!booking) return json(response, 404, { error: "Booking not found." });

  const clientName = text(body.clientName, 200);
  const email = text(body.email, 320).toLowerCase();
  const phone = text(body.phone, 80);
  const address = text(body.address, 700);
  const serviceLabel = text(body.serviceLabel, 240);
  if (!clientName || !serviceLabel) {
    return json(response, 400, { error: "Customer name and service name are required." });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(response, 400, { error: "Enter a valid customer email address." });
  }

  const scheduleLocal = text(body.scheduleLocal, 40);
  const match = scheduleLocal.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  if (!match) return json(response, 400, { error: "Choose a valid service date and time." });
  const schedule = toZonedIso(match[1], match[2]);
  const teamHours = numberBetween(body.teamHours, 0.25, 200, "On-site duration");
  const laborHours = numberBetween(body.laborHours, 0.25, 1000, "Labor-hours");
  const cleanerCount = Math.round(numberBetween(body.cleanerCount, 1, 50, "Cleaner count"));
  const totalCents = Math.round(numberBetween(body.totalCents, 0, 100000000, "Total price"));
  const sqft = Math.round(numberBetween(body.sqft || 0, 0, 10000000, "Square footage"));

  const estimate = booking.estimate && typeof booking.estimate === "object" ? booking.estimate : {};
  const priorPayment = estimate.payment && typeof estimate.payment === "object" ? estimate.payment : {};
  const paidCents = Math.max(0, Math.round(Number(
    priorPayment.paidCents || (["deposit_paid", "paid", "captured", "fully_paid"].includes(String(priorPayment.status || "").toLowerCase()) ? priorPayment.depositCents : 0) || 0
  )));
  if (totalCents < paidCents) {
    return json(response, 409, { error: `The total cannot be less than the ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(paidCents / 100)} already paid.` });
  }

  const scheduleChanged = new Date(schedule).getTime() !== new Date(booking.schedule).getTime();
  const durationChanged = Math.abs(teamHours - bookingDurationHours(booking)) > 0.001;
  if ((scheduleChanged || durationChanged) && !["Completed", "Cancelled"].includes(booking.status)) {
    await assertScheduleAvailable(schedule, teamHours, id);
  }

  const remainingCents = Math.max(0, totalCents - paidCents);
  const taxRate = 0.08875;
  const subtotalCents = Math.round(totalCents / (1 + taxRate));
  const payment = {
    ...priorPayment,
    totalCents,
    paidCents,
    remainingCents,
    status: remainingCents === 0 && paidCents >= totalCents ? "fully_paid" : (priorPayment.status || (paidCents ? "deposit_paid" : "pending")),
    remaining: {
      ...(priorPayment.remaining || {}),
      amountCents: remainingCents,
      status: remainingCents === 0 ? "captured" : (["captured", "paid"].includes(String(priorPayment.remaining?.status || "").toLowerCase()) ? "pending" : (priorPayment.remaining?.status || "pending"))
    }
  };
  const rescheduleRequestedAt = new Date().toISOString();
  const updatedEstimate = {
    ...estimate,
    subtotal: subtotalCents / 100,
    tax: (totalCents - subtotalCents) / 100,
    total: totalCents / 100,
    low: totalCents / 100,
    high: totalCents / 100,
    manHours: laborHours,
    laborHours,
    teamHours,
    hours: teamHours,
    cleanerCount,
    payment,
    ...(scheduleChanged ? {
      rescheduling: {
        ...(estimate.rescheduling || {}),
        previousSchedule: booking.schedule,
        newSchedule: schedule,
        requestedAt: rescheduleRequestedAt,
        source: "crm",
        authorizationReset: {
          status: "checking",
          thresholdHours: RESCHEDULE_AUTHORIZATION_RESET_HOURS
        }
      }
    } : {})
  };
  const addons = String(body.addons || "").split(/[\n,]+/).map((item) => text(item, 200)).filter(Boolean).slice(0, 100);
  await updateBooking(id, {
    client_name: clientName,
    email,
    phone,
    address,
    service_label: serviceLabel,
    schedule,
    schedule_label: bookingScheduleLabel(schedule),
    bedrooms_label: text(body.bedroomsLabel, 200),
    bathrooms_label: text(body.bathroomsLabel, 200),
    sqft,
    addons,
    notes: String(body.notes || "").trim().slice(0, 10000),
    estimate: updatedEstimate
  });

  let paymentAuthorization = { status: "unchanged" };
  if (scheduleChanged) {
    let updatedBooking = await getBooking(id);
    const shouldReset = shouldResetAuthorizationForReschedule(booking.schedule, schedule, new Date(rescheduleRequestedAt));
    if (shouldReset) {
      try {
        const released = await cancelRemainingAuthorization({ booking: updatedBooking, resetForReschedule: true });
        updatedBooking = await getBooking(id) || updatedBooking;
        let replacement = { status: "scheduled", authorizationDueHours: 48 };
        if (authorizationDue(updatedBooking, new Date(rescheduleRequestedAt))) {
          replacement = await authorizeRemainingBalance({ booking: updatedBooking, now: new Date(rescheduleRequestedAt) });
          updatedBooking = await getBooking(id) || updatedBooking;
        }
        paymentAuthorization = {
          status: "reset",
          releasedPaymentIntentId: released.paymentIntentId || "",
          replacement
        };
      } catch (error) {
        paymentAuthorization = {
          status: "requires_attention",
          error: text(error.message || "The previous authorization could not be released.", 500)
        };
      }
    } else {
      paymentAuthorization = {
        status: "retained_short_notice",
        thresholdHours: RESCHEDULE_AUTHORIZATION_RESET_HOURS
      };
    }

    updatedBooking = await getBooking(id) || updatedBooking;
    const latestEstimate = updatedBooking.estimate && typeof updatedBooking.estimate === "object" ? updatedBooking.estimate : updatedEstimate;
    await updateBookingEstimate(id, {
      ...latestEstimate,
      rescheduling: {
        ...(latestEstimate.rescheduling || updatedEstimate.rescheduling || {}),
        authorizationReset: {
          ...paymentAuthorization,
          recordedAt: new Date().toISOString()
        }
      }
    });
  }

  let scheduleNotification = { status: "not_needed" };
  if (scheduleChanged) {
    const message = [
      `IMAN Cleaning Service: Your cleaning appointment has been rescheduled to ${bookingScheduleLabel(schedule)} (New York time).`,
      `Service: ${serviceLabel}.`,
      address ? `Address: ${address}.` : "",
      "Questions or changes? Call (929) 232-1930. Reply STOP to opt out."
    ].filter(Boolean).join(" ");
    try {
      const sent = await sendCustomerMessage({
        phone,
        customerName: clientName,
        message
      });
      scheduleNotification = { status: "sent", messageId: sent.messageId || "" };
    } catch (error) {
      scheduleNotification = { status: "failed", error: "The booking was saved, but the rescheduling text could not be sent." };
    }
  }

  let calendar = { status: "unchanged" };
  if (!["Completed", "Cancelled"].includes(booking.status)) {
    try {
      calendar = await updateBookingGoogleCalendar(await getBooking(id), "reschedule", { notifyCustomer: false });
    } catch (error) {
      calendar = { status: "error", error: "Booking saved, but Google Calendar could not be updated." };
    }
  }
  return json(response, 200, { ok: true, calendar, scheduleNotification, paymentAuthorization, booking: toClientBooking(await getBooking(id)) });
}

function buildTimeTracking(existing = {}, clockAction, now = new Date()) {
  const nowIso = now.toISOString();
  const entries = Array.isArray(existing.entries)
    ? existing.entries.map((entry) => ({ ...entry }))
    : [];
  const activeIndex = entries.findIndex((entry) => entry.clockInAt && !entry.clockOutAt);

  if (clockAction === "clock_in") {
    if (activeIndex >= 0) {
      throw Object.assign(new Error("This team is already clocked in for the booking."), { statusCode: 409 });
    }
    entries.push({ clockInAt: nowIso, clockOutAt: "", minutes: 0 });
  } else if (clockAction === "clock_out") {
    if (activeIndex < 0) {
      throw Object.assign(new Error("Clock in before clocking out."), { statusCode: 409 });
    }
    const clockInTime = new Date(entries[activeIndex].clockInAt).getTime();
    entries[activeIndex].clockOutAt = nowIso;
    entries[activeIndex].minutes = Number.isFinite(clockInTime)
      ? Math.max(0, Math.round((now.getTime() - clockInTime) / 60000))
      : 0;
  } else {
    throw Object.assign(new Error("Choose clock in or clock out."), { statusCode: 400 });
  }

  const activeEntry = entries.find((entry) => entry.clockInAt && !entry.clockOutAt);
  const closedEntries = entries.filter((entry) => entry.clockInAt && entry.clockOutAt);
  return {
    entries,
    clockedIn: Boolean(activeEntry),
    lastClockInAt: entries.at(-1)?.clockInAt || existing.lastClockInAt || "",
    lastClockOutAt: closedEntries.at(-1)?.clockOutAt || existing.lastClockOutAt || "",
    totalMinutes: closedEntries.reduce((sum, entry) => sum + Math.max(0, Number(entry.minutes || 0)), 0)
  };
}

async function updateStatus(body, request, response) {
  const id = String(body.id || "").trim();
  const status = String(body.status || "").trim();

  if (!id) return json(response, 400, { error: "Booking ID is required." });
  if (!allowedStatuses.has(status)) {
    return json(response, 400, { error: "Invalid status." });
  }

  const booking = await getBooking(id);
  if (!booking) return json(response, 404, { error: "Booking not found." });

  const cancellationSource = String(body.cancellationSource || "").trim().toLowerCase();
  if (status === "Cancelled" && !["iman", "customer"].includes(cancellationSource)) {
    return json(response, 400, { error: "Choose whether Iman Cleaning or the customer cancelled the booking." });
  }
  if (status === "Cancelled" && booking.status === "Cancelled") {
    return json(response, 409, { error: "This booking is already cancelled. Its recorded refund cannot be run again." });
  }

  let payment = { status: "not_applicable" };
  let additionalWork = { status: "not_requested" };
  let reviewRequest = { status: "not_requested" };
  if (status === "Completed") {
    try {
      payment = await captureRemainingBalance({ bookingId: id });
    } catch (error) {
      payment = { status: "error", error: error.message || "Payment update failed." };
    }
    const captured = ["captured", "already_captured", "not_applicable"].includes(payment.status);
    if (!captured) {
      if (body.sendAdditionalWork) {
        const refreshed = await getBooking(id) || booking;
        const estimate = refreshed.estimate && typeof refreshed.estimate === "object" ? refreshed.estimate : {};
        const prior = estimate.additionalWork || {};
        await updateBookingEstimate(id, {
          ...estimate,
          additionalWork: { ...prior, offerRequested: true, pendingUntilBalancePaid: true }
        });
        additionalWork = { status: "waiting_for_payment" };
      }
      return json(response, 409, {
        error: "The booking was not marked completed because the remaining balance could not be collected.",
        payment,
        additionalWork
      });
    }

    await updateBooking(id, { status });
    const refreshed = await getBooking(id) || { ...booking, status };
    const priorOffer = refreshed.estimate?.additionalWork || {};
    const shouldSendOffer = Boolean(body.sendAdditionalWork || priorOffer.pendingUntilBalancePaid);
    if (shouldSendOffer) {
      try {
        const result = await sendAdditionalWorkOffer({ booking: { ...refreshed, status }, baseUrl: getSiteUrl(request) });
        additionalWork = { status: result.sent ? "sent" : "failed", ...result };
      } catch (error) {
        additionalWork = { status: "failed", error: error.message || "The additional-work link could not be sent." };
      }
    }
    try {
      const bookingForReview = shouldSendOffer ? (await getBooking(id) || refreshed) : refreshed;
      reviewRequest = await sendReviewRequest({ booking: bookingForReview });
    } catch (error) {
      reviewRequest = { status: "failed", sent: false, error: error.message || "The Google review request could not be sent." };
    }
  } else if (status === "Cancelled") {
    try {
      const cancellation = cancellationAmountsForSource(booking, cancellationSource);
      const authorization = await cancelRemainingAuthorization({ booking });
      const refund = await refundBookingPayment({
        booking,
        amountCents: cancellation.refundCents,
        policy: cancellationSource === "iman"
          ? "iman_cancelled_full_refund"
          : cancellation.lessThan48Hours
            ? "customer_cancelled_less_than_48_hours_deposit_retained"
            : "customer_cancelled_48_hours_or_more_full_refund",
        reason: cancellationSource === "customer" ? "requested_by_customer" : ""
      });
      const bookingAfterAuthorization = await getBooking(id) || booking;
      const currentEstimate = bookingAfterAuthorization.estimate && typeof bookingAfterAuthorization.estimate === "object"
        ? bookingAfterAuthorization.estimate
        : {};
      const currentPayment = currentEstimate.payment && typeof currentEstimate.payment === "object" ? currentEstimate.payment : {};
      const cancelledAt = new Date().toISOString();
      const estimate = {
        ...currentEstimate,
        payment: {
          ...currentPayment,
          status: cancellation.refundCents
            ? (cancellation.retainedCents ? "partially_refunded" : "refunded")
            : (cancellation.retainedCents ? "deposit_retained" : currentPayment.status),
          paidCents: cancellation.retainedCents,
          remainingCents: 0,
          refundedCents: Number(currentPayment.refundedCents || 0) + cancellation.refundCents,
          refundedAt: cancellation.refundCents ? cancelledAt : (currentPayment.refundedAt || "")
        },
        cancellation: {
          cancelledAt,
          source: cancellationSource,
          label: cancellationSource === "iman" ? "Canceled by Iman Cleaning" : "Canceled by customer",
          lessThan48Hours: cancellation.lessThan48Hours,
          depositCents: cancellation.depositCents,
          retainedCents: cancellation.retainedCents,
          refundCents: cancellation.refundCents,
          refundId: refund.id || "",
          refundStatus: refund.status || ""
        }
      };
      await updateBooking(id, { status, estimate });
      payment = {
        status: cancellation.refundCents ? "refunded" : authorization.status,
        cancellationSource,
        retainedCents: cancellation.retainedCents,
        refundedCents: cancellation.refundCents,
        authorization,
        refund
      };
    } catch (error) {
      return json(response, error.statusCode || 409, {
        error: error.message || "The booking was not cancelled because its payment could not be updated.",
        payment: { status: "error", error: error.message || "Payment update failed." }
      });
    }
  } else {
    await updateBooking(id, { status });
  }

  let calendar = { status: 'unchanged' };
  if (status === 'Cancelled' || ['Confirmed', 'Cleaner assigned', 'In progress'].includes(status)) {
    try {
      const current = await getBooking(id);
      calendar = await updateBookingGoogleCalendar(current, status === 'Cancelled' ? 'cancel' : 'reschedule');
    } catch { calendar = { status: 'error', error: 'Google Calendar could not be updated. The CRM booking status was saved.' }; }
  }
  return json(response, 200, { ok: true, payment, additionalWork, reviewRequest, calendar });
}

async function resendAdditionalWork(body, request, response) {
  const id = String(body.id || "").trim();
  if (!id) return json(response, 400, { error: "Booking ID is required." });
  const booking = await getBooking(id);
  if (!booking) return json(response, 404, { error: "Booking not found." });
  const result = await sendAdditionalWorkOffer({ booking, baseUrl: getSiteUrl(request) });
  return json(response, result.sent ? 200 : 502, {
    ok: result.sent,
    additionalWork: { status: result.sent ? "sent" : "failed", ...result }
  });
}

async function updateClock(body, response) {
  const id = String(body.id || "").trim();
  const clockAction = String(body.clockAction || "").trim().toLowerCase();
  if (!id) return json(response, 400, { error: "Booking ID is required." });

  const booking = await getBooking(id);
  if (!booking) return json(response, 404, { error: "Booking not found." });
  if (!hasPaidDeposit(booking)) {
    return json(response, 409, { error: "Clocking is available only after the 25% deposit is paid." });
  }
  if (booking.status === "Cancelled") {
    return json(response, 409, { error: "A cancelled booking cannot be clocked." });
  }
  if (clockAction === "clock_in" && booking.status === "Completed") {
    return json(response, 409, { error: "A completed booking cannot be clocked in again." });
  }

  const estimate = booking.estimate && typeof booking.estimate === "object" ? booking.estimate : {};
  const timeTracking = buildTimeTracking(estimate.timeTracking || {}, clockAction, new Date());
  await updateBookingEstimate(id, { ...estimate, timeTracking });
  if (clockAction === "clock_in" && booking.status !== "In progress") {
    await updateBooking(id, { status: "In progress" });
  }

  return json(response, 200, {
    ok: true,
    status: clockAction === "clock_in" ? "In progress" : booking.status,
    timeTracking
  });
}

async function updateCleanerAssignment(body, response) {
  const id = String(body.id || "").trim();
  if (!id) return json(response, 400, { error: "Booking ID is required." });

  const booking = await getBooking(id);
  if (!booking) return json(response, 404, { error: "Booking not found." });
  if (!hasPaidDeposit(booking)) {
    return json(response, 409, { error: "Cleaners can be assigned only after the 25% deposit is paid." });
  }
  if (booking.status === "Cancelled") {
    return json(response, 409, { error: "Cleaners cannot be assigned to a cancelled booking." });
  }

  const cleanerNames = parseCleanerNames(body.cleanerNames);
  if (cleanerNames.length > 20) {
    return json(response, 400, { error: "Enter no more than 20 cleaner names." });
  }
  if (cleanerNames.some((name) => name.length > 80)) {
    return json(response, 400, { error: "Each cleaner name must be 80 characters or fewer." });
  }

  const now = new Date().toISOString();
  const estimate = booking.estimate && typeof booking.estimate === "object" ? booking.estimate : {};
  const priorAssignment = estimate.assignment && typeof estimate.assignment === "object" ? estimate.assignment : {};
  const assignment = {
    ...priorAssignment,
    cleanerNames,
    assignedAt: cleanerNames.length ? (priorAssignment.assignedAt || now) : "",
    updatedAt: now
  };
  await updateBookingEstimate(id, { ...estimate, assignment });

  let status = booking.status;
  if (cleanerNames.length && ["New", "Confirmed"].includes(status)) status = "Cleaner assigned";
  if (!cleanerNames.length && status === "Cleaner assigned") status = "Confirmed";
  if (status !== booking.status) await updateBooking(id, { status });

  return json(response, 200, { ok: true, cleanerNames, status, assignment });
}

async function handler(request, response) {
  try {
    const action = String(request.query?.action || "").toLowerCase();
    if (["calendar-start", "calendar-status", "calendar-callback", "calendar-sync"].includes(action)) {
      return require("../google-calendar/_handler")(request, response);
    }
    if (!new Set(["walkthroughs", "additional-work", "bookings", "quotes", "contacts", "email-suppressions", "marketing-campaign", "calls", "conversations", "callbacks", "concerns", "same-day", "voice-token", "voice-call", "customer-message", "customer-call", "payment-link-email", "photo-upload-url", "photo-record", "quote-photo-link", "quote-photo-reminders", "quote-photo-reminder-status"]).has(action)) {
      return json(response, 404, { error: "CRM action not found." });
    }
    if (action === "voice-call") return handleVoiceCall(request, response);
    if (!isAdmin(request)) {
      return json(response, 401, { error: "Admin token required." });
    }

    if (action === "walkthroughs") {
      response.setHeader("Cache-Control", "no-store");
      if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
      return json(response, 200, { request: await require("./_walkthroughs").confirm(await readJsonBody(request)) });
    }

    if (action === 'additional-work') {
      response.setHeader('Cache-Control', 'no-store');
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
      const id = String(request.query?.bookingId || '').trim();
      if (!id || !await getBooking(id)) return json(response, 404, { error: 'Booking not found.' });
      return json(response, 200, { orders: await require('../booking/_additional-approval').crmOrders(id) });
    }

    if (action === "voice-token") {
      if (request.method === "GET") return json(response, 200, await createBrowserVoiceToken());
      return json(response, 405, { error: "Method not allowed." });
    }

    if (action === "customer-message") {
      if (request.method === "POST") return json(response, 201, { ok: true, ...(await sendCustomerMessage(await readJsonBody(request))) });
      return json(response, 405, { error: "Method not allowed." });
    }

    if (action === "payment-link-email") {
      if (request.method === "POST") return json(response, 201, { ok: true, ...(await require("./_payment-link-email").sendPaymentLinkEmail(await readJsonBody(request))) });
      return json(response, 405, { error: "Method not allowed." });
    }

    if (action === "customer-call") {
      const body = await readJsonBody(request);
      if (request.method === "POST") return json(response, 201, { ok: true, call: await startCustomerCall(body) });
      if (request.method === "PATCH") return json(response, 200, { ok: true, call: await finishCustomerCall(body) });
      return json(response, 405, { error: "Method not allowed." });
    }

    if (action === "concerns") {
      if (request.method === "GET") return json(response, 200, { concerns: await listConcerns() });
      if (request.method === "PATCH") return json(response, 200, { concern: await updateConcern(await readJsonBody(request)) });
      return json(response, 405, { error: "Method not allowed." });
    }

    if (action === "same-day") {
      if (request.method === "GET") return json(response, 200, { requests: await listSameDayRequests() });
      if (request.method === "PATCH") return json(response, 200, { request: await updateSameDayRequest(await readJsonBody(request), request) });
      return json(response, 405, { error: "Method not allowed." });
    }

    if (action === "quotes" && request.method === "POST") {
      return json(response, 201, { ok: true, quote: await createStandaloneCustomQuote() });
    }

    if (action === "quotes" && ["PATCH", "DELETE"].includes(request.method)) {
      const body = await readJsonBody(request);
      const editor = require("./_quote-admin");
      const result = request.method === "DELETE" ? await editor.deleteQuote(body)
        : body.operation === "restore" ? await editor.restoreQuote(body)
        : body.operation === "discount" ? await editor.saveDiscount(body) : await editor.saveEdit(body);
      return json(response, 200, result);
    }

    if (request.method === "POST" && action === "photo-upload-url") {
      return json(response, 200, await prepareQualityPhoto(await readJsonBody(request)));
    }
    if (request.method === "POST" && action === "photo-record") {
      return json(response, 201, await recordQualityPhoto(await readJsonBody(request)));
    }
    if (request.method === "POST" && action === "contacts") {
      return json(response, 201, { contact: await createManualContact(await readJsonBody(request)) });
    }
    if (action === "marketing-campaign") {
      if (request.method === "GET") return json(response, 200, await campaignPreview());
      if (request.method === "POST") {
        const body = await readJsonBody(request);
        return json(response, 200, await sendCampaignBatch({ ...body, siteUrl: getSiteUrl(request) }));
      }
      return json(response, 405, { error: "Method not allowed." });
    }
    if (request.method === "PATCH" && action === "contacts") {
      const body = await readJsonBody(request);
      if (body.operation === "confirm-manual-sms-consent") {
        return json(response, 200, await confirmManualSmsConsent(body));
      }
      return json(response, 200, { contact: await updateManualContact(body) });
    }
    if (request.method === "DELETE" && action === "contacts") {
      return json(response, 200, { deleted: await deleteManualContact(await readJsonBody(request)) });
    }
    if (request.method === "PATCH" && action === "callbacks") {
      return json(response, 200, { callback: await updateCallback(await readJsonBody(request)) });
    }
    if (request.method === "PATCH" && action === "quote-photo-link") {
      const body = await readJsonBody(request);
      const quoteId = String(body.quoteId || "").trim();
      if (!quoteId) return json(response, 400, { error: "Quote ID is required." });
      const { drive } = require("../quote/_shared").getGoogleClients();
      const found = await findCustomQuoteRecord(drive, quoteId);
      const priorReminderCancellations = await cancelPhotoUploadReminders(found.record);
      const delivery = await sendPhotoUploadRequest({ record: found.record, baseUrl: getSiteUrl(request) });
      const now = new Date().toISOString();
      found.record.status = "Awaiting photos";
      found.record.photoUpload = {
        ...(found.record.photoUpload || {}),
        status: "Awaiting photos",
        uploadUrl: delivery.link.url,
        linkExpiresAt: new Date(delivery.link.expiresAt).toISOString(),
        lastSentAt: now,
        smsStatus: delivery.smsDelivery.status,
        smsMessageId: delivery.smsDelivery.messageId || "",
        emailStatus: delivery.emailDelivery.status,
        emailMessageId: delivery.emailDelivery.messageId || "",
        scheduledReminders: delivery.scheduledReminders || [],
        priorReminderCancellations
      };
      await saveCustomQuoteRecord(drive, found.fileId, found.record);
      return json(response, 200, { ok: true, uploadUrl: delivery.link.url, photoUpload: found.record.photoUpload });
    }

    if (request.method === "PATCH" && action === "quote-photo-reminders") {
      const body = await readJsonBody(request);
      const quoteId = String(body.quoteId || "").trim();
      if (!quoteId) return json(response, 400, { error: "Quote ID is required." });
      const { drive } = require("../quote/_shared").getGoogleClients();
      const found = await findCustomQuoteRecord(drive, quoteId);
      const priorReminderCancellations = await cancelPhotoUploadReminders(found.record);
      const scheduledReminders = await schedulePhotoUploadReminders({ record: found.record });
      const now = new Date().toISOString();
      found.record.photoUpload = {
        ...(found.record.photoUpload || {}),
        scheduledReminders,
        remindersRetriedAt: now,
        priorReminderCancellations
      };
      await saveCustomQuoteRecord(drive, found.fileId, found.record);
      return json(response, 200, { ok: true, photoUpload: found.record.photoUpload });
    }

    if (request.method === "PATCH" && action === "quote-photo-reminder-status") {
      const body = await readJsonBody(request);
      const quoteId = String(body.quoteId || "").trim();
      if (!quoteId) return json(response, 400, { error: "Quote ID is required." });
      const { drive } = require("../quote/_shared").getGoogleClients();
      const found = await findCustomQuoteRecord(drive, quoteId);
      const scheduledReminders = await refreshPhotoUploadReminders(found.record);
      found.record.photoUpload = {
        ...(found.record.photoUpload || {}),
        scheduledReminders,
        remindersCheckedAt: new Date().toISOString()
      };
      await saveCustomQuoteRecord(drive, found.fileId, found.record);
      return json(response, 200, { ok: true, photoUpload: found.record.photoUpload });
    }

    if (request.method === "GET") {
      if (action === "quotes") {
        return json(response, 200, { quotes: await listCrmQuotes() });
      }
      if (action === "contacts") {
        return json(response, 200, { contacts: await listManualContacts() });
      }
      if (action === "email-suppressions") {
        return json(response, 200, { suppressions: await listEmailSuppressions() });
      }
      if (action === "callbacks") {
        return json(response, 200, { callbacks: await listCallbacks() });
      }
      if (action === "calls") {
        return json(response, 200, { calls: await listCalls() });
      }
      if (action === "conversations") {
        return json(response, 200, { conversations: await listCrmConversations() });
      }
      const records = await listAllBookings();
      return json(response, 200, { bookings: records.map(toClientBooking) });
    }
    if (request.method === "PATCH") {
      const body = await readJsonBody(request);
      if (body.clockAction) return updateClock(body, response);
      if (body.assignmentAction === "save") return updateCleanerAssignment(body, response);
      if (body.additionalWorkAction === "resend") return resendAdditionalWork(body, request, response);
      if (body.bookingAction === "save_details") return updateBookingDetails(body, response);
      return updateStatus(body, request, response);
    }
    return json(response, 405, { error: "Method not allowed." });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Unexpected server error."
    });
  }
}

module.exports = handler;
module.exports._test = {
  buildTimeTracking,
  cancellationAmountsForSource,
  hasPaidDeposit,
  parseCleanerNames,
  shouldResetAuthorizationForReschedule
};
