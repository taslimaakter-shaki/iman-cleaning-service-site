const crypto = require("crypto");

const TEAM_SIZE = 2;
const MAN_HOUR_RATE = 80;
const ORGANIZATION_HOURLY_RATE = 60;
const ORGANIZATION_MIN_HOURS = 4;
const HOLD_MINUTES = 30;
const TIME_ZONE = "America/New_York";
const OPEN_TIME = "08:00";
const CLOSE_TIME = "20:30";
const APPOINTMENT_GAP_HOURS = 3;
const SLOT_INTERVAL_MINUTES = 30;
const MIN_BOOKING_NOTICE_HOURS = 24;
const MAX_ADVANCE_BOOKING_DAYS = 60;
const NY_SALES_TAX_RATE = 0.08875;
const NYC_ZIP_PREFIXES = new Set([
  "100", "101", "102", "103", "104", "111", "112", "113", "114", "116"
]);
const NYC_QUEENS_SPLIT_ZIPS = new Set(["11004", "11005"]);
const WINDOW_TARGET_TEAM_HOURLY = 180;
const WINDOW_PRICES = {
  single_hung: { label: "Single-hung window", interior: 18, exterior: 17, both: 28, minutes: 9 },
  double_hung: { label: "Double-hung window", interior: 22, exterior: 20, both: 34, minutes: 10 },
  sliding: { label: "Sliding window assembly", interior: 20, exterior: 19, both: 32, minutes: 10 },
  bathroom_sliding_half: { label: "Bathroom sliding window (half-size)", interior: 13, exterior: 12, both: 20, minutes: 6 },
  bathroom_hung_half: { label: "Bathroom hung window (half-size)", interior: 14, exterior: 13, both: 22, minutes: 7 },
  casement: { label: "Casement sash", interior: 18, exterior: 17, both: 29, minutes: 9 },
  awning: { label: "Awning sash", interior: 16, exterior: 15, both: 25, minutes: 8 },
  hopper: { label: "Hopper sash", interior: 15, exterior: 14, both: 23, minutes: 8 },
  picture_fixed: { label: "Picture / fixed panel", interior: 15, exterior: 15, both: 24, minutes: 8 },
  bay_up_to_3_panels: { label: "Bay assembly (up to 3 panels)", interior: 45, exterior: 42, both: 70, minutes: 22 },
  bow_up_to_5_panels: { label: "Bow assembly (up to 5 panels)", interior: 65, exterior: 60, both: 100, minutes: 30 },
  garden: { label: "Garden window assembly", interior: 36, exterior: 35, both: 58, minutes: 18 },
  transom: { label: "Transom panel", interior: 12, exterior: 12, both: 19, minutes: 6 },
  french_grid: { label: "French / grid sash", interior: 27, exterior: 25, both: 42, minutes: 13 },
  jalousie: { label: "Jalousie assembly", interior: 30, exterior: 28, both: 48, minutes: 15 },
  arched_specialty: { label: "Arched / specialty panel", interior: 25, exterior: 24, both: 40, minutes: 12 },
  skylight: { label: "Skylight", interior: 28, exterior: 32, both: 48, minutes: 16 },
  storefront_panel: { label: "Storefront panel", interior: 12, exterior: 12, both: 20, minutes: 3 }
};
const SERVICES = {
  standard: {
    label: "Standard Cleaning",
    prices: {
      studio_1bath: 200,
      "1bed_1bath": 250,
      "2bed_1bath": 300,
      "3bed_1bath": 350,
      "3bed_2bath": 400
    },
    laborHours: {
      studio_1bath: 3
    }
  },
  deep: {
    label: "Deep Cleaning",
    prices: {
      studio_1bath: 300,
      "1bed_1bath": 400,
      "2bed_1bath": 480,
      "3bed_1bath": 560,
      "3bed_2bath": 640
    }
  },
  move: {
    label: "Move-In / Move-Out Cleaning",
    prices: {
      studio_1bath: 300,
      "1bed_1bath": 400,
      "2bed_1bath": 480,
      "3bed_1bath": 560,
      "3bed_2bath": 640
    }
  },
  post: {
    label: "Post-Construction Cleaning",
    prices: {
      studio_1bath: 400,
      "1bed_1bath": 500,
      "2bed_1bath": 580,
      "3bed_1bath": 660,
      "3bed_2bath": 740
    }
  }
};

const TIERS = {
  studio_1bath: { label: "Studio / 1 Bathroom", bedroomsLabel: "Studio", bathroomsLabel: "1 bathroom" },
  "1bed_1bath": { label: "1 Bedroom / 1 Bathroom", bedroomsLabel: "1 bedroom", bathroomsLabel: "1 bathroom" },
  "2bed_1bath": { label: "2 Bedrooms / 1 Bathroom", bedroomsLabel: "2 bedrooms", bathroomsLabel: "1 bathroom" },
  "3bed_1bath": { label: "3 Bedrooms / 1 Bathroom", bedroomsLabel: "3 bedrooms", bathroomsLabel: "1 bathroom" },
  "3bed_2bath": { label: "3 Bedrooms / 2 Bathrooms", bedroomsLabel: "3 bedrooms", bathroomsLabel: "2 bathrooms" }
};

