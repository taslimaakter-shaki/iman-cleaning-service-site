const { json, readJsonBody } = require("../booking/_shared");
const { sendCustomerSms } = require("../booking/_notifications");
const { phoneFromPayload, requireWebhookAuth } = require("../quote/_send-link");
const { buildManualCallRow, safeUpsertCallLog } = require("../receptionist/_shared");

const CONCERN_URL = "https://www.imancleaningservice.com/service-concern.html";

function buildConcernMessage() {
  return [
    "Iman Cleaning Service: We're sorry to hear about your service concern.",
    "Please complete this form so our team can review the matter:",
    CONCERN_URL,
    "You can describe the issue and upload photos or supporting information.",
    "Questions? Call 929-232-1930. Reply STOP to opt out."
  ].join("\n");
}

function recipientFromPayload(body) {
  const value = phoneFromPayload(body);
  // Reject missing caller ID and unresolved template variables before contacting Twilio.
  if (!/^[+\d().\s-]+$/.test(value)) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (value.startsWith("+") && /^[1-9]\d{10,14}$/.test(digits)) return `+${digits}`;
  return "";
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { sent: false, error: "Method not allowed." });
    requireWebhookAuth(request);
    const body = await readJsonBody(request);
    const to = recipientFromPayload(body);
    if (!to) return json(response, 400, { sent: false, error: "A valid caller phone number is required." });

    const delivery = await sendCustomerSms(to, buildConcernMessage());
    if (delivery.status !== "sent" || !delivery.messageId) {
      return json(response, 502, { sent: false, error: delivery.error || "The service-concern link could not be sent." });
    }
    // A logging failure must not turn an accepted SMS into a failed response/retry.
    const logResult = await safeUpsertCallLog(buildManualCallRow(body, {
      rawEventType: "retell_service_concern_link_sms",
      callType: "service_concern",
      callStatus: "concern_link_sent",
      callerPhone: to,
      summary: "Service-concern form link accepted by Twilio for SMS delivery.",
      source: "retell_service_concern_link"
    }));
    return json(response, 200, {
      sent: true,
      deliveryStatus: "accepted",
      concernUrl: CONCERN_URL,
      messageId: delivery.messageId,
      callLogged: logResult.logged
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      sent: false,
      error: error.message || "The service-concern link could not be sent."
    });
  }
};

module.exports.buildConcernMessage = buildConcernMessage;
module.exports.recipientFromPayload = recipientFromPayload;
