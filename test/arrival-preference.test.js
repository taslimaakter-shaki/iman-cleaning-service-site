const assert = require("node:assert/strict");
const {
  applyArrivalDiscount,
  assertArrivalPreferenceEligible,
  arrivalPreferenceForKey,
  arrivalWindowEnd,
  arrivalWindowLabel,
  slotMatchesArrivalPreference
} = require("../api/booking/_arrival-preference");

const packageWithFall5 = {
  serviceKey: "deep",
  teamHours: 2,
  subtotalCents: 50000,
  originalSubtotalCents: 50000,
  originalTaxCents: 4438,
  originalTotalCents: 54438,
  taxRate: 0.08875,
  taxCents: 4216,
  discountedSubtotalCents: 47500,
  priceCents: 51716,
  price: 517.16,
  promoDiscount: { code: "FALL10", label: "First-time customer fall discount", percent: 5, amountCents: 2500, application: "before_tax" }
};

const anytime = applyArrivalDiscount(packageWithFall5, "any_day");
assert.equal(anytime.arrivalDiscount.amountCents, 2500);
assert.equal(anytime.discountedSubtotalCents, 45000, "FALL5 and flexible-arrival 5% both use the original pretax subtotal");
assert.equal(anytime.taxCents, 3994);
assert.equal(anytime.priceCents, 48994);

const morning = applyArrivalDiscount(packageWithFall5, "morning");
assert.equal(morning.arrivalDiscount, null);
assert.equal(morning.discountedSubtotalCents, 47500);
assert.equal(morning.taxCents, 4216);
assert.equal(morning.priceCents, 51716);

const exact = applyArrivalDiscount(packageWithFall5, "exact");
assert.equal(exact.arrivalDiscount, null);
assert.equal(exact.priceCents, packageWithFall5.priceCents);

assert.equal(arrivalWindowLabel("afternoon", 2), "5:30 PM");
assert.equal(arrivalWindowLabel("any_day", 5), "8:00 AM–2:30 PM");
assert.equal(arrivalWindowEnd("any_day", 5), "14:30");
assert.equal(arrivalWindowEnd("morning", 4), "08:00");
assert.equal(arrivalPreferenceForKey("morning").percent, 0);
assert.equal(assertArrivalPreferenceEligible({ manHours: 8 }, "morning").key, "morning");
assert.equal(assertArrivalPreferenceEligible({ manHours: 10, teamHours: 5 }, "morning").start, "08:00");
assert.equal(assertArrivalPreferenceEligible({ manHours: 10, teamHours: 5 }, "afternoon").start, "14:30");
assert.equal(assertArrivalPreferenceEligible({ manHours: 12 }, "any_day").key, "any_day");
assert.equal(assertArrivalPreferenceEligible({ manHours: 12 }, "exact").key, "exact");
assert.equal(slotMatchesArrivalPreference({ value: "2030-10-01T08:00:00-04:00", time: "08:00", flexibleEligible: true }, "any_day"), true);
assert.equal(slotMatchesArrivalPreference({ value: "2030-10-01T16:00:00-04:00", time: "16:00", flexibleEligible: true }, "any_day"), true);
assert.equal(slotMatchesArrivalPreference({ value: "2030-10-01T16:30:00-04:00", time: "16:30", flexibleEligible: true }, "any_day"), true);
assert.equal(slotMatchesArrivalPreference({ value: "2030-10-01T10:00:00-04:00", time: "10:00", flexibleEligible: false }, "morning"), false, "Flexible choices require the extra hour of calendar capacity");
assert.equal(slotMatchesArrivalPreference({ value: "2030-10-01T18:00:00-04:00", time: "18:00", flexibleEligible: true }, "exact"), true);
assert.equal(slotMatchesArrivalPreference({ value: "2030-10-01T18:00:00-04:00", time: "18:00", flexibleEligible: false }, "exact"), false, "Exact times also preserve the additional hour");

console.log("Arrival preference tests passed: windows, extra-capacity eligibility, exact-time behavior, and stacked pretax discounts.");

for (const [laborHours, end, label] of [[4, '17:30', '8:00 AM–5:30 PM'], [2, '18:30', '8:00 AM–6:30 PM']]) {
  const pkg = { ...packageWithFall5, manHours: laborHours, teamHours: laborHours / 2 };
  const discounted = applyArrivalDiscount(pkg, 'any_day');
  assert.equal(discounted.arrivalDiscount.windowEnd, end);
  assert.equal(discounted.arrivalDiscount.windowLabel, label);
  assert.equal(arrivalWindowEnd('any_day', laborHours / 2), end);
}

for (const [hours, time] of [[2,'18:30'],[4,'17:30'],[5,'17:00'],[9.5,'14:45']]) {
 const pref = arrivalPreferenceForKey('afternoon', hours / 2);
 assert.equal(pref.flexible,false); assert.equal(pref.start,time); assert.equal(pref.end,time);
 assert(slotMatchesArrivalPreference({value:'test',time,teamHours:hours/2,flexibleEligible:true},'afternoon'));
 assert(!slotMatchesArrivalPreference({value:'test',time:'08:00',teamHours:hours/2,flexibleEligible:true},'afternoon'));
}
assert(!slotMatchesArrivalPreference({value:'test',time:'08:30',teamHours:2,flexibleEligible:true},'morning'));
assert(slotMatchesArrivalPreference({value:'test',time:'08:00',teamHours:2,flexibleEligible:true},'morning'));