function json(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function readJsonBody(request, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(Object.assign(new Error("Invalid request body."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function cleanText(value, maxLength = 500) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeServiceZip(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 5);
}

function isNYCServiceZip(value) {
  const zip = normalizeServiceZip(value);
  if (!/^\d{5}$/.test(zip)) return false;
  return NYC_ZIP_PREFIXES.has(zip.slice(0, 3)) || NYC_QUEENS_SPLIT_ZIPS.has(zip);
}

function roundUpToHalfHour(value) {
  return Math.ceil(Number(value) * 2) / 2;
}

function inclusiveTaxBreakdown(totalCents) {
  const normalizedTotalCents = Math.round(Number(totalCents));
  const subtotalCents = Math.round(normalizedTotalCents / (1 + NY_SALES_TAX_RATE));
  const taxCents = normalizedTotalCents - subtotalCents;
  return {
    subtotal: subtotalCents / 100,
    subtotalCents,
    tax: taxCents / 100,
    taxCents,
    taxRate: NY_SALES_TAX_RATE,
    total: normalizedTotalCents / 100,
    totalCents: normalizedTotalCents
  };
}

function allocateInclusiveTaxAcrossItems(items, subtotalCents) {
  const taxableItems = items.filter((item) => Number(item.amount) > 0);
  const allocations = taxableItems.map((item) => {
    const grossCents = Math.round(Number(item.amount) * 100);
    const exactSubtotalCents = grossCents / (1 + NY_SALES_TAX_RATE);
    return {
      item,
      grossCents,
      subtotalCents: Math.floor(exactSubtotalCents),
      remainder: exactSubtotalCents % 1
    };
  });
  let centsToAllocate = subtotalCents - allocations.reduce(
    (total, allocation) => total + allocation.subtotalCents,
    0
  );
  allocations
    .sort((left, right) => right.remainder - left.remainder)
    .forEach((allocation) => {
      if (centsToAllocate > 0) {
        allocation.subtotalCents += 1;
        centsToAllocate -= 1;
      }
    });
  allocations.forEach(({ item, grossCents, subtotalCents: itemSubtotalCents }) => {
    item.preTaxAmount = itemSubtotalCents / 100;
    item.taxAmount = (grossCents - itemSubtotalCents) / 100;
  });
  items
    .filter((item) => Number(item.amount) === 0)
    .forEach((item) => {
      item.preTaxAmount = 0;
      item.taxAmount = 0;
    });
}

function wholeNumber(value, field, maximum = 50) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > maximum) {
    throw Object.assign(new Error(`Enter a valid ${field}.`), { statusCode: 400 });
  }
  return number;
}

function yesNo(value, field) {
  const normalized = cleanText(value, 20);
  if (!["yes", "no"].includes(normalized)) {
    throw Object.assign(new Error(`Choose Yes or No for ${field}.`), { statusCode: 400 });
  }
  return normalized;
}

const FORMULA_SERVICES = {
  standard: {
    label: "Standard Cleaning",
    roomRate: 50,
    halfBathroomRate: 30,
    kitchenRate: 50,
    combinedLivingDining: 80,
    separateLivingDining: 100
  },
  deep: {
    label: "Deep Cleaning",
    roomRate: 80,
    halfBathroomRate: 60,
    kitchenRate: 80,
    combinedLivingDining: 100,
    separateLivingDining: 160
  },
  move: {
    label: "Move-Out Cleaning",
    roomRate: 80,
    halfBathroomRate: 60,
    kitchenRate: 150,
    combinedLivingDining: 100,
    separateLivingDining: 160
  }
};

function calculateResidentialUnitPrice(unit = {}, unitIndex = 0, serviceKey = "standard") {
  const service = FORMULA_SERVICES[serviceKey];
  if (!service) {
    throw Object.assign(new Error("Choose Standard, Deep, or Move-Out Cleaning."), { statusCode: 400 });
  }
  const unitNumber = unitIndex + 1;
  const bedrooms = wholeNumber(unit.bedrooms, `the number of bedrooms in Unit ${unitNumber}`, 20);
  const fullBathrooms = wholeNumber(unit.fullBathrooms, `the number of full bathrooms in Unit ${unitNumber}`, 20);
  const halfBathrooms = wholeNumber(unit.halfBathrooms, `the number of half bathrooms in Unit ${unitNumber}`, 20);
  const additionalRooms = serviceKey === "standard"
    ? 0
    : wholeNumber(unit.additionalRooms, `the number of additional rooms in Unit ${unitNumber}`, 30);
  const livingDining = cleanText(unit.livingDining, 20);
  if (!["combined", "separate"].includes(livingDining)) {
    throw Object.assign(new Error(`Choose whether the living room and dining room are combined or separate in Unit ${unitNumber}.`), { statusCode: 400 });
  }
  const hasPets = yesNo(unit.hasPets || "no", `whether there are pets in Unit ${unitNumber}`);
  let petCount = 0;
  let petType = "";
  let otherPetType = "";
  if (hasPets === "yes") {
    petCount = wholeNumber(unit.petCount, `the number of pets in Unit ${unitNumber}`, 20);
    if (petCount < 1) {
      throw Object.assign(new Error(`Enter the number of pets in Unit ${unitNumber}.`), { statusCode: 400 });
    }
    petType = cleanText(unit.petType, 20);
    if (!["cats", "dogs", "cats-and-dogs", "other"].includes(petType)) {
      throw Object.assign(new Error(`Choose the type of pets in Unit ${unitNumber}.`), { statusCode: 400 });
    }
    if (petType === "other") {
      otherPetType = cleanText(unit.otherPetType, 80);
      if (!otherPetType) {
        throw Object.assign(new Error(`Enter the type of pet in Unit ${unitNumber}.`), { statusCode: 400 });
      }
    }
  }

  const excludeKitchenItems = serviceKey === "move"
    ? yesNo(unit.excludeKitchenItems || "no", `whether to exclude kitchen items in Unit ${unitNumber}`)
    : "no";
  const excludeOven = serviceKey === "move" && excludeKitchenItems === "yes"
    ? yesNo(unit.excludeOven, `excluding inside oven cleaning in Unit ${unitNumber}`)
    : "no";
  const excludeRefrigerator = serviceKey === "move" && excludeKitchenItems === "yes"
    ? yesNo(unit.excludeRefrigerator, `excluding inside refrigerator cleaning in Unit ${unitNumber}`)
    : "no";
  const excludeCabinets = serviceKey === "move" && excludeKitchenItems === "yes"
    ? yesNo(unit.excludeCabinets, `excluding inside cabinet cleaning in Unit ${unitNumber}`)
    : "no";
  const submittedRefrigerator = cleanText(unit.refrigerator, 30);
  const refrigerator = serviceKey === "move"
    ? (excludeRefrigerator === "yes" ? "excluded" : "included")
    : submittedRefrigerator === "yes"
      ? "empty"
      : submittedRefrigerator;
  if (serviceKey !== "move" && !["no", "empty", "not-empty"].includes(refrigerator)) {
    throw Object.assign(new Error(`Choose a refrigerator-cleaning option for Unit ${unitNumber}.`), { statusCode: 400 });
  }
  const oven = serviceKey === "move"
    ? (excludeOven === "yes" ? "excluded" : "included")
    : yesNo(unit.oven, `inside oven cleaning in Unit ${unitNumber}`);
  const cabinets = serviceKey === "move"
    ? (excludeCabinets === "yes" ? "excluded" : "included")
    : yesNo(unit.cabinets, `inside kitchen cabinet cleaning in Unit ${unitNumber}`);
  const additionalCleaning = yesNo(
    unit.additionalCleaning || "no",
    `additional cleaning in Unit ${unitNumber}`
  );
  const windowCleaning = serviceKey === "move"
    ? "interior_included"
    : cleanText(unit.windowCleaning || "no", 30);
  const exteriorWindows = serviceKey === "move"
    ? yesNo(unit.exteriorWindows || "no", `exterior window cleaning in Unit ${unitNumber}`)
    : "no";
  if (serviceKey !== "move" && !["no", "interior", "exterior", "interior_exterior"].includes(windowCleaning)) {
    throw Object.assign(new Error(`Choose a window-cleaning option for Unit ${unitNumber}.`), { statusCode: 400 });
  }
  if ((serviceKey !== "move" && windowCleaning !== "no") || exteriorWindows === "yes") {
    throw Object.assign(new Error("Window cleaning requires the existing window quote calculator so window type, count, and access can be reviewed."), {
      statusCode: 409,
      reviewRequired: true,
      reviewUrl: "/quote.html?service=window-cleaning&qualification_reason=window_addon"
    });
  }

  let cabinetCount = 0;
  let drawerCount = 0;
  let cabinetsEmpty = "no";
  if (cabinets === "yes") {
    cabinetCount = wholeNumber(unit.cabinetCount, `the approximate number of kitchen cabinets in Unit ${unitNumber}`, 100);
    if (cabinetCount < 1) {
      throw Object.assign(new Error(`Enter the approximate number of kitchen cabinets in Unit ${unitNumber}.`), { statusCode: 400 });
    }
    drawerCount = wholeNumber(unit.drawerCount, `the approximate number of kitchen drawers in Unit ${unitNumber}`, 100);
    cabinetsEmpty = yesNo(unit.cabinetsEmpty, `whether the kitchen cabinets and drawers will be empty in Unit ${unitNumber}`);
  }

  const kitchenDiscount = serviceKey === "move"
    ? (excludeOven === "yes" ? 30 : 0) +
      (excludeRefrigerator === "yes" ? 40 : 0) +
      (excludeCabinets === "yes" ? 50 : 0)
    : 0;
  const includedKitchenItems = [
    refrigerator === "included" ? "refrigerator" : "",
    oven === "included" ? "oven" : "",
    cabinets === "included" ? "cabinets" : ""
  ].filter(Boolean);
  const excludedKitchenItems = [
    refrigerator === "excluded" ? "refrigerator" : "",
    oven === "excluded" ? "oven" : "",
    cabinets === "excluded" ? "cabinets" : ""
  ].filter(Boolean);
  const kitchenLabel = serviceKey !== "move"
    ? "Kitchen"
    : excludedKitchenItems.length
      ? includedKitchenItems.length
        ? `Kitchen (included: inside ${includedKitchenItems.join(", ")}; excluded: inside ${excludedKitchenItems.join(", ")})`
        : "Kitchen (inside refrigerator, oven, and cabinet cleaning excluded)"
      : "Kitchen (includes inside refrigerator, oven, and cabinets)";

  const baseItems = [
    { key: "bedrooms", label: `${bedrooms} bedroom${bedrooms === 1 ? "" : "s"}`, amount: bedrooms * service.roomRate },
    { key: "full_bathrooms", label: `${fullBathrooms} full bathroom${fullBathrooms === 1 ? "" : "s"}`, amount: fullBathrooms * service.roomRate },
    { key: "half_bathrooms", label: `${halfBathrooms} half bathroom${halfBathrooms === 1 ? "" : "s"}`, amount: halfBathrooms * service.halfBathroomRate },
    {
      key: "kitchen",
      label: kitchenLabel,
      amount: service.kitchenRate - kitchenDiscount
    },
    {
      key: "living_dining",
      label: livingDining === "combined" ? "Combined living & dining area" : "Separate living room & dining room",
      amount: livingDining === "combined" ? service.combinedLivingDining : service.separateLivingDining
    },
    additionalRooms ? { key: "additional_rooms", label: `${additionalRooms} additional room${additionalRooms === 1 ? "" : "s"}`, amount: additionalRooms * 80 } : null,
    serviceKey === "move" ? { key: "interior_windows", label: "Interior window cleaning", amount: 0, included: true } : null
  ].filter(Boolean);
  const addOns = [
    hasPets === "yes" ? {
      key: "pet_fee",
      label: `Pet fee (${petCount} pet${petCount === 1 ? "" : "s"})`,
      amount: 50 + Math.max(0, petCount - 1) * 30
    } : null,
    refrigerator === "empty" ? { key: "refrigerator", label: "Inside refrigerator (emptied)", amount: 40 } : null,
    refrigerator === "not-empty" ? { key: "refrigerator", label: "Inside refrigerator (not empty)", amount: 60 } : null,
    oven === "yes" ? { key: "oven", label: "Inside oven", amount: 30 } : null,
    cabinets === "yes" ? {
      key: "cabinets",
      label: `Inside ${cabinetCount} kitchen cabinet${cabinetCount === 1 ? "" : "s"} & ${drawerCount} drawer${drawerCount === 1 ? "" : "s"} (${cabinetsEmpty === "yes" ? "empty" : "not empty"})`,
      amount: cabinetsEmpty === "yes"
        ? (cabinetCount * 3) + (drawerCount * 1.5)
        : (cabinetCount * 6) + (drawerCount * 3)
    } : null
  ];
  const pricedAddOns = addOns.filter(Boolean);
  const basePrice = baseItems.reduce((total, item) => total + item.amount, 0);
  const addOnTotal = pricedAddOns.reduce((total, item) => total + item.amount, 0);
  const subtotal = basePrice + addOnTotal;

  return {
    unitNumber,
    bedrooms,
    fullBathrooms,
    halfBathrooms,
    livingDining,
    hasPets,
    petCount,
    petType,
    otherPetType,
    refrigerator,
    oven,
    cabinets,
    cabinetCount,
    drawerCount,
    cabinetsEmpty,
    additionalCleaning,
    excludeKitchenItems,
    excludeOven,
    excludeRefrigerator,
    excludeCabinets,
    kitchenDiscount,
    windowCleaning,
    exteriorWindows,
    additionalRooms,
    baseItems,
    addOns: pricedAddOns,
    basePrice,
    addOnTotal,
    subtotal,
    subtotalCents: subtotal * 100,
    manHours: roundUpToHalfHour(subtotal / MAN_HOUR_RATE)
  };
}

function calculateResidentialQuoteBundle(unitDetails = [], serviceKey = "standard") {
  const service = FORMULA_SERVICES[serviceKey];
  if (!service) {
    throw Object.assign(new Error("Choose Standard, Deep, or Move-Out Cleaning."), { statusCode: 400 });
  }
  if (!Array.isArray(unitDetails) || !unitDetails.length || unitDetails.length > 10) {
    throw Object.assign(new Error("Complete the pricing questions for every residential unit."), { statusCode: 400 });
  }
  const units = unitDetails.map((unit, index) => calculateResidentialUnitPrice(unit, index, serviceKey));
  const basePrice = units.reduce((total, unit) => total + unit.basePrice, 0);
  const addOnTotal = units.reduce((total, unit) => total + unit.addOnTotal, 0);
  const totalCents = Math.round((basePrice + addOnTotal) * 100);
  const taxBreakdown = inclusiveTaxBreakdown(totalCents);
  const { subtotal, subtotalCents, tax, taxCents, taxRate, total } = taxBreakdown;
  const pricedItems = units.flatMap((unit) => [...unit.baseItems, ...unit.addOns]);
  allocateInclusiveTaxAcrossItems(pricedItems, subtotalCents);
  units.forEach((unit) => {
    unit.baseSubtotal = unit.baseItems.reduce((sum, item) => sum + item.preTaxAmount, 0);
    unit.addOnSubtotal = unit.addOns.reduce((sum, item) => sum + item.preTaxAmount, 0);
  });
  const baseSubtotal = units.reduce((sum, unit) => sum + unit.baseSubtotal, 0);
  const addOnSubtotal = units.reduce((sum, unit) => sum + unit.addOnSubtotal, 0);
  const manHours = roundUpToHalfHour(total / MAN_HOUR_RATE);

  return {
    id: `${serviceKey}__instant_${units.length}_unit${units.length === 1 ? "" : "s"}`,
    packageIds: units.map((unit) => `${serviceKey}__instant_unit_${unit.unitNumber}`),
    serviceKey,
    serviceLabel: service.label,
    tierKey: units.length === 1 ? "instant_quote" : "multiple_units",
    tierLabel: units.length === 1 ? `Personalized ${service.label}` : `${units.length} residential units`,
    bedroomsLabel: `${units.reduce((totalBedrooms, unit) => totalBedrooms + unit.bedrooms, 0)} bedrooms`,
    bathroomsLabel: `${units.reduce((totalBathrooms, unit) => totalBathrooms + unit.fullBathrooms + unit.halfBathrooms, 0)} bathrooms`,
    price: total,
    priceCents: totalCents,
    subtotal,
    subtotalCents,
    basePrice,
    baseSubtotal,
    addOnTotal,
    addOnSubtotal,
    taxRate,
    tax,
    taxCents,
    total,
    totalCents,
    manHours,
    teamHours: manHours / TEAM_SIZE,
    cleanerCount: TEAM_SIZE,
    manHourRate: MAN_HOUR_RATE,
    unitCount: units.length,
    pricingMode: `${serviceKey}_formula`,
    units
  };
}

function calculateStandardUnitPrice(unit = {}, unitIndex = 0) {
  return calculateResidentialUnitPrice(unit, unitIndex, "standard");
}

function calculateStandardQuoteBundle(unitDetails = []) {
  return calculateResidentialQuoteBundle(unitDetails, "standard");
}

function calculateWindowQuote(details = {}, serviceZip = "") {
  const scope = cleanText(details.scope, 20);
  const propertyType = cleanText(details.propertyType, 30);
  const frequency = cleanText(details.frequency || "one_time", 30);
  const condition = cleanText(details.condition || "routine", 30);
  const size = cleanText(details.size || "standard", 30);
  const access = cleanText(details.access || "ground_safe", 30);
  if (!["interior", "exterior", "both"].includes(scope)) {
    throw Object.assign(new Error("Choose interior, exterior, or both sides."), { statusCode: 400 });
  }
  if (!["residential", "commercial"].includes(propertyType)) {
    throw Object.assign(new Error("Choose residential or commercial window cleaning."), { statusCode: 400 });
  }
  if (!["one_time", "weekly", "biweekly", "every_four_weeks"].includes(frequency)) {
    throw Object.assign(new Error("Choose a valid service frequency."), { statusCode: 400 });
  }
  const manualReview = condition !== "routine" || size === "very_oversized" ||
    ["third", "special_equipment", "leaning_out", "not_sure"].includes(access);
  if (manualReview) {
    throw Object.assign(new Error("Photos and a brief review are required before we can confirm this window-cleaning price."), {
      statusCode: 409,
      reviewRequired: true,
      reviewUrl: "/quote.html?service=window-cleaning&qualification_reason=window_manual_review"
    });
  }
  if (!["standard", "oversized"].includes(size)) {
    throw Object.assign(new Error("Choose a valid window size."), { statusCode: 400 });
  }
  const selectedWindows = Array.isArray(details.windows) ? details.windows.slice(0, 18) : [];
  if (!selectedWindows.length) {
    throw Object.assign(new Error("Choose at least one window type."), { statusCode: 400 });
  }

  const baseItems = [];
  let baseTotal = 0;
  let teamMinutes = 0;
  selectedWindows.forEach((selection) => {
    const type = cleanText(selection?.type, 40);
    const price = WINDOW_PRICES[type];
    if (!price) throw Object.assign(new Error("Choose a recognized window type."), { statusCode: 400 });
    const quantity = wholeNumber(selection.quantity, `${price.label} quantity`, 200);
    if (quantity < 1) throw Object.assign(new Error(`Enter at least one ${price.label}.`), { statusCode: 400 });
    const amount = price[scope] * quantity;
    const scopeMinutes = scope === "both" ? price.minutes : Math.max(2, Math.round(price.minutes * 0.65));
    baseItems.push({
      key: type,
      label: `${quantity} × ${price.label} (${scope === "both" ? "interior & exterior" : scope})`,
      amount,
      preTaxAmount: amount,
      taxAmount: 0
    });
    baseTotal += amount;
    teamMinutes += scopeMinutes * quantity;
  });

  const addOns = [];
  let addOnTotal = 0;
  const add = (key, label, countValue, rate, minutes = 0) => {
    const count = wholeNumber(countValue || 0, label.toLowerCase(), 500);
    if (!count) return;
    const amount = count * rate;
    addOns.push({ key, label: `${count} × ${label}`, amount, preTaxAmount: amount, taxAmount: 0 });
    addOnTotal += amount;
    teamMinutes += count * minutes;
  };
  add("screens", "removable screen", details.screens, 5, 2);
  add("tracks", "detailed track and sill", details.tracks, 7, 3);

  if (size === "oversized") {
    const amount = Math.round(baseTotal * 0.5 * 100) / 100;
    addOns.push({ key: "oversized", label: "Oversized glass adjustment (15–30 sq. ft.)", amount, preTaxAmount: amount, taxAmount: 0 });
    addOnTotal += amount;
    teamMinutes *= 1.5;
  }

  const discountRates = { weekly: 0.15, biweekly: 0.10, every_four_weeks: 0.05 };
  const discountRate = propertyType === "commercial" ? (discountRates[frequency] || 0) : 0;
  const discount = Math.round(baseTotal * discountRate * 100) / 100;
  if (discount) {
    addOns.push({ key: "recurring_discount", label: `${Math.round(discountRate * 100)}% recurring-service discount`, amount: -discount, preTaxAmount: -discount, taxAmount: 0 });
    addOnTotal -= discount;
  }

  const zip = normalizeServiceZip(serviceZip || details.serviceZip);
  if (!isNYCServiceZip(zip)) {
    throw Object.assign(new Error("Enter a ZIP code within our New York City service area."), { statusCode: 400 });
  }
  let minimum = propertyType === "residential" ? 225 : 175;
  if (propertyType === "commercial" && frequency !== "one_time") {
    minimum = frequency === "every_four_weeks" ? 150 : 125;
  }
  const calculatedSubtotal = Math.round((baseTotal + addOnTotal) * 100) / 100;
  const subtotal = Math.max(minimum, calculatedSubtotal);
  const minimumAdjustment = Math.round((subtotal - calculatedSubtotal) * 100) / 100;
  if (minimumAdjustment > 0) {
    addOns.push({ key: "service_minimum", label: `${propertyType === "residential" ? "Residential" : "Commercial"} service minimum`, amount: minimumAdjustment, preTaxAmount: minimumAdjustment, taxAmount: 0 });
    addOnTotal += minimumAdjustment;
  }
  const taxRate = NY_SALES_TAX_RATE;
  const subtotalCents = Math.round(subtotal * 100);
  const taxCents = Math.round(subtotalCents * taxRate);
  const totalCents = subtotalCents + taxCents;
  const tax = taxCents / 100;
  const total = totalCents / 100;
  const teamHours = Math.round(Math.max(teamMinutes / 60, subtotal / WINDOW_TARGET_TEAM_HOURLY) * 100) / 100;
  const manHours = Math.round(teamHours * TEAM_SIZE * 100) / 100;
  const unit = {
    unitNumber: 1,
    ...details,
    baseItems,
    addOns,
    basePrice: baseTotal,
    baseSubtotal: baseTotal,
    addOnTotal,
    addOnSubtotal: addOnTotal,
    subtotal,
    subtotalCents,
    manHours,
    teamHours,
    cleanerCount: TEAM_SIZE
  };
  return {
    id: "window__instant_quote",
    packageIds: ["window__instant_quote"],
    serviceKey: "window",
    serviceLabel: "Window Cleaning",
    tierKey: "instant_quote",
    tierLabel: "Personalized Window Cleaning",
    bedroomsLabel: "",
    bathroomsLabel: "",
    price: total,
    priceCents: totalCents,
    subtotal,
    subtotalCents,
    basePrice: baseTotal,
    baseSubtotal: baseTotal,
    addOnTotal,
    addOnSubtotal: addOnTotal,
    taxRate,
    tax,
    taxCents,
    total,
    totalCents,
    manHours,
    teamHours,
    cleanerCount: TEAM_SIZE,
    manHourRate: WINDOW_TARGET_TEAM_HOURLY / TEAM_SIZE,
    unitCount: 1,
    pricingMode: "window_formula",
    units: [unit]
  };
}

function calculateOrganizationQuote(hoursValue) {
  const selectedHours = Number(hoursValue);
  if (!Number.isInteger(selectedHours) || selectedHours < ORGANIZATION_MIN_HOURS || selectedHours > 24) {
    throw Object.assign(new Error("Choose a whole number from 4 to 24 total labor-hours for organization or decluttering."), {
      statusCode: 400
    });
  }
  const totalCents = selectedHours * ORGANIZATION_HOURLY_RATE * 100;
  const taxBreakdown = inclusiveTaxBreakdown(totalCents);
  const baseItem = {
    key: "organization_hours",
    label: `${selectedHours} labor-hours × $${ORGANIZATION_HOURLY_RATE} per labor-hour`,
    amount: taxBreakdown.total,
    preTaxAmount: taxBreakdown.subtotal,
    taxAmount: taxBreakdown.tax
  };
  const unit = {
    unitNumber: 1,
    hours: selectedHours,
    baseItems: [baseItem],
    addOns: [],
    basePrice: taxBreakdown.total,
    baseSubtotal: taxBreakdown.subtotal,
    addOnTotal: 0,
    addOnSubtotal: 0,
    subtotal: taxBreakdown.total,
    subtotalCents: totalCents,
    manHours: selectedHours,
    teamHours: selectedHours / TEAM_SIZE,
    cleanerCount: TEAM_SIZE
  };
  return {
    id: `organization__${selectedHours}_hours`,
    packageIds: [`organization__${selectedHours}_hours`],
    serviceKey: "organization",
    serviceLabel: "Organization / Decluttering",
    tierKey: "hourly",
    tierLabel: `${selectedHours} Labor-Hour Service`,
    bedroomsLabel: "",
    bathroomsLabel: "",
    price: taxBreakdown.total,
    priceCents: totalCents,
    ...taxBreakdown,
    basePrice: taxBreakdown.total,
    baseSubtotal: taxBreakdown.subtotal,
    addOnTotal: 0,
    addOnSubtotal: 0,
    manHours: selectedHours,
    teamHours: selectedHours / TEAM_SIZE,
    cleanerCount: TEAM_SIZE,
    manHourRate: ORGANIZATION_HOURLY_RATE,
    unitCount: 1,
    pricingMode: "organization_formula",
    units: [unit]
  };
}

function getPackage(packageId) {
  const [serviceKey, ...tierParts] = cleanText(packageId, 80).split("__");
  const tierKey = tierParts.join("__");
  const service = SERVICES[serviceKey];
  const tier = TIERS[tierKey];
  const price = service?.prices?.[tierKey];
  if (!service || !tier || !price) return null;
  const manHours = service.laborHours?.[tierKey] ?? roundUpToHalfHour(price / MAN_HOUR_RATE);
  const teamHours = manHours / TEAM_SIZE;
  const priceCents = Math.round(price * 100);
  const taxBreakdown = inclusiveTaxBreakdown(priceCents);
  return {
    id: `${serviceKey}__${tierKey}`,
    serviceKey,
    serviceLabel: service.label,
    tierKey,
    tierLabel: tier.label,
    bedroomsLabel: tier.bedroomsLabel,
    bathroomsLabel: tier.bathroomsLabel,
    price,
    priceCents,
    ...taxBreakdown,
    manHours,
    teamHours,
    cleanerCount: TEAM_SIZE,
    manHourRate: MAN_HOUR_RATE
  };
}

function getPackageBundle(packageIds) {
  const normalizedIds = Array.isArray(packageIds)
    ? packageIds.map((packageId) => cleanText(packageId, 80)).filter(Boolean).slice(0, 10)
    : [];
  if (!normalizedIds.length) return null;
  const packages = normalizedIds.map(getPackage);
  if (packages.some((pkg) => !pkg)) return null;
  const serviceKey = packages[0].serviceKey;
  if (packages.some((pkg) => pkg.serviceKey !== serviceKey)) return null;
  if (packages.length === 1) {
    return {
      ...packages[0],
      packageIds: [packages[0].id],
      unitCount: 1,
      units: [{
        id: packages[0].id,
        tierKey: packages[0].tierKey,
        tierLabel: packages[0].tierLabel,
        price: packages[0].price,
        priceCents: packages[0].priceCents,
        manHours: packages[0].manHours,
        teamHours: packages[0].teamHours
      }]
    };
  }
  const manHours = packages.reduce((total, pkg) => total + pkg.manHours, 0);
  const price = packages.reduce((total, pkg) => total + pkg.price, 0);
  const priceCents = Math.round(price * 100);
  const taxBreakdown = inclusiveTaxBreakdown(priceCents);
  return {
    id: `bundle__${serviceKey}__${packages.map((pkg) => pkg.tierKey).join("_")}`,
    packageIds: packages.map((pkg) => pkg.id),
    serviceKey,
    serviceLabel: packages[0].serviceLabel,
    tierKey: "multiple_units",
    tierLabel: `${packages.length} residential units`,
    bedroomsLabel: "Multiple units",
    bathroomsLabel: "Multiple units",
    price,
    priceCents,
    ...taxBreakdown,
    manHours,
    teamHours: manHours / TEAM_SIZE,
    cleanerCount: TEAM_SIZE,
    manHourRate: MAN_HOUR_RATE,
    unitCount: packages.length,
    units: packages.map((pkg) => ({
      id: pkg.id,
      tierKey: pkg.tierKey,
      tierLabel: pkg.tierLabel,
      price: pkg.price,
      priceCents: pkg.priceCents,
      manHours: pkg.manHours,
      teamHours: pkg.teamHours
    }))
  };
}

function catalogForClient() {
  return Object.entries(SERVICES).flatMap(([serviceKey, service]) => (
    Object.keys(service.prices).map((tierKey) => packageForClient(getPackage(`${serviceKey}__${tierKey}`)))
  ));
}

function packageForClient(pkg) {
  if (!pkg) return null;
  const { manHourRate, ...customerPackage } = pkg;
  return customerPackage;
}

function recommendResidentialService(eligibility = {}) {
  const propertyStatus = cleanText(eligibility.propertyStatus, 40);
  const lastCleaned = cleanText(eligibility.lastCleaned, 40);
  const condition = cleanText(eligibility.condition, 40);
  const requestedService = cleanText(eligibility.requestedService, 40);
  const cleaningCategory = cleanText(eligibility.cleaningCategory, 40);
  const propertyOver2000 = cleanText(eligibility.propertyOver2000, 40);
  const waterDamage = cleanText(eligibility.waterDamage, 40);
  const recentRenovation = cleanText(eligibility.recentRenovation, 40);
  const excessiveBelongings = cleanText(eligibility.excessiveBelongings, 40);
  const utilitiesAvailable = cleanText(eligibility.utilitiesAvailable, 40);
  const propertyAccess = cleanText(eligibility.propertyAccess, 40);
  const clutter = cleanText(eligibility.clutter, 40);
  const buildup = cleanText(eligibility.buildup, 40);
  const hazards = cleanText(eligibility.hazards, 40);
  const squareFootage = Math.max(0, Number(eligibility.squareFootage) || 0);

  if (cleaningCategory === "commercial") {
    return {
      type: "review",
      internalReason: "commercial_service",
      reason: "Commercial cleaning is customized for each business and may require a brief consultation or walkthrough before we confirm the scope and price.",
      reviewUrl: "/quote.html?category=commercial&qualification_reason=commercial_service"
    };
  }
  if (cleaningCategory === "window") {
    return {
      type: "instant",
      serviceKey: "window",
      reason: "Window cleaning is priced from the selected window types, quantities, sides, add-ons, and safe-access details."
    };
  }
  if (propertyOver2000 === "yes") {
    return {
      type: "review",
      internalReason: "large_property",
      reason: "Properties larger than 2,000 square feet need a custom quote so we can confirm the cleaning scope, time, and staffing.",
      reviewUrl: "/quote.html?category=residential&qualification_reason=large_property"
    };
  }
  if (waterDamage === "yes") {
    return {
      type: "review",
      internalReason: "water_damage",
      reason: "Properties affected by flooding or water damage require additional information before we can provide an accurate estimate.",
      reviewUrl: "/quote.html?category=residential&qualification_reason=water_damage"
    };
  }
  if (recentRenovation === "yes") {
    return {
      type: "review",
      internalReason: "post_construction",
      reason: "Recently renovated properties typically require specialized post-construction cleaning due to construction dust, debris, and fine particles.",
      reviewUrl: "/quote.html?category=residential&service=post-construction&qualification_reason=post_construction"
    };
  }
  if (excessiveBelongings && excessiveBelongings !== "no") {
    return {
      type: "review",
      internalReason: "excessive_belongings",
      reason: "Belongings or storage that limit access require a custom assessment so we can estimate the cleaning time, access needs, and staffing.",
      reviewUrl: "/quote.html?category=residential&qualification_reason=excessive_belongings"
    };
  }
  if (utilitiesAvailable === "no") {
    return {
      type: "review",
      internalReason: "utilities_unavailable",
      reason: "Electricity and running water are required to perform most cleaning services. Please request a custom quote so we can review your situation and determine whether we can accommodate your request.",
      reviewUrl: "/quote.html?category=residential&qualification_reason=utilities_unavailable"
    };
  }
  if (propertyAccess === "no") {
    return {
      type: "review",
      internalReason: "limited_property_access",
      reason: "Some access limitations may require additional time, equipment, or a walkthrough before we can confirm your booking. Please request a custom quote so we can review your property and provide an accurate estimate.",
      reviewUrl: "/quote.html?category=residential&qualification_reason=limited_property_access"
    };
  }
  if (squareFootage > 2000) {
    return {
      type: "review",
      internalReason: "large_property",
      reason: "Properties larger than 2,000 square feet need a custom quote so we can confirm the cleaning scope, time, and staffing.",
      reviewUrl: "/quote.html?category=residential&qualification_reason=large_property"
    };
  }
  if (hazards !== "none") {
    return {
      type: "review",
      internalReason: "safety_concern",
      reason: "Possible mold, active pests, or human or animal waste must be reviewed before we can confirm a cleaning appointment.",
      reviewUrl: "/quote.html?category=residential&qualification_reason=safety_concern"
    };
  }
  if (clutter && clutter !== "low") {
    return {
      type: "review",
      internalReason: "heavy_clutter",
      reason: "Any clutter that requires our team to work around belongings needs a custom assessment so we can estimate the cleaning time, access, and staffing.",
      reviewUrl: "/quote.html?category=residential&qualification_reason=heavy_clutter"
    };
  }
  if (buildup === "heavy") {
    return {
      type: "review",
      internalReason: "heavy_buildup",
      reason: "Heavy grease, soap scum, dust, or residue may require additional time and specialized cleaning. Please request a custom quote so we can review the condition accurately.",
      reviewUrl: "/quote.html?category=residential&qualification_reason=heavy_buildup"
    };
  }
  if (condition === "severe") {
    return { type: "review", reason: "The reported property condition requires a custom quote so we can review the scope accurately." };
  }
  if (propertyStatus === "renovated") {
    return { type: "instant", serviceKey: "post", reason: "A recently renovated or constructed property qualifies for Post-Construction Cleaning." };
  }
  if (propertyStatus === "moving") {
    return { type: "instant", serviceKey: "move", reason: "An empty property being prepared before or after a move qualifies for Move-In / Move-Out Cleaning." };
  }
  if (requestedService === "details") {
    return {
      type: "review",
      reason: "Detail Cleaning is customized around specific rooms, surfaces, appliances, and priority tasks.",
      reviewUrl: "/quote.html?service=details-cleaning"
    };
  }
  if (["heavy", "average"].includes(condition) || ["three_to_six_months", "over_six_months", "never"].includes(lastCleaned)) {
    return { type: "instant", serviceKey: "deep", reason: "The cleaning history or buildup reported is best handled with Deep Cleaning." };
  }
  if (requestedService === "deep") {
    return { type: "instant", serviceKey: "deep", reason: "The customer selected Deep Cleaning for a more thorough top-to-bottom service." };
  }
  if (requestedService === "standard") {
    return { type: "instant", serviceKey: "standard", reason: "The customer selected Standard Cleaning, and the reported condition qualifies for it." };
  }
  return { type: "instant", serviceKey: "standard", reason: "The property appears regularly maintained and eligible for Standard Cleaning." };
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw Object.assign(new Error("Booking storage is not configured."), {
      statusCode: 503,
      setup: "Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel."
    });
  }
  return {
    endpoint: `${url.replace(/\/$/, "")}/rest/v1/bookings`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    }
  };
}

