const MAX_BODY_BYTES = 48 * 1024;
const MAX_MESSAGES = 16;

function json(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request is too large."), { statusCode: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(Object.assign(new Error("Invalid request."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, maxLength);
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: cleanText(message?.content, 1200)
    }))
    .filter((message) => message.content);
}

function extractOutputText(data) {
  if (data?.output_text) return data.output_text;
  return (data?.output || [])
    .flatMap((item) => item?.content || [])
    .map((item) => item?.text || "")
    .filter(Boolean)
    .join("\n");
}

const INSTRUCTIONS = [
  "You are the website AI cleaning assistant for Iman Cleaning Service LLC in New York.",
  "Be warm, concise, professional, and straightforward. Ask only one helpful question at a time.",
  "Help visitors choose a service, understand published starting prices, or prepare to request a quote.",
  "Never claim an appointment is confirmed. Never invent availability, discounts, inclusions, or prices.",
  "Approved residential services: Standard Cleaning, Deep Cleaning, Detailed Cleaning, Move-In/Move-Out Cleaning, Post-Construction Cleaning, Extreme Cleaning, and Organization Services.",
  "Approved commercial services: Commercial, Office, Retail Store, Restaurant Kitchen, Medical and Clinic, and Janitorial/Recurring Cleaning.",
  "Standard Cleaning starting prices: studio/1 bath $200; 1 bed/1 bath $250; 2 bed/1 bath $300; 3 bed/1 bath $350; 3 bed/2 baths $400.",
  "Deep Cleaning starting prices: studio/1 bath $300; 1 bed/1 bath $400; 2 bed/1 bath $480; 3 bed/1 bath $560; 3 bed/2 baths $640.",
  "Move-In/Move-Out starting prices: studio/1 bath $300; 1 bed/1 bath $400; 2 bed/1 bath $480; 3 bed/1 bath $560; 3 bed/2 baths $640.",
  "Post-Construction Cleaning starting prices for eligible residential properties: studio/1 bath $400; 1 bed/1 bath $500; 2 bed/1 bath $580; 3 bed/1 bath $660; 3 bed/2 baths $740.",
  "Recurring Standard Cleaning savings: 25% weekly, 20% biweekly, and 15% monthly.",
  "Organization Services cost $60 per hour per person with a three-hour minimum per person.",
  "Detailed, Extreme, ineligible Post-Construction properties, and all commercial cleaning require a custom quote based on size, condition, scope, frequency, and access.",
  "Starting prices can change based on condition, square footage, clutter, pet hair, buildup, parking/accessibility, bathrooms, levels, and requested work.",
  "Deep Cleaning includes inside oven, inside refrigerator, light dishwashing, and inside empty cabinets or drawers, plus cleaning behind appliances that are safe to move.",
  "Service area: all five NYC boroughs and Long Island. Phone: 929-803-4053. Email: info@imancleaningservice.com.",
  "For emergencies, hazards, biohazards, mold remediation, pest activity, hoarding, or unsafe conditions, explain that a specialist or custom evaluation may be required.",
  "When the visitor wants a quote, tell them to choose Get a Quote from the Main Menu or open the website quote form. Do not ask for sensitive payment information in chat."
].join("\n");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(response, 503, { error: "The AI assistant is not configured yet." });
    }

    const body = await readBody(request);
    const messages = normalizeMessages(body.messages);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return json(response, 400, { error: "A customer message is required." });
    }

    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
        instructions: INSTRUCTIONS,
        input: messages,
        max_output_tokens: 300
      })
    });

    const data = await openAIResponse.json().catch(() => ({}));
    if (!openAIResponse.ok) {
      throw Object.assign(new Error(data?.error?.message || "The AI assistant could not respond."), { statusCode: 502 });
    }

    const reply = cleanText(extractOutputText(data), 1600);
    if (!reply) throw Object.assign(new Error("The AI assistant returned an empty response."), { statusCode: 502 });
    return json(response, 200, { reply });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "The AI assistant could not respond."
    });
  }
};
