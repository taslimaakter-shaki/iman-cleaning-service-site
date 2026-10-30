function workHours(estimate = {}) {
  for (const value of [estimate.manHours, estimate.laborHours]) {
    const hours = Number(value);
    if (Number.isFinite(hours) && hours > 0) return hours;
  }
  const hours = Number(estimate.teamHours) * Number(estimate.cleanerCount);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}
function duration(hours) {
  const minutes = Math.round(hours * 60);
  const whole = Math.floor(minutes / 60), rest = minutes % 60;
  return [whole ? `${whole} ${whole === 1 ? 'hour' : 'hours'}` : '', rest ? `${rest} ${rest === 1 ? 'minute' : 'minutes'}` : ''].filter(Boolean).join(' ');
}
function staffingOptions(estimate) {
  const hours = workHours(estimate);
  if (hours >= 7) return `2 team members for up to ${duration(hours / 2)}`;
  return hours > 0 && hours < 7 ? `1 team member for up to ${duration(hours)}, or 2 team members for up to ${duration(hours / 2)}` : '';
}
function displayNotes(notes, estimate) {
  const options = staffingOptions(estimate);
  if (!options) return notes;
  // Replace only the known generated staffing sentence, preserving customer notes.
  return String(notes || '').replace(/(Maximum labor: [\d.]+ labor-hours; )[^\n]*?(?=\. Service may be completed sooner\.)/, `$1${options}`).replace(/(Included service: [\d.]+ total work-hours; )2 team members for [\d.]+ hours\./, `$1${options}.`).replace(/Maximum estimated service time: up to [\d.]+ hours with a two-person team\./, `Maximum estimated service time: ${options}.`).replace(/(Maximum labor: [\d.]+ labor-hours; )two-person team for up to [\d.]+ hours\./, `$1${options}.`);
}
module.exports = { workHours, staffingOptions, displayNotes };
