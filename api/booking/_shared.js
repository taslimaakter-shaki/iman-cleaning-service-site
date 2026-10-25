const crypto = require("crypto");

const TEAM_SIZE = 2;
const MAN_HOUR_RATE = 80;
const FIRST_PET_CLEANING_FEE = 50;
const ADDITIONAL_PET_CLEANING_FEE = 20;
const ORGANIZATION_HOURLY_RATE = 60;
const ORGANIZATION_MIN_HOURS = 4;
const HOURLY_CLEANING_RATE = 80;
const HOURLY_CLEANING_MIN_HOURS = 4;
const HOLD_MINUTES = 30;
const TIME_ZONE = "America/New_York";
const OPEN_TIME = "08:00";
const CLOSE_TIME = "20:30";
const APPOINTMENT_GAP_HOURS = 3;
const SLOT_INTERVAL_MINUTES = 30;
// Customers may book any available slot beginning at 8:00 AM on the next
// calendar day, even when they book late the night before. Same-day slots are
// still excluded by availableSlotsForPackage, which starts at dayIndex 1.
const MIN_BOOKING_NOTICE_HOURS = 0;
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

function temporarilyPausedServiceBorough(value) {
  const zip = normalizeServiceZip(value);
  if (!/^\d{5}$/.test(zip)) return "";
  if (zip.startsWith("103")) return "Staten Island";
  if (zip.startsWith("104")) return "the Bronx";
  return "";
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
  recurring: {
    label: "Recurring Cleaning Service",
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
  },
  post: {
    label: "Post-Construction Cleaning",
    roomRate: 90,
    fullBathroomRate: 100,
    halfBathroomRate: 60,
    kitchenRate: 100,
    combinedLivingDining: 100,
    separateLivingDining: 180
  }
};

