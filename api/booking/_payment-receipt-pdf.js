const PDFDocument = require("pdfkit");
const bookingDiscountName = require("../../booking-discount-names");
const { unitsFor, unitLabel, conditionChargeLabel } = require("./_document-details");

const COLORS = {
  ink: "#16363d",
  muted: "#607579",
  teal: "#0b7285",
  green: "#639b38",
  paleGreen: "#f1f7ec",
  caution: "#a84f08",
  cautionPale: "#fff6e8",
  line: "#d7e5e3",
  pale: "#f2f8f7"
};

function safeText(value) {
  return String(value ?? "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function moneyFromAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "";
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return safeText(value);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function appointmentParts(booking, record) {
  const date = booking?.schedule ? new Date(booking.schedule) : null;
  if (date && Number.isFinite(date.getTime())) {
    const arrival = booking?.estimate?.arrivalPreference || {};
    return {
      date: new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      }).format(date),
      time: arrival.flexible && arrival.windowLabel
        ? `${arrival.windowLabel} estimated arrival window`
        : new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit"
      }).format(date)
    };
  }
  return { date: safeText(record?.serviceDate), time: safeText(record?.arrivalWindow ? `${record.arrivalWindow} estimated arrival window` : record?.serviceTime) };
}

function paymentTypeLabel(value) {
  return value === "deposit_25" ? "25% booking deposit" : safeText(value || "Payment");
}

function pricingRows(booking, record) {
  const estimate = booking?.estimate || {};
  const units = unitsFor(estimate);
  const cents = value => Math.round(Number(value || 0) * 100);
  const itemCents = item => cents(item.preTaxAmount ?? item.amount);
  const adjustmentKind = item => {
    const text = `${item?.key || ""} ${item?.label || ""}`.toLowerCase();
    return ["dust", "buildup", "clutter", "mold"].find(kind => text.includes(kind) && text.includes("adjustment")) || "";
  };
  const groups = [
    ["dust", "Heavy dust and dirt cleaning", estimate.dustAdjustment],
    ["buildup", "Buildup adjustment", estimate.buildupAdjustment],
    ["clutter", "Clutter access adjustment", estimate.clutterAdjustment],
    ["mold", "Possible mold/mildew adjustment", estimate.moldAdjustment]
  ];
  const prefix = index => estimate.eligibility?.propertyType || estimate.propertyType || units.length > 1
    ? `${unitLabel(estimate, index)} - ` : "";
  const extras = [];
  const itemized = new Map(groups.map(([kind]) => [kind, []]));
  let baseCents = 0;
  units.forEach((unit, index) => {
    baseCents += (unit.baseItems || []).reduce((sum, item) => sum + Math.max(0, itemCents(item)), 0);
    (unit.addOns || []).forEach(item => {
      const amount = itemCents(item);
      if (!item?.label || (!amount && !item.included)) return;
      const kind = adjustmentKind(item);
      const label = kind === "buildup" ? "Buildup adjustment"
        : kind === "clutter" ? "Clutter access adjustment"
        : ["pet_fee", "property_pet_fee"].includes(item.key) ? "Pet cleaning"
        : String(item.label).replace(/\s*\([^)]*%[^)]*\)/g, "");
      const row = { label: prefix(index) + label, cents: amount };
      if (kind) itemized.get(kind).push(row);
      else extras.push(row);
    });
  });
  groups.forEach(([kind, fallbackLabel, adjustment]) => {
    const savedRows = itemized.get(kind);
    const storedTotal = savedRows.length ? savedRows.reduce((sum, row) => sum + row.cents, 0)
      : adjustment?.amountCents ?? cents(adjustment?.amount);
    if (!(storedTotal > 0)) return;
    const areas = (adjustment?.affectedAreas || []).filter(area => area.roomId && area.conditionType && (area.amountCents ?? cents(area.amount)) > 0);
    const areaTotal = areas.reduce((sum, area) => sum + (area.amountCents ?? cents(area.amount)), 0);
    // Split only when the saved per-room charges reconcile. No repricing with
    // today's rates, and no duplicate aggregate charge on older bookings.
    if (units.length && areas.length && areaTotal === storedTotal) {
      areas.forEach(area => {
        const index = units.findIndex((unit, i) => (unit.unitNumber || i + 1) === area.unitNumber);
        extras.push({ label: `${unitLabel(estimate, index < 0 ? Math.max(0, Number(area.unitNumber || 1) - 1) : index)} - ${conditionChargeLabel(area)}`,
          cents: area.amountCents ?? cents(area.amount) });
      });
    } else if (savedRows.length) extras.push(...savedRows);
    else extras.push({ label: fallbackLabel, cents: storedTotal });
  });
  const service = safeText(booking?.service_label || record?.service || "Cleaning Service");
  const serviceLabel = /service$/i.test(service) ? service : `${service} Service`;
  const subtotalValue = record?.subtotalBeforeTax ?? estimate.subtotal;
  const subtotal = subtotalValue === undefined || subtotalValue === null || subtotalValue === "" ? null
    : cents(String(subtotalValue).replace(/[^0-9.-]/g, ""));
  const extrasCents = extras.reduce((sum, item) => sum + item.cents, 0);
  if (Number.isFinite(subtotal)) {
    // The saved subtotal is authoritative, including rounding and custom quotes.
    // Inconsistent legacy breakdowns are summarized rather than invented.
    if (subtotal < extrasCents) return [[serviceLabel, moneyFromAmount(subtotal / 100)]];
    baseCents = subtotal - extrasCents;
  }
  const rows = baseCents > 0 ? [[serviceLabel, moneyFromAmount(baseCents / 100)]] : [];
  extras.forEach(item => rows.push([safeText(item.label), item.cents ? moneyFromAmount(item.cents / 100) : "Included"]));
  if (!rows.length) rows.push([serviceLabel, record?.subtotalBeforeTax || record?.totalAmount || ""]);
  return rows.filter(([, value]) => value);
}

