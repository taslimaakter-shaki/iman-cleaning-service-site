const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { calculateHourlyCleaningQuote } = require("../api/booking/_shared");
const { applyPromotion, PROMOTIONS } = require("../api/booking/_promo");
const { applyArrivalDiscount } = require("../api/booking/_arrival-preference");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "book-now.html"), "utf8");
const script = fs.readFileSync(path.join(root, "book-now.js"), "utf8");

assert.match(html, /data-resume-quote/);
assert.match(html, /data-resume-continue>Continue Quote/);
assert.match(html, /data-resume-new>Start New/);
assert.match(script, /persistBookingDraft = saveBookingDraft;/);
assert.match(script, /saveBookingDraft\(\{ immediate: true \}\);\s*closeWizard\(\{ preserveDraft: true \}\);/);
assert.match(script, /window\.addEventListener\("pagehide"/);
assert.match(script, /BOOKING_DRAFT_MAX_AGE = 7 \* 24 \* 60 \* 60 \* 1000/);
assert.match(
  script,
  /if \(quoteDetailsMode && !value\("unitCount"\)\) \{[\s\S]*?form\.elements\.unitCount\.value = String\(Math\.min\(10, Math\.max\(1, restoredUnits \|\| 1\)\)\);/,
  "Legacy detail drafts should recover a valid unit count before their questions are rebuilt."
);
const detailLoader = script.indexOf("const loadCurrentUnitDetails = () => {");
const resumedUnitClamp = script.indexOf("state.currentUnitIndex = Math.max(0, Math.min(Number(state.currentUnitIndex) || 0, count - 1));", detailLoader);
const currentUnitRead = script.indexOf("const current = state.unitDetails[state.currentUnitIndex] || emptyUnitDetails();", detailLoader);
assert.ok(detailLoader >= 0 && resumedUnitClamp > detailLoader && resumedUnitClamp < currentUnitRead);

const section = (from, to) => script.slice(script.indexOf(from), script.indexOf(to));
const day = "2030-11-05";
const slot = { date: day, time: "08:00", value: day + "T08:00:00-05:00", flexibleEligible: true, anytimeEligible: true, arrivalOptions: ["morning"] };
const base = applyPromotion(calculateHourlyCleaningQuote(4), PROMOTIONS.RETURNING5);
const flexible = applyArrivalDiscount(base, "any_day");
function resume(preference, savedSlots) {
  const state = {
    serviceKey: "hourly", package: flexible, arrivalDiscount: flexible.arrivalDiscount, packageBeforeArrivalDiscount: base,
    arrivalPreference: preference, availableSlots: savedSlots, selectedDate: day, calendarMonthIndex: 0
  };
  const select = { value: "", replaceChildren() { this.value = ""; }, add() {} };
  const noop = () => {};
  const context = vm.createContext({ state, scheduleSelect: select, savedSchedule: slot.value, Option: class {},
    monthKeyForDate: date => date.slice(0, 7), displayTime: time => time,
    setSchedulerStatus: noop, renderCalendar: noop, renderTimeSlots: noop, persistBookingDraft: noop });
  vm.runInContext([
    section("  const slotsForDate =", "  const setSchedulerStatus ="),
    section("  const loadSchedulerSlots =", "  const repeatExtrasPanel ="),
    section("  const restoreDraftAppointment =", "  const restoreBookingDraft ="),
    "restoreDraftAppointment(savedSchedule)"
  ].join("\n"), context);
  return { state, select };
}
const resumed = resume("any_day", [slot]);
assert.equal(resumed.select.value, slot.value);
assert.equal(resumed.state.arrivalPreference, "any_day");
assert.equal(resumed.state.package.price, 288);
const fixed = resume("morning", [slot]);
assert.equal(fixed.select.value, slot.value);
assert.equal(fixed.state.package.price, 304);
for (const slots of [[], [{ ...slot, anytimeEligible: false }]]) {
  const unavailable = resume("any_day", slots);
  assert.equal(unavailable.select.value, "");
  assert.equal(unavailable.state.arrivalPreference, "");
  assert.equal(unavailable.state.package.price, 304);
}

console.log("Booking resume-draft tests passed.");
