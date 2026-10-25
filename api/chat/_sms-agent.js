const { Retell } = require("retell-sdk");

const AGENT_NAME = "IMAN SMS Messaging Agent - Calling Agent";
const DEFAULT_VOICE_AGENT_ID = "agent_f52ea018e57e39dee7a33e5953";
const WEBSITE_KNOWLEDGE_BASE_NAME = "IMAN Approved Website";
const WEBSITE_KNOWLEDGE_URLS = [
  "https://www.imancleaningservice.com/",
  "https://www.imancleaningservice.com/services-hub.html",
  "https://www.imancleaningservice.com/faq.html",
  "https://www.imancleaningservice.com/areas.html",
  "https://www.imancleaningservice.com/standard-cleaning.html",
  "https://www.imancleaningservice.com/deep-cleaning.html",
  "https://www.imancleaningservice.com/move-in-move-out-cleaning.html",
  "https://www.imancleaningservice.com/post-construction-cleaning.html",
  "https://www.imancleaningservice.com/commercial-cleaning.html",
  "https://www.imancleaningservice.com/office-cleaning.html",
  "https://www.imancleaningservice.com/retail-store-cleaning.html",
  "https://www.imancleaningservice.com/restaurant-cleaning.html",
  "https://www.imancleaningservice.com/medical-clinic-cleaning.html",
  "https://www.imancleaningservice.com/janitorial-recurring-cleaning.html"
];
const SESSION_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const CONVERSATION_IDLE_MS = 30 * 60 * 1000;
const SMS_INTRODUCTION = "Hi, I'm Fatimah, IMAN Cleaning Service's virtual assistant.";
const FALLBACK_REPLY = "I'm sorry, I'm not able to answer that by text right now. Please call us at 929-232-1930 and ask to speak with a person.";
let agentCache = null;

const AGENT_PROMPT = `You are the AI text-message assistant for IMAN Cleaning Service LLC in New York City.

STYLE AND IDENTITY
- Be warm, concise, professional, and natural. Write for SMS, with short paragraphs and no markdown formatting.
- On the first reply, identify yourself as IMAN Cleaning Service's virtual assistant. Do not repeat this on every message.
- Answer the customer's question directly whenever the approved information below is enough.
- Ask no more than one useful follow-up question per reply. Do not interrogate the customer or repeat information already provided.

STRICT LIMITS
- Never invent or promise prices, discounts, availability, arrival times, staffing, refunds, compensation, coverage, or exceptions.
- Never say an appointment, cancellation, reschedule, payment, refund, or complaint resolution is confirmed.
- Never request card numbers, bank information, passwords, Social Security numbers, or other sensitive data by text.
- For an exact quote or booking, send: https://www.imancleaningservice.com/book-now.html
- To reschedule or cancel an existing appointment, send: https://www.imancleaningservice.com/manage-booking.html
- For a concern about a completed cleaning, send: https://www.imancleaningservice.com/service-concern.html
- If the question needs a human decision, involves a billing dispute, damage, a missing item, safety, an emergency, a special exception, exact live availability, or information you do not know, say you cannot resolve it by text and ask the customer to call 929-232-1930.
- For immediate danger or a medical emergency, tell the customer to call 911.

APPROVED BUSINESS INFORMATION
- Business: IMAN Cleaning Service LLC. Phone: 929-232-1930. Email: info@imancleaningservice.com.
- Service area: Brooklyn, Queens, and Manhattan, subject to ZIP code, service, and schedule availability.
- Residential services include Standard, Deep, Move-In/Move-Out, Hourly, Details, Post-Construction, Extreme, and custom cleaning.
- Commercial services include offices, retail stores, restaurants, medical and clinic spaces, and recurring janitorial cleaning.
- The team brings the professional cleaning products and equipment needed for the confirmed service.
- Water/flood-damage requests, some Post-Construction work, and commercial work require a custom quote.
- A booking generally requires a 25% deposit. The remaining balance is due after cleaning, with a temporary authorization hold placed about 48 hours before service.
- Customers may reschedule or cancel at least 48 hours before service for a full deposit refund.
- If the team arrives but cannot work for a customer-caused access or site-readiness reason, the total charge is 50% of the scheduled service price.
- No additional work or charge should be made without customer approval.
- Service-quality concerns should be submitted promptly, generally within 24 hours after cleaning. Damage, missing-item, billing, health, or safety concerns should be reported as soon as discovered.

QUOTE GUIDANCE
- If a customer is only exploring, explain the relevant service briefly.
- If they want help identifying the right service, gather only what is needed, one item at a time: service goal, ZIP code, property type, bedrooms and bathrooms, approximate square footage, condition, desired date/time, and important add-ons.
- Collected details are not a quote or reservation. Direct them to the online booking form for the actual price and appointment confirmation.`;

