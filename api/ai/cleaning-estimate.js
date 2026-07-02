function json(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 12 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

const BOROUGH_RATES = {
  queens: { label: "Queens", hourlyRate: 55 },
  manhattan: { label: "Manhattan", hourlyRate: 65 },
  bronx: { label: "Bronx", hourlyRate: 65 },
  brooklyn: { label: "Brooklyn", hourlyRate: 65 },
  statenIsland: { label: "Staten Island", hourlyRate: 75 }
};

function detectBorough(input = {}) {
  const locationText = `${input.borough || ""} ${input.address || ""}`.toLowerCase();
  if (/staten\s*island|\bsi\b/.test(locationText)) return BOROUGH_RATES.statenIsland;
  if (/queens|astoria|jamaica|flushing|long island city|lic|forest hills|jackson heights|elmhurst|corona/.test(locationText)) return BOROUGH_RATES.queens;
  if (/manhattan|new york, ny|harlem|chelsea|soho|tribeca|upper east|upper west|midtown|downtown/.test(locationText)) return BOROUGH_RATES.manhattan;
  if (/bronx|riverdale|fordham|mott haven|pelham/.test(locationText)) return BOROUGH_RATES.bronx;
  if (/brooklyn|williamsburg|bushwick|bed[-\s]?stuy|park slope|crown heights|bay ridge|greenpoint/.test(locationText)) return BOROUGH_RATES.brooklyn;
  return BOROUGH_RATES.queens;
}

function parseHours(estimatedHours) {
  const value = String(estimatedHours || "");
  const numbers = value.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  if (numbers.length >= 2) return { low: numbers[0], high: numbers[1] };
  if (numbers.length === 1) return { low: numbers[0], high: numbers[0] };
  return null;
}

function formatMoney(amount) {
  return `$${Math.round(amount / 5) * 5}`;
}

function calculateRateEstimate(input, estimatedHours) {
  const borough = detectBorough(input);
  const hours = parseHours(estimatedHours);
  if (!hours) return null;
  const low = Math.max(1, hours.low);
  const high = Math.max(low, hours.high);
  const priceLow = low * borough.hourlyRate;
  const priceHigh = high * borough.hourlyRate;
  return {
    borough: borough.label,
    hourlyRate: `$${borough.hourlyRate}/hour`,
    priceRange: `${formatMoney(priceLow)}-${formatMoney(priceHigh)}`,
    depositRequired: formatMoney(Math.max(40, priceLow * 0.25))
  };
}

function demoEstimate(input) {
  const service = String(input.service || "Standard Cleaning");
  const bedrooms = Number(input.bedrooms || 0);
  const bathrooms = Number(input.bathrooms || 0);
  const sqft = Number(input.sqft || 0);
  const clutter = String(input.clutter || "Medium");
  const photos = Array.isArray(input.images) ? input.images.length : 0;
  const isDeep = /deep|move|airbnb|commercial/i.test(service);
  const clutterBoost = clutter === "Heavy" ? 1.4 : clutter === "Medium" ? 1.15 : 1;
  const baseHours = 1.75 + bedrooms * 0.65 + bathrooms * 0.55 + Math.max(sqft, 500) / 850;
  const hoursLow = Math.max(2, Math.round(baseHours * clutterBoost * (isDeep ? 1.2 : 1) * 2) / 2);
  const hoursHigh = hoursLow + (isDeep ? 1.5 : 1);
  const cleaners = hoursHigh >= 4 || /commercial|move|airbnb/i.test(service) ? 2 : 1;
  const rateEstimate = calculateRateEstimate(input, `${hoursLow}-${hoursHigh} hours`);

  return {
    provider: "demo",
    difficulty: isDeep || clutter === "Heavy" ? "Moderate to high" : "Moderate",
    clutterLevel: clutter || "Medium",
    estimatedHours: `${hoursLow}-${hoursHigh} hours`,
    recommendedCleaners: cleaners,
    borough: rateEstimate.borough,
    hourlyRate: rateEstimate.hourlyRate,
    priceRange: rateEstimate.priceRange,
    depositRequired: rateEstimate.depositRequired,
    confidence: photos ? "Medium" : "Low until photos are uploaded",
    summary: photos
      ? `Based on ${photos} uploaded photo${photos === 1 ? "" : "s"}, this looks like a ${service.toLowerCase()} job with ${clutter.toLowerCase()} clutter.`
      : "Upload photos for a stronger AI estimate.",
    included: [
      "Visible surfaces",
      "Kitchen exterior surfaces",
      "Bathrooms",
      "Floors",
      "Trash removal"
    ],
    notIncluded: [
      "Hazardous waste",
      "Pest removal",
      "Heavy lifting",
      "Exterior windows"
    ]
  };
}

function normalizeEstimate(input, estimate) {
  const fallback = demoEstimate(input);
  const normalized = {
    ...fallback,
    ...(estimate && typeof estimate === "object" ? estimate : {})
  };

  for (const key of ["difficulty", "clutterLevel", "estimatedHours", "priceRange", "depositRequired", "confidence", "summary"]) {
    if (!normalized[key]) normalized[key] = fallback[key];
  }

  if (!Number.isFinite(Number(normalized.recommendedCleaners)) || Number(normalized.recommendedCleaners) < 1) {
    normalized.recommendedCleaners = fallback.recommendedCleaners;
  }

  const rateEstimate = calculateRateEstimate(input, normalized.estimatedHours);
  if (rateEstimate) {
    normalized.borough = rateEstimate.borough;
    normalized.hourlyRate = rateEstimate.hourlyRate;
    normalized.priceRange = rateEstimate.priceRange;
    normalized.depositRequired = rateEstimate.depositRequired;
  }

  if (!Array.isArray(normalized.included) || normalized.included.length === 0) {
    normalized.included = fallback.included;
  }

  if (!Array.isArray(normalized.notIncluded) || normalized.notIncluded.length === 0) {
    normalized.notIncluded = fallback.notIncluded;
  }

  Object.keys(normalized).forEach((key) => {
    if (!key || normalized[key] === null || typeof normalized[key] === "undefined") {
      delete normalized[key];
    }
  });

  return normalized;
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

async function createOpenAIEstimate(input) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    return demoEstimate(input);
  }

  const imageContent = (input.images || []).slice(0, 4).map((imageUrl) => ({
    type: "input_image",
    image_url: imageUrl,
    detail: "low"
  }));

  const prompt = [
    "You are the AI cleaning estimator for IMAN CLEANING SERVICE LLC.",
    "Estimate cleaning difficulty, clutter level, hours, cleaner count, included work, and excluded work.",
    "Be conservative and practical for NYC residential and commercial cleaning.",
    "Pricing is controlled by IMAN official borough rates, so estimate time only and do not invent prices.",
    "Official hourly rates: Queens $55/hour; Manhattan $65/hour; Bronx $65/hour; Brooklyn $65/hour; Staten Island $75/hour.",
    "Return only valid JSON with these keys: difficulty, clutterLevel, estimatedHours, recommendedCleaners, confidence, summary, included, notIncluded.",
    `Booking details: ${JSON.stringify({
      service: input.service,
      address: input.address,
      borough: input.borough,
      propertyType: input.propertyType,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      sqft: input.sqft,
      kitchen: input.kitchen,
      livingRoom: input.livingRoom,
      pets: input.pets,
      clutter: input.clutter,
      lastCleaned: input.lastCleaned,
      extras: input.extras
    })}`
  ].join("\n");

  const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            ...imageContent
          ]
        }
      ]
    })
  });

  const data = await openAIResponse.json();

  if (!openAIResponse.ok) {
    throw new Error(data.error?.message || "OpenAI estimate failed.");
  }

  const outputText = data.output_text || data.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("\n");
  const estimate = extractJson(outputText || "{}");

  return {
    provider: "openai",
    ...estimate
  };
}

async function createCloudRunGeminiEstimate(input) {
  const endpoint = process.env.GEMINI_ESTIMATOR_URL;
  const token = process.env.IMAN_AI_SERVICE_TOKEN;

  if (!endpoint) return null;

  const geminiResponse = await fetch(`${endpoint.replace(/\/$/, "")}/estimate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-iman-ai-token": token } : {})
    },
    body: JSON.stringify(input)
  });
  const data = await geminiResponse.json();

  if (!geminiResponse.ok) {
    throw new Error(data.error || "Gemini estimator service failed.");
  }

  return data.estimate;
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const input = await readBody(request);
    const images = Array.isArray(input.images) ? input.images : [];

    if (images.length > 4) {
      return json(response, 400, { error: "Upload up to 4 photos for the first AI estimate." });
    }

    const cloudRunEstimate = await createCloudRunGeminiEstimate({ ...input, images });
    const estimate = normalizeEstimate({ ...input, images }, cloudRunEstimate || await createOpenAIEstimate({ ...input, images }));
    return json(response, 200, { estimate });
  } catch (error) {
    return json(response, 500, { error: error.message || "AI estimate failed." });
  }
};
