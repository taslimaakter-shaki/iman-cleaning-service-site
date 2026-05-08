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
  const locationText = [
    input.borough,
    input.city,
    input.streetAddress,
    input.zipCode
  ].filter(Boolean).join(" ").toLowerCase();

  if (/staten\s*island|\bsi\b|103\d{2}/.test(locationText)) return BOROUGH_RATES.statenIsland;
  if (/queens|astoria|jamaica|flushing|long island city|\blic\b|forest hills|jackson heights|elmhurst|corona|113\d{2}|114\d{2}|111\d{2}/.test(locationText)) return BOROUGH_RATES.queens;
  if (/manhattan|new york, ny|harlem|chelsea|soho|tribeca|upper east|upper west|midtown|downtown|100\d{2}|101\d{2}/.test(locationText)) return BOROUGH_RATES.manhattan;
  if (/bronx|riverdale|fordham|mott haven|pelham|104\d{2}/.test(locationText)) return BOROUGH_RATES.bronx;
  if (/brooklyn|williamsburg|bushwick|bed[-\s]?stuy|park slope|crown heights|bay ridge|greenpoint|112\d{2}/.test(locationText)) return BOROUGH_RATES.brooklyn;
  return BOROUGH_RATES.queens;
}

function parseHours(estimatedHours) {
  const numbers = String(estimatedHours || "").match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
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
  const service = String(input.serviceType || input.serviceCategory || "Cleaning");
  const sqft = Number(input.squareFootage || 0);
  const bedrooms = Number(input.bedrooms || 0);
  const fullBathrooms = Number(input.fullBathrooms || 0);
  const halfBathrooms = Number(input.halfBathrooms || 0);
  const clutterText = String(input.clutter || "");
  const buildupText = String(input.heavyBuildup || "");
  const addOns = Array.isArray(input.addOns) ? input.addOns : [];
  const images = Array.isArray(input.images) ? input.images.length : 0;
  const isCommercial = String(input.serviceCategory || "").toLowerCase() === "commercial";
  const isDetailed = /deep|move|construction|renovation|detailed/i.test(service);
  const clutterBoost = /heavy/i.test(clutterText) ? 1.4 : /some/i.test(clutterText) ? 1.15 : 1;
  const buildupBoost = /heavy/i.test(buildupText) ? 1.25 : /some/i.test(buildupText) ? 1.1 : 1;
  const addOnBoost = Math.min(1.75, 1 + addOns.filter((item) => !/no add/i.test(item)).length * 0.08);
  const baseHours = isCommercial
    ? 2.5 + Math.max(sqft, 800) / 950
    : 1.75 + bedrooms * 0.65 + fullBathrooms * 0.55 + halfBathrooms * 0.3 + Math.max(sqft, 500) / 850;
  const hoursLow = Math.max(2, Math.round(baseHours * clutterBoost * buildupBoost * addOnBoost * (isDetailed ? 1.22 : 1) * 2) / 2);
  const hoursHigh = hoursLow + (isCommercial || isDetailed ? 1.5 : 1);
  const recommendedCleaners = hoursHigh >= 4 || isCommercial || /move|construction/i.test(service) ? 2 : 1;
  const rateEstimate = calculateRateEstimate(input, `${hoursLow}-${hoursHigh} hours`);

  return {
    provider: "estimate-engine",
    difficulty: isDetailed || /heavy/i.test(clutterText + buildupText) ? "Moderate to high" : "Moderate",
    clutterLevel: /heavy/i.test(clutterText) ? "Heavy" : /some/i.test(clutterText) ? "Medium" : "Light",
    estimatedHours: `${hoursLow}-${hoursHigh} hours`,
    recommendedCleaners,
    borough: rateEstimate.borough,
    hourlyRate: rateEstimate.hourlyRate,
    priceRange: rateEstimate.priceRange,
    depositRequired: rateEstimate.depositRequired,
    confidence: images ? "Medium" : "Low until photos are reviewed",
    summary: images
      ? `AI reviewed ${images} uploaded photo${images === 1 ? "" : "s"} plus the quote details.`
      : "Estimate is based on the quote form details. Photos can improve accuracy.",
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

  for (const key of ["difficulty", "clutterLevel", "estimatedHours", "confidence", "summary"]) {
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

  if (!Array.isArray(normalized.included) || normalized.included.length === 0) normalized.included = fallback.included;
  if (!Array.isArray(normalized.notIncluded) || normalized.notIncluded.length === 0) normalized.notIncluded = fallback.notIncluded;

  Object.keys(normalized).forEach((key) => {
    if (!key || normalized[key] === null || typeof normalized[key] === "undefined") delete normalized[key];
  });

  return normalized;
}

async function createCloudRunGeminiEstimate(input) {
  const endpoint = process.env.GEMINI_ESTIMATOR_URL;
  const token = process.env.IMAN_AI_SERVICE_TOKEN;
  if (!endpoint) return null;

  const payload = {
    service: input.serviceType || input.serviceCategory,
    address: [input.streetAddress, input.city, input.state, input.zipCode].filter(Boolean).join(", "),
    borough: detectBorough(input).label,
    propertyType: input.propertyType || input.commercialSpaceType,
    bedrooms: input.bedrooms,
    bathrooms: Number(input.fullBathrooms || 0) + Number(input.halfBathrooms || 0) * 0.5,
    sqft: input.squareFootage,
    kitchen: input.kitchenDiningRooms ? `${input.kitchenDiningRooms} kitchen/dining` : "",
    livingRoom: input.livingRooms ? `${input.livingRooms} living rooms` : "",
    pets: input.pets,
    clutter: input.clutter,
    lastCleaned: input.lastCleaned,
    extras: input.addOns,
    images: input.images
  };

  try {
    const geminiResponse = await fetch(`${endpoint.replace(/\/$/, "")}/estimate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-iman-ai-token": token } : {})
      },
      body: JSON.stringify(payload)
    });
    const data = await geminiResponse.json();
    if (!geminiResponse.ok) throw new Error(data.error || "Gemini estimator service failed.");
    return data.estimate;
  } catch (_error) {
    return null;
  }
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });

    const input = await readBody(request);
    const images = Array.isArray(input.images) ? input.images.slice(0, 4) : [];
    const cloudRunEstimate = await createCloudRunGeminiEstimate({ ...input, images });
    const estimate = normalizeEstimate({ ...input, images }, cloudRunEstimate);
    return json(response, 200, { estimate });
  } catch (error) {
    return json(response, 500, { error: error.message || "AI estimate failed." });
  }
};