async function findVoiceAgent(retell) {
  const phoneNumbers = await retell.phoneNumber.list({ limit: 100 });
  const businessNumber = (phoneNumbers.items || phoneNumbers || []).find((item) =>
    String(item.phone_number || "").replace(/\D/g, "").endsWith("9292321930")
  );
  const voiceAgentId = businessNumber?.inbound_agent_id || cleanText(process.env.RETELL_VOICE_AGENT_ID, 100) || DEFAULT_VOICE_AGENT_ID;
  if (!voiceAgentId) throw new Error("The Retell calling agent was not found.");
  return retell.agent.retrieve(voiceAgentId);
}

async function websiteKnowledgeBaseId(retell) {
  const result = await retell.knowledgeBase.list();
  const knowledgeBases = result.items || result || [];
  return knowledgeBases.find((item) => item.knowledge_base_name === WEBSITE_KNOWLEDGE_BASE_NAME)?.knowledge_base_id || "";
}

async function removeWebsiteKnowledgeFromEngine(retell, responseEngine, knowledgeBaseId) {
  if (!knowledgeBaseId || !responseEngine || responseEngine.type === "custom-llm") return responseEngine;
  if (responseEngine.type === "retell-llm") {
    const llm = await retell.llm.retrieve(responseEngine.llm_id, { version: responseEngine.version });
    const knowledgeBaseIds = (llm.knowledge_base_ids || []).filter((id) => id !== knowledgeBaseId);
    if (knowledgeBaseIds.length === (llm.knowledge_base_ids || []).length) return responseEngine;
    const updated = await retell.llm.update(responseEngine.llm_id, {
      version: responseEngine.version,
      knowledge_base_ids: knowledgeBaseIds
    });
    return { type: "retell-llm", llm_id: responseEngine.llm_id, version: updated.version };
  }

  if (responseEngine.type === "conversation-flow") {
    const flow = await retell.conversationFlow.retrieve(responseEngine.conversation_flow_id, { version: responseEngine.version });
    const knowledgeBaseIds = (flow.knowledge_base_ids || []).filter((id) => id !== knowledgeBaseId);
    if (knowledgeBaseIds.length === (flow.knowledge_base_ids || []).length) return responseEngine;
    const updated = await retell.conversationFlow.update(responseEngine.conversation_flow_id, {
      version: responseEngine.version,
      knowledge_base_ids: knowledgeBaseIds
    });
    return { type: "conversation-flow", conversation_flow_id: responseEngine.conversation_flow_id, version: updated.version };
  }
  return responseEngine;
}

async function engineUsesKnowledgeBase(retell, responseEngine, knowledgeBaseId) {
  if (!knowledgeBaseId || !responseEngine || responseEngine.type === "custom-llm") return false;
  const engine = responseEngine.type === "retell-llm"
    ? await retell.llm.retrieve(responseEngine.llm_id, { version: responseEngine.version })
    : await retell.conversationFlow.retrieve(responseEngine.conversation_flow_id, { version: responseEngine.version });
  return (engine.knowledge_base_ids || []).includes(knowledgeBaseId);
}

