const crypto = require('crypto');
const arrival = require('./_arrival-preference');
const { staffingOptions } = require('./_staffing-options');
const cents = value => Math.round(Number(value || 0) * 100);
const error = message => Object.assign(new Error(message), { statusCode: 409 });
function quote(booking, key, keep = false, slot = null) {
  const e = booking.estimate || {}, payment = e.payment || {};
  let preference = arrival.arrivalPreferenceForKey(key, e.teamHours || e.hours);
  if (keep && e.arrivalPreference?.flexible) preference = { ...preference, ...e.arrivalPreference, start: e.arrivalPreference.windowStart || preference.start, end: e.arrivalPreference.windowEnd || preference.end, fixedStart: false };
  if (slot && preference.fixedStart) preference = arrival.preferenceForSlot(preference, slot);
  const serviceKey = e.recurringDiscount ? 'recurring' : (e.serviceKey || booking.service);
  preference = arrival.assertArrivalPreferenceEligible({ ...e, serviceKey }, preference);
  const previousTotalCents = Number(payment.cleaningPriceCents ?? payment.totalCents ?? cents(e.total));
  const previousDiscount = e.arrivalDiscount || null;
  const keepDiscount = keep || !previousDiscount?.amountCents || preference.percent > 0;
  const same = keepDiscount && key === (e.arrivalPreference?.key || 'exact') && (keep || !['morning','afternoon'].includes(key) || !e.arrivalDiscount?.amountCents);
  const subtotalCents = cents(e.subtotal);
  const previousTaxCents = cents(e.tax);
  const previousDiscountCents = Number(previousDiscount?.amountCents || 0);
  const preservePrice = same || (serviceKey === 'recurring' && previousDiscountCents === 0);
  if (!preservePrice && (!Number.isFinite(Number(e.subtotal)) || !Number.isFinite(Number(e.tax)))) throw error('Please contact IMAN to update the time preference for this booking.');
  const discountCents = same ? previousDiscountCents : Math.round(subtotalCents * preference.percent / 100);
  const beforeArrivalCents = e.discountedSubtotal != null ? cents(e.discountedSubtotal) + previousDiscountCents : Math.max(0, subtotalCents - (e.promoDiscount?.application === 'before_tax' ? Number(e.promoDiscount.amountCents || 0) : 0));
  const discountedSubtotalCents = Math.max(0, beforeArrivalCents - discountCents);
  const taxCents = preservePrice ? previousTaxCents : Math.round(discountedSubtotalCents * Number(e.taxRate ?? .08875));
  // Preserve every other agreed discount, surcharge, and service-price component.
  const totalCents = preservePrice ? previousTotalCents : Math.max(0, previousTotalCents + previousDiscountCents - discountCents + taxCents - previousTaxCents);
  const paidCents = Number(payment.paidCents ?? payment.depositCents ?? 0);
  const refundedCents = (e.rescheduling?.priceRefunds || []).reduce((sum, r) => sum + (['pending','succeeded'].includes(r.status) ? Number(r.amountCents) : 0), 0);
  const creditedCents = Math.max(0, paidCents - refundedCents);
  const windowLabel = (preference.flexible || preference.fixedStart) ? (keep && same && e.arrivalPreference?.windowLabel || arrival.arrivalWindowLabel(preference, e.teamHours || e.hours)) : '';
  const result = { preference: { ...preference, windowLabel, windowStart: preference.start, windowEnd: (preference.flexible || preference.fixedStart) ? arrival.arrivalWindowEnd(preference, e.teamHours || e.hours) : preference.end }, previousPreference: e.arrivalPreference || { key: 'exact', label: 'Exact arrival time' }, previousDiscount, previousTotalCents, subtotalCents, discountedSubtotalCents, taxCents, totalCents, paidCents: creditedCents, depositCents: Number(payment.depositCents || 0), remainingCents: Math.max(0, totalCents - creditedCents), refundCents: Math.max(0, creditedCents - totalCents), duration: staffingOptions(e), arrivalDiscount: discountCents ? { code: key.toUpperCase(), label: preference.label, percent: same ? Number(previousDiscount?.percent || preference.percent) : preference.percent, amountCents: discountCents, application: 'before_tax', windowLabel } : null };
  result.id = crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
  return result;
}
function choices(booking, slots) {
  const original = booking.estimate?.arrivalPreference || { key: 'exact' };
  const time = new Intl.DateTimeFormat('en-GB', {timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(booking.schedule));
  const options = [];
  for (const keep of [true,false]) for (const key of (keep ? [original.key] : ['any_day','morning','afternoon'])) {
    let pricing;
    try { pricing = quote(booking, key, keep); } catch { continue; }
    const seen = new Set();
    for (const slot of slots) {
      if (!arrival.slotMatchesArrivalPreference(slot,pricing.preference)) continue;
      if (keep && key === 'exact' && slot.time !== time) continue;
      if (pricing.preference.flexible && slot.time > pricing.preference.windowEnd) continue;
      if (pricing.preference.flexible && seen.has(slot.date)) continue;
      seen.add(slot.date);
      const slotPricing = pricing.preference.fixedStart ? quote(booking, key, keep, slot) : pricing;
      const label = pricing.preference.flexible ? `${new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date(slot.value))} · Estimated arrival ${pricing.preference.windowLabel}` : slot.label;
      options.push({ ...slot, label, mode: keep ? 'keep' : 'new', preferenceKey: key, pricing: slotPricing, choiceId: `${keep?'keep':'new'}:${key}:${slot.value}` });
    }
  }
  return options;
}
function revisedEstimate(booking, req) {
  const e = booking.estimate, q = req.pricing;
  if (!q) return e;
  const extra = Math.max(0, Number(e.payment?.totalCents || q.previousTotalCents) - q.previousTotalCents);
  return { ...e, total: q.totalCents/100, low: q.totalCents/100, high:q.totalCents/100, discountedSubtotal:q.discountedSubtotalCents/100, tax:q.taxCents/100, arrivalDiscount:q.arrivalDiscount, arrivalPreference:{...q.preference, provisionalStart:req.schedule, confirmationStatus:q.preference.flexible?'pending':'confirmed'}, payment:{...e.payment, totalCents:q.totalCents+extra, ...(e.payment?.cleaningPriceCents != null ? {cleaningPriceCents:q.totalCents}:{}), remainingCents:Math.max(0,q.remainingCents+extra)} };
}
module.exports = { quote, choices, revisedEstimate };