function buildPaymentReceiptPdf({ booking = null, record }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 45,
      bufferPages: true,
      info: {
        Title: `Payment receipt ${safeText(record?.quoteId || "")}`,
        Author: "Iman Cleaning Service LLC",
        Subject: "Booking deposit payment receipt"
      }
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const bottomLimit = doc.page.height - 64;
    const paidAmount = record?.paidAmount || "$0.00";
    const appointment = appointmentParts(booking, record);
    const remainingNumber = Number(String(record?.remainingAmount || "0").replace(/[^0-9.-]/g, ""));
    const discountLabel = safeText(bookingDiscountName("", record?.discountLabel));

    const drawPageBrand = () => {
      doc.rect(0, 0, doc.page.width, 8).fill(COLORS.teal);
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10)
        .text("IMAN CLEANING SERVICE LLC", left, 25, { lineBreak: false });
      doc.y = 48;
    };
    const ensureSpace = (height) => {
      if (doc.y + height > bottomLimit) {
        doc.addPage();
        drawPageBrand();
      }
    };
    const sectionTitle = (title) => {
      ensureSpace(26);
      doc.y += 4;
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10.5)
        .text(safeText(title), left, doc.y, { width, lineBreak: false });
      doc.y += 14;
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor(COLORS.line).lineWidth(0.7).stroke();
      doc.y += 2;
    };
    const infoGrid = (items) => {
      const gap = 0;
      const colWidth = (width - gap) / 2;
      for (let index = 0; index < items.length; index += 2) {
        ensureSpace(35);
        const y = doc.y;
        const row = [items[index], items[index + 1]].filter(Boolean);
        row.forEach(([label, value], column) => {
          const x = left + (column * (colWidth + gap));
          doc.rect(x, y, colWidth, 35).fillAndStroke(COLORS.pale, COLORS.line);
          doc.fillColor(COLORS.teal).font("Helvetica-Bold").fontSize(7.2)
            .text(safeText(label).toUpperCase(), x + 9, y + 5, { width: colWidth - 18, lineBreak: false });
          doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9)
            .text(safeText(value), x + 9, y + 19, { width: colWidth - 18, lineBreak: false });
        });
        doc.y = y + 35;
      }
    };
    const fullInfoRow = (label, value) => {
      ensureSpace(35);
      const y = doc.y;
      doc.rect(left, y, width, 35).fillAndStroke(COLORS.pale, COLORS.line);
      doc.fillColor(COLORS.teal).font("Helvetica-Bold").fontSize(7.2)
        .text(safeText(label).toUpperCase(), left + 9, y + 5, { width: width - 18, lineBreak: false });
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9)
        .text(safeText(value), left + 9, y + 19, { width: width - 18, lineBreak: false });
      doc.y = y + 35;
    };
    const moneyRows = (rows, { highlight = new Set(), caution = new Set() } = {}) => {
      rows.filter(([, value]) => value).forEach(([label, value]) => {
        doc.font("Helvetica").fontSize(8.6);
        const rowHeight = Math.max(19, doc.heightOfString(safeText(label), { width: width - 140 }) + 10);
        ensureSpace(rowHeight);
        const y = doc.y;
        const isHighlight = highlight.has(label);
        const isCaution = caution.has(label);
        if (isCaution) {
          doc.rect(left, y, width, rowHeight).fillAndStroke(COLORS.cautionPale, COLORS.caution);
        } else if (isHighlight) {
          doc.rect(left, y, width, rowHeight).fillAndStroke(COLORS.pale, COLORS.teal);
        } else {
          doc.moveTo(left, y + rowHeight).lineTo(right, y + rowHeight).strokeColor(COLORS.line).lineWidth(0.5).stroke();
        }
        const color = isCaution ? COLORS.caution : COLORS.ink;
        doc.fillColor(color).font(isCaution ? "Helvetica-Bold" : "Helvetica").fontSize(8.6)
          .text(safeText(label), left + 8, y + 5, { width: width - 140 });
        doc.fillColor(color).font("Helvetica-Bold").fontSize(8.6)
          .text(safeText(value), right - 130, y + 5, { width: 122, align: "right", lineBreak: false });
        doc.y = y + rowHeight;
      });
    };

    drawPageBrand();
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(19).text("Booking Deposit Receipt");
    doc.moveDown(0.2);

    const paidBoxY = doc.y;
    doc.rect(left, paidBoxY, width, 50).fillAndStroke(COLORS.paleGreen, COLORS.green);
    doc.fillColor(COLORS.teal).font("Helvetica-Bold").fontSize(8)
      .text(record?.paymentType === "deposit_25" ? "DEPOSIT PAID" : "AMOUNT PAID", left + 14, paidBoxY + 11, { lineBreak: false });
    doc.fillColor(COLORS.teal).font("Helvetica-Bold").fontSize(17)
      .text(safeText(paidAmount), right - 150, paidBoxY + 9, { width: 136, align: "right", lineBreak: false });
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8)
      .text("Payment status", left + 14, paidBoxY + 31, { lineBreak: false });
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9.3)
      .text("Paid", right - 150, paidBoxY + 29, { width: 136, align: "right", lineBreak: false });
    doc.y = paidBoxY + 54;

    sectionTitle("Receipt Information");
    infoGrid([
      ["Customer", booking?.client_name || record?.customerName],
      ["Order number", record?.orderNumber || booking?.estimate?.orderNumber || booking?.id],
      ["Service", booking?.service_label || record?.service],
      ["Payment type", paymentTypeLabel(record?.paymentType)],
      ["Payment date", formatDateTime(record?.paidAt)],
      ["Payment method", record?.paymentMethod],
      ["Service date", appointment.date],
      ["Estimated arrival time", appointment.time]
    ].filter(([, value]) => value));
    fullInfoRow("Booking reference", record?.quoteId || booking?.id || "");

    sectionTitle("Itemized Pricing - Before Tax");
    moneyRows(pricingRows(booking, record));

    sectionTitle("Service Price Calculation");
    moneyRows([
      ["Service subtotal", record?.subtotalBeforeTax],
      [discountLabel, record?.discountAmount],
      [record?.arrivalDiscountLabel || "Flexible arrival discount", record?.arrivalDiscountAmount],
      ["Discounted subtotal", record?.discountedSubtotalBeforeTax],
      ["NY sales tax (8.875%)", record?.salesTax],
      [record?.manualDiscountLabel || "Manual discount (after tax)", record?.manualDiscountAmount],
      ["Final service price", record?.totalAmount]
    ], { highlight: new Set(["Final service price"]) });

    sectionTitle("Payment Applied");
    moneyRows([
      [record?.paymentType === "deposit_25" ? "Deposit received" : "Amount received", paidAmount],
      ["Remaining balance", record?.remainingAmount]
    ], {
      highlight: new Set([record?.paymentType === "deposit_25" ? "Deposit received" : "Amount received"]),
      caution: remainingNumber > 0 ? new Set(["Remaining balance"]) : new Set()
    });
    if (remainingNumber > 0) {
      ensureSpace(45);
      doc.moveDown(0.7);
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.8)
        .text(booking?.estimate?.payment?.provider === "external" ? "The remaining balance is payable separately after service. No automatic card hold or charge will be made." : "The remaining balance will be temporarily authorized approximately 48 hours before the appointment and charged after service completion, according to the accepted booking agreement.", left, doc.y, { width, lineGap: 2 });
    }

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      const originalBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.moveTo(left, doc.page.height - 33).lineTo(right, doc.page.height - 33)
        .strokeColor(COLORS.line).lineWidth(0.5).stroke();
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7)
        .text("IMAN Cleaning Service LLC - Payment Receipt", left, doc.page.height - 25, { lineBreak: false });
      doc.text("929-232-1930  |  www.imancleaningservice.com", left, doc.page.height - 25, { width, align: "center", lineBreak: false });
      doc.text(`Page ${index + 1} of ${range.count}`, left, doc.page.height - 25, { width, align: "right", lineBreak: false });
      doc.page.margins.bottom = originalBottomMargin;
    }
    doc.end();
  });
}

module.exports = {
  buildPaymentReceiptPdf,
  pricingRows
};
