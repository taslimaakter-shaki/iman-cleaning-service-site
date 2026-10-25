const assert = require("assert");
const {
  AGENT_PROMPT,
  FALLBACK_REPLY,
  WEBSITE_KNOWLEDGE_BASE_NAME,
  WEBSITE_KNOWLEDGE_URLS,
  extractAgentReply,
  findOrCreateChat,
  latestPublishedChatVersion,
  CONVERSATION_IDLE_MS,
  SMS_INTRODUCTION,
  shouldIntroduce,
  formatSmsReply,
  replyToCustomer
} = require("../api/chat/_sms-agent");

assert.match(AGENT_PROMPT, /virtual assistant/i);
assert.match(AGENT_PROMPT, /book-now\.html/);
assert.match(AGENT_PROMPT, /manage-booking\.html/);
assert.match(AGENT_PROMPT, /service-concern\.html/);
assert.match(AGENT_PROMPT, /call 929-232-1930/i);
assert.match(FALLBACK_REPLY, /929-232-1930/);
assert.match(FALLBACK_REPLY, /ask to speak with a person/);
assert.equal(WEBSITE_KNOWLEDGE_BASE_NAME, "IMAN Approved Website");
assert.ok(WEBSITE_KNOWLEDGE_URLS.includes("https://www.imancleaningservice.com/faq.html"));
assert.ok(!WEBSITE_KNOWLEDGE_URLS.some((url) => /crm|account|booking-confirmed|quote-payment/i.test(url)));
assert.equal(extractAgentReply({ messages: [{ role: "user", content: "Hi" }, { role: "agent", content: "How can I help?" }] }), "How can I help?");
assert.equal(extractAgentReply({ messages: [] }), "");

async function testPublishedChatSessions() {
  const agentId = "agent_test_sms";
  const customer = "+12025550101";
  const business = "+12025550102";
  let current = { version: 1, is_published: true };
  let versions = [];
  let sessions = [];
  const created = [];
  const retell = {
    chatAgent: {
      retrieve: async (id) => { assert.equal(id, agentId); return current; },
      getVersions: async () => versions
    },
    chat: {
      list: async (params) => {
        assert.deepEqual(params.filter_criteria.agent, [{ agent_id: agentId, version: [current.is_published ? current.version : 1] }]);
        return { items: sessions };
      },
      create: async (params) => {
        created.push(params);
        return { chat_id: `chat_new_${created.length}` };
      }
      // No SMS, end, delete, or publishing methods: migration must not call them.
    }
  };
  const session = (overrides = {}) => ({
    agent_id: agentId,
    version: 1,
    chat_id: "chat_current",
    chat_status: "ongoing",
    start_timestamp: Date.now(),
    metadata: { channel: "twilio_sms", customer_phone: customer, business_phone: business },
    ...overrides
  });

  sessions = [session({ version: 0, chat_id: "chat_old_voice" })];
  assert.equal(await findOrCreateChat(retell, agentId, customer, business), "chat_new_1");
  assert.equal(created[0].agent_version, 1);
  assert.equal(created[0].metadata.customer_phone, customer);
  assert.equal(sessions[0].chat_id, "chat_old_voice"); // History untouched.

  sessions = [session()];
  assert.equal(await findOrCreateChat(retell, agentId, customer, business), "chat_current");
  assert.equal(created.length, 1);

  // Publishing a new version must take effect even for a previously reused chat.
  current = { version: 2, is_published: true };
  assert.equal(await findOrCreateChat(retell, agentId, customer, business), "chat_new_2");
  assert.equal(created[1].agent_version, 2);
  current = { version: 1, is_published: true };

  for (const invalid of [
    { chat_status: "ended" },
    { chat_status: "error" },
    { agent_id: "agent_different" },
    { version: null },
    { start_timestamp: Date.now() - 73 * 60 * 60 * 1000 },
    { metadata: { channel: "twilio_sms", customer_phone: "+12025550103", business_phone: business } },
    { metadata: { channel: "twilio_sms", customer_phone: customer, business_phone: "+12025550104" } },
    { metadata: { channel: "website", customer_phone: customer, business_phone: business } }
  ]) {
    sessions = [session(invalid)];
    const count = created.length;
    await findOrCreateChat(retell, agentId, customer, business);
    assert.equal(created.length, count + 1);
  }

  // An unfinished draft is never silently published or selected for customers.
  current = { version: 2, is_published: false };
  versions = [current, { version: 0, is_published: true }, { version: 1, is_published: true }];
  assert.equal(await latestPublishedChatVersion(retell, agentId), 1);
  sessions = [session()];
  assert.equal(await findOrCreateChat(retell, agentId, customer, business), "chat_current");
  versions = [current];
  await assert.rejects(() => latestPublishedChatVersion(retell, agentId), /no published training/);
  current = { version: 0, is_published: true };
  assert.equal(await latestPublishedChatVersion(retell, agentId), 0);
}