async function cloneCallingEngineForChat(retell, responseEngine, knowledgeBaseId) {
  if (responseEngine?.type !== "conversation-flow") {
    throw new Error("The calling agent must use a conversation flow to copy it to the text agent.");
  }
  const flow = await retell.conversationFlow.retrieve(responseEngine.conversation_flow_id, { version: responseEngine.version });
  const allowedFields = [
    "model_choice", "model_temperature", "tool_call_strict_mode", "kb_config", "start_speaker",
    "begin_after_user_silence_ms", "global_prompt", "flex_mode", "tools", "components",
    "start_node_id", "default_dynamic_variables", "begin_tag_display_position", "notes", "mcps",
    "is_transfer_llm", "nodes"
  ];
  const copy = Object.fromEntries(allowedFields
    .filter((field) => flow[field] !== undefined)
    .map((field) => [field, flow[field]]));
  copy.knowledge_base_ids = (flow.knowledge_base_ids || []).filter((id) => id !== knowledgeBaseId);
  const cloned = await retell.conversationFlow.create(copy);
  return { type: "conversation-flow", conversation_flow_id: cloned.conversation_flow_id, version: cloned.version };
}

async function alignmentStep(label, operation) {
  try {
    return await operation();
  } catch (error) {
    error.message = `${label}: ${error.message || error}`;
    throw error;
  }
}

async function publishChatAgent(retell, chatAgent, description) {
  try {
    await retell.chatAgent.publish(chatAgent.agent_id, {
      version: chatAgent.version || 0,
      version_description: description
    });
  } catch (error) {
    if (!(error instanceof SyntaxError && /Unexpected end of JSON/i.test(error.message))) throw error;
  }
  const published = await retell.chatAgent.retrieve(chatAgent.agent_id);
  if (!published.is_published) throw new Error("Retell did not publish the aligned chat agent.");
  return published;
}

async function alignMessagingAgentWithVoice(retell, existingChatAgent = null) {
  const knowledgeBaseId = await alignmentStep("list knowledge bases", () => websiteKnowledgeBaseId(retell));
  let voiceAgent = await alignmentStep("retrieve calling agent", () => findVoiceAgent(retell));
  const voiceUsesWebsite = await alignmentStep("inspect calling-agent knowledge", () => engineUsesKnowledgeBase(retell, voiceAgent.response_engine, knowledgeBaseId));

  if (voiceUsesWebsite) {
    let voiceDraft = voiceAgent;
    if (voiceAgent.is_published) voiceDraft = await alignmentStep("create calling-agent draft", () => retell.agent.createVersion(voiceAgent.agent_id, { base_version: voiceAgent.version }));
    const cleanedEngine = await alignmentStep("disconnect website knowledge", () => removeWebsiteKnowledgeFromEngine(retell, voiceDraft.response_engine, knowledgeBaseId));
    await alignmentStep("update calling-agent draft", () => retell.agent.update(voiceAgent.agent_id, {
      version: voiceDraft.version,
      response_engine: cleanedEngine,
      version_title: "Website knowledge disconnected"
    }));
    await alignmentStep("publish calling agent", () => retell.agent.publish(voiceAgent.agent_id, {
      version: voiceDraft.version,
      version_title: "Website knowledge disconnected",
      version_description: "Removed the website knowledge base from the calling agent."
    }));
    voiceAgent = await alignmentStep("refresh calling agent", () => retell.agent.retrieve(voiceAgent.agent_id));
  }

  let chatAgent = existingChatAgent;
  if (!chatAgent) {
    const listed = await retell.chatAgent.list({ limit: 100 });
    const found = (listed.items || []).find((item) => item.agent_name === AGENT_NAME);
    chatAgent = found ? await retell.chatAgent.retrieve(found.agent_id) : null;
  }

  if (!chatAgent) {
    const chatResponseEngine = await alignmentStep("copy calling-agent flow for chat", () => cloneCallingEngineForChat(retell, voiceAgent.response_engine, knowledgeBaseId));
    chatAgent = await alignmentStep("create aligned chat agent", () => retell.chatAgent.create({
      agent_name: AGENT_NAME,
      response_engine: chatResponseEngine,
      language: "en-US",
      end_chat_after_silence_ms: SESSION_MAX_AGE_MS,
      data_storage_setting: "everything",
      data_storage_retention_days: 90,
      handbook_config: { ai_disclosure: true, scope_boundaries: true, high_empathy: true, default_personality: true },
      timezone: "America/New_York"
    }));
    chatAgent = await alignmentStep("publish aligned chat agent", () => publishChatAgent(retell, chatAgent, "Aligned with IMAN calling agent"));
  } else if (!chatAgent.is_published) {
    chatAgent = await alignmentStep("publish aligned chat agent", () => publishChatAgent(retell, chatAgent, "Aligned with IMAN calling agent"));
  }

  agentCache = null;
  return {
    chatAgentId: chatAgent.agent_id,
    chatAgentVersion: chatAgent.version,
    voiceAgentId: voiceAgent.agent_id,
    voiceAgentVersion: voiceAgent.version,
    responseEngine: voiceAgent.response_engine,
    websiteKnowledgeDisconnected: true
  };
}

