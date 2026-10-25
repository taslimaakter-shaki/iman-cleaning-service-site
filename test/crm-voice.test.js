const assert = require("assert");
const twilio = require("twilio");
const { createBrowserVoiceToken, handleVoiceCall, normalizeDialNumber } = require("../api/crm/_voice");

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; return body; }
  };
}

async function run() {
  assert.equal(normalizeDialNumber("(212) 555-0123"), "+12125550123");
  assert.equal(normalizeDialNumber("1-718-555-0199"), "+17185550199");
  assert.throws(() => normalizeDialNumber("555"), /10-digit/);

  Object.assign(process.env, {
    TWILIO_ACCOUNT_SID: `AC${"1".repeat(32)}`,
    TWILIO_API_KEY_SID: `SK${"2".repeat(32)}`,
    TWILIO_API_KEY_SECRET: "test-secret",
    TWILIO_TWIML_APP_SID: `AP${"3".repeat(32)}`,
    TWILIO_AUTH_TOKEN: "test-auth-token",
    TWILIO_FROM_NUMBER: "+19292321930",
    PUBLIC_SITE_URL: "https://www.imancleaningservice.com"
  });

  const issued = await createBrowserVoiceToken();
  assert.equal(issued.fromNumber, "+19292321930");
  assert.equal(issued.token.split(".").length, 3);

  const url = "https://www.imancleaningservice.com/api/crm/voice-call";
  const params = { To: "+12125550123", AccountSid: process.env.TWILIO_ACCOUNT_SID };
  const request = {
    method: "POST",
    body: params,
    headers: { "x-twilio-signature": twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params) }
  };
  const response = responseRecorder();
  await handleVoiceCall(request, response);
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /callerId="\+19292321930"/);
  assert.match(response.body, /<Number>\+12125550123<\/Number>/);

  const rejected = responseRecorder();
  await handleVoiceCall({ ...request, headers: { "x-twilio-signature": "invalid" } }, rejected);
  assert.equal(rejected.statusCode, 403);

  console.log("CRM browser voice tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
