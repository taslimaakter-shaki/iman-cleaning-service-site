const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const crypto = require("node:crypto");
const twilio = require("twilio");
const { buildConversationRecords } = require("../api/crm/_conversations")._test;

const business = "+12025550102", customer = "+12025550101", other = "+12025550103";
const env = {
  SUPABASE_URL: "https://db.example.test", SUPABASE_SERVICE_ROLE_KEY: "test-db-key",
  TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "test-token", TWILIO_FROM_NUMBER: business,
  OWNER_SMS_TO: "+12025550104", PUBLIC_SITE_URL: "https://example.test"
};
function harness() {
  const sessions = [], messages = [], outbound = [], ai = [], queries = [];
  let now = Date.parse("2030-01-01T12:00:00Z"), failStorage = false, failSend = false, nextId = 1;
  let duringAi = null;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const equal = (url, field, value) => !url.searchParams.has(field) || url.searchParams.get(field) === `eq.${value}`;
  const result = (data, ok = true) => ({ok, status: ok ? 200 : 503, text: async () => JSON.stringify(data)});
  async function fetch(url, options = {}) {
    const u = new URL(url), method = options.method || "GET";
    if (u.hostname === "api.twilio.com") {
      assert.equal(method, "POST");
      if (failSend) return result({message: "SMS failed"}, false);
      const body = new URLSearchParams(options.body);
      outbound.push(Object.fromEntries(body));
      return result({sid: `SM${outbound.length}`});
    }
    assert.equal(u.hostname, "db.example.test", "Tests must never access real providers");
    queries.push({url: u, method});
    if (failStorage) return result({message: "Storage unavailable"}, false);
    const table = u.pathname.split("/").at(-1);
    const rows = table === "live_chat_sessions" ? sessions : messages;
    if (method === "POST") {
      const row = JSON.parse(options.body);
      if (table === "live_chat_messages") Object.assign(row, {id: nextId++, created_at: new Clock().toISOString()});
      rows.push(row); return result([row]);
    }
    if (method === "PATCH") {
      const row = rows.find(row => equal(u, "id", row.id));
      assert(row); Object.assign(row, JSON.parse(options.body), {updated_at: new Clock().toISOString()});
      return result([row]);
    }
    assert.equal(method, "GET");
    if (u.searchParams.get("select") === "created_at,session:live_chat_sessions!inner(*)") {
      assert.equal(table, "live_chat_messages");
      assert.equal(u.searchParams.get("sender"), "eq.owner");
      assert.equal(u.searchParams.get("client_message_id"), "like.crm-out:*");
      assert.equal(u.searchParams.get("limit"), "1");
      assert(!u.searchParams.has("session.status"), "Closed conversations stay with the team");
      const contact = u.searchParams.get("session.visitor_contact").slice(3);
      const pageFilter = u.searchParams.get("session.or");
      const expectedPage = pageFilter.match(/page_url.eq.([^,)]+)/)[1];
      const allowLegacy = pageFilter.includes("page_url.not.like.sms:*");
      const match = messages.toReversed().find(message => {
        const session = sessions.find(s => s.id === message.session_id);
        return message.sender === "owner" && message.client_message_id.startsWith("crm-out:") &&
          session?.visitor_contact === contact && (session.page_url === expectedPage ||
            (allowLegacy && !session.page_url.startsWith("sms:")));
      });
      return result(match ? [{created_at: match.created_at, session: sessions.find(s => s.id === match.session_id)}] : []);
    }
    let matches = rows.filter(row => ["id", "short_code", "visitor_contact", "status", "session_id", "client_message_id"].every(field => equal(u, field, row[field])));
    if (u.searchParams.get("order")?.includes("desc")) matches = matches.toReversed();
    return result(matches.slice(0, Number(u.searchParams.get("limit") || matches.length)));
  }
  function load(file, dependencies) {
    const module = {exports: {}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), {
      module, exports: module.exports, URL, URLSearchParams, Buffer, Date: Clock, fetch,
      process: {env}, console: {error() {}}, require: name => {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        throw new Error(`Unexpected dependency: ${name}`);
      }
    }, {filename: file});
    return module.exports;
  }
  const shared = load("api/chat/_shared.js", {crypto});
  const communications = load("api/crm/_communications.js", {crypto, "../chat/_shared": shared});
  const handler = load("api/chat/[action].js", {"./_shared": {...shared, readFormBody: async req => req.form}, twilio,
    "./_sms-agent": {replyToCustomer: async params => {
      ai.push(params); if (duringAi) { const callback = duringAi; duringAi = null; await callback(); }
      return "AI answer";
    }}
  });
  async function incoming({from = customer, to = business, sid, body = "Thanks, when can you come?", action = "twilio-webhook", valid = true, method = "POST"} = {}) {
    const form = {From: from, To: to, Body: body, MessageSid: sid};
    const signature = twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, `${env.PUBLIC_SITE_URL}/api/chat/${action}`, form);
    const response = {headers: {}, setHeader(k,v) {this.headers[k] = v;}, end(body) {this.body = body;}};
    await handler({method, query: {action}, headers: {"x-twilio-signature": valid ? signature : "invalid"}, form}, response);
    return response;
  }
  return {sessions, messages, outbound, ai, queries, shared, communications, incoming,
    advance: ms => now += ms, failStorage: value => failStorage = value, failSend: value => failSend = value,
    duringAi: fn => duringAi = fn};
}