async function syncWebsiteKnowledge() {
  return alignMessagingAgentWithVoice(client());
}

async function inspectVoicePricingFlow() {
  const retell = client();
  const voiceAgent = await findVoiceAgent(retell);
  if (voiceAgent.response_engine?.type !== "conversation-flow") {
    throw new Error("The Retell calling agent is not using a conversation flow.");
  }
  const flow = await retell.conversationFlow.retrieve(
    voiceAgent.response_engine.conversation_flow_id,
    { version: voiceAgent.response_engine.version }
  );
  return {
    agent: {
      agent_id: voiceAgent.agent_id,
      version: voiceAgent.version,
      is_published: voiceAgent.is_published,
      response_engine: voiceAgent.response_engine
    },
    flow: {
      conversation_flow_id: flow.conversation_flow_id,
      version: flow.version,
      global_prompt: flow.global_prompt,
      start_node_id: flow.start_node_id,
      nodes: flow.nodes,
      components: flow.components,
      tools: flow.tools
    }
  };
}

const PRICING_SUCCESS_MESSAGE = "Wonderful, I’ve texted you our instant-pricing and booking link. Open it and enter your cleaning details to see your price. If instant pricing is available, you can also choose a date and time and book your appointment through the same link. If your service requires a custom quote, the page will guide you through the next steps and our team will review your request after you submit it. Is there anything else I can help you with today?";
const PRICING_FAILURE_MESSAGE = "I wasn't able to send the text. You can get your cleaning price at imancleaningservice.com/book-now.html. Is there anything else I can help you with today?";
const PRICING_GOODBYE_MESSAGE = "Great, have a great one. Bye.";

