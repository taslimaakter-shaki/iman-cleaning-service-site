const PDFDocument = require("pdfkit");

const COLORS = {
  ink: "#16363d",
  muted: "#607579",
  teal: "#0b7285",
  green: "#639b38",
  paleGreen: "#f1f7ec",
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

function money(cents) {
  const value = Math.max(0, Math.round(Number(cents) || 0));
  return `$${(value / 100).toFixed(2)}`;
}

function centsFromAmount(value) {
  return Math.max(0, Math.round((Number(value) || 0) * 100));
}

function formatDate(value, includeTime = false) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } : {})
  }).format(date);
}

function discountDetails(estimate = {}) {
  const discount = estimate.promoDiscount || estimate.recurringDiscount || estimate.manualDiscount || {};
  const amountCents = Math.max(0, Math.round(Number(discount.amountCents) || 0));
  const rawLabel = safeText(discount.label || estimate.promoCode || "Discount");
  return {
    amountCents,
    label: /^FALL10\b/i.test(rawLabel) ? "FALL10 discount" : rawLabel
  };
}

function receiptAmounts(booking = {}) {
  const estimate = booking.estimate || {};
  const payment = estimate.payment || {};
  const totalCents = Math.max(0, Math.round(Number(payment.totalCents) || centsFromAmount(estimate.total)));
  const discount = discountDetails(estimate);
  const arrivalDiscountCents = Math.max(0, Math.round(Number(estimate.arrivalDiscount?.amountCents) || 0));
  const arrivalDiscount = arrivalDiscountCents ? {
    amountCents: arrivalDiscountCents,
    label: safeText(estimate.arrivalDiscount?.label || "Flexible arrival discount")
  } : null;
  const subtotalCents = centsFromAmount(estimate.subtotal);
  const discountedSubtotalCents = centsFromAmount(Number.isFinite(Number(estimate.discountedSubtotal))
    ? estimate.discountedSubtotal
    : (subtotalCents - discount.amountCents - (arrivalDiscount?.amountCents || 0)) / 100);
  const taxCents = Math.max(0, Math.round(Number.isFinite(Number(estimate.tax))
    ? Number(estimate.tax) * 100
    : totalCents - discountedSubtotalCents));
  const depositCents = Math.max(0, Math.round(Number(payment.depositCents) || 0));
  const finalPaymentCents = Math.max(0, Math.round(Number(payment.remaining?.amountCents)
    || (payment.paymentType === "deposit_25" ? totalCents - depositCents : 0)));
  const paidCents = Math.max(0, Math.round(Number(payment.paidCents) || totalCents));
  return {
    totalCents,
    subtotalCents,
    discountedSubtotalCents,
    taxCents,
    depositCents,
    finalPaymentCents,
    paidCents,
    discount,
    ...(arrivalDiscount ? { arrivalDiscount } : {})
  };
}

function paymentMethodLabel(booking = {}) {
  const payment = booking.estimate?.payment || {};
  const remaining = payment.remaining || {};
  const brand = safeText(remaining.cardBrand || payment.cardBrand || "").trim();
  const last4 = safeText(remaining.cardLast4 || payment.cardLast4 || "").replace(/\D/g, "").slice(-4);
  return brand && last4 ? `${brand[0].toUpperCase()}${brand.slice(1)} ending in ${last4}` : "";
}