async function testConversationIntroductions() {
  const start = Date.parse("2026-09-10T14:00:00Z");
  const history = (at) => ({ lastCustomerMessageAt: new Date(at).toISOString(), lastAssistantMessageAt: new Date(at + 1000).toISOString() });
  assert.equal(CONVERSATION_IDLE_MS, 30 * 60 * 1000);
  assert.equal(shouldIntroduce({ now: start }), true);
  for (const gap of [1, 60_000, 15 * 60_000, CONVERSATION_IDLE_MS - 1]) {
    assert.equal(shouldIntroduce({ ...history(start), now: start + gap }), false);
  }
  for (const gap of [CONVERSATION_IDLE_MS, CONVERSATION_IDLE_MS + 1, 8 * 60 * 60_000]) {
    assert.equal(shouldIntroduce({ ...history(start), now: start + gap }), true);
  }
  assert.equal(shouldIntroduce({ lastCustomerMessageAt: "invalid", now: start }), true);
  assert.equal(shouldIntroduce({ lastCustomerMessageAt: new Date(start).toISOString(), now: start }), true);
  const answer = "Please call (929) 232-1930 and ask to speak with a person.";
  const linkAnswer = "You can book here: https://www.imancleaningservice.com/book-now.html";
  for (const opening of [SMS_INTRODUCTION, "Hi, I am Fatimah, IMAN Cleaning Service's virtual assistant.", "Hello! I’m Fatimah, IMAN Cleaning Service’s virtual assistant."]) {
    assert.equal(formatSmsReply(`${opening}\n${answer}`, false), answer);
    assert.equal(formatSmsReply(`${opening} ${linkAnswer}`, true), `${SMS_INTRODUCTION}\n\n${linkAnswer}`);
  }
  assert.equal(formatSmsReply(answer, false), answer);
  assert.equal(formatSmsReply(linkAnswer, true), `${SMS_INTRODUCTION}\n\n${linkAnswer}`);
  assert.equal(formatSmsReply(`${SMS_INTRODUCTION} ${SMS_INTRODUCTION} ${answer}`, false), answer);
  assert.equal(formatSmsReply("You can ask Fatimah about services.", false), "You can ask Fatimah about services.");
  assert.equal(formatSmsReply(SMS_INTRODUCTION, false, true), SMS_INTRODUCTION);

  // Exercise the complete reply path with durable CRM timestamps, not just a
  // prompt or an in-process cache. No actual SMS is sent by these mock clients.
  const customer = "+12025550101", business = "+12025550102", agentId = "agent_test_sms";
  let sessions = [], created = 0, version = 2, now = start;
  const completionChats = [];
  const retell = {
    chatAgent: { retrieve: async () => ({ version, is_published: true }) },
    chat: {
      list: async () => ({ items: sessions }),
      create: async (params) => {
        const chat = { agent_id: agentId, chat_id: `test_${++created}`, version: params.agent_version, chat_status: "ongoing", start_timestamp: Date.now(), metadata: params.metadata };
        sessions.unshift(chat);
        return chat;
      },
      createChatCompletion: async ({ chat_id }) => {
        completionChats.push(chat_id);
        // Deliberately repeat the OLD model opening to test the server guard.
        return { messages: [{ role: "agent", content: `${SMS_INTRODUCTION} ${answer}` }] };
      }
    }
  };
  let previous = {};
  async function textAt(time, expectIntroduction) {
    now = time;
    const result = await replyToCustomer({ from: customer, to: business, body: "Can I speak with a person?", ...previous }, { getAgent: async () => ({ agentId, retell }), now });
    assert.equal(result, expectIntroduction ? `${SMS_INTRODUCTION}\n\n${answer}` : answer);
    previous = history(time);
  }
  await textAt(start, true);
  await textAt(start + 5 * 60_000, false);
  await textAt(start + 15 * 60_000, false);
  await textAt(start + 35 * 60_000, false); // 35 minutes total, only 20 idle.
  assert.equal(created, 1);
  assert.equal(new Set(completionChats).size, 1);
  await textAt(start + 65 * 60_000, true); // Exactly 30 minutes of inactivity.
  assert.equal(created, 2);
  await textAt(start + 66 * 60_000, false);
  version = 3; // Publishing new training cannot cause another introduction.
  await textAt(start + 67 * 60_000, false);
  assert.equal(created, 3);
  sessions[0].chat_status = "ended";
  await textAt(start + 68 * 60_000, false); // Ending a Retell chat is not 30m idle.
  assert.equal(created, 4);
  await textAt(start + 8 * 60 * 60_000, true); // Returning in the evening.
  await textAt(start + 8 * 60 * 60_000 + 60_000, false);
  assert.equal(created, 5);

  // Finding a customer's ongoing session is not limited to the first 100 chats.
  const current = sessions[0];
  const pages = [];
  retell.chat.list = async (params) => {
    pages.push(params.pagination_key);
    return params.pagination_key ? { items: [current] } : { items: [], has_more: true, pagination_key: "second_page" };
  };
  assert.equal(await findOrCreateChat(retell, agentId, customer, business), current.chat_id);
  assert.deepEqual(pages, [undefined, "second_page"]);
  assert.equal(sessions.length, 5); // Old customer history has not been deleted.
}

Promise.resolve().then(testPublishedChatSessions).then(testConversationIntroductions).then(() => {
  console.log("SMS messaging agent, published-version sessions and 30-minute introduction tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