async function updateVoicePricingFlow() {
  const retell = client();
  const currentAgent = await findVoiceAgent(retell);
  if (currentAgent.response_engine?.type !== "conversation-flow") {
    throw new Error("The Retell calling agent is not using a conversation flow.");
  }
  const draft = currentAgent.is_published
    ? await retell.agent.createVersion(currentAgent.agent_id, { base_version: currentAgent.version })
    : currentAgent;
  const engine = draft.response_engine;
  const flow = await retell.conversationFlow.retrieve(engine.conversation_flow_id, { version: engine.version });
  const nodes = JSON.parse(JSON.stringify(flow.nodes || []));
  const startNode = nodes.find((node) => node.id === flow.start_node_id) || nodes.find((node) => node.name === "Welcome Node");
  const quoteIntro = nodes.find((node) => node.id === "ask_phone_number");
  const quoteClosing = nodes.find((node) => node.id === "quote_closing");
  const quoteGoodbye = nodes.find((node) => node.id === "quote_goodbye");
  const quoteFailed = nodes.find((node) => node.id === "quote_send_failed");
  if (!startNode || !quoteIntro || !quoteClosing || !quoteGoodbye || !quoteFailed) {
    throw new Error("The expected Retell pricing nodes were not found, so no change was made.");
  }

  const existingContinueEdge = (quoteClosing.edges || []).find((edge) => edge.id === "edge_quote_more_help") || quoteClosing.edges?.[0];
  const alreadyUpdated = quoteIntro.instruction?.text?.includes("instant-pricing link")
    && quoteClosing.instruction?.text === PRICING_SUCCESS_MESSAGE
    && quoteGoodbye.instruction?.text === PRICING_GOODBYE_MESSAGE
    && quoteFailed.instruction?.text === PRICING_FAILURE_MESSAGE
    && existingContinueEdge?.destination_node_id === "quote_more_help";
  if (alreadyUpdated && currentAgent.is_published) {
    return { updated: false, agent: currentAgent, flow };
  }

  quoteIntro.instruction = {
    type: "prompt",
    text: "Say exactly:\n\"I'll text you our instant-pricing link now.\"\n\nDo not ask the caller for a name, phone number, address, ZIP code, service type, property details, preferred date, budget, or photos. Do not ask whether they want the link. Continue directly to the Send quote form node."
  };
  quoteClosing.instruction = { type: "static_text", text: PRICING_SUCCESS_MESSAGE };
  quoteGoodbye.instruction = { type: "static_text", text: PRICING_GOODBYE_MESSAGE };
  quoteFailed.instruction = { type: "static_text", text: PRICING_FAILURE_MESSAGE };

  let moreHelp = nodes.find((node) => node.id === "quote_more_help");
  if (!moreHelp) {
    moreHelp = {
      id: "quote_more_help",
      name: "Quote: more help",
      type: "conversation",
      instruction: { type: "static_text", text: "Of course! How can I help?" },
      edges: (startNode.edges || []).map((edge, index) => ({
        ...JSON.parse(JSON.stringify(edge)),
        id: `edge_quote_more_help_${index + 1}`
      })),
      else_edge: startNode.else_edge ? {
        ...JSON.parse(JSON.stringify(startNode.else_edge)),
        id: "edge_quote_more_help_unclear"
      } : undefined
    };
    nodes.push(moreHelp);
  }
  const continueEdge = (quoteClosing.edges || []).find((edge) => edge.id === "edge_quote_more_help") || quoteClosing.edges?.[0];
  if (!continueEdge) throw new Error("The pricing continuation edge was not found, so no change was made.");
  continueEdge.destination_node_id = moreHelp.id;
  const failedContinueEdge = (quoteFailed.edges || []).find((edge) => edge.id === "edge_quote_failed_more_help") || quoteFailed.edges?.[0];
  if (failedContinueEdge) failedContinueEdge.destination_node_id = moreHelp.id;

  const updatedFlow = await retell.conversationFlow.update(engine.conversation_flow_id, {
    version: engine.version,
    nodes
  });
  await retell.agent.update(draft.agent_id, {
    version: draft.version,
    response_engine: {
      type: "conversation-flow",
      conversation_flow_id: updatedFlow.conversation_flow_id,
      version: updatedFlow.version
    },
    version_title: "Instant-pricing call flow"
  });
  try {
    await retell.agent.publish(draft.agent_id, {
      version: draft.version,
      version_title: "Instant-pricing call flow",
      version_description: "Direct pricing requests to the instant-pricing link, then continue or end based on the caller's answer."
    });
  } catch (error) {
    if (!(error instanceof SyntaxError && /Unexpected end of JSON/i.test(error.message))) throw error;
  }
  const publishedAgent = await retell.agent.retrieve(draft.agent_id);
  if (!publishedAgent.is_published || publishedAgent.version !== draft.version) {
    throw new Error("Retell did not publish the updated calling-agent version.");
  }
  const publishedFlow = await retell.conversationFlow.retrieve(
    publishedAgent.response_engine.conversation_flow_id,
    { version: publishedAgent.response_engine.version }
  );
  return { updated: true, agent: publishedAgent, flow: publishedFlow };
}

