const {
  cleanText,
  createSession,
  findClientMessage,
  getLatestActiveSession,
  getLatestActiveSessionByContact,
  getOwnerPhoneNumbers,
  getSession,
  getSessionByShortCode,
  getTeamSmsSessionByContact,
  isTeamSmsSessionActive,
  getSiteUrl,
  json,
  listMessages,
  normalizePhoneNumber,
  readFormBody,
  readJsonBody,
  saveMessage,
  sendOwnerSmsNotifications,
  twiml,
  updateSession
} = require("./_shared");
const twilio = require("twilio");
const { inspectVoicePricingFlow, replyToCustomer, syncWebsiteKnowledge, updateVoicePricingFlow } = require("./_sms-agent");

function getAction(request) {
  const queryAction = request.query?.action;
  if (Array.isArray(queryAction)) return cleanText(queryAction[0], 80);
  if (queryAction) return cleanText(queryAction, 80);

  const url = new URL(request.url || "", "https://www.imancleaningservice.com");
  const parts = url.pathname.split("/").filter(Boolean);
  return cleanText(parts[parts.length - 1], 80);
}

function toClientSession(session) {
  return {
    id: session.id,
    status: session.status,
    shortCode: session.short_code,
    visitorName: session.visitor_name,
    visitorContact: session.visitor_contact
  };
}

async function handleSend(request, response) {
  if (request.method !== "POST") {
    return json(response, 405, { error: "Method not allowed." });
  }

  const body = await readJsonBody(request);
  const messageText = cleanText(body.message, 1600);
  if (!messageText) {
    return json(response, 400, { error: "Message is required." });
  }

  let session = body.sessionId ? await getSession(body.sessionId) : null;
  if (!session || session.status === "closed") {
    session = await createSession({
      visitorName: body.visitorName,
      visitorContact: body.visitorContact,
      pageUrl: body.pageUrl,
      referrer: body.referrer
    });
  } else {
    const updates = {};
    const visitorName = cleanText(body.visitorName, 120);
    const visitorContact = cleanText(body.visitorContact, 180);
    const pageUrl = cleanText(body.pageUrl, 500);
    const referrer = cleanText(body.referrer, 500);
    if (visitorName && visitorName !== session.visitor_name) updates.visitor_name = visitorName;
    if (visitorContact && visitorContact !== session.visitor_contact) updates.visitor_contact = visitorContact;
    if (pageUrl && pageUrl !== session.page_url) updates.page_url = pageUrl;
    if (referrer && referrer !== session.referrer) updates.referrer = referrer;
    session = await updateSession(session.id, updates);
  }

  let message = await findClientMessage(session.id, body.clientMessageId);
  if (!message) {
    message = await saveMessage({
      sessionId: session.id,
      sender: "visitor",
      body: messageText,
      clientMessageId: body.clientMessageId
    });
  }

  await updateSession(session.id, {
    last_visitor_message_at: new Date().toISOString(),
    status: "active"
  });

  const ownerSms = await sendOwnerSmsNotifications({
    session,
    message,
    siteUrl: getSiteUrl(request)
  });

  if (ownerSms.status !== "sent") {
    return json(response, 503, {
      error: "Live chat SMS is not configured yet.",
      setup: ownerSms.error,
      session: toClientSession(session),
      message
    });
  }

  return json(response, 201, {
    session: toClientSession(session),
    message,
    ownerSmsStatus: ownerSms.status,
    ownerSmsMessageIds: ownerSms.sent.map((item) => item.messageId)
  });
}

async function handleMessages(request, response) {
  if (request.method !== "GET") {
    return json(response, 405, { error: "Method not allowed." });
  }

  const url = new URL(request.url || "", "https://www.imancleaningservice.com");
  const sessionId = cleanText(url.searchParams.get("sessionId"), 80);
  if (!sessionId) {
    return json(response, 400, { error: "Session ID is required." });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return json(response, 404, { error: "Chat session was not found." });
  }

  const messages = await listMessages(session.id);
  return json(response, 200, {
    session: {
      id: session.id,
      status: session.status,
      shortCode: session.short_code
    },
    messages
  });
}

