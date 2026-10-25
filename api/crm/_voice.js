const twilio = require("twilio");

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw Object.assign(new Error(`${name} is not configured.`), { statusCode: 503 });
  return value;
}

function normalizeDialNumber(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  throw Object.assign(new Error("Enter a valid 10-digit U.S. or Canadian phone number."), { statusCode: 400 });
}

const VOICE_APP_NAME = "IMAN CRM Browser Dialer";
const SESSION_KEY_NAME = "IMAN CRM Browser Dialer Session";
let cachedCredential = null;

async function provisionVoiceCredential() {
  const accountSid = requiredEnv("TWILIO_ACCOUNT_SID");
  const authToken = requiredEnv("TWILIO_AUTH_TOKEN");
  const configuredKeySid = String(process.env.TWILIO_API_KEY_SID || "").trim();
  const configuredKeySecret = String(process.env.TWILIO_API_KEY_SECRET || "").trim();
  const configuredAppSid = String(process.env.TWILIO_TWIML_APP_SID || "").trim();
  if (configuredKeySid && configuredKeySecret && configuredAppSid) {
    return { apiKeySid: configuredKeySid, apiKeySecret: configuredKeySecret, twimlAppSid: configuredAppSid };
  }
  if (cachedCredential && cachedCredential.expiresAt > Date.now()) return cachedCredential;

  const client = twilio(accountSid, authToken);
  const voiceUrl = `${String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || "https://www.imancleaningservice.com").replace(/\/$/, "")}/api/crm/voice-call`;
  const applications = await client.applications.list({ limit: 100 });
  let application = applications.find((item) => item.friendlyName === VOICE_APP_NAME);
  if (application) {
    application = await client.applications(application.sid).update({ voiceUrl, voiceMethod: "POST" });
  } else {
    application = await client.applications.create({ friendlyName: VOICE_APP_NAME, voiceUrl, voiceMethod: "POST" });
  }

  const staleBefore = Date.now() - (2 * 60 * 60 * 1000);
  const keys = await client.keys.list({ limit: 100 });
  await Promise.all(keys
    .filter((key) => key.friendlyName === SESSION_KEY_NAME && new Date(key.dateCreated).getTime() < staleBefore)
    .map((key) => client.keys(key.sid).remove().catch(() => false)));
  const key = await client.newKeys.create({ friendlyName: SESSION_KEY_NAME });
  cachedCredential = {
    apiKeySid: key.sid,
    apiKeySecret: key.secret,
    twimlAppSid: application.sid,
    expiresAt: Date.now() + (50 * 60 * 1000)
  };
  return cachedCredential;
}

async function createBrowserVoiceToken() {
  const accountSid = requiredEnv("TWILIO_ACCOUNT_SID");
  const { apiKeySid, apiKeySecret, twimlAppSid } = await provisionVoiceCredential();
  const fromNumber = normalizeDialNumber(requiredEnv("TWILIO_FROM_NUMBER"));
  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity: "iman-crm-owner",
    ttl: 3600
  });
  token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: twimlAppSid }));
  return { token: token.toJwt(), identity: "iman-crm-owner", expiresIn: 3600, fromNumber };
}

async function readFormBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return Object.fromEntries(new URLSearchParams(request.body));
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32768) throw Object.assign(new Error("Request is too large."), { statusCode: 413 });
  }
  return Object.fromEntries(new URLSearchParams(body));
}

function webhookUrl(request) {
  const siteUrl = String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || "").replace(/\/$/, "");
  if (siteUrl) return `${siteUrl}/api/crm/voice-call`;
  const protocol = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${protocol}://${host}/api/crm/voice-call`;
}

async function handleVoiceCall(request, response) {
  if (request.method !== "POST") {
    response.statusCode = 405;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    return response.end(JSON.stringify({ error: "Method not allowed." }));
  }

  const params = await readFormBody(request);
  const signature = String(request.headers["x-twilio-signature"] || "");
  const valid = twilio.validateRequest(requiredEnv("TWILIO_AUTH_TOKEN"), signature, webhookUrl(request), params);
  if (!valid) {
    response.statusCode = 403;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    return response.end(JSON.stringify({ error: "Invalid Twilio signature." }));
  }

  const destination = normalizeDialNumber(params.To);
  const fromNumber = normalizeDialNumber(requiredEnv("TWILIO_FROM_NUMBER"));
  if (destination === fromNumber) {
    throw Object.assign(new Error("The business number cannot call itself."), { statusCode: 400 });
  }

  const twiml = new twilio.twiml.VoiceResponse();
  const dial = twiml.dial({ callerId: fromNumber, answerOnBridge: true, timeout: 30 });
  dial.number(destination);
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/xml; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  return response.end(twiml.toString());
}

module.exports = { createBrowserVoiceToken, handleVoiceCall, normalizeDialNumber, provisionVoiceCredential, webhookUrl };
