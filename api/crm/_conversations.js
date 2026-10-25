const { cleanText, supabaseRequest } = require("../chat/_shared");

function sourceForSession(session = {}, messages = []) {
  if (messages.some(message => message.sender === "owner" && String(message.clientMessageId || message.client_message_id || "").startsWith("crm-out:"))) return "Team text message";
  if (String(session.page_url || "").startsWith("sms:")) return "AI text message";
  if (String(session.referrer || "").toLowerCase().includes("retell")) return "AI text message";
  return "Website chat";
}

function senderLabel(sender) {
  if (sender === "visitor") return "Customer";
  if (sender === "owner") return "Team member";
  return "AI assistant";
}

function buildConversationRecords(sessions = [], messages = []) {
  const messagesBySession = new Map();
  messages.forEach((message) => {
    if (!messagesBySession.has(message.session_id)) messagesBySession.set(message.session_id, []);
    messagesBySession.get(message.session_id).push({
      id: message.id,
      createdAt: message.created_at,
      sender: cleanText(message.sender, 20),
      senderLabel: senderLabel(message.sender),
      clientMessageId: message.client_message_id || "",
      body: cleanText(message.body, 1600)
    });
  });

  return sessions.map((session) => {
    const conversationMessages = (messagesBySession.get(session.id) || [])
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    const lastMessage = conversationMessages.at(-1);
    return {
      id: session.id,
      shortCode: session.short_code,
      status: session.status,
      customerName: session.visitor_name || session.visitor_contact || "Customer",
      customerContact: session.visitor_contact || "",
      source: sourceForSession(session, conversationMessages),
      pageUrl: session.page_url || "",
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      messageCount: conversationMessages.length,
      lastMessage: lastMessage?.body || "",
      messages: conversationMessages
    };
  });
}

async function listCrmConversations() {
  const sessions = await supabaseRequest(
    "live_chat_sessions",
    "?select=*&order=updated_at.desc&limit=300"
  );
  if (!sessions.length) return [];

  const messages = await supabaseRequest(
    "live_chat_messages",
    "?select=id,session_id,created_at,sender,body,client_message_id&order=created_at.asc&limit=5000"
  );
  const sessionIds = new Set(sessions.map((session) => session.id));
  return buildConversationRecords(
    sessions,
    messages.filter((message) => sessionIds.has(message.session_id))
  );
}

module.exports = { listCrmConversations };
module.exports._test = { buildConversationRecords, senderLabel, sourceForSession };