function parseOwnerReply(rawBody) {
  const body = cleanText(rawBody, 1600);
  const closeMatch = body.match(/^(?:#?(C[0-9A-F]{5})\s+)?(?:close|done|end)(?:\s+#?(C[0-9A-F]{5}))?$/i);
  if (closeMatch) {
    return {
      shortCode: (closeMatch[1] || closeMatch[2] || "").toUpperCase(),
      message: "",
      close: true
    };
  }

  const codedMatch = body.match(/^#?(C[0-9A-F]{5})\s*(?::|-|,)?\s*([\s\S]*)$/i);
  if (codedMatch) {
    return {
      shortCode: codedMatch[1].toUpperCase(),
      message: cleanText(codedMatch[2], 1600),
      close: false
    };
  }

  return {
    shortCode: "",
    message: body,
    close: false
  };
}

async function getOrCreateSmsConversation(customerPhone, businessPhone, excludedSessionId = "") {
  let session = await getLatestActiveSessionByContact(customerPhone);
  const updatedAt = new Date(session?.updated_at || 0).getTime();
  const stillCurrent = session && session.id !== excludedSessionId && session.page_url === `sms:${businessPhone}` &&
    Number.isFinite(updatedAt) && updatedAt > Date.now() - (72 * 60 * 60 * 1000);
  if (!stillCurrent) {
    session = await createSession({
      visitorContact: customerPhone,
      pageUrl: `sms:${businessPhone}`,
      referrer: "Retell AI messaging agent"
    });
  }
  return session;
}

async function saveSmsExchange({ session, form, reply }) {
  const messageSid = cleanText(form.MessageSid, 80);
  const incomingId = messageSid ? `sms-in:${messageSid}` : "";
  const outgoingId = messageSid ? `sms-out:${messageSid}` : "";
  let inbound = incomingId ? await findClientMessage(session.id, incomingId) : null;
  if (!inbound) {
    inbound = await saveMessage({
      sessionId: session.id,
      sender: "visitor",
      body: form.Body,
      clientMessageId: incomingId,
      twilioMessageSid: messageSid
    });
  }

  let outbound = outgoingId ? await findClientMessage(session.id, outgoingId) : null;
  if (reply && !outbound) {
    outbound = await saveMessage({
      sessionId: session.id,
      sender: "system",
      body: reply,
      clientMessageId: outgoingId
    });
  }

  const now = new Date().toISOString();
  const latestMessageTime = (previous, current) => new Date(previous || 0).getTime() > new Date(current).getTime() ? previous : current;
  await updateSession(session.id, {
    status: "active",
    last_visitor_message_at: latestMessageTime(session.last_visitor_message_at, inbound.created_at || now),
    ...(reply ? { last_owner_reply_at: latestMessageTime(session.last_owner_reply_at, outbound?.created_at || now) } : {})
  });
  return { inbound, outbound };
}

async function handleTwilioWebhook(request, response, { fallback = false } = {}) {
  if (request.method !== "POST") {
    response.statusCode = 405;
    return response.end("Method not allowed.");
  }

  const form = await readFormBody(request);
  const from = normalizePhoneNumber(form.From);
  const ownerNumbers = getOwnerPhoneNumbers();
  const signature = cleanText(request.headers["x-twilio-signature"], 500);
  const webhookUrl = `${getSiteUrl(request)}/api/chat/${fallback ? "sms-fallback" : "twilio-webhook"}`;
  if (!twilio.validateRequest(String(process.env.TWILIO_AUTH_TOKEN || ""), signature, webhookUrl, form)) {
    response.statusCode = 403;
    return response.end("Invalid Twilio signature.");
  }

  if (!ownerNumbers.includes(from)) {
    const optOutType = cleanText(form.OptOutType, 30).toUpperCase();
    const keyword = cleanText(form.Body, 30).toUpperCase();
    const to = normalizePhoneNumber(form.To);
    // Manual customer conversations take priority over any newer AI session.
    // The authority is a saved owner message, never caller-supplied metadata.
    const teamSession = await getTeamSmsSessionByContact(from, to);
    const teamActive = isTeamSmsSessionActive(teamSession);
    // Do not reuse an expired team thread: that would reset its timer and make
    // the next AI reply accidentally hand the conversation back to the team.
    const session = teamActive ? teamSession : await getOrCreateSmsConversation(from, to, teamSession?.id);
    if (teamActive || fallback) {
      await saveSmsExchange({ session, form, reply: "" });
      return twiml(response);
    }
    if (optOutType === "STOP" || ["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(keyword)) {
      await saveSmsExchange({ session, form, reply: "" });
      return twiml(response);
    }
    if (optOutType === "HELP" || keyword === "HELP") {
      const reply = "IMAN Cleaning Service virtual assistant. Ask a cleaning or booking question here, or call 929-232-1930. Reply STOP to opt out.";
      const saved = await saveSmsExchange({ session, form, reply });
      return twiml(response, saved.outbound?.body || reply);
    }
    if (optOutType === "START" || ["START", "YES", "UNSTOP"].includes(keyword)) {
      const reply = "IMAN Cleaning Service texting is active. How can our virtual assistant help? Reply STOP to opt out.";
      const saved = await saveSmsExchange({ session, form, reply });
      return twiml(response, saved.outbound?.body || reply);
    }
    const messageSid = cleanText(form.MessageSid, 80);
    const priorReply = messageSid ? await findClientMessage(session.id, `sms-out:${messageSid}`) : null;
    const reply = priorReply?.body || await replyToCustomer({
      from, to, body: form.Body,
      lastCustomerMessageAt: session.last_visitor_message_at,
      lastAssistantMessageAt: session.last_owner_reply_at
    });
    // A team member may have sent a message while the AI was preparing a reply.
    const claimedSession = await getTeamSmsSessionByContact(from, to);
    if (isTeamSmsSessionActive(claimedSession)) {
      await saveSmsExchange({ session: claimedSession, form, reply: "" });
      return twiml(response);
    }
    const saved = await saveSmsExchange({ session, form, reply });
    return twiml(response, saved.outbound?.body || reply);
  }

  if (!ownerNumbers.length) {
    return twiml(response, "Owner SMS is not configured for website chat.");
  }

  const parsed = parseOwnerReply(form.Body);
  const keyword = parsed.message.toUpperCase();
  if (!parsed.shortCode && keyword === "HELP") {
    return twiml(response, "IMAN Cleaning Service LLC live chat alerts. Reply with a chat code and message, for example: C12345 I can help. Call 929-232-1930 for help.");
  }
  if (!parsed.shortCode && (keyword === "STOP" || keyword === "UNSUBSCRIBE" || keyword === "CANCEL")) {
    return twiml(response, "IMAN Cleaning Service LLC: You have opted out of live chat SMS alerts. Reply START to opt back in.");
  }
  if (!parsed.shortCode && keyword === "START") {
    return twiml(response, "IMAN Cleaning Service LLC: You are opted in to live chat SMS alerts. Reply HELP for help or STOP to opt out.");
  }

  if (!parsed.close && !parsed.message) {
    return twiml(response, "Reply with the chat code and your message, for example: C12345 I can help.");
  }

  const session = parsed.shortCode
    ? await getSessionByShortCode(parsed.shortCode)
    : await getLatestActiveSession();

  if (!session) {
    return twiml(response, "No active website chat was found. Ask the customer to send a new chat message first.");
  }

  if (parsed.close) {
    await updateSession(session.id, {
      status: "closed",
      closed_at: new Date().toISOString()
    });
    return twiml(response, `Website chat ${session.short_code} is closed.`);
  }

  await saveMessage({
    sessionId: session.id,
    sender: "owner",
    body: parsed.message,
    twilioMessageSid: form.MessageSid
  });

  await updateSession(session.id, {
    status: "active",
    last_owner_reply_at: new Date().toISOString()
  });

  return twiml(response);
}

async function handleKnowledgeSync(request, response) {
  if (request.method !== "POST") {
    return json(response, 405, { error: "Method not allowed." });
  }
  const expectedToken = cleanText(process.env.IMAN_KB_SYNC_TOKEN, 500);
  const suppliedToken = cleanText(request.headers["x-iman-sync-token"], 500);
  if (!expectedToken || suppliedToken !== expectedToken) {
    return json(response, 403, { error: "Knowledge sync is not authorized." });
  }
  try {
    return json(response, 200, await syncWebsiteKnowledge());
  } catch (error) {
    console.error("Retell alignment failed:", error.stack || error.message || error);
    return json(response, error.status || error.statusCode || 500, {
      error: error.message || "Retell alignment failed.",
      type: error.name || "Error"
    });
  }
}

async function handleVoicePricingSync(request, response) {
  if (request.method !== "POST") {
    return json(response, 405, { error: "Method not allowed." });
  }
  const expectedToken = cleanText(process.env.IMAN_KB_SYNC_TOKEN, 500);
  const suppliedToken = cleanText(request.headers["x-iman-sync-token"], 500);
  if (!expectedToken || suppliedToken !== expectedToken) {
    return json(response, 403, { error: "Voice-agent sync is not authorized." });
  }
  try {
    const body = await readJsonBody(request);
    return json(response, 200, body.apply ? await updateVoicePricingFlow() : await inspectVoicePricingFlow());
  } catch (error) {
    console.error("Retell voice-agent inspection failed:", error.stack || error.message || error);
    return json(response, error.status || error.statusCode || 500, {
      error: error.message || "Retell voice-agent inspection failed.",
      type: error.name || "Error"
    });
  }
}

module.exports = async function handler(request, response) {
  try {
    const action = getAction(request);
    if (action === "send") return handleSend(request, response);
    if (action === "messages") return handleMessages(request, response);
    if (action === "twilio-webhook") return await handleTwilioWebhook(request, response);
    if (action === "sms-fallback") return await handleTwilioWebhook(request, response, { fallback: true });
    if (action === "knowledge-sync") return handleKnowledgeSync(request, response);
    if (action === "voice-pricing-sync") return handleVoicePricingSync(request, response);
    return json(response, 404, { error: "Live chat endpoint was not found." });
  } catch (error) {
    if (["twilio-webhook", "sms-fallback"].includes(getAction(request))) {
      // Fail closed: a storage/routing failure must not trigger an AI or error
      // text to a customer whose conversation may belong to the team.
      console.error("SMS conversation handling failed.");
      response.statusCode = 503;
      response.setHeader("Content-Type", "text/xml");
      return response.end("<Response></Response>");
    }

    return json(response, error.statusCode || 500, {
      error: error.message || "Live chat request could not be completed.",
      setup: error.setup,
      details: error.details
    });
  }
};
