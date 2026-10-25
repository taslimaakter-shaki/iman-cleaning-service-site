const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { toClientCall } = require("../api/crm/_calls");

process.env.TWILIO_FROM_NUMBER = "+19292321930";
const business = process.env.TWILIO_FROM_NUMBER;
const record = (id, direction, caller, recipient) => toClientCall({
  conversation_id: id, call_direction: direction, caller_phone: caller, recipient_phone: recipient,
  customer_name: `Customer ${id}`, call_started_at: "2030-01-01T15:00:00Z", call_duration_seconds: 60
});
const inbound = record("in", "inbound", "+12125550123", business);
const outbound = record("out", "outbound", business, "+17185550199");
assert.equal(inbound.callbackPhone, "+12125550123");
assert.equal(outbound.callbackPhone, "+17185550199");
assert.equal(record("api", "outbound-api", business, "+17185550199").callbackPhone, outbound.callbackPhone);
assert.equal(record("legacy", "", "(212) 555-0123", business).callbackPhone, inbound.callbackPhone);
for (const row of [record("missing", "inbound", "", business), record("missing-out", "outbound", business, ""),
  record("private", "inbound", "anonymous", business), record("invalid", "inbound", "555", business),
  record("international", "inbound", "+442079460123", business), record("self", "inbound", business, business)]) {
  assert.equal(row.callbackPhone, "", `${row.id} must never call the business number or guess a destination`);
}

class Element {
  constructor() { this.nodes = {}; this.listeners = {}; this.dataset = {}; this.innerHTML = ""; this.textContent = ""; this.value = ""; this.classList = { add(){}, remove(){}, toggle(){} }; }
  querySelector(key) { return this.nodes[key] ||= new Element(); }
  querySelectorAll() { return []; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  focus() {} contains() { return false; } showModal() { this.open = true; } close() { this.open = false; }
}
const document = new Element(), requests = [], connections = [], callEvents = {};
let releaseToken, refreshed = 0;
const window = { navigator: {}, matchMedia: () => ({ matches: false }), ImanTwilioVoice: { Device: class {
  on() {} updateToken() {}
  async connect(args) { connections.push(args); return { on(name, fn) { callEvents[name] = fn; }, disconnect() {} }; }
} } };
const context = { document, window, navigator: { userAgent: "Test", platform: "Test" },
  sessionStorage: { getItem: () => "" }, localStorage: { getItem: () => "" }, setTimeout: () => 1, clearTimeout() {}, console,
  fetch: async (url, options) => {
    requests.push({ url, ...options });
    assert.equal(options.headers["x-admin-token"], "mock-admin");
    if (url === "/api/crm/voice-token") { await new Promise(resolve => { releaseToken = resolve; }); return { ok: true, json: async () => ({ token: "mock-only" }) }; }
    assert.equal(url, "/api/crm/customer-call", "All network access is mocked; no actual calls or messages");
    return { ok: true, json: async () => ({ call: { conversation_id: "mock-new-call" } }) };
  }
};
const source = fs.readFileSync(path.join(__dirname, "../crm.js"), "utf8");
context.refreshed = () => { refreshed++; };
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, "loadBookings = async () => refreshed(); window.test = { state, renderCalls, openCall, callBack, callBackButton, customerHistoryMarkup, startOutboundCall, openDialer };})();"), context);
const api = window.test, node = selector => document.querySelector(selector);
api.state.token = "mock-admin";
api.state.calls = [inbound, outbound, record("missing", "inbound", "", business)];
api.renderCalls();
for (const selector of ["[data-calls-table]", "[data-mobile-calls]"]) {
  const markup = node(selector).innerHTML;
  assert.match(markup, /data-call-back="in"/); assert.match(markup, /data-call-back="out"/);
  assert.match(markup, /data-open-call="in"/); assert.doesNotMatch(markup, /data-call-back="missing"/);
  assert.match(markup, /Callback unavailable/);
}
assert.match(api.customerHistoryMarkup(inbound.phone), /data-call-back="in"/);
api.openCall("in"); assert.match(node("[data-booking-detail]").innerHTML, /data-call-back="in"/);
assert.match(api.callBackButton({ ...inbound, customerName: '<img src=x onerror="bad()">' }), /&lt;img/);
assert.doesNotMatch(api.callBackButton({ ...inbound, customerName: '<img src=x>' }), /<img/);

const click = id => { for (const fn of document.listeners.click) fn({ target: { closest: selector => selector === "[data-call-back]" ? { dataset: { callBack: id } } : null } }); };
click("out");
const number = node("[data-dialer-number]"), dialer = node("[data-dialer-dialog]");
assert.equal(number.value, outbound.callbackPhone); assert.equal(number.readOnly, true);
assert.equal(dialer.dataset.sourceId, "out"); assert.equal(dialer.dataset.sourceType, "Call history");
assert.equal(requests.length, 0, "Opening callback is a confirmation step, not an automatic call");
click("in"); assert.equal(number.value, inbound.callbackPhone);
api.callBack("missing"); api.callBack("stale-record"); assert.equal(number.value, inbound.callbackPhone);
assert.equal(requests.length, 0);
api.state.search = "Customer out"; api.renderCalls();
assert.doesNotMatch(node("[data-calls-table]").innerHTML, /data-call-back="in"/);
api.state.search = "";

(async () => {
  const form = { elements: { phoneNumber: number } };
  const connecting = api.startOutboundCall(form);
  click("out"); await api.startOutboundCall(form);
  assert.equal(number.value, inbound.callbackPhone, "A pending call must not be retargeted");
  assert.equal(requests.length, 1, "Repeated start clicks create only one request");
  releaseToken(); await connecting;
  assert.equal(connections.length, 1); assert.equal(connections[0].params.To, inbound.callbackPhone);
  const started = JSON.parse(requests.find(request => request.method === "POST").body);
  assert.equal(started.phone, inbound.callbackPhone); assert.equal(started.sourceId, "in");
  assert.equal(started.sourceType, "Call history"); assert.equal(started.customerName, inbound.customerName);
  click("out"); await api.startOutboundCall(form);
  assert.equal(connections.length, 1, "An active call cannot start a second call");
  assert.equal(number.value, inbound.callbackPhone);
  callEvents.disconnect(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(requests.find(request => request.method === "PATCH").body).callId, "mock-new-call");
  assert.equal(refreshed, 1, "Callback completion refreshes the existing call history");
  click("out"); assert.equal(number.value, outbound.callbackPhone); assert(number.readOnly);
  api.openDialer(""); assert.equal(number.readOnly, false, "Manual dialer stays editable");
  console.log("Call-history callbacks: inbound/outbound customer binding, desktop/mobile/detail/history actions, missing/private/self numbers, escaping, filtering, locked dialer, repeat-click protection and call logging passed (mocks only).");
})().catch(error => { console.error(error); process.exitCode = 1; });