function cleanText(value, maxLength = 1200) {
  return String(value || "").replace(/\0/g, "").replace(/\r\n?/g, "\n").trim().slice(0, maxLength);
}

function client() {
  const apiKey = cleanText(process.env.RETELL_API_KEY, 500);
  if (!apiKey) throw new Error("Retell messaging is not configured.");
  return new Retell({ apiKey });
}

async function ensureMessagingAgent() {
  if (agentCache?.agentId) return agentCache;
  const retell = client();
  const listed = await retell.chatAgent.list({
    limit: 100,
    filter_criteria: { query: AGENT_NAME, channel: { type: "string", op: "eq", value: "chat" } }
  });
  const found = (listed.items || []).find((item) => item.agent_name === AGENT_NAME);
  if (found) {
    // An incoming text must not publish a draft or copy a voice-only greeting.
    // Training is published explicitly in Retell, separately from SMS delivery.
    agentCache = { agentId: found.agent_id, retell };
    return agentCache;
  }

  throw new Error("The trained IMAN text-message agent was not found.");
}

async function latestPublishedChatVersion(retell, agentId) {
  const latest = await retell.chatAgent.retrieve(agentId);
  const publishedVersion = (agent) => agent?.is_published === true &&
    Number.isInteger(agent.version) && agent.version >= 0;
  if (publishedVersion(latest)) return latest.version;

  // The newest version can be an unfinished draft. Never publish/use it just
  // because a customer texted; retain the latest deliberately published training.
  const versions = await retell.chatAgent.getVersions(agentId);
  const published = versions.filter(publishedVersion).sort((a, b) => b.version - a.version)[0];
  if (!published) throw new Error("The IMAN text-message agent has no published training.");
  return published.version;
}

async function findOrCreateChat(retell, agentId, customerPhone, businessPhone, { startNewConversation = false } = {}) {
  // Check the published version and session status on every incoming message.
  // Old 72-hour sessions kept the voice greeting even after chat training changed.
  const agentVersion = await latestPublishedChatVersion(retell, agentId);
  if (!startNewConversation) {
    let paginationKey;
    const seenCursors = new Set();
    do {
      const chats = await retell.chat.list({
        filter_criteria: { agent: [{ agent_id: agentId, version: [agentVersion] }], chat_status: { type: "enum", op: "in", value: ["ongoing"] } },
        limit: 100,
        sort_order: "descending",
        ...(paginationKey ? { pagination_key: paginationKey } : {})
      });
      const existing = (chats.items || []).find((chat) => {
        const metadata = chat.metadata && typeof chat.metadata === "object" ? chat.metadata : {};
        return chat.agent_id === agentId && chat.version === agentVersion && chat.chat_status === "ongoing" &&
          metadata.channel === "twilio_sms" && metadata.customer_phone === customerPhone &&
          metadata.business_phone === businessPhone &&
          Number(chat.start_timestamp || 0) > Date.now() - SESSION_MAX_AGE_MS;
      });
      if (existing) return existing.chat_id;
      paginationKey = chats.has_more ? chats.pagination_key : null;
      if (!paginationKey || seenCursors.has(paginationKey)) break;
      seenCursors.add(paginationKey);
    } while (paginationKey);
  }

  // Leave older sessions/history intact. The next incoming text starts a session
  // with the current training; this API call does not send an outbound SMS.
  const created = await retell.chat.create({
    agent_id: agentId,
    agent_version: agentVersion,
    metadata: { channel: "twilio_sms", customer_phone: customerPhone, business_phone: businessPhone },
    retell_llm_dynamic_variables: { customer_phone: customerPhone }
  });
  return created.chat_id;
}