function buildFinalPaymentReceiptPdf({ booking }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 45,
      bufferPages: true,
      info: {
        Title: `Final payment receipt ${safeText(booking?.id || "")}`,
        Author: "Iman Cleaning Service LLC",
        Subject: "Final paid-in-full service receipt"
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
    const estimate = booking?.estimate || {};
    const payment = estimate.payment || {};
    const amounts = receiptAmounts(booking);

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
      const colWidth = width / 2;
      for (let index = 0; index < items.length; index += 2) {
        ensureSpace(35);
        const y = doc.y;
        [items[index], items[index + 1]].forEach((item, column) => {
          if (!item) return;
          const [label, value] = item;
          const x = left + column * colWidth;
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
    const moneyRows = (rows, highlight = new Set()) => {
      rows.filter(([, value]) => value).forEach(([label, value]) => {
        ensureSpace(19);
        const y = doc.y;
        if (highlight.has(label)) doc.rect(left, y, width, 19).fillAndStroke(COLORS.pale, COLORS.teal);
        else doc.moveTo(left, y + 19).lineTo(right, y + 19).strokeColor(COLORS.line).lineWidth(0.5).stroke();
        doc.fillColor(COLORS.ink).font(highlight.has(label) ? "Helvetica-Bold" : "Helvetica").fontSize(8.6)
          .text(safeText(label), left + 8, y + 5, { width: width - 140, lineBreak: false });
        doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(8.6)
          .text(safeText(value), right - 130, y + 5, { width: 122, align: "right", lineBreak: false });
        doc.y = y + 19;
      });
    };

    drawPageBrand();
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(19).text("Final Payment Receipt");
    doc.moveDown(0.2);
    const paidBoxY = doc.y;
    doc.rect(left, paidBoxY, width, 50).fillAndStroke(COLORS.paleGreen, COLORS.green);
    doc.fillColor(COLORS.teal).font("Helvetica-Bold").fontSize(8)
      .text("TOTAL PAID", left + 14, paidBoxY + 11, { lineBreak: false });
    doc.fillColor(COLORS.teal).font("Helvetica-Bold").fontSize(17)
      .text(money(amounts.paidCents), right - 150, paidBoxY + 9, { width: 136, align: "right", lineBreak: false });
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8)
      .text("Payment status", left + 14, paidBoxY + 31, { lineBreak: false });
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9.3)
      .text("Paid in full", right - 150, paidBoxY + 29, { width: 136, align: "right", lineBreak: false });
    doc.y = paidBoxY + 54;

    sectionTitle("Receipt Information");
    infoGrid([
      ["Customer", booking?.client_name],
      ["Order number", estimate.orderNumber || booking?.id],
      ["Service", booking?.service_label || booking?.service || "Cleaning service"],
      ["Service status", "Completed"],
      ["Final payment date", formatDate(payment.completedPaymentAt || payment.remaining?.capturedAt, true)],
      ["Payment method", paymentMethodLabel(booking)],
      ["Service date", formatDate(booking?.schedule)],
      ["Completion status", "Paid in full"]
    ].filter(([, value]) => value));
    fullInfoRow("Booking reference", booking?.id || "");

    sectionTitle("Service Price Calculation");
    moneyRows([
      ["Service subtotal", money(amounts.subtotalCents)],
      [amounts.discount.label, amounts.discount.amountCents ? `-${money(amounts.discount.amountCents)}` : ""],
      [amounts.arrivalDiscount?.label || "", amounts.arrivalDiscount?.amountCents ? `-${money(amounts.arrivalDiscount.amountCents)}` : ""],
      ["Discounted subtotal", amounts.discount.amountCents || amounts.arrivalDiscount?.amountCents ? money(amounts.discountedSubtotalCents) : ""],
      ["NY sales tax (8.875%)", money(amounts.taxCents)],
      ["Final service price", money(amounts.totalCents)]
    ], new Set(["Final service price"]));

    sectionTitle("Payment History");
    const depositPayment = payment.paymentType === "deposit_25" && amounts.depositCents > 0;
    moneyRows([
      [depositPayment ? "Deposit previously paid" : "Payment previously received", money(depositPayment ? amounts.depositCents : amounts.paidCents)],
      ["Final payment charged", depositPayment ? money(amounts.finalPaymentCents) : ""],
      ["Total paid", money(amounts.paidCents)],
      ["Remaining balance", "$0.00"]
    ], new Set(["Total paid", "Remaining balance"]));

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      const originalBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.moveTo(left, doc.page.height - 33).lineTo(right, doc.page.height - 33)
        .strokeColor(COLORS.line).lineWidth(0.5).stroke();
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7)
        .text("IMAN Cleaning Service LLC - Final Payment Receipt", left, doc.page.height - 25, { lineBreak: false });
      doc.text("929-232-1930  |  www.imancleaningservice.com", left, doc.page.height - 25, { width, align: "center", lineBreak: false });
      doc.text(`Page ${index + 1} of ${range.count}`, left, doc.page.height - 25, { width, align: "right", lineBreak: false });
      doc.page.margins.bottom = originalBottomMargin;
    }
    doc.end();
  });
}

module.exports = { buildFinalPaymentReceiptPdf, receiptAmounts };
