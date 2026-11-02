// Labor excludes the reserved buffer and travel. Legacy service estimates use
// the recorded crew size, or the booking system's standard two-person crew.
function laborHours(estimate = {}) {
  for (const value of [estimate.manHours, estimate.laborHours]) {
    const hours = Number(value);
    if (Number.isFinite(hours) && hours > 0) return hours;
  }
  const serviceHours = [estimate.teamHours, estimate.hours].map(Number).find(hours => Number.isFinite(hours) && hours > 0);
  const cleaners = Number(estimate.cleanerCount);
  return (serviceHours || 0) * (Number.isFinite(cleaners) && cleaners > 0 ? cleaners : 2);
}
module.exports = { laborHours };
