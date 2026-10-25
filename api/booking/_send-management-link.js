const { cleanText, json, readJsonBody } = require("./_shared");
const { sendCustomerSms } = require("./_notifications");
const { phoneFromPayload, requireWebhookAuth } = require("../quote/_send-link");
const { buildManualCallRow, safeUpsertCallLog } = require("../receptionist/_shared");

function managementUrl() {
  const baseUrl = cleanText(
    process.env.PUBLIC_SITE_URL || process.env.SITE_URL,
    500
  ) || "https://www.imancleaningservice.com";
  return `${baseUrl.replace(/\/$/, "")}/manage-booking.html`;
}

function buildManagementMessage() {
  return [
    "IMAN Cleaning Service: To reschedule or cancel your appointment, visit:",
    managementUrl(),
    "Enter your order number, name, and phone number to verify your booking.",
    "Questions? Call 929-232-1930.",
    "Reply STOP to opt out."
  ].join("\n");
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    requireWebhookAuth(request);
    const body = await readJsonBody(request);
    const to = phoneFromPayload(body);
    const delivery = await sendCustomerSms(to, buildManagementMessage());
    if (delivery.status !== "sent") {
      throw Object.assign(new Error(delivery.error || "The booking-management link could not be sent."), { statusCode: 502 });
    }
    const logResult = await safeUpsertCallLog(buildManualCallRow(body, {
      rawEventType: "retell_booking_management_link_sms",
      callType: "booking_management",
      callStatus: "management_link_sent",
      callerPhone: to,
      summary: "Secure rescheduling and cancellation link sent by SMS.",
      source: "retell_booking_management_link"
    }));
    return json(response, 200, {
      sent: true,
      managementUrl: managementUrl(),
      messageId: delivery.messageId,
      callLogged: logResult.logged,
      callLogError: logResult.error || ""
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "The booking-management link could not be sent.",
      setup: error.setup,
      details: error.details
    });
  }
};

module.exports.buildManagementMessage = buildManagementMessage;
module.exports.managementUrl = managementUrl;
