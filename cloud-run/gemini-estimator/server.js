const express = require("express");
const { VertexAI } = require("@google-cloud/vertexai");
const { jsonrepair } = require("jsonrepair");

const app = express();
const port = process.env.PORT || 8080;
const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash-002";
const serviceToken = process.env.IMAN_AI_SERVICE_TOKEN || "";

app.use(express.json({ limit: "12mb" }));

function cleanDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1] === "image/jpg" ? "image/jpeg" : match[1],
    data: match[2]
  };
}

function parseJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const fencedJson = fenced[1].trim();
    try {
      return JSON.parse(fencedJson);
    } catch (_error) {
      return JSON.parse(jsonrepair(fencedJson));
    }
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    try {
      return JSON.parse(jsonrepair(raw));
    } catch (_repairError) {
      // Fall through to balanced-object extraction.
    }

    const candidates = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        if (depth === 0) start = index;
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          candidates.push(raw.slice(start, index + 1));
          start = -1;
        }
      }
    }

    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(candidates[index]);
      } catch (_candidateError) {
        try {
          return JSON.parse(jsonrepair(candidates[index]));
        } catch (_candidateRepairError) {
          // Try the previous candidate.
        }
      }
    }

    throw error;
  }
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

function fallbackEstimate(input = {}) {
  const service = String(input.service || "Standard Cleaning");
  const bedrooms = Number(input.bedrooms || 0);
  const bathrooms = Number(input.bathrooms || 0);
  const sqft = Number(input.sqft || 0);
  const clutter = String(input.clutter || "Medium");
  const photos = Array.isArray(input.images) ? input.images.length : 0;
  const isDeep = /deep|move|airbnb|commercial|post-construction/i.test(service);
  const clutterBoost = clutter === "Heavy" ? 1.4 : clutter === "Medium" ? 1.15 : 1;
  const baseHours = 1.75 + bedrooms * 0.65 + bathrooms * 0.55 + Math.max(sqft, 500) / 850;
  const hoursLow = Math.max(2, Math.round(baseHours * clutterBoost * (isDeep ? 1.2 : 1) * 2) / 2);
  const hoursHigh = hoursLow + (isDeep ? 1.5 : 1);
  const cleaners = hoursHigh >= 4 || /commercial|move|airbnb/i.test(service) ? 2 : 1;
  const rateEstimate = calculateRateEstimate(input, `${hoursLow}-${hoursHigh} hours`);

  return {
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
  const fallback = fallbackEstimate(input);
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

function assertAuthorized(request, response) {
  if (!serviceToken) return true;
  const providedToken = request.header("x-iman-ai-token");
  if (providedToken === serviceToken) return true;
  response.status(401).json({ error: "Unauthorized AI estimate request." });
  return false;
}

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "iman-gemini-estimator" });
});

app.post("/estimate", async (request, response) => {
  try {
    if (!assertAuthorized(request, response)) return;

    const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
    if (!project) {
      return response.status(500).json({ error: "GOOGLE_CLOUD_PROJECT is not available in Cloud Run." });
    }

    const input = request.body || {};
    const images = Array.isArray(input.images) ? input.images.slice(0, 4).map(cleanDataUrl).filter(Boolean) : [];
    const vertexAI = new VertexAI({ project, location });
    const model = vertexAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 900,
        responseMimeType: "application/json"
      }
    });

    const prompt = [
      "You are the AI cleaning estimator for IMAN CLEANING SERVICE LLC.",
      "Analyze the provided booking details and cleaning photos.",
      "Estimate cleaning difficulty, clutter level, hours, recommended cleaner count, included work, and excluded work.",
      "Be practical and conservative for NYC cleaning jobs.",
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

    const parts = [
      { text: prompt },
      ...images.map((image) => ({
        inlineData: {
          mimeType: image.mimeType,
          data: image.data
        }
      }))
    ];

    const result = await model.generateContent({
      contents: [{ role: "user", parts }]
    });

    const text = result.response?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "{}";
    const estimate = normalizeEstimate(input, parseJson(text));

    response.json({
      estimate: {
        provider: "vertex-gemini",
        ...estimate
      }
    });
  } catch (error) {
    response.status(500).json({ error: error.message || "Gemini estimate failed." });
  }
});

app.listen(port, () => {
  console.log(`Iman Gemini estimator listening on ${port}`);
});
