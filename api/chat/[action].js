const {
  cleanText,
  createSession,
  findClientMessage,
  getLatestActiveSession,
  getOwnerPhoneNumbers,
  getSession,
  getSessionByShortCode,
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

async function handleTwilioWebhook(request, response) {
  if (request.method !== "POST") {
    return twiml(response, "Live chat replies must be sent by SMS.");
  }

  const form = await readFormBody(request);
  const from = normalizePhoneNumber(form.From);
  const ownerNumbers = getOwnerPhoneNumbers();
  if (!ownerNumbers.length) {
    return twiml(response, "Owner SMS is not configured for website chat.");
  }
  if (!ownerNumbers.includes(from)) {
    return twiml(response, "This number is not authorized to reply to website chats.");
  }

  const parsed = parseOwnerReply(form.Body);
  const keyword = parsed.message.toUpperCase();
  if (!parsed.shortCode && keyword === "HELP") {
    return twiml(response, "IMAN Cleaning Service LLC live chat alerts. Reply with a chat code and message, for example: C12345 I can help. Call 929-803-4053 for help.");
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

module.exports = async function handler(request, response) {
  try {
    const action = getAction(request);
    if (action === "send") return handleSend(request, response);
    if (action === "messages") return handleMessages(request, response);
    if (action === "twilio-webhook") return handleTwilioWebhook(request, response);
    return json(response, 404, { error: "Live chat endpoint was not found." });
  } catch (error) {
    if (getAction(request) === "twilio-webhook") {
      return twiml(response, error.message || "Website chat reply could not be delivered.");
    }

    return json(response, error.statusCode || 500, {
      error: error.message || "Live chat request could not be completed.",
      setup: error.setup,
      details: error.details
    });
  }
};