(async () => {
  const h = harness();
  const sent = await h.communications.sendCustomerMessage({phone: customer, customerName: "Example Customer", message: "Your team member here."});
  assert.equal(h.outbound[0].To, customer);
  assert.equal(h.messages[0].sender, "owner");
  assert.match(h.messages[0].client_message_id, /^crm-out:/);
  const assertSilent = async options => {
    const before = h.ai.length;
    const response = await h.incoming(options);
    assert.equal(response.statusCode, 200); assert.equal(response.body, "<Response></Response>");
    assert.equal(h.ai.length, before, "Team-managed replies must never call the AI");
  };
  await assertSilent({sid: "reply1"});
  assert.equal(h.messages.at(-1).session_id, sent.sessionId);
  assert.equal(h.messages.at(-1).sender, "visitor");
  const count = h.messages.length;
  await assertSilent({sid: "reply1"}); assert.equal(h.messages.length, count, "Retry does not duplicate CRM history");
  await assertSilent({sid: "formatted-phone", from: "(202) 555-0101"});
  h.advance(30 * 60_000); await assertSilent({sid: "reply-after-30min"});
  h.advance(5 * 24 * 60 * 60_000); h.sessions[0].status = "closed";
  await assertSilent({sid: "reply-after-5days"}); assert.equal(h.sessions.length, 1);
  const latestActivity = h.sessions[0].last_visitor_message_at;
  await assertSilent({sid: "reply1"});
  assert.equal(h.sessions[0].last_visitor_message_at, latestActivity, "A delayed retry must not roll the inactivity clock backward");
  for (const body of ["YES", "START", "STOP", "HELP"]) await assertSilent({sid: body, body});
  assert.equal(h.outbound.length, 1, "Receiving messages does not send a second team text");
  assert.equal(buildConversationRecords(h.sessions, h.messages)[0].source, "Team text message");
  assert.match((await h.incoming({from: other, sid: "unrelated"})).body, /AI answer/);
  assert.match((await h.incoming({to: "+12025550105", sid: "other-line"})).body, /AI answer/);
  const beforeForged = h.queries.length;
  assert.equal((await h.incoming({sid: "forged", valid: false})).statusCode, 403);
  assert.equal(h.queries.length, beforeForged);
  await assertSilent({sid: "fallback", action: "sms-fallback"});
  assert.equal((await h.incoming({sid: "forged-fallback", action: "sms-fallback", valid: false})).statusCode, 403);
  assert.equal((await h.incoming({method: "GET"})).statusCode, 405);
  h.failStorage(true);
  for (const action of ["twilio-webhook", "sms-fallback"]) {
    const failed = await h.incoming({sid: "db-failure", action});
    assert.equal(failed.statusCode, 503); assert.equal(failed.body, "<Response></Response>");
  }
  h.failStorage(false);

  const legacy = harness();
  const old = await legacy.shared.createSession({visitorContact: customer, pageUrl: "https://example.test/", referrer: "CRM customer message"});
  await legacy.shared.saveMessage({sessionId: old.id, sender: "owner", body: "Earlier team message", clientMessageId: "crm-out:SMold"});
  await legacy.shared.updateSession(old.id, {status: "closed"});
  legacy.advance(5 * 24 * 60 * 60_000);
  assert.equal((await legacy.incoming({sid: "legacy-reply"})).body, "<Response></Response>");
  assert.equal(legacy.messages.at(-1).session_id, old.id); assert.equal(legacy.ai.length, 0);
  await legacy.communications.sendCustomerMessage({phone: customer, message: "Following up."});
  assert.equal(legacy.sessions[0].page_url, `sms:${business}`, "CRM SMS no longer reuses a website channel label");

  const expiring = harness();
  const firstTeam = await expiring.communications.sendCustomerMessage({phone: customer, message: "Team checking in."});
  const sevenDays = 7 * 24 * 60 * 60_000;
  expiring.advance(sevenDays - 1);
  assert.equal((await expiring.incoming({sid: "just-before-expiry"})).body, "<Response></Response>");
  // That customer message resets the inactivity clock; another full week must pass.
  expiring.advance(sevenDays - 1);
  assert(expiring.shared.isTeamSmsSessionActive(await expiring.shared.getTeamSmsSessionByContact(customer, business)));
  expiring.advance(1);
  // A CRM-only update is not a message and must not extend the human-only period.
  await expiring.shared.updateSession(firstTeam.sessionId, {visitor_name: "Updated name"});
  assert.match((await expiring.incoming({sid: "at-expiry"})).body, /AI answer/);
  assert.equal(expiring.ai[0].lastCustomerMessageAt, undefined, "Returning AI starts with a fresh greeting window");
  assert.equal(expiring.ai[0].lastAssistantMessageAt, undefined);
  assert.notEqual(expiring.messages.at(-1).session_id, firstTeam.sessionId);
  assert.match((await expiring.incoming({sid: "next-ai-turn"})).body, /AI answer/);
  assert.equal(expiring.ai.length, 2, "AI remains active after returning, rather than reactivating the old team thread");
  await expiring.communications.sendCustomerMessage({phone: customer, message: "Our team will take it from here."});
  assert.equal((await expiring.incoming({sid: "team-again"})).body, "<Response></Response>");

  const outboundReset = harness();
  await outboundReset.communications.sendCustomerMessage({phone: customer, message: "First message."});
  outboundReset.advance(6 * 24 * 60 * 60_000);
  await outboundReset.communications.sendCustomerMessage({phone: customer, message: "Following up."});
  outboundReset.advance(2 * 24 * 60 * 60_000);
  assert.equal((await outboundReset.incoming({sid: "outbound-extends-timer"})).body, "<Response></Response>");

  const automated = harness();
  const session = await automated.shared.createSession({visitorContact: customer, pageUrl: `sms:${business}`, referrer: "CRM customer message"});
  await automated.shared.saveMessage({sessionId: session.id, sender: "system", body: "Automated quote link", clientMessageId: "sms-out:automation"});
  await automated.shared.saveMessage({sessionId: session.id, sender: "visitor", body: "Fake ownership", clientMessageId: "crm-out:spoof"});
  assert.match((await automated.incoming({sid: "automated-reply"})).body, /AI answer/);
  automated.duringAi(() => automated.communications.sendCustomerMessage({phone: customer, message: "A team member is helping now."}));
  assert.equal((await automated.incoming({sid: "racing-reply"})).body, "<Response></Response>");
  assert(!automated.messages.some(m => m.client_message_id === "sms-out:racing-reply"), "Discard an AI reply if the team took over during generation");

  const failedSend = harness(); failedSend.failSend(true);
  await assert.rejects(failedSend.communications.sendCustomerMessage({phone: customer, message: "Not delivered."}), /SMS failed/);
  assert.equal(failedSend.messages.length, 0, "A failed send is not falsely logged as a delivered team message");
  console.log("Team SMS handling passed: customer isolation; old/closed/legacy history; exact 7-day inactivity expiry, either-side reset, fresh ongoing AI session, team re-takeover; retries, race, fallback, signatures, failed storage/send and automated-message exclusion. Providers mocked.");
})().catch(error => { console.error(error); process.exitCode = 1; });
