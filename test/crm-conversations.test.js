const assert = require("assert");
const { buildConversationRecords, senderLabel, sourceForSession } = require("../api/crm/_conversations")._test;

const sessions = [{
  id: "sms-session",
  short_code: "C12345",
  status: "active",
  visitor_name: "Amina Customer",
  visitor_contact: "+19295550123",
  page_url: "sms:+19292321930",
  referrer: "Retell AI messaging agent",
  created_at: "2026-09-08T12:00:00.000Z",
  updated_at: "2026-09-08T12:02:00.000Z"
}, {
  id: "web-session",
  short_code: "C67890",
  status: "closed",
  visitor_name: "Website Visitor",
  visitor_contact: "visitor@example.com",
  page_url: "https://www.imancleaningservice.com/index.html",
  referrer: "",
  created_at: "2026-09-08T11:00:00.000Z",
  updated_at: "2026-09-08T11:05:00.000Z"
}];

const messages = [{
  id: "reply",
  session_id: "sms-session",
  created_at: "2026-09-08T12:02:00.000Z",
  sender: "system",
  body: "We can help with that."
}, {
  id: "question",
  session_id: "sms-session",
  created_at: "2026-09-08T12:01:00.000Z",
  sender: "visitor",
  body: "Do you offer deep cleaning?"
}, {
  id: "owner-reply",
  session_id: "web-session",
  created_at: "2026-09-08T11:05:00.000Z",
  sender: "owner",
  body: "A team member will call you."
}];

const conversations = buildConversationRecords(sessions, messages);
assert.equal(conversations.length, 2);
assert.equal(conversations[0].source, "AI text message");
assert.equal(conversations[0].messageCount, 2);
assert.equal(conversations[0].messages[0].body, "Do you offer deep cleaning?");
assert.equal(conversations[0].messages[1].senderLabel, "AI assistant");
assert.equal(conversations[0].lastMessage, "We can help with that.");
assert.equal(conversations[1].source, "Website chat");
assert.equal(senderLabel("visitor"), "Customer");
assert.equal(senderLabel("owner"), "Team member");
assert.equal(senderLabel("system"), "AI assistant");
assert.equal(sourceForSession({ referrer: "Retell messaging" }), "AI text message");
assert.equal(sourceForSession(sessions[0], [{sender: "owner", client_message_id: "crm-out:SMtest"}]), "Team text message");
assert.equal(sourceForSession(sessions[0], [{sender: "visitor", client_message_id: "crm-out:spoof"}]), "AI text message");
const teamHistory = buildConversationRecords(sessions, [...messages, {
  id: "manual-sms", session_id: "sms-session", sender: "owner", client_message_id: "crm-out:SMtest",
  body: "Your team member can help.", created_at: "2026-09-08T12:03:00.000Z"
}]);
assert.equal(teamHistory[0].source, "Team text message");
assert.equal(teamHistory[0].messages.at(-1).senderLabel, "Team member");

console.log("CRM AI conversation tests passed.");
