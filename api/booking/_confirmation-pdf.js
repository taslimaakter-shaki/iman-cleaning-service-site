const { staffingOptions, displayNotes } = require("./_staffing-options");
const PDFDocument = require("pdfkit");

const COLORS = {
  ink: "#16363d",
  muted: "#607579",
  teal: "#0b7285",
  green: "#639b38",
  caution: "#a84f08",
  cautionPale: "#fff6e8",
  line: "#d7e5e3",
  pale: "#f2f8f7"
};

const LABELS = {
  serviceIntent: "Type of help requested",
  requestedService: "Requested service",
  cleaningCategory: "Cleaning category",
  propertyStatus: "Property status",
  propertyType: "Property type",
  serviceZip: "Service ZIP code",
  unitCount: "Number of units",
  propertyOver2000: "Property larger than 2,000 sq. ft.",
  squareFootage: "Approximate property square footage",
  waterDamage: "Water or flood damage",
  recentRenovation: "Recent renovation or construction",
  excessiveBelongings: "Belongings limiting access",
  utilitiesAvailable: "Electricity and water available",
  unsafeConditions: "Unsafe or restricted conditions reported",
  clutter: "Clutter level",
  buildup: "Buildup level",
  hazards: "Safety concerns",
  lastCleaned: "Last professionally cleaned",
  condition: "Reported condition",
  bedrooms: "Bedrooms",
  fullBathrooms: "Full bathrooms",
  halfBathrooms: "Half bathrooms",
  hasLivingRoom: "Living room",
  hasDiningRoom: "Dining room",
  kitchen: "Kitchen",
  livingDining: "Living and dining area",
  hasPets: "Pets in the property",
  petCount: "Number of pets",
  petType: "Pet type",
  otherPetType: "Other pet type",
  refrigeratorCleaning: "Inside refrigerator",
  ovenCleaning: "Inside oven",
  cabinetsDrawers: "Cabinets and drawers",
  additionalCleaning: "Additional cleaning requested",
  hours: "Organization labor-hours",
  scope: "Cleaning sides",
  frequency: "Service frequency",
  screens: "Removable window screens",
  tracks: "Detailed sills and tracks",
  size: "Largest panel size",
  access: "Highest exterior access",
  windows: "Selected window types and quantities"
};

const OMIT_UNIT_KEYS = new Set([
  "unitNumber", "tierKey", "tierLabel", "squareFootage", "baseItems", "addOns",
  "basePrice", "baseSubtotal", "addOnTotal", "addOnSubtotal", "subtotal",
  "subtotalCents", "price", "manHours", "teamHours", "cleanerCount", "packageId",
  "serviceZip"
]);

function safeText(value) {
  return String(value ?? "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00bd/g, "1/2")
    .replace(/\u00d7/g, "x")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function friendlyLabel(key) {
  if (LABELS[key]) return LABELS[key];
  return safeText(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function friendlyValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === "object") {
        const type = item.type ? friendlyValue(item.type) : "Item";
        const quantity = Number(item.quantity || 0);
        return quantity ? `${type}: ${quantity}` : type;
      }
      return friendlyValue(item);
    }).filter(Boolean).join("; ");
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, nested]) => nested !== "" && nested !== null && nested !== undefined)
      .map(([key, nested]) => `${friendlyLabel(key)}: ${friendlyValue(nested)}`)
      .join("; ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = safeText(value).replace(/_/g, " ").trim();
  if (!text) return "";
  if (["yes", "no"].includes(text.toLowerCase())) {
    return text[0].toUpperCase() + text.slice(1).toLowerCase();
  }
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function moneyFromCents(cents) {
  return `$${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`;
}

function formatAppointment(booking, record) {
  const schedule = booking?.schedule;
  if (schedule) {
    const date = new Date(schedule);
    if (Number.isFinite(date.getTime())) {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(date);
    }
  }
  return [record?.serviceDate, record?.serviceTime].filter(Boolean).join(" at ");
}

function answerRows(source, omitted = new Set()) {
  return Object.entries(source || {})
    .filter(([key, value]) => !omitted.has(key) && value !== "" && value !== null && value !== undefined)
    .map(([key, value]) => [friendlyLabel(key), friendlyValue(value)])
    .filter(([, value]) => value);
}

function compactValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => compactValue(item)).filter(Boolean).join("; ");
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, nested]) => {
        if (nested === "" || nested === null || nested === undefined || nested === false) return false;
        if (typeof nested === "number" && nested <= 0) return false;
        return !["no", "none", "not included"].includes(String(nested).trim().toLowerCase());
      })
      .map(([key, nested]) => `${friendlyLabel(key)}: ${friendlyValue(nested)}`)
      .join("; ");
  }
  return friendlyValue(value);
}

