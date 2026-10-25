const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const notifications = require("../api/booking/_notifications");
const receptionist = require("../api/receptionist/_shared");
const originalSms = notifications.sendCustomerSms;
const originalLog = receptionist.safeUpsertCallLog;
const originalSecret = process.env.QUOTE_LINK_WEBHOOK_SECRET;
const sends = [];
const logs = [];
let result = { status: "sent", messageId: "SM_test" };
notifications.sendCustomerSms = async (to, body) => {
  sends.push({ to, body });
  if (result instanceof Error) throw result;
  return result;
};
receptionist.safeUpsertCallLog = async (row) => {
  logs.push(row);
  return { logged: false, error: "Test logging outage" };
};
const handler = require("../api/service-concern/[action]");
const { recipientFromPayload, buildConcernMessage } = require("../api/service-concern/_send-link");
notifications.sendCustomerSms = originalSms;
receptionist.safeUpsertCallLog = originalLog;

async function request(method, body, headers = { "x-iman-webhook-secret": "test-secret" }, action = "send-link") {
  const req = Readable.from(body === undefined ? [] : [typeof body === "string" ? body : JSON.stringify(body)]);
  req.method = method;
  req.query = { action };
  req.headers = headers;
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); } };
  await handler(req, res);
  return res;
}

(async () => {
  process.env.QUOTE_LINK_WEBHOOK_SECRET = "test-secret";
  assert.equal((await request("GET")).statusCode, 405);
  assert.equal((await request("POST", { to: "2025550100" }, {})).statusCode, 401);
  assert.equal((await request("POST", {}, { "x-iman-webhook-secret": "wrong" })).statusCode, 401);
  for (const to of ["", "{{user_number}}", "anonymous", "123", "+bad12345678901", "01234567890123456789"]) {
    assert.equal((await request("POST", { to })).statusCode, 400);
  }
  assert.equal((await request("POST", "{bad json")).statusCode, 400);
  assert.equal(sends.length, 0);
  assert.equal(logs.length, 0);
  assert.equal(recipientFromPayload({ call: { from_number: "+12025550100" } }), "+12025550100");
  const accepted = await request("POST", { args: { to: "(202) 555-0100" }, call: { call_id: "test-call" } });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.sent, true);
  assert.equal(accepted.body.deliveryStatus, "accepted");
  assert.equal(accepted.body.callLogged, false, "logging outages must not trigger another SMS send");
  assert.equal(sends[0].to, "+12025550100");
  assert.match(sends[0].body, /https:\/\/www\.imancleaningservice\.com\/service-concern\.html/);
  assert.doesNotMatch(sends[0].body, /book-now|manage-booking/);
  assert.match(buildConcernMessage(), /Reply STOP to opt out/);
  assert.equal(logs[0].call_type, "service_concern");
  assert.equal((await request("POST", { call: { from_number: "+12025550101" } }, { authorization: "Bearer test-secret" })).statusCode, 200);
  for (const failure of [{ status: "failed", error: "Recipient opted out" }, { status: "not_configured" }, { status: "sent", messageId: "" }, new Error("SMS provider unavailable")]) {
    result = failure;
    const rejected = await request("POST", { to: "2025550100" });
    assert.ok(rejected.statusCode >= 500);
    assert.equal(rejected.body.sent, false);
  }
  assert.equal(logs.length, 2, "only accepted texts may be logged as sent");
  assert.equal((await request("POST", {}, undefined, "not-a-route")).statusCode, 404);
  delete process.env.QUOTE_LINK_WEBHOOK_SECRET;
  assert.equal((await request("POST", { to: "2025550100" })).statusCode, 503);
  console.log("Service-concern SMS tests passed: routing, auth, recipient validation, correct link, provider failures and safe logging.");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (originalSecret === undefined) delete process.env.QUOTE_LINK_WEBHOOK_SECRET;
  else process.env.QUOTE_LINK_WEBHOOK_SECRET = originalSecret;
});
