const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const { formatSmsReply, shouldIntroduce, SMS_INTRODUCTION } = require("../api/chat/_sms-agent");

async function testWebhook() {
  const sessions = new Map(), messages = [], aiCalls = [];
  const customer = "+12025550101", business = "+12025550102";
  const answer = "Please call (929) 232-1930 and ask to speak with a person.";
  let now = Date.now();
  const shared = {
    cleanText: (value, max) => String(value || "").trim().slice(0, max),
    normalizePhoneNumber: (value) => value,
    getOwnerPhoneNumbers: () => [],
    getSiteUrl: () => "https://example.test",
    readFormBody: async (request) => request.form,
    getLatestActiveSessionByContact: async (phone) => sessions.get(phone) || null,
    getTeamSmsSessionByContact: async () => null,
    isTeamSmsSessionActive: () => false,
    createSession: async (data) => {
      const session = { id: `session_${sessions.size}`, visitor_contact: data.visitorContact, page_url: data.pageUrl, updated_at: new Date(now).toISOString() };
      sessions.set(data.visitorContact, session);
      return session;
    },
    findClientMessage: async (sessionId, id) => messages.find(m => m.session_id === sessionId && m.client_message_id === id),
    saveMessage: async (data) => {
      const message = { session_id: data.sessionId, client_message_id: data.clientMessageId, body: data.body, created_at: new Date(now).toISOString() };
      messages.push(message);
      return message;
    },
    updateSession: async (id, updates) => {
      const session = [...sessions.values()].find(s => s.id === id);
      Object.assign(session, updates, { updated_at: new Date(now).toISOString() });
      return session;
    },
    twiml: (response, body = "") => { response.body = body; }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../api/chat/[action]"), "utf8"), {
    module, URL, Date, console, process: { env: {} },
    require(name) {
      if (name === "./_shared") return shared;
      if (name === "twilio") return { validateRequest: () => true };
      if (name === "./_sms-agent") return {
        replyToCustomer: async (params) => {
          aiCalls.push({ ...params });
          return formatSmsReply(`${SMS_INTRODUCTION} ${answer}`, shouldIntroduce({ ...params, now }));
        }
      };
      throw new Error(`Unexpected dependency: ${name}`);
    }
  });
  const handler = module.exports;
  async function incoming(phone, sid, body = "Can I speak with a person?") {
    const response = {};
    await handler({ method: "POST", query: { action: "twilio-webhook" }, headers: {}, form: { From: phone, To: business, MessageSid: sid, Body: body } }, response);
    return response.body;
  }
  assert.equal(await incoming(customer, "first"), `${SMS_INTRODUCTION}\n\n${answer}`);
  assert.equal(aiCalls[0].lastCustomerMessageAt, undefined);
  const firstTime = sessions.get(customer).last_visitor_message_at;
  now += 15 * 60_000;
  assert.equal(await incoming(customer, "second"), answer);
  assert.equal(aiCalls[1].lastCustomerMessageAt, firstTime);
  assert.equal(aiCalls[1].lastAssistantMessageAt, firstTime);
  now += 20 * 60_000;
  assert.equal(await incoming(customer, "third"), answer); // 35m total, not idle.
  assert.equal(await incoming(customer, "third"), answer); // Retry uses saved reply.
  assert.equal(aiCalls.length, 3);
  now += 30 * 60_000;
  assert.equal(await incoming(customer, "fourth"), `${SMS_INTRODUCTION}\n\n${answer}`);
  now += 60_000;
  assert.equal(await incoming(customer, "fifth"), answer);
  assert.equal(await incoming("+12025550103", "other_customer"), `${SMS_INTRODUCTION}\n\n${answer}`);
  assert.equal(sessions.size, 2);
  assert.equal(messages.length, 12); // All six incoming/reply pairs retained.
  assert.equal(await incoming(customer, "opt_out", "STOP"), "");
  assert.equal(aiCalls.length, 6); // Opt-out does not generate a greeting or AI reply.
}

testWebhook().then(() => console.log("SMS webhook greeting timestamps, retries, opt-out and customer isolation tests passed.")).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
