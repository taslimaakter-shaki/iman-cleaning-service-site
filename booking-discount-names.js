(() => {
  const names = {
    FALL10: "Fall Cleaning Discount",
    RETURNING5: "Returning Customer Discount",
    WEEKLY20: "Recurring Client Discount",
    BIWEEKLY15: "Recurring Client Discount",
    MONTHLY10: "Recurring Client Discount"
  };

  function bookingDiscountName(code, label = "") {
    const key = String(code || "").trim().toUpperCase();
    if (Object.hasOwn(names, key)) return names[key];
    const text = String(label || "").trim();
    // Earlier receipts sometimes stored the code in the label, alone or before
    // a description. Translate those receipts when they are displayed again.
    const oldCode = text.match(/^[a-z]+\d+\b/i)?.[0].toUpperCase();
    if (Object.hasOwn(names, oldCode)) return names[oldCode];
    if (/^(?:first-time customer fall discount|fall cleaning discount)$/i.test(text)) return names.FALL10;
    if (/^returning customer discount$/i.test(text)) return names.RETURNING5;
    if (/^(weekly|biweekly|monthly) cleaning discount$/i.test(text)) return names.WEEKLY20;
    return text || "Discount";
  }

  if (typeof module !== "undefined" && module.exports) module.exports = bookingDiscountName;
  if (typeof window !== "undefined") window.imanBookingDiscountName = bookingDiscountName;
})();