function extractAgentReply(result) {
  const replies = (result?.messages || [])
    .filter((message) => message.role === "agent" && message.content)
    .map((message) => cleanText(message.content, 1200));
  return cleanText(replies.at(-1), 1200);
}

function shouldIntroduce({ lastCustomerMessageAt, lastAssistantMessageAt, now = Date.now() } = {}) {
  const lastCustomer = new Date(lastCustomerMessageAt || 0).getTime();
  const lastAssistant = new Date(lastAssistantMessageAt || 0).getTime();
  // CRM timestamps survive server restarts, Retell version changes and ended chats.
  // Only customer inactivity resets the greeting, not the age of an AI session.
  return !Number.isFinite(lastCustomer) || lastCustomer <= 0 ||
    !Number.isFinite(lastAssistant) || lastAssistant <= 0 ||
    now - lastCustomer >= CONVERSATION_IDLE_MS;
}

function formatSmsReply(reply, introduce, identityRequested = false) {
  let answer = cleanText(reply, 1200);
  // Guard against the model repeating its old opening. Only strip an anchored
  // self-introduction; keep the answer, links and explicit identity explanations.
  const opening = /^(?:(?:hi|hello|hey)(?:\s+there)?[!,.:\s]+)?(?:i\s*(?:['’]m|am)|this is)\s+fatimah\b[^.!?\n]{0,180}(?:virtual assistant|text(?:-message)? assistant)[.!\s]*/i;
  while ((introduce || !identityRequested) && opening.test(answer)) answer = answer.replace(opening, "").trim();
  answer = answer || "How can I help you today?";
  return introduce ? `${SMS_INTRODUCTION}\n\n${answer}` : answer;
}

async function replyToCustomer({ from, to, body, lastCustomerMessageAt, lastAssistantMessageAt }, {
  getAgent = ensureMessagingAgent,
  now = Date.now()
} = {}) {
  const message = cleanText(body, 1600);
  if (!message) return FALLBACK_REPLY;
  const introduce = shouldIntroduce({ lastCustomerMessageAt, lastAssistantMessageAt, now });
  const identityRequested = /\b(?:who (?:are you|am i (?:talking|texting|speaking) (?:to|with))|(?:what(?:['’]s| is) )?your name|are you (?:an? |the )?(?:ai|bot|human|real person|virtual assistant))\b/i.test(message);
  try {
    const { agentId, retell } = await getAgent();
    const chatId = await findOrCreateChat(retell, agentId, from, to, { startNewConversation: introduce });
    const result = await retell.chat.createChatCompletion({ chat_id: chatId, content: message });
    return formatSmsReply(extractAgentReply(result) || FALLBACK_REPLY, introduce, identityRequested);
  } catch (error) {
    console.error("SMS AI reply failed:", error.message || error);
    return formatSmsReply(FALLBACK_REPLY, introduce);
  }
}

module.exports = {
  AGENT_NAME,
  AGENT_PROMPT,
  FALLBACK_REPLY,
  CONVERSATION_IDLE_MS,
  SMS_INTRODUCTION,
  WEBSITE_KNOWLEDGE_BASE_NAME,
  WEBSITE_KNOWLEDGE_URLS,
  alignMessagingAgentWithVoice,
  ensureMessagingAgent,
  findOrCreateChat,
  latestPublishedChatVersion,
  extractAgentReply,
  shouldIntroduce,
  formatSmsReply,
  replyToCustomer,
  inspectVoicePricingFlow,
  updateVoicePricingFlow,
  syncWebsiteKnowledge
};
