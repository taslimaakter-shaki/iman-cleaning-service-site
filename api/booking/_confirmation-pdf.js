const PDFDocument = require("pdfkit");

const COLORS = {
  ink: "#16363d",
  muted: "#607579",
  teal: "#0b7285",
  green: "#639b38",
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
  waterDamage: "Water or flood damage",
  recentRenovation: "Recent renovation or construction",
  excessiveBelongings: "Belongings limiting access",
  utilitiesAvailable: "Electricity and water available",
  propertyAccess: "Property safely accessible",
  clutter: "Clutter level",
  buildup: "Buildup level",
  hazards: "Safety concerns",
  lastCleaned: "Last professionally cleaned",
  condition: "Reported condition",
  bedrooms: "Bedrooms",
  fullBathrooms: "Full bathrooms",
  halfBathrooms: "Half bathrooms",
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
  hours: "Organization / decluttering labor-hours",
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

function buildSections({ booking, record }) {
  const estimate = booking?.estimate || {};
  const payment = estimate.payment || {};
  const customerRows = [
    ["Booking reference", booking?.id || record.quoteId],
    ["Customer", booking?.client_name || record.customerName],
    ["Email", booking?.email || record.customerEmail],
    ["Phone", booking?.phone || record.customerPhone],
    ["Service address", booking?.address || record.serviceLocation],
    ["Service ZIP code", estimate.eligibility?.serviceZip || String(booking?.address || "").match(/\b\d{5}(?:-\d{4})?\b/)?.[0]],
    ["Service", booking?.service_label || record.service],
    ["Appointment", formatAppointment(booking, record)],
    ["Booking status", "Confirmed"]
  ].filter(([, value]) => value);

  const sections = [{ title: "Booking and customer information", rows: customerRows }];
  const eligibilityRows = answerRows(estimate.eligibility);
  if (eligibilityRows.length) sections.push({ title: "Eligibility and service answers", rows: eligibilityRows });

  (Array.isArray(estimate.units) ? estimate.units : []).forEach((unit, index) => {
    const rows = answerRows(unit, OMIT_UNIT_KEYS);
    const included = [...(unit.baseItems || []), ...(unit.addOns || [])]
      .filter((item) => item?.label)
      .map((item) => ["Included item", `${safeText(item.label)}${Number.isFinite(Number(item.amount)) ? ` - $${Number(item.amount).toFixed(2)}` : ""}`]);
    if (rows.length || included.length) {
      sections.push({
        title: estimate.units.length > 1 ? `Service details - unit ${index + 1}` : "Service details",
        rows: [...rows, ...included]
      });
    }
  });

  const serviceRows = [
    ["Selected priorities / extras", (booking?.addons || []).join(", ")],
    ["Service notes", booking?.notes],
    ["Included labor-hours", estimate.manHours],
    ["Estimated team time", estimate.teamHours ? `${estimate.teamHours} hours` : ""],
    ["Estimated subtotal", Number.isFinite(Number(estimate.subtotal)) ? `$${Number(estimate.subtotal).toFixed(2)}` : ""],
    ["Sales tax", Number.isFinite(Number(estimate.tax)) ? `$${Number(estimate.tax).toFixed(2)}` : ""],
    ["Estimated total", record.totalAmount || (payment.totalCents ? moneyFromCents(payment.totalCents) : "")]
  ].filter(([, value]) => value !== "" && value !== null && value !== undefined);
  if (serviceRows.length) sections.push({ title: "Quote summary", rows: serviceRows });

  sections.push({
    title: "Agreement and payment confirmation",
    rows: [
      ["Agreement accepted", "Yes"],
      ["Agreement version", estimate.agreementVersion || "Current Service Agreement"],
      ["Agreement accepted at", record.agreementAcceptedAt],
      ["Payment status", record.paymentStatus || "Paid"],
      ["Payment method", record.paymentMethod],
      ["Payment type", record.paymentType === "deposit_25" ? "25% booking deposit" : friendlyValue(record.paymentType)],
      ["Deposit / amount paid", record.paidAmount],
      ["Remaining balance", record.remainingAmount],
      ["Estimated total", record.totalAmount],
      ["Paid at", record.paidAt],
      ["Payment reference", record.paymentIntentId],
      ["Receipt", record.stripeReceiptUrl],
      ["Invoice", record.stripeInvoiceUrl]
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
    doc.fillColor(COLORS.green).font("Helvetica-Bold").fontSize(11).text("IMAN CLEANING SERVICE LLC");
    doc.moveDown(0.35);
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(23).text("Booking Confirmation & Customer Submission");
    doc.moveDown(0.35);
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(10)
      .text("A complete record of the information submitted for this booking and the confirmed deposit payment.");
    doc.moveDown(1);

    const ensureSpace = (height = 90) => {
      if (doc.y + height > doc.page.height - 66) doc.addPage();
    };
    const section = (title, rows) => {
      if (!rows.length) return;
      ensureSpace(75);
      const headerY = doc.y;
      doc.roundedRect(doc.page.margins.left, headerY, pageWidth, 25, 6).fill(COLORS.pale);
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(12)
        .text(safeText(title), doc.page.margins.left + 10, headerY + 6, {
          width: pageWidth - 20,
          lineBreak: false
        });
      doc.y = headerY + 34;
      rows.forEach(([label, value]) => {
        ensureSpace(38);
        const y = doc.y;
        const labelWidth = 155;
        const cleanValue = safeText(value);
        const valueHeight = doc.heightOfString(cleanValue, { width: pageWidth - labelWidth - 14 });
        doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9.3)
          .text(safeText(label), doc.page.margins.left, y, { width: labelWidth });
        doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9.3)
          .text(cleanValue, doc.page.margins.left + labelWidth + 14, y, { width: pageWidth - labelWidth - 14 });
        doc.y = Math.max(doc.y, y + valueHeight) + 7;
        doc.moveTo(doc.page.margins.left, doc.y - 2).lineTo(doc.page.width - doc.page.margins.right, doc.y - 2)
          .strokeColor(COLORS.line).lineWidth(0.5).stroke();
      });
      doc.moveDown(0.65);
    };

    buildSections({ booking, record }).forEach(({ title, rows }) => section(title, rows));
    ensureSpace(65);
    doc.moveDown(0.4);
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10)
      .text("This document confirms the information on file at the time the booking deposit was paid.");
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5)
      .text("It does not display or store full card numbers. Payment processing is handled securely by Stripe.");

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8)
        .text(`Iman Cleaning Service LLC | 929-803-4053 | Page ${index + 1} of ${range.count}`,
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