function meaningfulUnitRows(source, omitted = new Set()) {
  return Object.entries(source || {})
    .filter(([key, value]) => {
      if (omitted.has(key) || value === "" || value === null || value === undefined || value === false) return false;
      if (typeof value === "number" && value <= 0) return false;
      const normalized = String(value).trim().toLowerCase();
      if (/^exclude/i.test(key) && ["no", "false", "0"].includes(normalized)) return false;
      if (/^(mold|hasPets|additionalCleaning|exteriorWindows)/i.test(key)
        && ["no", "none", "false", "0"].includes(normalized)) return false;
      return Boolean(compactValue(value));
    })
    .map(([key, value]) => [key, friendlyLabel(key), compactValue(value)]);
}

function formatTeamTime(estimate = {}) {
  const options = staffingOptions(estimate);
  if (options) return `${options}; service may be completed sooner`;
  const cleaners = Number(estimate.cleanerCount || 0);
  const totalMinutes = Math.round(Number(estimate.teamHours || 0) * 60);
  const duration = totalMinutes > 0
    ? [
        Math.floor(totalMinutes / 60) ? `${Math.floor(totalMinutes / 60)} ${Math.floor(totalMinutes / 60) === 1 ? "hour" : "hours"}` : "",
        totalMinutes % 60 ? `${totalMinutes % 60} minutes` : ""
      ].filter(Boolean).join(" ")
    : "";
  const team = cleaners ? `${cleaners} cleaning ${cleaners === 1 ? "professional" : "professionals"}` : "";
  return [team, duration ? `up to ${duration}; service may be completed sooner` : ""].filter(Boolean).join(" - ");
}

function formatAppointmentParts(booking, record) {
  const schedule = booking?.schedule ? new Date(booking.schedule) : null;
  if (schedule && Number.isFinite(schedule.getTime())) {
    const arrival = booking?.estimate?.arrivalPreference || {};
    return {
      date: new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric"
      }).format(schedule),
      time: arrival.flexible && arrival.windowLabel
        ? `${arrival.windowLabel} estimated arrival window`
        : new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", hour: "numeric", minute: "2-digit"
      }).format(schedule)
    };
  }
  return { date: record?.serviceDate || "", time: record?.arrivalWindow ? `${record.arrivalWindow} estimated arrival window` : record?.serviceTime || "" };
}

