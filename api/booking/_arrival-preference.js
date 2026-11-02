const { cleanText } = require("./_shared");

const ARRIVAL_PREFERENCES = Object.freeze({
  exact: Object.freeze({ key: "exact", label: "Exact arrival time", percent: 0, start: "08:00", end: "20:30", flexible: false }),
  any_day: Object.freeze({ key: "any_day", label: "Anytime arrival discount", percent: 5, start: "08:00", end: "20:30", flexible: true }),
  morning: Object.freeze({ key: "morning", label: "Morning arrival", percent: 0, start: "08:00", end: "08:00", flexible: false, fixedStart: true }),
  afternoon: Object.freeze({ key: "afternoon", label: "Afternoon arrival", percent: 0, start: "08:00", end: "20:30", flexible: false, fixedStart: true })
});

function arrivalError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code: "ARRIVAL_PREFERENCE_INVALID" });
}

function arrivalPreferenceForKey(value, serviceTeamHours) {
  const key = cleanText(value, 30).toLowerCase();
  const preference = ARRIVAL_PREFERENCES[key];
  if (!preference) throw arrivalError("Choose an arrival-time option.");
  if (preference.key === "afternoon" && Number.isFinite(Number(serviceTeamHours))) {
    const latest = 20 * 60 + 30 - Math.ceil(Number(serviceTeamHours) * 60) - 60;
    if (latest < 480) throw arrivalError("This service cannot fit before closing with the additional reserved hour.", 409);
    const time = `${String(Math.floor(latest / 60)).padStart(2, '0')}:${String(latest % 60).padStart(2, '0')}`;
    return { ...preference, start: time, end: time };
  }
  return preference;
}

function assertArrivalPreferenceEligible(pkg, preferenceValue) {
  if (!pkg) throw arrivalError("Your quote must be completed before choosing an arrival window.");
  const preference = typeof preferenceValue === "object"
    ? preferenceValue
    : arrivalPreferenceForKey(preferenceValue, pkg.teamHours);
  return preference;
}

function minutes(value) {
  const [hour, minute] = String(value || "").split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : NaN;
}

function slotMatchesArrivalPreference(slot, preferenceValue) {
  const preference = typeof preferenceValue === "object"
    ? preferenceValue
    : arrivalPreferenceForKey(preferenceValue, slot?.teamHours);
  if (!slot || !slot.value) return false;
  if (slot.flexibleEligible !== true) return false;
  if (preference.key === "any_day" && slot.anytimeEligible === false) return false;
  if (preference.fixedStart && Array.isArray(slot.arrivalOptions)) return slot.arrivalOptions.includes(preference.key);
  if (preference.fixedStart) return slot.time === preference.start && (preference.key !== "afternoon" || preference.start === preference.end);
  if (!preference.flexible) return true;
  const slotMinutes = minutes(slot.time);
  return Number.isFinite(slotMinutes)
    && slotMinutes >= minutes(preference.start)
    && slotMinutes <= minutes(preference.end);
}

// Availability is computed with service, buffer, travel and all existing jobs first.
// Select at most one fixed start in each period from those feasible starts.
function markArrivalOptions(slots) {
  const dates = new Map();
  const marked = slots.map(slot => ({ ...slot, arrivalOptions: [] }));
  for (const slot of marked) {
    if (slot.flexibleEligible !== true) continue;
    if (!dates.has(slot.date)) dates.set(slot.date, []);
    dates.get(slot.date).push(slot);
  }
  for (const daily of dates.values()) {
    daily.sort((a, b) => minutes(a.time) - minutes(b.time));
    const morning = daily.filter(slot => minutes(slot.time) < 720);
    const afternoon = daily.filter(slot => minutes(slot.time) >= 720);
    if (morning.length) (afternoon.length ? morning[0] : morning[morning.length - 1]).arrivalOptions.push('morning');
    if (afternoon.length) afternoon[afternoon.length - 1].arrivalOptions.push('afternoon');
  }
  return marked;
}

function preferenceForSlot(preference, slot) {
  return preference.fixedStart ? { ...preference, start: slot.time, end: slot.time } : preference;
}