function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseRequest(path, options = {}) {
  const config = getSupabaseConfig();
  const response = await fetch(`${config.endpoint}${path}`, {
    ...options,
    headers: { ...config.headers, ...(options.headers || {}) }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw Object.assign(new Error(data?.message || "Booking storage request failed."), {
      statusCode: response.status,
      details: data
    });
  }
  return data;
}

function bookingDriveQuery(extra = "") {
  const parentFolderId = String(process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || "").replace(/'/g, "\\'");
  return [
    `'${parentFolderId}' in parents`,
    "trashed = false",
    "appProperties has { key='iman_record_type' and value='booking' }",
    extra
  ].filter(Boolean).join(" and ");
}

function driveBookingRecord(data) {
  if (Buffer.isBuffer(data)) return JSON.parse(data.toString("utf8"));
  if (typeof data === "string") return JSON.parse(data);
  return data;
}

async function getDriveBookingFiles(extraQuery = "") {
  const { drive } = require("../quote/_shared").getGoogleClients();
  const listed = await drive.files.list({
    q: bookingDriveQuery(extraQuery),
    fields: "files(id,name,createdTime,appProperties)",
    orderBy: "createdTime desc",
    pageSize: 500
  });
  return { drive, files: listed.data.files || [] };
}

async function listDriveBookings() {
  const { drive, files } = await getDriveBookingFiles();
  return Promise.all(files.map(async (file) => {
    const downloaded = await drive.files.get({ fileId: file.id, alt: "media" });
    return driveBookingRecord(downloaded.data);
  }));
}

async function listReminderBookings() {
  const records = hasSupabaseConfig()
    ? await supabaseRequest("?select=*&status=in.(Confirmed,Cleaner%20assigned)&order=schedule.asc&limit=500")
    : await listDriveBookings();
  return (records || []).filter((record) => ["Confirmed", "Cleaner assigned"].includes(record.status));
}

async function listPaymentBookings() {
  const statuses = ["Confirmed", "Cleaner assigned", "In progress"];
  const records = hasSupabaseConfig()
    ? await supabaseRequest("?select=*&status=in.(Confirmed,Cleaner%20assigned,In%20progress)&order=schedule.asc&limit=500")
    : await listDriveBookings();
  return (records || []).filter((record) => statuses.includes(record.status));
}

async function listCustomerBookings(email) {
  const normalizedEmail = cleanText(email, 180).toLowerCase();
  const records = [];
  if (hasSupabaseConfig()) {
    try {
      const stored = await supabaseRequest(
        `?select=*&email=eq.${encodeURIComponent(normalizedEmail)}&order=schedule.desc&limit=100`
      );
      records.push(...(stored || []));
    } catch {
      // Drive remains available for sites that used it before Supabase was connected.
    }
  }
  try {
    const driveRecords = await listDriveBookings();
    records.push(...(driveRecords || []).filter((record) => (
      cleanText(record.email, 180).toLowerCase() === normalizedEmail
    )));
  } catch {
    // Supabase-only installations do not require Google Drive booking storage.
  }
  return Array.from(new Map(records.map((record) => [record.id, record])).values())
    .sort((left, right) => new Date(right.schedule).getTime() - new Date(left.schedule).getTime());
}

async function createBooking(booking) {
  const record = { ...booking, created_at: new Date().toISOString() };
  if (hasSupabaseConfig()) {
    const records = await supabaseRequest("", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(booking)
    });
    return records?.[0] || record;
  }

  const { drive, config } = require("../quote/_shared").getGoogleClients();
  await drive.files.create({
    requestBody: {
      name: `${record.id}-residential-booking.json`,
      parents: [config.parentFolderId],
      mimeType: "application/json",
      appProperties: {
        iman_record_type: "booking",
        booking_id: record.id,
        booking_status: record.status
      }
    },
    media: {
      mimeType: "application/json",
      body: JSON.stringify(record, null, 2)
    },
    fields: "id,name,createdTime,appProperties"
  });
  return record;
}

async function findDriveBooking(bookingId) {
  const safeId = cleanText(bookingId, 100).replace(/'/g, "\\'");
  const { drive, files } = await getDriveBookingFiles(
    `appProperties has { key='booking_id' and value='${safeId}' }`
  );
  if (!files[0]) return { drive, file: null, record: null };
  const downloaded = await drive.files.get({ fileId: files[0].id, alt: "media" });
  return {
    drive,
    file: files[0],
    record: driveBookingRecord(downloaded.data)
  };
}

async function deletePendingBooking(bookingId) {
  if (hasSupabaseConfig()) {
    await supabaseRequest(`?id=eq.${encodeURIComponent(bookingId)}&status=eq.New`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    return;
  }
  const { drive, file, record } = await findDriveBooking(bookingId);
  if (file && record?.status === "New") {
    await drive.files.delete({ fileId: file.id });
  }
}

async function confirmBooking(bookingId) {
  let confirmedBooking;
  if (hasSupabaseConfig()) {
    const records = await supabaseRequest(`?id=eq.${encodeURIComponent(bookingId)}&select=*`);
    const booking = records?.[0];
    await supabaseRequest(`?id=eq.${encodeURIComponent(bookingId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "Confirmed" })
    });
    confirmedBooking = booking ? { ...booking, status: "Confirmed" } : null;
  } else {
    const { drive, file, record } = await findDriveBooking(bookingId);
    if (!file || !record) {
      throw Object.assign(new Error("Paid booking record could not be found."), { statusCode: 404 });
    }
    confirmedBooking = {
      ...record,
      status: "Confirmed",
      confirmed_at: new Date().toISOString()
    };
    await drive.files.update({
      fileId: file.id,
      requestBody: {
        appProperties: {
          ...(file.appProperties || {}),
          booking_status: "Confirmed"
        }
      },
      media: {
        mimeType: "application/json",
        body: JSON.stringify(confirmedBooking, null, 2)
      },
      fields: "id,name,appProperties"
    });
  }

  let calendarSync = { status: "not_configured" };
  if (confirmedBooking) {
    try {
      calendarSync = await syncBookingToGoogleCalendar(confirmedBooking);
    } catch (error) {
      calendarSync = { status: "error", error: cleanText(error.message, 300) };
    }
  }
  return { booking: confirmedBooking, calendarSync };
}

async function getBooking(bookingId) {
  const id = cleanText(bookingId, 100);
  if (!id) return null;
  if (hasSupabaseConfig()) {
    const records = await supabaseRequest(`?id=eq.${encodeURIComponent(id)}&select=*`);
    return records?.[0] || null;
  }
  const { record } = await findDriveBooking(id);
  return record || null;
}

async function updateBooking(bookingId, changes = {}) {
  const id = cleanText(bookingId, 100);
  const allowed = {};
  ["status", "schedule", "schedule_label", "estimate", "notes"].forEach((key) => {
    if (changes[key] !== undefined) allowed[key] = changes[key];
  });
  if (hasSupabaseConfig()) {
    const records = await supabaseRequest(`?id=eq.${encodeURIComponent(id)}&select=*`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(allowed)
    });
    return records?.[0] || null;
  }
  const { drive, file, record } = await findDriveBooking(id);
  if (!file || !record) {
    throw Object.assign(new Error("Booking record could not be found."), { statusCode: 404 });
  }
  const updated = { ...record, ...allowed, updated_at: new Date().toISOString() };
  await drive.files.update({
    fileId: file.id,
    requestBody: {
      appProperties: {
        ...(file.appProperties || {}),
        booking_status: updated.status
      }
    },
    media: {
      mimeType: "application/json",
      body: JSON.stringify(updated, null, 2)
    },
    fields: "id,name,appProperties"
  });
  return updated;
}

async function updateBookingEstimate(bookingId, estimate) {
  const safeEstimate = estimate && typeof estimate === "object" ? estimate : {};
  if (hasSupabaseConfig()) {
    const records = await supabaseRequest(`?id=eq.${encodeURIComponent(bookingId)}&select=*`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ estimate: safeEstimate })
    });
    return records?.[0] || null;
  }

  const { drive, file, record } = await findDriveBooking(bookingId);
  if (!file || !record) {
    throw Object.assign(new Error("Booking record could not be found."), { statusCode: 404 });
  }
  const updated = { ...record, estimate: safeEstimate, updated_at: new Date().toISOString() };
  await drive.files.update({
    fileId: file.id,
    requestBody: {
      appProperties: {
        ...(file.appProperties || {}),
        booking_status: updated.status
      }
    },
    media: {
      mimeType: "application/json",
      body: JSON.stringify(updated, null, 2)
    },
    fields: "id,name,appProperties"
  });
  return updated;
}

function localDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function offsetForLocalDate(dateString, timeString) {
  const approximate = new Date(`${dateString}T${timeString}:00Z`);
  const zonePart = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    timeZoneName: "longOffset",
    hour: "2-digit"
  }).formatToParts(approximate).find((part) => part.type === "timeZoneName")?.value || "GMT-05:00";
  return zonePart.replace("GMT", "");
}

function toZonedIso(dateString, timeString) {
  return `${dateString}T${timeString}:00${offsetForLocalDate(dateString, timeString)}`;
}

function activeBooking(record, now = Date.now()) {
  if (["Confirmed", "Cleaner assigned", "In progress"].includes(record.status)) return true;
  if (record.status !== "New") return false;
  const createdAt = new Date(record.created_at).getTime();
  return Number.isFinite(createdAt) && now - createdAt < HOLD_MINUTES * 60 * 1000;
}

function bookingInterval(record) {
  const start = new Date(record.schedule).getTime();
  const hours = Number(record.estimate?.teamHours || record.estimate?.hours || 2);
  return { start, end: start + Math.max(1, hours) * 60 * 60 * 1000 };
}

async function listActiveBookings() {
  const records = hasSupabaseConfig()
    ? await supabaseRequest("?select=id,status,schedule,estimate,created_at&order=created_at.desc&limit=500")
    : await listDriveBookings();
  return (records || []).filter((record) => activeBooking(record));
}

function intervalsOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

function slotAvailable(startIso, teamHours, bookings) {
  const start = new Date(startIso).getTime();
  const candidate = { start, end: start + teamHours * 60 * 60 * 1000 };
  const gap = APPOINTMENT_GAP_HOURS * 60 * 60 * 1000;
  return !bookings.some((booking) => {
    const existing = bookingInterval(booking);
    return intervalsOverlap(
      { start: candidate.start - gap, end: candidate.end + gap },
      existing
    );
  });
}

function formatSlotLabel(dateString, timeString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(toZonedIso(dateString, timeString)));
}

function timeStringForDate(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

function availableSlotsForDate(pkg, dateString, bookings = [], minimumStartMs = 0) {
  const open = new Date(toZonedIso(dateString, OPEN_TIME)).getTime();
  const close = new Date(toZonedIso(dateString, CLOSE_TIME)).getTime();
  const duration = pkg.teamHours * 60 * 60 * 1000;
  const interval = SLOT_INTERVAL_MINUTES * 60 * 1000;
  const earliestStart = Number.isFinite(Number(minimumStartMs)) ? Number(minimumStartMs) : 0;
  const slots = [];

  for (let candidateStart = open; candidateStart + duration <= close; candidateStart += interval) {
    if (candidateStart < earliestStart) continue;
    const startDate = new Date(candidateStart);
    const time = timeStringForDate(startDate);
    const value = toZonedIso(dateString, time);
    if (!slotAvailable(value, pkg.teamHours, bookings)) continue;
    slots.push({
      value,
      label: formatSlotLabel(dateString, time),
      date: dateString,
      time,
      teamHours: pkg.teamHours,
      gapHours: APPOINTMENT_GAP_HOURS,
      closesAt: CLOSE_TIME
    });
  }
  return slots;
}

function nextAvailableSlotForDate(pkg, dateString, bookings = []) {
  return availableSlotsForDate(pkg, dateString, bookings)[0] || null;
}

function googleCalendarConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

function getGoogleCalendarClient() {
  if (!googleCalendarConfigured()) return null;
  const { google } = require("googleapis");
  const { auth } = require("../quote/_shared").getGoogleClients();
  return google.calendar({ version: "v3", auth });
}

async function googleCalendarBusyRecords(timeMin, timeMax) {
  if (!googleCalendarConfigured()) return { connected: false, records: [] };
  try {
    const calendar = getGoogleCalendarClient();
    const listed = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
      timeMin,
      timeMax,
      singleEvents: true,
      showDeleted: false,
      maxResults: 2500
    });
    const records = (listed.data.items || [])
      .filter((event) => event.status !== "cancelled" && event.transparency !== "transparent")
      .map((event) => {
        const startValue = event.start?.dateTime || (event.start?.date ? `${event.start.date}T00:00:00${offsetForLocalDate(event.start.date, "00:00")}` : "");
        const endDate = event.end?.date || event.start?.date;
        const endValue = event.end?.dateTime || (endDate ? `${endDate}T00:00:00${offsetForLocalDate(endDate, "00:00")}` : "");
        const start = new Date(startValue).getTime();
        const end = new Date(endValue).getTime();
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
        return {
          status: "Confirmed",
          schedule: new Date(start).toISOString(),
          estimate: { teamHours: (end - start) / (60 * 60 * 1000) },
          source: "google-calendar"
        };
      })
      .filter(Boolean);
    return { connected: true, records };
  } catch (error) {
    return { connected: false, records: [], error: cleanText(error.message, 300) };
  }
}

async function syncBookingToGoogleCalendar(booking) {
  if (!googleCalendarConfigured()) return { status: "not_configured" };
  const calendar = getGoogleCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const privateKey = `iman_booking_id=${booking.id}`;
  const existing = await calendar.events.list({
    calendarId,
    privateExtendedProperty: [privateKey],
    maxResults: 1,
    singleEvents: true
  });
  if (existing.data.items?.[0]) {
    return { status: "already_exists", eventId: existing.data.items[0].id };
  }

  const start = new Date(booking.schedule);
  const teamHours = Number(booking.estimate?.teamHours || booking.estimate?.hours || 2);
  const end = new Date(start.getTime() + teamHours * 60 * 60 * 1000);
  const inserted = await calendar.events.insert({
    calendarId,
    sendUpdates: "all",
    requestBody: {
      summary: `${booking.service_label || "Cleaning"} — ${booking.client_name || "Customer"}`,
      description: [
        `Booking reference: ${booking.id}`,
        booking.phone ? `Customer phone: ${booking.phone}` : "",
        booking.email ? `Customer email: ${booking.email}` : "",
        booking.notes || ""
      ].filter(Boolean).join("\n"),
      location: booking.address || "",
      start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
      end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
      attendees: booking.email ? [{ email: booking.email }] : [],
      extendedProperties: {
        private: { iman_booking_id: booking.id }
      }
    }
  });
  return { status: "created", eventId: inserted.data.id };
}

async function updateBookingGoogleCalendar(booking, action = "reschedule") {
  if (!googleCalendarConfigured()) return { status: "not_configured" };
  const calendar = getGoogleCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const existing = await calendar.events.list({
    calendarId,
    privateExtendedProperty: [`iman_booking_id=${booking.id}`],
    maxResults: 1,
    singleEvents: true
  });
  const event = existing.data.items?.[0];
  if (!event) {
    return action === "cancel"
      ? { status: "not_found" }
      : syncBookingToGoogleCalendar(booking);
  }
  if (action === "cancel") {
    await calendar.events.delete({ calendarId, eventId: event.id, sendUpdates: "all" });
    return { status: "cancelled", eventId: event.id };
  }
  const start = new Date(booking.schedule);
  const teamHours = Number(booking.estimate?.teamHours || booking.estimate?.hours || 2);
  const end = new Date(start.getTime() + teamHours * 60 * 60 * 1000);
  await calendar.events.patch({
    calendarId,
    eventId: event.id,
    sendUpdates: "all",
    requestBody: {
      start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
      end: { dateTime: end.toISOString(), timeZone: TIME_ZONE }
    }
  });
  return { status: "rescheduled", eventId: event.id };
}

async function availableSlotsForPackage(pkg, days = MAX_ADVANCE_BOOKING_DAYS, now = new Date()) {
  const requestedDays = Number(days);
  const bookingDays = Math.min(
    MAX_ADVANCE_BOOKING_DAYS,
    Math.max(1, Number.isFinite(requestedDays) ? Math.floor(requestedDays) : MAX_ADVANCE_BOOKING_DAYS)
  );
  const currentTime = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(currentTime.getTime())) {
    throw Object.assign(new Error("The current booking time is invalid."), { statusCode: 400 });
  }
  const minimumStartMs = currentTime.getTime() + MIN_BOOKING_NOTICE_HOURS * 60 * 60 * 1000;
  const slots = [];
  const today = localDateString(currentTime);
  const base = new Date(`${today}T12:00:00Z`);
  const firstDate = localDateString(new Date(base.getTime() + 24 * 60 * 60 * 1000));
  const afterLastDate = localDateString(new Date(base.getTime() + (bookingDays + 1) * 24 * 60 * 60 * 1000));
  const [storedBookings, calendarAvailability] = await Promise.all([
    listActiveBookings(),
    googleCalendarBusyRecords(
      toZonedIso(firstDate, "00:00"),
      toZonedIso(afterLastDate, "00:00")
    )
  ]);
  const bookings = storedBookings.concat(calendarAvailability.records);

  for (let dayIndex = 1; dayIndex <= bookingDays; dayIndex += 1) {
    const date = new Date(base.getTime() + dayIndex * 24 * 60 * 60 * 1000);
    const dateString = localDateString(date);
    availableSlotsForDate(pkg, dateString, bookings, minimumStartMs).forEach((slot) => {
      slots.push({ ...slot, calendarChecked: calendarAvailability.connected });
    });
  }
  return slots;
}

function makeBookingId() {
  return `BK-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

module.exports = {
  APPOINTMENT_GAP_HOURS,
  CLOSE_TIME,
  HOLD_MINUTES,
  MAN_HOUR_RATE,
  ORGANIZATION_HOURLY_RATE,
  ORGANIZATION_MIN_HOURS,
  MAX_ADVANCE_BOOKING_DAYS,
  MIN_BOOKING_NOTICE_HOURS,
  NY_SALES_TAX_RATE,
  OPEN_TIME,
  SLOT_INTERVAL_MINUTES,
  TEAM_SIZE,
  availableSlotsForPackage,
  availableSlotsForDate,
  catalogForClient,
  cleanText,
  calculateResidentialQuoteBundle,
  calculateResidentialUnitPrice,
  calculateOrganizationQuote,
  calculateWindowQuote,
  calculateStandardQuoteBundle,
  calculateStandardUnitPrice,
  confirmBooking,
  createBooking,
  deletePendingBooking,
  getPackage,
  getPackageBundle,
  getBooking,
  isNYCServiceZip,
  packageForClient,
  json,
  listReminderBookings,
  listPaymentBookings,
  listCustomerBookings,
  makeBookingId,
  nextAvailableSlotForDate,
  readJsonBody,
  recommendResidentialService,
  supabaseRequest,
  updateBooking,
  updateBookingEstimate,
  updateBookingGoogleCalendar
};