function buildSections({ booking, record }) {
  const estimate = booking?.estimate || {};
  const selectedService = safeText(
    estimate.eligibility?.requestedService || booking?.service || booking?.service_label || record?.service
  ).toLowerCase();
  const isMovingCleaning = selectedService === "move" || /move[ -]?(in|out)|moving cleaning/.test(selectedService);
  const agreementAcceptance = estimate.agreementAcceptance || {};
  const appointment = formatAppointmentParts(booking, record);
  const customerRows = [
    ["Order number", booking?.estimate?.orderNumber || record.orderNumber],
    ["Booking reference", booking?.id || record.quoteId],
    ["Booking status", "Confirmed"],
    ["Customer", booking?.client_name || record.customerName],
    ["Email", booking?.email || record.customerEmail],
    ["Phone", booking?.phone || record.customerPhone],
    ["Service address", booking?.address || record.serviceLocation],
    ["Service", booking?.service_label || record.service],
    ["Service date", appointment.date],
    ["Estimated arrival time", appointment.time],
    ["Team and maximum time", formatTeamTime(estimate)]
  ].filter(([, value]) => value);

  const sections = [{ title: "Booking and customer information", rows: customerRows }];
  const eligibilityRows = answerRows(estimate.eligibility);
  if (eligibilityRows.length) sections.push({ title: "Eligibility and prescreening answers", rows: eligibilityRows });

  const homeKeys = new Set([
    "bedrooms", "fullBathrooms", "halfBathrooms", "kitchens", "kitchen", "hasLivingRoom", "hasDiningRoom",
    "livingDining", "additionalRooms", "additionalRoomTypes", "squareFootage"
  ]);
  const selectionKeys = new Set([
    "refrigeratorCleaning", "ovenCleaning", "cabinetsDrawers", "refrigerator", "oven", "cabinets",
    "windowCleaning", "interiorWindowCleaning", "screens", "tracks", "scope", "frequency", "windows"
  ]);

  (Array.isArray(estimate.units) ? estimate.units : []).forEach((unit, index) => {
    const omittedUnitKeys = new Set(OMIT_UNIT_KEYS);
    if (isMovingCleaning) {
      // Moving Cleaning requires an empty property. These questions are not
      // asked and must not appear as zero/negative answers in the record.
      omittedUnitKeys.add("cabinetCount");
      omittedUnitKeys.add("drawerCount");
      omittedUnitKeys.add("cabinetsEmpty");
    }
    const entries = meaningfulUnitRows(unit, omittedUnitKeys);
    const suffix = estimate.units.length > 1 ? ` - unit ${index + 1}` : "";
    const homeRows = entries.filter(([key]) => homeKeys.has(key)).map(([, label, value]) => [label, value]);
    const selectionRows = entries.filter(([key]) => selectionKeys.has(key)).map(([, label, value]) => [label, value]);
    const conditionRows = entries.filter(([key]) => /(buildup|clutter|mold|construction|condition)/i.test(key))
      .map(([, label, value]) => [label, value]);
    const usedKeys = new Set(entries
      .filter(([key]) => homeKeys.has(key) || selectionKeys.has(key) || /(buildup|clutter|mold|construction|condition)/i.test(key))
      .map(([key]) => key));
    const otherRows = entries.filter(([key]) => !usedKeys.has(key)).map(([, label, value]) => [label, value]);
    if (homeRows.length) sections.push({ title: `Home details and selected rooms${suffix}`, rows: homeRows });
    if (selectionRows.length) sections.push({ title: `Included service selections and extras${suffix}`, rows: selectionRows });
    if (conditionRows.length) sections.push({ title: `Reported condition by area${suffix}`, rows: conditionRows });
    if (otherRows.length) sections.push({ title: `Additional service details${suffix}`, rows: otherRows });
  });

  if ((booking?.addons || []).length) {
    sections.push({ title: "Selected priorities", rows: [["Priorities and extras", booking.addons.join(", ")]] });
  }

  if (booking?.notes) {
    sections.push({
      title: "Customer notes - review before service",
      rows: [["Customer instructions", displayNotes(booking.notes, estimate)]],
      tone: "caution"
    });
  }

  sections.push({
    title: "Agreement confirmation",
    rows: [
      ["Agreement accepted", "Yes"],
      ["Agreement version", estimate.agreementVersion || "Current Service Agreement"],
      ["Agreement presented at", agreementAcceptance.presentedAt],
      ["Agreement scrolled to end at", agreementAcceptance.scrolledToEndAt],
      ["Customer accepted at", agreementAcceptance.customerAcceptedAt],
      ["Acceptance recorded at", agreementAcceptance.serverRecordedAt || record.agreementAcceptedAt],
      ["Acceptance method", agreementAcceptance.acceptanceMethod === "scroll_to_end_typed_name_then_checkbox" ? "Scrolled to the end, typed legal name, then checked acceptance" : agreementAcceptance.acceptanceMethod],
      ["Acceptance statement", agreementAcceptance.acceptanceText],
      ["Electronically signed by", agreementAcceptance.signedName],
      ["Agreement record hash", agreementAcceptance.recordHash],
      ["Agreement copy", agreementAcceptance.agreementUrl],
      ...(Array.isArray(agreementAcceptance.keyTerms)
        ? agreementAcceptance.keyTerms.map((term) => ["Key term accepted", term])
        : [])
    ].filter(([, value]) => value)
  });
  return sections;
}