function arrivalWindowEnd(preferenceValue, serviceTeamHours) {
  const preference = typeof preferenceValue === "object"
    ? preferenceValue
    : arrivalPreferenceForKey(preferenceValue, serviceTeamHours);
  if (preference.fixedStart) return preference.start;
  if (!preference.flexible) return "";
  const closeMinutes = minutes("20:30");
  const reservedMinutes = Math.ceil(Number(serviceTeamHours) * 60) + 60;
  const calculatedLatest = Number.isFinite(reservedMinutes) ? closeMinutes - reservedMinutes : minutes(preference.end);
  const effectiveEndMinutes = Math.min(minutes(preference.end), calculatedLatest);
  if (!Number.isFinite(effectiveEndMinutes) || effectiveEndMinutes < minutes(preference.start)) {
    throw arrivalError("This arrival window is not available for the selected service duration.", 409);
  }
  return `${String(Math.floor(effectiveEndMinutes / 60)).padStart(2, "0")}:${String(effectiveEndMinutes % 60).padStart(2, "0")}`;
}

function arrivalWindowLabel(preferenceValue, serviceTeamHours) {
  const preference = typeof preferenceValue === "object"
    ? preferenceValue
    : arrivalPreferenceForKey(preferenceValue, serviceTeamHours);
  if (!preference.flexible && !preference.fixedStart) return "";
  const display = (value) => {
    const [hourValue, minute = "00"] = value.split(":");
    const hour = Number(hourValue);
    return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
  };
  if (preference.fixedStart) return display(preference.start);
  return `${display(preference.start)}–${display(arrivalWindowEnd(preference, serviceTeamHours))}`;
}

function applyArrivalDiscount(pkg, preferenceValue) {
  const preference = assertArrivalPreferenceEligible(pkg, preferenceValue);
  if (!preference.percent) {
    return { ...pkg, arrivalPreference: preference, arrivalDiscount: null };
  }

  const originalSubtotalCents = Math.max(0, Math.round(Number(pkg.originalSubtotalCents ?? pkg.subtotalCents) || 0));
  const taxRate = Number(pkg.taxRate) || 0.08875;
  const promo = pkg.promoDiscount?.amountCents ? pkg.promoDiscount : null;
  const manual = pkg.manualDiscount?.amountCents ? pkg.manualDiscount : null;
  const pretaxPromoCents = promo?.application === "before_tax" ? Number(promo.amountCents || 0) : 0;
  const afterTaxDiscountCents = (promo && promo.application !== "before_tax" ? Number(promo.amountCents || 0) : 0)
    + Number(manual?.amountCents || 0);
  const amountCents = Math.round(originalSubtotalCents * preference.percent / 100);
  const discountedSubtotalCents = Math.max(0, originalSubtotalCents - pretaxPromoCents - amountCents);
  const taxCents = Math.round(discountedSubtotalCents * taxRate);
  const totalCents = Math.max(0, discountedSubtotalCents + taxCents - afterTaxDiscountCents);
  const originalTaxCents = Math.max(0, Math.round(Number(pkg.originalTaxCents ?? pkg.taxCents) || 0));
  const originalTotalCents = Math.max(0, Math.round(Number(pkg.originalTotalCents) || originalSubtotalCents + originalTaxCents));
  const arrivalDiscount = {
    code: preference.key.toUpperCase(),
    label: preference.label,
    percent: preference.percent,
    amountCents,
    application: "before_tax",
    windowStart: preference.start,
    windowEnd: arrivalWindowEnd(preference, pkg.teamHours),
    windowLabel: arrivalWindowLabel(preference, pkg.teamHours)
  };

  return {
    ...pkg,
    originalSubtotalCents,
    originalTaxCents,
    originalTotalCents,
    discountedSubtotalCents,
    discountedSubtotal: discountedSubtotalCents / 100,
    taxCents,
    tax: taxCents / 100,
    totalCents,
    total: totalCents / 100,
    priceCents: totalCents,
    price: totalCents / 100,
    arrivalPreference: preference,
    arrivalDiscount
  };
}

module.exports = {
  ARRIVAL_PREFERENCES,
  markArrivalOptions,
  preferenceForSlot,
  applyArrivalDiscount,
  assertArrivalPreferenceEligible,
  arrivalPreferenceForKey,
  arrivalWindowEnd,
  arrivalWindowLabel,
  slotMatchesArrivalPreference
};
