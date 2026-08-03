const {
  cleanText,
  json,
  listReminderBookings,
  updateBookingEstimate
} = require("./_shared");
const {
  reminderStageForBooking,
  sendBookingReminderEmail,
  sendBookingReminderSms
} = require("./_notifications");

function authorized(request) {
  const secret = process.env.CRON_SECRET || "";
  return Boolean(secret) && request.headers.authorization === `Bearer ${secret}`;
}

async function processDueReminders({
  now = new Date(),
  listBookings = listReminderBookings,
  sendEmail = sendBookingReminderEmail,
  sendSms = sendBookingReminderSms,
  updateEstimate = updateBookingEstimate
} = {}) {
  const bookings = await listBookings();
  const results = [];

  for (const booking of bookings) {
    const stage = reminderStageForBooking(booking, now);
    if (!stage) continue;
    const estimate = booking.estimate && typeof booking.estimate === "object" ? booking.estimate : {};
    const reminders = estimate.reminders && typeof estimate.reminders === "object" ? estimate.reminders : {};
    const existingStage = reminders[stage] && typeof reminders[stage] === "object" ? reminders[stage] : {};
    if (existingStage.emailSentAt && existingStage.smsSentAt) {
      results.push({ bookingId: booking.id, stage, status: "already_sent" });
      continue;
    }

    try {
      const [email, sms] = await Promise.all([
        existingStage.emailSentAt
          ? Promise.resolve({ status: "already_sent", messageId: existingStage.emailMessageId || "", error: "" })
          : sendEmail(booking, stage),
        existingStage.smsSentAt
          ? Promise.resolve({ status: "already_sent", messageId: existingStage.smsMessageId || "", error: "" })
          : sendSms(booking, stage)
      ]);
      const recordedAt = new Date().toISOString();
      const nextStage = {
        ...existingStage,
        ...(email.status === "sent" ? { emailSentAt: recordedAt, emailMessageId: email.messageId || "" } : {}),
        ...(sms.status === "sent" ? { smsSentAt: recordedAt, smsMessageId: sms.messageId || "" } : {})
      };
      await updateEstimate(booking.id, {
        ...estimate,
        reminders: {
          ...reminders,
          [stage]: nextStage
        }
      });
      const errors = [email, sms]
        .filter((delivery) => ["failed", "error"].includes(delivery.status))
        .map((delivery) => cleanText(delivery.error, 240))
        .filter(Boolean);
      results.push({
        bookingId: booking.id,
        stage,
        status: errors.length ? "error" : "sent",
        emailStatus: email.status,
        smsStatus: sms.status,
        sentAt: recordedAt,
        error: errors.join(" ")
      });
    } catch (error) {
      results.push({
        bookingId: booking.id,
        stage,
        status: "error",
        error: cleanText(error.message || "Reminder could not be sent.", 240)
      });
    }
  }

  return {
    checked: bookings.length,
    due: results.length,
    sent: results.filter((result) => result.status === "sent").length,
    errors: results.filter((result) => result.status === "error").length,
    results
  };
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "GET") {
      return json(response, 405, { error: "Method not allowed." });
    }
    if (!authorized(request)) {
      return json(response, 401, { error: "Unauthorized." });
    }
    const result = await processDueReminders();
    return json(response, 200, { ok: true, ...result });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Booking reminders could not be processed.",
      setup: error.setup,
      details: error.details
    });
  }
};

module.exports.processDueReminders = processDueReminders;