function buildBookingConfirmationPdf({ booking = null, record }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54, bufferPages: true, info: {
      Title: `Booking confirmation ${safeText(booking?.id || record?.quoteId || "")}`,
      Author: "Iman Cleaning Service LLC",
      Subject: "Customer booking answers, agreement, and payment confirmation"
    } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.rect(0, 0, doc.page.width, 12).fill(COLORS.teal);
    doc.fillColor(COLORS.green).font("Helvetica-Bold").fontSize(8).text("BOOKING CONFIRMED");
    doc.moveDown(0.35);
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(19).text("Complete Booking Record");
    doc.moveDown(0.75);

    const ensureSpace = (height = 90) => {
      if (doc.y + height > doc.page.height - 66) doc.addPage();
    };
    const section = (title, rows, tone = "default") => {
      if (!rows.length) return;
      if (tone === "caution") {
        ensureSpace(94);
        const boxX = doc.page.margins.left;
        const boxY = doc.y;
        const boxPadding = 12;
        const label = safeText(rows[0]?.[0] || "Customer instructions");
        const value = safeText(rows[0]?.[1] || "");
        doc.font("Helvetica-Bold").fontSize(8.5);
        const labelHeight = doc.heightOfString(label, { width: pageWidth - (boxPadding * 2) });
        doc.font("Helvetica").fontSize(8.5);
        const valueHeight = doc.heightOfString(value, { width: pageWidth - (boxPadding * 2) });
        const boxHeight = 38 + labelHeight + valueHeight + (boxPadding * 2);
        doc.lineWidth(1.2).roundedRect(boxX, boxY, pageWidth, boxHeight, 7)
          .fillAndStroke(COLORS.cautionPale, COLORS.caution);
        doc.fillColor(COLORS.caution).font("Helvetica-Bold").fontSize(9.5)
          .text(safeText(title).toUpperCase(), boxX + boxPadding, boxY + boxPadding, {
            width: pageWidth - (boxPadding * 2),
            lineBreak: false
          });
        const labelY = boxY + boxPadding + 24;
        doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(8.5)
          .text(label, boxX + boxPadding, labelY, { width: pageWidth - (boxPadding * 2) });
        doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5)
          .text(value, boxX + boxPadding, labelY + labelHeight + 4, { width: pageWidth - (boxPadding * 2) });
        doc.y = boxY + boxHeight + 13;
        return;
      }
      ensureSpace(75);
      const headerY = doc.y;
      doc.roundedRect(doc.page.margins.left, headerY, pageWidth, 25, 6).fill(COLORS.pale);
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9.5)
        .text(safeText(title), doc.page.margins.left + 10, headerY + 6, {
          width: pageWidth - 20,
          lineBreak: false
        });
      doc.y = headerY + 34;
      rows.forEach(([label, value]) => {
        ensureSpace(38);
        const y = doc.y;
        const labelWidth = 145;
        const cleanLabel = safeText(label);
        const cleanValue = safeText(value);
        doc.font("Helvetica-Bold").fontSize(8.5);
        const labelHeight = doc.heightOfString(cleanLabel, { width: labelWidth });
        doc.font("Helvetica").fontSize(8.5);
        const valueHeight = doc.heightOfString(cleanValue, { width: pageWidth - labelWidth - 14 });
        doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(8.5)
          .text(cleanLabel, doc.page.margins.left, y, { width: labelWidth });
        doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5)
          .text(cleanValue, doc.page.margins.left + labelWidth + 14, y, { width: pageWidth - labelWidth - 14 });
        doc.y = Math.max(doc.y, y + labelHeight, y + valueHeight) + 5;
        doc.moveTo(doc.page.margins.left, doc.y - 2).lineTo(doc.page.width - doc.page.margins.right, doc.y - 2)
          .strokeColor(COLORS.line).lineWidth(0.5).stroke();
      });
      doc.moveDown(0.4);
    };

    buildSections({ booking, record }).forEach(({ title, rows, tone }) => section(title, rows, tone));

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8)
        .text(`Iman Cleaning Service LLC | 929-232-1930 | Page ${index + 1} of ${range.count}`,
          doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 10,
          { width: pageWidth, align: "center", lineBreak: false });
    }
    doc.end();
  });
}

module.exports = {
  buildBookingConfirmationPdf,
  buildSections,
  friendlyLabel,
  friendlyValue
};