function calculateResidentialUnitPrice(unit = {}, unitIndex = 0, serviceKey = "standard", eligibility = {}) {
  const service = FORMULA_SERVICES[serviceKey];
  if (!service) {
    throw Object.assign(new Error("Choose Standard, Deep, Move-Out, or Post-Construction Cleaning."), { statusCode: 400 });
  }
  const unitNumber = unitIndex + 1;
  const bedrooms = wholeNumber(unit.bedrooms, `the number of bedrooms in Unit ${unitNumber}`, 20);
  const fullBathrooms = wholeNumber(unit.fullBathrooms, `the number of full bathrooms in Unit ${unitNumber}`, 20);
  const halfBathrooms = wholeNumber(unit.halfBathrooms, `the number of half bathrooms in Unit ${unitNumber}`, 20);
  const kitchens = unit.kitchens !== undefined && unit.kitchens !== ""
    ? wholeNumber(unit.kitchens, `the number of kitchens in Unit ${unitNumber}`, 20)
    : 1;
  const additionalRooms = wholeNumber(unit.additionalRooms || 0, `the number of additional rooms in Unit ${unitNumber}`, 30);
  const additionalRoomTypeLabels = {
    office: "office",
    storage: "storage room",
    pet: "pet room",
    guest: "guest room",
    playroom: "playroom",
    denStudy: "den or study",
    other: "other room"
  };
  const submittedAdditionalRoomTypes = unit.additionalRoomTypes && typeof unit.additionalRoomTypes === "object"
    ? unit.additionalRoomTypes
    : null;
  const additionalRoomTypes = submittedAdditionalRoomTypes
    ? Object.fromEntries(Object.keys(additionalRoomTypeLabels).map((key) => [
        key,
        wholeNumber(submittedAdditionalRoomTypes[key] || 0, `the ${additionalRoomTypeLabels[key]} count in Unit ${unitNumber}`, 30)
      ]))
    : {};
  const assignedAdditionalRooms = Object.values(additionalRoomTypes).reduce((total, amount) => total + amount, 0);
  if (submittedAdditionalRoomTypes && assignedAdditionalRooms !== additionalRooms) {
    throw Object.assign(new Error(`Assign all additional rooms by type in Unit ${unitNumber}.`), { statusCode: 400 });
  }
  const additionalRoomLabel = submittedAdditionalRoomTypes
    ? Object.entries(additionalRoomTypes)
        .filter(([, quantity]) => quantity > 0)
        .map(([key, quantity]) => `${quantity} ${additionalRoomTypeLabels[key]}${quantity === 1 ? "" : "s"}`)
        .join(", ")
    : `${additionalRooms} additional room${additionalRooms === 1 ? "" : "s"}`;
  const submittedLivingDining = cleanText(unit.livingDining, 20);
  const legacyLivingDining = !unit.hasLivingRoom && !unit.hasDiningRoom && ["combined", "separate"].includes(submittedLivingDining);
  const livingRooms = unit.livingRooms !== undefined && unit.livingRooms !== ""
    ? wholeNumber(unit.livingRooms, `the number of living rooms in Unit ${unitNumber}`, 20)
    : (legacyLivingDining || unit.hasLivingRoom === "yes" ? 1 : 0);
  const diningRooms = unit.diningRooms !== undefined && unit.diningRooms !== ""
    ? wholeNumber(unit.diningRooms, `the number of dining rooms in Unit ${unitNumber}`, 20)
    : (legacyLivingDining || unit.hasDiningRoom === "yes" ? 1 : 0);
  const hasLivingRoom = livingRooms > 0 ? "yes" : "no";
  const hasDiningRoom = diningRooms > 0 ? "yes" : "no";
  let livingDining = "none";
  if (hasLivingRoom === "yes" && hasDiningRoom === "yes") {
    if (!["combined", "separate"].includes(submittedLivingDining)) {
      throw Object.assign(new Error(`Choose whether the living room and dining room are combined or separate in Unit ${unitNumber}.`), { statusCode: 400 });
    }
    livingDining = submittedLivingDining;
  } else if (hasLivingRoom === "yes") {
    livingDining = "living_only";
  } else if (hasDiningRoom === "yes") {
    livingDining = "dining_only";
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

  const excludeKitchenItems = kitchens > 0 && serviceKey === "move"
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
  const refrigerator = kitchens < 1
    ? "no"
    : serviceKey === "move"
      ? (excludeRefrigerator === "yes" ? "excluded" : "included")
      : submittedRefrigerator === "yes"
        ? "empty"
        : submittedRefrigerator;
  if (kitchens > 0 && serviceKey !== "move" && !["no", "empty", "not-empty"].includes(refrigerator)) {
    throw Object.assign(new Error(`Choose a refrigerator-cleaning option for Unit ${unitNumber}.`), { statusCode: 400 });
  }
  const oven = kitchens < 1
    ? "no"
    : serviceKey === "move"
      ? (excludeOven === "yes" ? "excluded" : "included")
      : yesNo(unit.oven, `inside oven cleaning in Unit ${unitNumber}`);
  const cabinets = kitchens < 1
    ? "no"
    : serviceKey === "move"
      ? (excludeCabinets === "yes" ? "excluded" : "included")
      : yesNo(unit.cabinets, `inside kitchen cabinet cleaning in Unit ${unitNumber}`);
  const additionalCleaning = yesNo(
    unit.additionalCleaning || "no",
    `additional cleaning in Unit ${unitNumber}`
  );
  const possibleMold = cleanText(eligibility?.hazards, 20) === "mold" && cleanText(eligibility?.moldCleaningRequested, 10) === "yes";
  const submittedMoldAreas = unit.moldAreas && typeof unit.moldAreas === "object" ? unit.moldAreas : null;
  const moldFullBathrooms = possibleMold
    ? wholeNumber(submittedMoldAreas?.fullBathrooms ?? unit.moldFullBathrooms ?? 0, `the number of affected full bathrooms in Unit ${unitNumber}`, fullBathrooms)
    : 0;
  const moldHalfBathrooms = possibleMold
    ? wholeNumber(submittedMoldAreas?.halfBathrooms ?? unit.moldHalfBathrooms ?? 0, `the number of affected half bathrooms in Unit ${unitNumber}`, halfBathrooms)
    : 0;
  const moldBedroomCount = possibleMold
    ? wholeNumber(submittedMoldAreas?.bedrooms ?? unit.moldBedroomCount ?? 0, `the number of affected bedrooms in Unit ${unitNumber}`, bedrooms)
    : 0;
  const moldKitchenCount = possibleMold
    ? wholeNumber(submittedMoldAreas?.kitchens ?? (unit.moldKitchen === "yes" ? 1 : 0), `the number of affected kitchens in Unit ${unitNumber}`, kitchens)
    : 0;
  const moldLivingRoomCount = possibleMold
    ? wholeNumber(submittedMoldAreas?.livingRooms ?? (unit.moldLivingRoom === "yes" ? 1 : 0), `the number of affected living rooms in Unit ${unitNumber}`, livingRooms)
    : 0;
  const moldDiningRoomCount = possibleMold
    ? wholeNumber(submittedMoldAreas?.diningRooms ?? 0, `the number of affected dining rooms in Unit ${unitNumber}`, diningRooms)
    : 0;
  const moldAdditionalRoomCount = possibleMold
    ? wholeNumber(submittedMoldAreas?.additionalRooms ?? 0, `the number of affected additional rooms in Unit ${unitNumber}`, additionalRooms)
    : 0;
  const moldBathrooms = moldFullBathrooms + moldHalfBathrooms > 0 ? "yes" : "no";
  const moldKitchen = moldKitchenCount > 0 ? "yes" : "no";
  const moldBedrooms = moldBedroomCount > 0 ? "yes" : "no";
  const moldLivingRoom = moldLivingRoomCount > 0 ? "yes" : "no";
  const affectedAreaLimits = { bedrooms, fullBathrooms, halfBathrooms, kitchens, livingRooms, diningRooms, additionalRooms };
  const normalizeConditionAreas = (submittedAreas, conditionLabel) => {
    const source = submittedAreas && typeof submittedAreas === "object" ? submittedAreas : {};
    return Object.fromEntries(Object.entries(affectedAreaLimits).map(([key, maximum]) => [
      key,
      wholeNumber(source[key] || 0, `the number of ${conditionLabel}-affected ${key} in Unit ${unitNumber}`, maximum)
    ]));
  };
  const buildupAreas = normalizeConditionAreas(unit.buildupAreas, "buildup");
  const clutterAreas = normalizeConditionAreas(unit.clutterAreas, "clutter");
  const constructionAreas = normalizeConditionAreas(unit.constructionAreas, "construction dust or debris");
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
      reviewUrl: "/contact.html"
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
  const kitchenCountLabel = kitchens === 1 ? "Kitchen" : `${kitchens} kitchens`;
  const kitchenLabel = serviceKey !== "move"
    ? kitchenCountLabel
    : excludedKitchenItems.length
      ? includedKitchenItems.length
        ? `${kitchenCountLabel} (included: inside ${includedKitchenItems.join(", ")}; excluded: inside ${excludedKitchenItems.join(", ")})`
        : `${kitchenCountLabel} (inside refrigerator, oven, and cabinet cleaning excluded)`
      : `${kitchenCountLabel} (includes inside refrigerator, oven, and cabinets)`;

  const baseItems = [
    { key: "bedrooms", label: `${bedrooms} bedroom${bedrooms === 1 ? "" : "s"}`, amount: bedrooms * service.roomRate },
    { key: "full_bathrooms", label: `${fullBathrooms} full bathroom${fullBathrooms === 1 ? "" : "s"}`, amount: fullBathrooms * (service.fullBathroomRate || service.roomRate) },
    { key: "half_bathrooms", label: `${halfBathrooms} half bathroom${halfBathrooms === 1 ? "" : "s"}`, amount: halfBathrooms * service.halfBathroomRate },
    kitchens ? {
      key: "kitchen",
      label: kitchenLabel,
      amount: Math.max(0, (service.kitchenRate * kitchens) - kitchenDiscount)
    } : null,
    livingDining !== "none" ? {
      key: "living_dining",
      label: livingDining === "combined"
        ? `${Math.min(livingRooms, diningRooms)} combined living & dining area${Math.min(livingRooms, diningRooms) === 1 ? "" : "s"}${Math.abs(livingRooms - diningRooms) ? ` + ${Math.abs(livingRooms - diningRooms)} separate ${livingRooms > diningRooms ? "living" : "dining"} room${Math.abs(livingRooms - diningRooms) === 1 ? "" : "s"}` : ""}`
        : livingDining === "separate"
          ? `${livingRooms} living room${livingRooms === 1 ? "" : "s"} & ${diningRooms} dining room${diningRooms === 1 ? "" : "s"}`
          : livingDining === "living_only"
            ? (livingRooms === 1 ? "Living room" : `${livingRooms} living rooms`)
            : (diningRooms === 1 ? "Dining room" : `${diningRooms} dining rooms`),
      amount: livingDining === "combined"
        ? (Math.min(livingRooms, diningRooms) * service.combinedLivingDining) + (Math.abs(livingRooms - diningRooms) * service.roomRate)
        : (livingRooms + diningRooms) * service.roomRate
    } : null,
    additionalRooms ? { key: "additional_rooms", label: additionalRoomLabel, amount: additionalRooms * service.roomRate } : null,
    serviceKey === "move" ? { key: "interior_windows", label: "Interior window cleaning", amount: 0, included: true } : null
  ].filter(Boolean);
  const petCleaningAmount = hasPets === "yes"
    ? FIRST_PET_CLEANING_FEE + (Math.max(1, petCount) - 1) * ADDITIONAL_PET_CLEANING_FEE
    : 0;
  const addOns = [
    hasPets === "yes" ? {
      key: "pet_fee",
      label: `Additional cleaning for ${petCount} pet${petCount === 1 ? "" : "s"}`,
      description: "Extra time for removing pet hair, dander, and pet-related buildup from accessible surfaces.",
      amount: petCleaningAmount
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
    kitchens,
    livingRooms,
    diningRooms,
    hasLivingRoom,
    hasDiningRoom,
    livingDining,
    hasPets,
    petCount,
    petType,
    otherPetType,
    moldBathrooms,
    moldFullBathrooms,
    moldHalfBathrooms,
    moldKitchen,
    moldKitchenCount,
    moldBedrooms,
    moldBedroomCount,
    moldLivingRoom,
    moldLivingRoomCount,
    moldDiningRoomCount,
    moldAdditionalRoomCount,
    moldAreas: {
      bedrooms: moldBedroomCount,
      fullBathrooms: moldFullBathrooms,
      halfBathrooms: moldHalfBathrooms,
      kitchens: moldKitchenCount,
      livingRooms: moldLivingRoomCount,
      diningRooms: moldDiningRoomCount,
      additionalRooms: moldAdditionalRoomCount
    },
    buildupAreas,
    clutterAreas,
    constructionAreas,
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
    additionalRoomTypes,
    baseItems,
    addOns: pricedAddOns,
    basePrice,
    addOnTotal,
    subtotal,
    subtotalCents: subtotal * 100,
    manHours: roundUpToHalfHour(subtotal / MAN_HOUR_RATE)
  };
}

function affectedAreaAdjustmentsFor(units, serviceKey, areasKey, percentage) {
  if (!percentage) {
    return { percentage: 0, affectedAreas: [], affectedAreaBasePrice: 0, amount: 0, amountCents: 0 };
  }
  const service = FORMULA_SERVICES[serviceKey];
  const affectedAreas = [];
  units.forEach((unit) => {
    const areas = unit[areasKey] || {};
    const pairedLivingDining = unit.livingDining === "combined"
      ? Math.min(unit.livingRooms, unit.diningRooms)
      : 0;
    const livingAreaPrice = (quantity) => {
      const pairedQuantity = Math.min(quantity, pairedLivingDining);
      return (pairedQuantity * service.combinedLivingDining / 2) + ((quantity - pairedQuantity) * service.roomRate);
    };
    const diningAreaPrice = livingAreaPrice;
    const kitchenAddOnKeys = new Set(["refrigerator", "oven", "cabinets"]);
    const kitchenAddOnTotal = unit.addOns
      .filter((item) => kitchenAddOnKeys.has(item.key))
      .reduce((total, item) => total + (Number(item.amount) || 0), 0);
    const kitchenUnitPrice = unit.kitchens
      ? Math.max(0, (((service.kitchenRate * unit.kitchens) - unit.kitchenDiscount) + kitchenAddOnTotal) / unit.kitchens)
      : 0;
    const candidates = [
      areas.fullBathrooms > 0 ? { key: "full_bathrooms", label: `${areas.fullBathrooms} affected full bathroom${areas.fullBathrooms === 1 ? "" : "s"}`, quantity: areas.fullBathrooms, baseAreaPrice: areas.fullBathrooms * (service.fullBathroomRate || service.roomRate) } : null,
      areas.halfBathrooms > 0 ? { key: "half_bathrooms", label: `${areas.halfBathrooms} affected half bathroom${areas.halfBathrooms === 1 ? "" : "s"}`, quantity: areas.halfBathrooms, baseAreaPrice: areas.halfBathrooms * service.halfBathroomRate } : null,
      areas.bedrooms > 0 ? { key: "bedrooms", label: `${areas.bedrooms} affected bedroom${areas.bedrooms === 1 ? "" : "s"}`, quantity: areas.bedrooms, baseAreaPrice: areas.bedrooms * service.roomRate } : null,
      areas.kitchens > 0 ? { key: "kitchens", label: `${areas.kitchens} affected kitchen${areas.kitchens === 1 ? "" : "s"}`, quantity: areas.kitchens, baseAreaPrice: areas.kitchens * kitchenUnitPrice } : null,
      areas.livingRooms > 0 ? {
        key: "living_room",
        label: `${areas.livingRooms} affected living room${areas.livingRooms === 1 ? "" : "s"}`,
        quantity: areas.livingRooms,
        baseAreaPrice: livingAreaPrice(areas.livingRooms)
      } : null,
      areas.diningRooms > 0 ? {
        key: "dining_room",
        label: `${areas.diningRooms} affected dining room${areas.diningRooms === 1 ? "" : "s"}`,
        quantity: areas.diningRooms,
        baseAreaPrice: diningAreaPrice(areas.diningRooms)
      } : null,
      areas.additionalRooms > 0 ? {
        key: "additional_rooms",
        label: `${areas.additionalRooms} affected additional room${areas.additionalRooms === 1 ? "" : "s"}`,
        quantity: areas.additionalRooms,
        baseAreaPrice: areas.additionalRooms * service.roomRate
      } : null
    ].filter(Boolean);
    candidates.forEach((area) => {
      const amountCents = Math.round(area.baseAreaPrice * percentage);
      affectedAreas.push({
        ...area,
        unitNumber: unit.unitNumber,
        percentage,
        amount: amountCents / 100,
        amountCents
      });
    });
  });
  const amountCents = affectedAreas.reduce((sum, area) => sum + area.amountCents, 0);
  const affectedAreaBasePrice = affectedAreas.reduce((sum, area) => sum + area.baseAreaPrice, 0);
  return {
    percentage,
    affectedAreas,
    affectedAreaBasePrice,
    amount: amountCents / 100,
    amountCents
  };
}

function buildupAdjustmentFor(units, serviceKey, buildup = "") {
  const condition = cleanText(buildup, 20) || "none";
  const percentage = condition === "some" ? 50 : condition === "heavy" ? 60 : 0;
  const adjustment = affectedAreaAdjustmentsFor(units, serviceKey, "buildupAreas", percentage);
  return { ...adjustment, condition, addedLaborHours: adjustment.amount / MAN_HOUR_RATE };
}

function clutterAdjustmentFor(units, serviceKey, clutter = "") {
  const condition = cleanText(clutter, 20) || "low";
  const percentage = condition === "moderate" ? 40 : condition === "several" ? 50 : condition === "heavy" ? 60 : 0;
  const adjustment = affectedAreaAdjustmentsFor(units, serviceKey, "clutterAreas", percentage);
  return { ...adjustment, condition, addedLaborHours: adjustment.amount / MAN_HOUR_RATE };
}

function moldAdjustmentsFor(units, serviceKey, hazards = "", moldCleaningRequested = "") {
  if (cleanText(hazards, 20) !== "mold" || cleanText(moldCleaningRequested, 10) !== "yes") {
    return { percentage: 0, affectedAreas: [], affectedAreaBasePrice: 0, amount: 0, amountCents: 0, tax: 0, taxCents: 0, total: 0, totalCents: 0 };
  }
  const adjustment = affectedAreaAdjustmentsFor(units, serviceKey, "moldAreas", 50);
  const taxCents = Math.round(adjustment.amountCents * NY_SALES_TAX_RATE);
  return {
    ...adjustment,
    tax: taxCents / 100,
    taxCents,
    total: (adjustment.amountCents + taxCents) / 100,
    totalCents: adjustment.amountCents + taxCents
  };
}

function calculateResidentialQuoteBundle(unitDetails = [], serviceKey = "standard", eligibility = {}) {
  const service = FORMULA_SERVICES[serviceKey];
  if (!service) {
    throw Object.assign(new Error("Choose Standard, Deep, Move-Out, or Post-Construction Cleaning."), { statusCode: 400 });
  }
  if (!Array.isArray(unitDetails) || !unitDetails.length || unitDetails.length > 10) {
    throw Object.assign(new Error("Complete the pricing questions for every residential unit."), { statusCode: 400 });
  }
  const movingDirection = cleanText(eligibility?.movingDirection, 20);
  const serviceLabel = serviceKey === "move"
    ? movingDirection === "move-in"
      ? "Move-In Cleaning"
      : movingDirection === "move-out"
        ? "Move-Out Cleaning"
        : "Moving Cleaning"
    : service.label;
  const hazards = cleanText(eligibility?.hazards, 20);
  const moldCleaningRequested = cleanText(eligibility?.moldCleaningRequested, 10);
  if (hazards === "mold" && !["yes", "no"].includes(moldCleaningRequested)) {
    throw Object.assign(new Error("Choose whether you want the accessible surface-level mold or mildew cleaned."), { statusCode: 400 });
  }
  const units = unitDetails.map((unit, index) => calculateResidentialUnitPrice({
    ...unit,
    hasPets: "no",
    petCount: 0,
    petType: "",
    otherPetType: ""
  }, index, serviceKey, eligibility));
  const buildup = cleanText(eligibility?.buildup, 20);
  const clutter = cleanText(eligibility?.clutter, 20);
  const selectedAreaCount = (areas = {}) => Object.values(areas).reduce((sum, amount) => sum + (Number(amount) || 0), 0);
  if (["some", "heavy"].includes(buildup)) {
    const affectedAreaCount = units.reduce((sum, unit) => sum + selectedAreaCount(unit.buildupAreas), 0);
    if (affectedAreaCount < 1) {
      throw Object.assign(new Error("Select at least one buildup-affected area in any unit."), { statusCode: 400 });
    }
  }
  if (["moderate", "several", "heavy"].includes(clutter)) {
    const affectedAreaCount = units.reduce((sum, unit) => sum + selectedAreaCount(unit.clutterAreas), 0);
    if (affectedAreaCount < 1) {
      throw Object.assign(new Error("Select at least one clutter-affected area in any unit."), { statusCode: 400 });
    }
  }
  if (serviceKey === "post") {
    const constructionFinished = cleanText(eligibility?.constructionFinished, 20);
    const contractorItemsRemoved = cleanText(eligibility?.contractorItemsRemoved, 20);
    if (constructionFinished !== "yes" || contractorItemsRemoved !== "yes") {
      throw Object.assign(new Error("Post-construction cleaning requires all construction work to be finished and contractor tools, unused materials, and equipment to be removed before the appointment."), { statusCode: 400 });
    }
    const constructionAffectedAreaCount = units.reduce((sum, unit) => sum + selectedAreaCount(unit.constructionAreas), 0);
    if (constructionAffectedAreaCount < 1) {
      throw Object.assign(new Error("Select at least one room with construction dust or debris in any unit."), { statusCode: 400 });
    }
  }
  const propertyHasPets = yesNo(eligibility?.propertyHasPets || "no", "whether there are pets at the property");
  let propertyPetCount = 0;
  let propertyPetType = "";
  let propertyOtherPetType = "";
  let petsSecured = "";
  let previousPetBuildup = "no";
  if (propertyHasPets === "yes") {
    propertyPetCount = wholeNumber(eligibility?.propertyPetCount, "the total number of pets at the property", 20);
    if (propertyPetCount < 1) {
      throw Object.assign(new Error("Enter the total number of pets at the property."), { statusCode: 400 });
    }
    propertyPetType = cleanText(eligibility?.propertyPetType, 20);
    if (!["cats", "dogs", "cats-and-dogs", "other"].includes(propertyPetType)) {
      throw Object.assign(new Error("Choose the type of pets at the property."), { statusCode: 400 });
    }
    if (propertyPetType === "other") {
      propertyOtherPetType = cleanText(eligibility?.propertyOtherPetType, 80);
      if (!propertyOtherPetType) {
        throw Object.assign(new Error("Enter the type of pets at the property."), { statusCode: 400 });
      }
    }
    petsSecured = yesNo(eligibility?.petsSecured, "whether pets will be secured during the appointment");
  } else if (serviceKey === "move") {
    previousPetBuildup = yesNo(eligibility?.previousPetBuildup || "no", "whether pet-related buildup is present");
  }
  const propertyPetCleaningAmount = propertyHasPets === "yes"
    ? FIRST_PET_CLEANING_FEE + (propertyPetCount - 1) * ADDITIONAL_PET_CLEANING_FEE
    : previousPetBuildup === "yes" ? FIRST_PET_CLEANING_FEE : 0;
  if (propertyPetCleaningAmount && units[0]) {
    const propertyPetItem = {
      key: "property_pet_fee",
      label: propertyHasPets === "yes"
        ? `Additional cleaning for ${propertyPetCount} pet${propertyPetCount === 1 ? "" : "s"} at the property`
        : "Pet-related buildup cleaning",
      description: propertyHasPets === "yes"
        ? "Charged once for the entire property for pet hair, dander, and pet-related buildup on accessible surfaces."
        : "Additional cleaning for visible pet hair, odor, litter, stains, or other pet-related buildup.",
      amount: propertyPetCleaningAmount
    };
    units[0].addOns.push(propertyPetItem);
    units[0].addOnTotal += propertyPetCleaningAmount;
    units[0].subtotal += propertyPetCleaningAmount;
    units[0].subtotalCents += propertyPetCleaningAmount * 100;
  }
  const basePrice = units.reduce((total, unit) => total + unit.basePrice, 0);
  const originalAddOnTotal = units.reduce((total, unit) => total + unit.addOnTotal, 0);
  const baseLaborHours = roundUpToHalfHour((basePrice + originalAddOnTotal) / MAN_HOUR_RATE);
  const buildupAdjustment = buildupAdjustmentFor(units, serviceKey, eligibility?.buildup);
  const clutterAdjustment = clutterAdjustmentFor(units, serviceKey, eligibility?.clutter);
  const moldAdjustment = moldAdjustmentsFor(units, serviceKey, hazards, moldCleaningRequested);
  if (hazards === "mold" && moldCleaningRequested === "yes" && !moldAdjustment.affectedAreas.length) {
    throw Object.assign(new Error("Select at least one room with possible mold or mildew."), { statusCode: 400 });
  }
  const originalTotalCents = Math.round((basePrice + originalAddOnTotal) * 100);
  const originalTaxBreakdown = inclusiveTaxBreakdown(originalTotalCents);
  const originalPricedItems = units.flatMap((unit) => [...unit.baseItems, ...unit.addOns]);
  allocateInclusiveTaxAcrossItems(originalPricedItems, originalTaxBreakdown.subtotalCents);
  const adjustmentTaxCents = Math.round(buildupAdjustment.amountCents * NY_SALES_TAX_RATE);
  buildupAdjustment.taxCents = adjustmentTaxCents;
  buildupAdjustment.tax = adjustmentTaxCents / 100;
  buildupAdjustment.totalCents = buildupAdjustment.amountCents + adjustmentTaxCents;
  buildupAdjustment.total = buildupAdjustment.totalCents / 100;
  const clutterTaxCents = Math.round(clutterAdjustment.amountCents * NY_SALES_TAX_RATE);
  clutterAdjustment.taxCents = clutterTaxCents;
  clutterAdjustment.tax = clutterTaxCents / 100;
  clutterAdjustment.totalCents = clutterAdjustment.amountCents + clutterTaxCents;
  clutterAdjustment.total = clutterAdjustment.totalCents / 100;
  if (buildupAdjustment.addedLaborHours && units[0]) {
    units[0].addOns.push({
      key: "buildup_adjustment",
      label: `Buildup adjustment (${buildupAdjustment.percentage}% of selected affected rooms)`,
      description: "Calculated from the selected affected-area prices, including selected kitchen add-ons when a kitchen is affected.",
      amount: buildupAdjustment.amount,
      preTaxAmount: buildupAdjustment.amount,
      taxAmount: buildupAdjustment.tax
    });
    units[0].addOnTotal += buildupAdjustment.amount;
    units[0].subtotal += buildupAdjustment.total;
    units[0].subtotalCents += buildupAdjustment.totalCents;
    units[0].manHours += buildupAdjustment.addedLaborHours;
  }
  if (clutterAdjustment.addedLaborHours && units[0]) {
    units[0].addOns.push({
      key: "clutter_adjustment",
      label: `Clutter access adjustment (${clutterAdjustment.percentage}% of selected affected rooms)`,
      description: "Calculated from the selected affected-area prices, including selected kitchen add-ons when a kitchen is affected.",
      amount: clutterAdjustment.amount,
      preTaxAmount: clutterAdjustment.amount,
      taxAmount: clutterAdjustment.tax
    });
    units[0].addOnTotal += clutterAdjustment.amount;
    units[0].subtotal += clutterAdjustment.total;
    units[0].subtotalCents += clutterAdjustment.totalCents;
    units[0].manHours += clutterAdjustment.addedLaborHours;
  }
  moldAdjustment.affectedAreas.forEach((area) => {
    const unit = units.find((candidate) => candidate.unitNumber === area.unitNumber);
    if (!unit) return;
    const areaTaxCents = Math.round(area.amountCents * NY_SALES_TAX_RATE);
    unit.addOns.push({
      key: `mold_adjustment_${area.key}`,
      label: `${area.label} — possible mold/mildew adjustment (${moldAdjustment.percentage}%)`,
      description: `${moldAdjustment.percentage}% of the affected-area price ($${area.baseAreaPrice.toFixed(2)})`,
      amount: area.amount,
      preTaxAmount: area.amount,
      taxAmount: areaTaxCents / 100
    });
    unit.addOnTotal += area.amount;
    unit.subtotal += (area.amountCents + areaTaxCents) / 100;
    unit.subtotalCents += area.amountCents + areaTaxCents;
  });
  const addOnTotal = units.reduce((total, unit) => total + unit.addOnTotal, 0);
  const subtotalCents = originalTaxBreakdown.subtotalCents + buildupAdjustment.amountCents + clutterAdjustment.amountCents + moldAdjustment.amountCents;
  const taxCents = originalTaxBreakdown.taxCents + adjustmentTaxCents + clutterTaxCents + moldAdjustment.taxCents;
  const totalCents = subtotalCents + taxCents;
  const subtotal = subtotalCents / 100;
  const tax = taxCents / 100;
  const total = totalCents / 100;
  const taxRate = NY_SALES_TAX_RATE;
  units.forEach((unit) => {
    unit.baseSubtotal = unit.baseItems.reduce((sum, item) => sum + item.preTaxAmount, 0);
    unit.addOnSubtotal = unit.addOns.reduce((sum, item) => sum + item.preTaxAmount, 0);
  });
  const baseSubtotal = units.reduce((sum, unit) => sum + unit.baseSubtotal, 0);
  const addOnSubtotal = units.reduce((sum, unit) => sum + unit.addOnSubtotal, 0);
  // Keep the included service time consistent with the complete customer-facing
  // price. This includes every selected room, add-on, condition adjustment, and
  // applicable tax instead of omitting mold or other priced cleaning work.
  const manHours = roundUpToHalfHour(total / MAN_HOUR_RATE);

  return {
    id: `${serviceKey}__instant_${units.length}_unit${units.length === 1 ? "" : "s"}`,
    packageIds: units.map((unit) => `${serviceKey}__instant_unit_${unit.unitNumber}`),
    serviceKey,
    serviceLabel,
    tierKey: units.length === 1 ? "instant_quote" : "multiple_units",
    tierLabel: units.length === 1 ? `Personalized ${serviceLabel}` : `${units.length} residential units`,
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
    baseLaborHours,
    buildupAdjustment,
    clutterAdjustment,
    moldAdjustment,
    propertyPets: {
      hasPets: propertyHasPets,
      petCount: propertyPetCount,
      petType: propertyPetType,
      otherPetType: propertyOtherPetType,
      petsSecured,
      previousPetBuildup,
      fee: propertyPetCleaningAmount
    },
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
      reviewUrl: "/contact.html"
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
    throw Object.assign(new Error("Choose a whole number from 4 to 24 total labor-hours for organization."), {
      statusCode: 400
    });
  }
  const totalCents = selectedHours * ORGANIZATION_HOURLY_RATE * 100;
  const taxBreakdown = inclusiveTaxBreakdown(totalCents);
  const baseItem = {
    key: "organization_hours",
    label: `${selectedHours} labor-hours`,
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
    serviceLabel: "Organization",
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

function calculateHourlyCleaningQuote(hoursValue) {
  const selectedHours = Number(hoursValue);
  if (!Number.isInteger(selectedHours) || selectedHours < HOURLY_CLEANING_MIN_HOURS || selectedHours > 24) {
    throw Object.assign(new Error("Choose a whole number from 4 to 24 work-hours for hourly cleaning."), {
      statusCode: 400
    });
  }
  const totalCents = selectedHours * HOURLY_CLEANING_RATE * 100;
  const taxBreakdown = inclusiveTaxBreakdown(totalCents);
  const baseItem = {
    key: "hourly_cleaning_hours",
    label: `${selectedHours} work-hours`,
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
    id: `hourly__${selectedHours}_hours`,
    packageIds: [`hourly__${selectedHours}_hours`],
    serviceKey: "hourly",
    serviceLabel: "Hourly Cleaning Service",
    tierKey: "hourly",
    tierLabel: `${selectedHours} Work-Hour Service`,
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
    manHourRate: HOURLY_CLEANING_RATE,
    unitCount: 1,
    pricingMode: "hourly_formula",
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
  const waterDamage = cleanText(eligibility.waterDamage, 40);
  const recentRenovation = cleanText(eligibility.recentRenovation, 40);
  const excessiveBelongings = cleanText(eligibility.excessiveBelongings, 40);
  const utilitiesAvailable = cleanText(eligibility.utilitiesAvailable, 40);
  const unsafeConditions = cleanText(eligibility.unsafeConditions, 40);
  const clutter = cleanText(eligibility.clutter, 40);
  const buildup = cleanText(eligibility.buildup, 40);
  const hazards = cleanText(eligibility.hazards, 40);
  const constructionFinished = cleanText(eligibility.constructionFinished, 20);
  const contractorItemsRemoved = cleanText(eligibility.contractorItemsRemoved, 20);

  if (cleaningCategory === "commercial") {
    return {
      type: "review",
      internalReason: "commercial_service",
      reason: "Commercial cleaning is customized for each business and may require a brief consultation or walkthrough before we confirm the scope and price.",
      reviewUrl: "/contact.html"
    };
  }
  if (cleaningCategory === "window") {
    return {
      type: "instant",
      serviceKey: "window",
      reason: "Window cleaning is priced from the selected window types, quantities, sides, add-ons, and safe-access details."
    };
  }
  if (waterDamage === "yes") {
    return {
      type: "ineligible",
      internalReason: "water_damage",
      reason: "We’re not currently providing cleaning related to flooding, sewage backup, or significant water damage. No cleaning quote is available for this category at this time."
    };
  }
  if (recentRenovation === "yes") {
    return {
      type: "review",
      internalReason: "post_construction",
      reason: "Recently renovated properties typically require specialized post-construction cleaning due to construction dust, debris, and fine particles.",
      reviewUrl: "/contact.html"
    };
  }
  if (excessiveBelongings && excessiveBelongings !== "no") {
    return {
      type: "review",
      internalReason: "excessive_belongings",
      reason: "Belongings or storage that limit access require a custom assessment so we can estimate the cleaning time, access needs, and staffing.",
      reviewUrl: "/contact.html"
    };
  }
  if (utilitiesAvailable === "no") {
    return {
      type: "ineligible",
      internalReason: "utilities_unavailable",
      reason: "Cleaning cannot be completed unless both electricity and running water are available at the property. We’re unable to provide or schedule a cleaning quote at this time. Please try again when both utilities are available."
    };
  }
  if (unsafeConditions === "yes") {
    return {
      type: "ineligible",
      internalReason: "ineligible_unsafe_conditions",
      reason: "For the safety of our cleaning team, we’re unable to provide or schedule cleaning while unsafe or hazardous conditions are present. Please try again after the conditions have been professionally removed or fully resolved."
    };
  }
  if (clutter === "unsafe") {
    return {
      type: "ineligible",
      internalReason: "ineligible_clutter_access",
      reason: "We’re unable to provide or schedule cleaning when the amount of clutter may prevent safe access for our cleaners. Please try again after clear and safe access has been created throughout the areas that need cleaning."
    };
  }
  if (["pests", "waste"].includes(hazards)) {
    return {
      type: "ineligible",
      internalReason: "ineligible_safety",
      reason: "We’re unable to provide a cleaning quote while active pests or human or significant animal waste are present. Please try again after the condition has been professionally removed or resolved."
    };
  }
  if (condition === "severe") {
    return { type: "review", reason: "The reported property condition requires a custom quote so we can review the scope accurately." };
  }
  if (propertyStatus === "renovated") {
    if (constructionFinished !== "yes" || contractorItemsRemoved !== "yes") {
      return {
        type: "ineligible",
        internalReason: "post_construction_not_ready",
        reason: "Post-construction cleaning is available only after all construction work is finished and contractor tools, unused materials, and equipment have been removed."
      };
    }
    return { type: "instant", serviceKey: "post", reason: "A recently renovated or constructed property qualifies for Post-Construction Cleaning." };
  }
  if (propertyStatus === "moving") {
    return { type: "instant", serviceKey: "move", reason: "An empty property being prepared before or after a move qualifies for Move-In / Move-Out Cleaning." };
  }
  if (requestedService === "details") {
    return { type: "instant", serviceKey: "deep", reason: "Deep Cleaning is the closest available option for added attention to buildup and priority areas." };
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
  if (requestedService === "recurring") {
    return { type: "instant", serviceKey: "recurring", reason: "The customer selected Recurring Cleaning Service, and the reported condition qualifies for it." };
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
    if (data?.code === "23P01") throw Object.assign(new Error("That appointment conflicts with another booking or its three-hour buffer. Please choose another time."), { statusCode: 409 });
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

async function listAllBookings() {
  const records = hasSupabaseConfig()
    ? await supabaseRequest("?select=*&order=created_at.desc&limit=500")
    : await listDriveBookings();
  return (records || []).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
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
  await require('./_calendar').assertCalendarReady();
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
    if (!booking) throw Object.assign(new Error("Paid booking record could not be found."), { statusCode: 404 });
    if (booking.status === 'Cancelled') throw Object.assign(new Error('This appointment was cancelled. Our team must review the payment.'), { statusCode: 409 });
    if (["Completed", "In progress", "Cleaner assigned", "Confirmed"].includes(booking.status)) {
      confirmedBooking = booking;
    } else {
      const changed = await supabaseRequest(`?id=eq.${encodeURIComponent(bookingId)}&status=eq.New`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "Confirmed" })
      });
      confirmedBooking = changed?.[0] || await getBooking(bookingId);
      if (!["Completed", "In progress", "Cleaner assigned", "Confirmed"].includes(confirmedBooking?.status)) {
        throw Object.assign(new Error('The booking changed before payment confirmation. Our team must review it.'), { statusCode: 409 });
      }
    }
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
  if (confirmedBooking?.schedule && !confirmedBooking?.estimate?.awaitingSchedule && !confirmedBooking?.estimate?.managedQuote?.awaitingSchedule) {
    try {
      calendarSync = await syncBookingToGoogleCalendar(confirmedBooking);
    } catch (error) {
      calendarSync = { status: "error", error: cleanText(error.message, 300) };
    }
  } else if (confirmedBooking) calendarSync = { status: "awaiting_schedule" };
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
  ["status", "schedule", "schedule_label", "estimate", "notes", "client_name", "phone", "email", "address", "service", "service_label", "bedrooms_label", "bathrooms_label", "sqft", "addons"].forEach((key) => {
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
  if (["Confirmed", "Cleaner assigned", "In progress", "Completed"].includes(record.status)) return bookingInterval(record).end + APPOINTMENT_GAP_HOURS * 3600000 > now;
  if (record.status !== "New") return false;
  const reservation = record.estimate?.calendarReservation;
  if (["draft", "released"].includes(reservation?.state)) return false;
  if (["creating", "open"].includes(reservation?.state)) return true;
  const createdAt = new Date(record.created_at).getTime();
  return Number.isFinite(createdAt) && now - createdAt < HOLD_MINUTES * 60 * 1000;
}

function bookingDurationHours(record) {
  const hours = Number(record.estimate?.teamHours ?? record.estimate?.hours ?? 2);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 200) throw Object.assign(new Error("Enter a valid appointment duration."), { statusCode: 400 });
  return hours;
}

function bookingInterval(record) {
  const start = new Date(record.schedule).getTime();
  if (!Number.isFinite(start)) throw Object.assign(new Error("An appointment has an invalid start time. Please contact our team."), { statusCode: 503 });
  return { start, end: start + bookingDurationHours(record) * 60 * 60 * 1000 };
}

async function listActiveBookings() {
  const records = [];
  if (hasSupabaseConfig()) {
    for (let offset = 0; ; offset += 500) {
      const page = await supabaseRequest(`?select=id,status,schedule,estimate,created_at&status=in.(New,Confirmed,Cleaner%20assigned,In%20progress,Completed)&order=id.asc&limit=500&offset=${offset}`);
      records.push(...(page || []));
      if (page.length < 500) break;
      if (offset >= 49500) throw Object.assign(new Error("Availability could not be checked completely. Please contact our team."), { statusCode: 503 });
    }
    const { reconcileReservation } = require('./_calendar');
    for (let index = 0; index < records.length; index += 5) {
      const reconciled = await Promise.all(records.slice(index, index + 5).map(reconcileReservation));
      records.splice(index, reconciled.length, ...reconciled);
    }
  } else records.push(...await listDriveBookings());
  return (records || []).filter((record) => activeBooking(record));
}

async function assertScheduleAvailable(startIso, hours, excludeBookingId = '') {
  const start = new Date(startIso).getTime();
  if (!Number.isFinite(start) || start <= Date.now() || !Number.isFinite(hours) || hours <= 0 || hours > 200) throw Object.assign(new Error("Choose a future start time and valid on-site duration."), { statusCode: 400 });
  const [bookings, calendar] = await Promise.all([listActiveBookings(), googleCalendarBusyRecords(new Date(start - 3 * 3600000).toISOString(), new Date(start + (hours + 3) * 3600000).toISOString())]);
  if (!slotAvailable(startIso, hours, bookings.concat(calendar.records).filter(b => b.id !== excludeBookingId))) throw Object.assign(new Error("That appointment conflicts with another booking or its three-hour buffer. Choose another time."), { statusCode: 409 });
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

function bookingCalendarId() {
  return process.env.GOOGLE_CALENDAR_ID || 'info@imancleaningservice.com';
}

async function googleCalendarConnectionStatus() {
  if (!googleCalendarConfigured()) return { connected: false, writable: false, calendarId: bookingCalendarId() };
  let stage = 'read_calendar';
  try {
    const auth = await require('../google-calendar/_connection').calendarAuth();
    const calendar = await getGoogleCalendarClient(auth);
    const result = await calendar.events.list({ calendarId: bookingCalendarId(), maxResults: 1, timeMin: new Date().toISOString() });
    stage = 'check_permissions';
    const { token } = await auth.getAccessToken();
    const tokenInfo = await auth.getTokenInfo(token);
    const scopes = tokenInfo.scopes || [];
    const role = result.data.accessRole;
    const canWrite = scopes.some(scope => ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'].includes(scope)) ||
      (role === 'owner' && scopes.includes('https://www.googleapis.com/auth/calendar.events.owned'));
    return { connected: true, writable: canWrite && ['owner', 'writer'].includes(role), calendarId: bookingCalendarId() };
  } catch (error) {
    const providerError = error.response?.data?.error;
    const reason = providerError?.errors?.[0]?.reason || (typeof providerError === 'string' ? providerError : '');
    const safeReasons = ['insufficientPermissions', 'accessNotConfigured', 'forbidden', 'notFound', 'invalid_grant'];
    return { connected: false, writable: false, calendarId: bookingCalendarId(), stage,
      reason: safeReasons.includes(reason) ? reason : 'connection_failed',
      status: Number(error.response?.status || error.code) || 503 };
  }
}

async function getGoogleCalendarClient(connectedAuth) {
  if (!googleCalendarConfigured()) return null;
  const { calendar: createCalendar } = require("googleapis/build/src/apis/calendar");
  const auth = connectedAuth || await require('../google-calendar/_connection').calendarAuth();
  return createCalendar({ version: "v3", auth });
}

async function googleCalendarBusyRecords(timeMin, timeMax) {
  if (!googleCalendarConfigured()) return { connected: false, records: [] };
  try {
    const calendar = await getGoogleCalendarClient();
    const events = [];
    let pageToken;
    do {
      const listed = await calendar.events.list({
        calendarId: bookingCalendarId(),
        timeMin, timeMax, singleEvents: true, showDeleted: false,
        maxResults: 2500, ...(pageToken ? { pageToken } : {})
      });
      events.push(...(listed.data.items || []));
      pageToken = listed.data.nextPageToken;
      if (pageToken && events.length >= 50000) throw new Error("Calendar result limit exceeded");
    } while (pageToken);
    const records = events
      .filter((event) => event.status !== "cancelled" && event.transparency !== "transparent")
      .map((event) => {
        const startValue = event.start?.dateTime || (event.start?.date ? `${event.start.date}T00:00:00${offsetForLocalDate(event.start.date, "00:00")}` : "");
        const endDate = event.end?.date || event.start?.date;
        const endValue = event.end?.dateTime || (endDate ? `${endDate}T00:00:00${offsetForLocalDate(endDate, "00:00")}` : "");
        const start = new Date(startValue).getTime();
        const end = new Date(endValue).getTime();
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
        return {
          id: event.extendedProperties?.private?.iman_booking_id || `google:${event.id}`,
          status: "Confirmed",
          schedule: new Date(start).toISOString(),
          estimate: { teamHours: (end - start) / (60 * 60 * 1000) },
          source: "google-calendar"
        };
      })
      .filter(Boolean);
    return { connected: true, records };
  } catch (error) {
    throw Object.assign(new Error("Calendar availability could not be verified. Please try again shortly."), { statusCode: 503 });
  }
}

async function syncBookingToGoogleCalendar(booking, { notifyCustomer = true } = {}) {
  if (!googleCalendarConfigured()) return { status: "not_configured" };
  const calendar = await getGoogleCalendarClient();
  const calendarId = bookingCalendarId();
  const privateKey = `iman_booking_id=${booking.id}`;
  const existing = await calendar.events.list({
    calendarId,
    privateExtendedProperty: [privateKey],
    maxResults: 1,
    singleEvents: true
  });
  if (existing.data.items?.[0]) {
    const event = existing.data.items[0];
    return { status: "already_exists", eventId: event.id, start: event.start?.dateTime, end: event.end?.dateTime };
  }

  const start = new Date(booking.schedule);
  const teamHours = bookingDurationHours(booking);
  const end = new Date(start.getTime() + teamHours * 60 * 60 * 1000);
  // Google accepts hexadecimal event IDs. Deterministic IDs prevent duplicate
  // calendar invitations when Stripe retries a confirmation concurrently.
  const eventId = `iman${crypto.createHash('sha256').update(booking.id).digest('hex')}`;
  let inserted;
  try { inserted = await calendar.events.insert({
    calendarId,
    sendUpdates: notifyCustomer ? "all" : "none",
    requestBody: {
      id: eventId,
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
      attendees: notifyCustomer && booking.email ? [{ email: booking.email }] : [],
      extendedProperties: {
        private: { iman_booking_id: booking.id }
      }
    }
  }); } catch (error) {
    if (Number(error.code || error.response?.status) !== 409) throw error;
    return { status: 'already_exists', eventId };
  }
  return { status: "created", eventId: inserted.data.id, start: inserted.data.start?.dateTime, end: inserted.data.end?.dateTime };
}

async function updateBookingGoogleCalendar(booking, action = "reschedule", { notifyCustomer = true } = {}) {
  if (!googleCalendarConfigured()) return { status: "not_configured" };
  const calendar = await getGoogleCalendarClient();
  const calendarId = bookingCalendarId();
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
      : syncBookingToGoogleCalendar(booking, { notifyCustomer });
  }
  if (action === "cancel") {
    await calendar.events.delete({ calendarId, eventId: event.id, sendUpdates: "all" });
    return { status: "cancelled", eventId: event.id };
  }
  const start = new Date(booking.schedule);
  const teamHours = bookingDurationHours(booking);
  const end = new Date(start.getTime() + teamHours * 60 * 60 * 1000);
  await calendar.events.patch({
    calendarId,
    eventId: event.id,
    sendUpdates: notifyCustomer ? "all" : "none",
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
      end: { dateTime: end.toISOString(), timeZone: TIME_ZONE }
    }
  });
  return { status: "rescheduled", eventId: event.id };
}

async function availableSlotsForPackage(pkg, days = MAX_ADVANCE_BOOKING_DAYS, now = new Date(), excludeBookingId = '') {
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
  // Checking identical intervals twice does not add another buffer. Exclude
  // both representations of the current booking when offering reschedule times.
  const bookings = storedBookings.concat(calendarAvailability.records).filter(b => b.id !== excludeBookingId);

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

async function makeUniqueOrderNumber() {
  const existing = new Set((await listAllBookings()).map((booking) => (
    String(booking?.estimate?.orderNumber || "").replace(/\D/g, "")
  )).filter(Boolean));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const orderNumber = String(crypto.randomInt(10000000, 100000000));
    if (!existing.has(orderNumber)) return orderNumber;
  }
  throw Object.assign(new Error("A unique order number could not be created. Please try again."), { statusCode: 503 });
}

module.exports = {
  APPOINTMENT_GAP_HOURS,
  CLOSE_TIME,
  HOLD_MINUTES,
  MAN_HOUR_RATE,
  ORGANIZATION_HOURLY_RATE,
  ORGANIZATION_MIN_HOURS,
  HOURLY_CLEANING_RATE,
  HOURLY_CLEANING_MIN_HOURS,
  MAX_ADVANCE_BOOKING_DAYS,
  MIN_BOOKING_NOTICE_HOURS,
  NY_SALES_TAX_RATE,
  OPEN_TIME,
  SLOT_INTERVAL_MINUTES,
  TEAM_SIZE,
  availableSlotsForPackage,
  availableSlotsForDate,
  assertScheduleAvailable,
  bookingDurationHours,
  bookingInterval,
  activeBooking,
  googleCalendarConnectionStatus,
  catalogForClient,
  cleanText,
  calculateResidentialQuoteBundle,
  calculateResidentialUnitPrice,
  calculateOrganizationQuote,
  calculateHourlyCleaningQuote,
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
  temporarilyPausedServiceBorough,
  packageForClient,
  json,
  listAllBookings,
  listReminderBookings,
  listPaymentBookings,
  listCustomerBookings,
  makeBookingId,
  makeUniqueOrderNumber,
  nextAvailableSlotForDate,
  toZonedIso,
  readJsonBody,
  recommendResidentialService,
  supabaseRequest,
  syncBookingToGoogleCalendar,
  updateBooking,
  updateBookingEstimate,
  updateBookingGoogleCalendar
};
