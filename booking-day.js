(() => {
  const OPEN_TIME = "08:00";
  const CLOSE_TIME = "20:30";
  const EXTENSION_HOURS = 1;
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const dayMinutes = minutes(CLOSE_TIME) - minutes(OPEN_TIME);
  const residential = pkg => ["standard", "recurring", "deep", "move", "post"].includes(pkg?.serviceKey);

  function splitVisitHours(pkg) {
    if (!residential(pkg) || !Number.isFinite(pkg.manHours) || pkg.manHours <= 20 || !(pkg.teamHours > 0)) return 0;
    // Round the reserved time up to the minute. Pricing still uses the full job.
    const minutesPerVisit = Math.ceil(pkg.teamHours * 60 / 2);
    return minutesPerVisit + EXTENSION_HOURS * 60 <= dayMinutes ? minutesPerVisit / 60 : 0;
  }

  function nextDate(date) {
    const midnight = new Date(date + "T00:00:00Z");
    midnight.setUTCDate(midnight.getUTCDate() + 1);
    return midnight.toISOString().slice(0, 10);
  }

  function residentialDayReview(pkg, zip) {
    if (!residential(pkg)) return null;
    const reservedMinutes = Math.ceil(pkg.teamHours * 60) + EXTENSION_HOURS * 60;
    if (!Number.isFinite(reservedMinutes) || reservedMinutes <= dayMinutes) return null;
    const params = new URLSearchParams({ request: "residential-custom", service: pkg.serviceKey, hours: String(pkg.teamHours) });
    if (pkg.units?.length) params.set("units", String(pkg.units.length));
    if (/^\d{5}$/.test(zip || "")) params.set("zip", zip);
    return {
      code: "RESIDENTIAL_DAY_LIMIT", reviewRequired: true, reviewUrl: "/contact.html?" + params + "#custom-quote",
      error: "This cleaning needs more time than we can reserve in one day. Request a custom quote so we can plan the work with you."
    };
  }

  const policy = { OPEN_TIME, CLOSE_TIME, EXTENSION_HOURS, residentialDayReview, splitVisitHours, nextDate };
  if (typeof module !== "undefined" && module.exports) module.exports = policy;
  if (typeof window !== "undefined") window.imanBookingDay = policy;
})();
