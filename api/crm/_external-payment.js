const crypto = require('node:crypto');
const shared = require('../booking/_shared');
const quotes = require('./_quote-admin');
const arrival = require('../booking/_arrival-preference');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (v, n = 200) => String(v || '').trim().slice(0, n);
const METHODS = { zelle: 'Zelle', cash: 'Cash', check: 'Cleared check', bank_transfer: 'Bank transfer' };
const TERMS = 'The 25% deposit confirms the appointment. Any remaining balance is due after service and must be paid separately. No automatic card hold or charge is authorized by this external payment. The Service Agreement cancellation, rescheduling and access policies still apply; any additional fee or refund is handled separately by IMAN Cleaning Service.';
const paid = b => Number(b?.estimate?.payment?.paidCents || 0);
const total = b => Number(b?.estimate?.payment?.totalCents || Math.round(Number(b?.estimate?.total || 0) * 100));
function validatePayment(body, outstanding) {
  if (!METHODS[body.method]) throw fail('Choose a payment method.');
  if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0 || body.amountCents > outstanding) throw fail('Enter an amount greater than zero and no greater than the outstanding balance.');
  if (body.verified !== true) throw fail('Verify that the payment was actually received before recording it.');
  const reference = text(body.reference, 120);
  if (reference.length < 3) throw fail('Enter the bank transaction reference, or a unique cash receipt reference.');
  const receivedAt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(body.receivedAt || '') ? shared.toZonedIso(body.receivedAt,'00:00') : body.receivedAt);
  if (!Number.isFinite(receivedAt.getTime()) || receivedAt.getTime() > Date.now() + 300000) throw fail('Enter a valid payment date that is not in the future.');
  return { method: body.method, amountCents: body.amountCents, reference, referenceKey: `${body.method}:${reference.toLowerCase().replace(/\s+/g, '')}`, receivedAt: receivedAt.toISOString(), note: text(body.note, 1000) };
}
async function resolve(body) {
  if (!['saved', 'booking'].includes(body.source)) throw fail('External payments are available for instant quotes.');
  const found = await quotes.load(body.source, body.id);
  if (found.state.deletedAt || found.state.updating) throw fail('Restore or refresh this quote before recording a payment.', 409);
  const bookings = await shared.listAllBookings();
  const matches = bookings.filter(b => b.id === found.state.bookingId || b.estimate?.savedQuoteId === found.id);
  let booking = found.source === 'booking' ? found.record : matches.find(b => b.estimate?.payment?.provider === 'external') || matches.find(b => paid(b)) || matches.filter(b => b.status === 'New').sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (booking && ['Cancelled'].includes(booking.status)) throw fail('This booking was cancelled. Resolve it before recording another payment.', 409);
  if (booking && paid(booking) && booking.estimate?.payment?.provider !== 'external') throw fail('This booking has a card payment. Use its existing payment workflow.', 409);
  if (booking?.estimate?.payment?.remaining?.paymentIntentId || booking?.estimate?.payment?.paymentIntentId) throw fail('A card payment is associated with this booking. Resolve it before switching payment methods.', 409);
  if (!booking) {
    const fields = found.state.fields;
    let pkg;
    if (fields) {
      const { bookingChanges } = quotes;
      const changes = bookingChanges({ ...fields, address: text(body.address,400) || fields.address, serviceDate: body.serviceDate || fields.serviceDate, serviceTime: body.serviceTime || fields.serviceTime }, null, { source: 'saved', id: found.id, revision: found.state.revision });
      booking = { id: `BK-EXT-${hash(['saved',found.id]).slice(0,20).toUpperCase()}`, status: 'New', addons: [], ...changes };
    } else {
      pkg = require('../booking/_saved-quote').validateAndPrice(found.record).pkg;
      pkg = require('../booking/_saved-quote').applySavedQuotePromotion(pkg, found.record, found.record.customer, bookings);
      pkg = require('../booking/_discount').applyPackageDiscount(pkg, found.state.manualDiscount);
      const preference = arrival.arrivalPreferenceForKey(body.arrivalPreference || 'any_day', pkg.teamHours);
      const date = text(body.serviceDate, 10), time = preference.fixedStart ? preference.start : text(body.serviceTime, 5);
      require('./_walkthroughs').validateVisit(date, time);
      const schedule = shared.toZonedIso(date, time);
      if (pkg.serviceKey === 'recurring') {
        const recurring = require('../booking/_recurring-discount');
        pkg = recurring.applyRecurringDiscount(pkg, recurring.verifyRecurringDiscount(bookings, { previousOrderNumber:body.previousOrderNumber,
          recurringPlan:body.recurringPlan, schedule, customer:{...found.record.customer,address:body.address} }));
      }
      pkg = arrival.applyArrivalDiscount(pkg, preference);
      const slots = await shared.availableSlotsForPackage(pkg);
      if (!slots.some(s => Date.parse(s.value) === Date.parse(schedule) && arrival.slotMatchesArrivalPreference(s, preference))) throw fail('That appointment is unavailable for the selected arrival option. Choose another time.', 409);
      const customer = found.record.customer || {};
      const windowLabel = arrival.arrivalWindowLabel(preference, pkg.teamHours);
      booking = { id: `BK-EXT-${hash(['saved',found.id]).slice(0,20).toUpperCase()}`, status: 'New',
        service: pkg.serviceKey, service_label: pkg.serviceLabel, schedule,
        schedule_label: `${date} — ${preference.flexible ? `Estimated arrival ${windowLabel}` : time + ' (New York)'}`,
        bedrooms_label: pkg.bedroomsLabel || '', bathrooms_label: pkg.bathroomsLabel || '', sqft: 0, addons: [],
        client_name: text(`${customer.firstName || ''} ${customer.lastName || ''}`), email: customer.email, phone: customer.phone,
        address: text(body.address,400), notes: '',
        estimate: { ...pkg, total: pkg.price, hours: pkg.teamHours, units: pkg.units || found.record.unitDetails,
          eligibility: found.record.eligibility, savedQuoteId: found.id, communicationConsent: found.record.communicationConsent,
          arrivalPreference: { ...preference, windowLabel, windowEnd: pkg.arrivalDiscount?.windowEnd || preference.end, provisionalStart: schedule, confirmationStatus: preference.flexible ? 'pending' : 'confirmed' },
          calendarReservationHours: pkg.teamHours + 1,
          payment: { totalCents: pkg.priceCents, depositCents: Math.round(pkg.priceCents*.25), paidCents: 0 }
        }
      };
    }
    booking.estimate = { ...booking.estimate, communicationConsent: found.record.communicationConsent, savedQuoteId: found.id, managedQuote:{source:'saved',id:found.id,revision:found.state.revision || ''}, orderNumber: booking.id, calendarReservation: { state: 'draft' } };
  }
  if (!booking.address || /^ZIP\s/i.test(booking.address) || booking.address.length < 8) throw fail('Enter the full service address before recording payment.');
  if (!booking.email || /[\r\n]/.test(booking.email) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(booking.email) || !booking.phone || !booking.client_name) throw fail('Complete the customer name, email and phone before recording payment.');
  if (booking.estimate?.awaitingSchedule || !Number.isFinite(Date.parse(booking.schedule))) throw fail('Complete the appointment date and time in the quote first.');
  if (!paid(booking) && Date.parse(booking.schedule) <= Date.now()) throw fail('Choose a future appointment before confirming this quote.');
  if (!paid(booking)) require('../booking/_minimum-total').assertMinimumTotal(total(booking));
  const token = hash({ source:found.source, id:found.id, version:found.version, booking });
  return { found, bookings, booking, token };
}
function savedAgreement(booking) {
  const estimate = booking.estimate || {}, acceptance = estimate.agreementAcceptance, context = acceptance?.context;
  if (!acceptance?.signedName || !acceptance.recordHash || !acceptance.serverRecordedAt || !context || estimate.crmQuote?.fields) return null;
  if (!Number.isFinite(Date.parse(acceptance.serverRecordedAt)) || !Number.isFinite(Date.parse(context.scheduledFor))
    || Date.parse(context.scheduledFor) !== Date.parse(booking.schedule)
    || Number(context.totalCents) !== total(booking)
    || Number(context.laborHours) !== Number(estimate.manHours)
    || context.packageId !== estimate.packageId || context.service !== booking.service_label) return null;
  return {source:'instant_quote',signedName:acceptance.signedName,acceptedAt:acceptance.customerAcceptedAt || acceptance.serverRecordedAt,recordHash:acceptance.recordHash};
}
function summary(resolved) {
  const { booking:b, token } = resolved;
  const payment = b.estimate.payment || {};
  return { previewToken: token, bookingId:b.id, customerName:b.client_name, service:b.service_label, address:b.address, scheduleLabel:b.schedule_label,
    totalCents:total(b), depositCents:Number(payment.depositCents || Math.round(total(b)*.25)), paidCents:paid(b), remainingCents:total(b)-paid(b),
    promoDiscount:b.estimate.promoDiscount || null, arrivalDiscount:b.estimate.arrivalDiscount || null, terms:TERMS,
    payments:payment.externalPayments || [], agreement:savedAgreement(b) };
}
async function cas(booking, patch) {
  const rows = await require('../booking/_additional-store').rpc('iman_update_external_payment_booking', {
    p_booking_id:booking.id, p_expected_status:booking.status, p_expected_estimate:booking.estimate || {},
    p_estimate:patch.estimate, p_status:patch.status || null
  });
  if (!rows?.[0]) throw fail('This booking changed. Refresh and review its payment history before continuing.',409);
  return rows[0];
}
async function record(body) {
  if (await require('../booking/_additional-store').rpc('iman_external_payment_version', {}) !== 1) throw fail('External payment storage is not ready. Contact the administrator.',503);
  const resolved = await resolve(body);
  let { found, bookings, booking } = resolved;
  const existing = (booking.estimate?.payment?.externalPayments || []).find(p => p.operationId === body.operationId);
  if (existing) {
    if (existing.amountCents !== body.amountCents || existing.method !== body.method || existing.reference !== text(body.reference,120)) throw fail('This payment request was already used for different details.',409);
    const delivery = await notifyPayment(booking.id, existing.operationId);
    return { ok:true, alreadyRecorded:true, ...summary({...resolved,booking:await shared.getBooking(booking.id)}), delivery };
  }
  if (!/^[\w-]{16,80}$/.test(body.operationId || '')) throw fail('Refresh the payment form and try again.');
  if (body.previewToken !== resolved.token) throw fail('The quote or appointment changed. Preview the payment again.',409);
  const payment = validatePayment(body, total(booking)-paid(booking));
  if ((booking.estimate.payment.externalPayments || []).length >= 100) throw fail('This booking has reached its payment entry limit. Contact support.',409);
  if (bookings.some(b => (b.estimate?.payment?.externalPayments || []).some(p => p.referenceKey === payment.referenceKey))) throw fail('That payment reference is already recorded. Check payment history instead of entering it again.',409);
  const agreement = savedAgreement(booking);
  const agreementEvidence = agreement ? `Service Agreement signed online by ${agreement.signedName} at ${agreement.acceptedAt}. Record: ${agreement.recordHash}` : text(body.agreementEvidence,1000);
  if (!agreement && (body.agreementVerified !== true || agreementEvidence.length < 10)) throw fail('Record how the customer accepted the service details and external-payment terms.');
  if (!paid(booking)) {
    await shared.assertScheduleAvailable(booking.schedule, shared.bookingDurationHours(booking), booking.id);
    await quotes.closeSessions(found);
    if ((await quotes.load(body.source,body.id)).version !== found.version && found.source !== 'booking') throw fail('This quote changed while payment was being verified. Preview it again.',409);
    const current = await shared.getBooking(booking.id);
    if (current) {
      if (paid(current) || current.estimate?.payment?.externalPayments?.length) throw fail('Payment was recorded elsewhere. Refresh first.',409);
      // Session expiry only changes reservation state; preserve the agreed quote.
      const snapshot = value => ({...value,estimate:{...value.estimate,calendarReservation:null}});
      if (hash(snapshot(current)) !== hash(snapshot(booking))) throw fail('The quote changed during payment verification.',409);
      booking = current;
    } else {
      try { booking = await shared.createBooking(booking); }
      catch (error) { if (await shared.getBooking(booking.id)) throw fail('This quote is being confirmed elsewhere. Refresh first.',409); throw error; }
    }
  }
  const prior = booking.estimate.payment || {};
  const cumulative = paid(booking)+payment.amountCents;
  const depositCents = Number(prior.depositCents || Math.round(total(booking)*.25));
  const confirms = cumulative >= depositCents;
  if (booking.status === 'New' && confirms) await shared.assertScheduleAvailable(booking.schedule, shared.bookingDurationHours(booking), booking.id);
  const entry = { ...payment, operationId:body.operationId, recordedAt:new Date().toISOString(), recordedBy:'CRM administrator', agreementEvidence, agreementSource:agreement ? 'instant_quote' : 'administrator_evidence',
    terms:TERMS, totalCents:total(booking), cumulativePaidCents:cumulative, remainingCents:total(booking)-cumulative, confirms, newlyConfirmed:booking.status==='New' && confirms,
    delivery:{ email:{status:'pending'}, sms:{status:'pending'} } };
  const estimate = { ...booking.estimate, externalPaymentTerms:{ text:TERMS, acceptedEvidence:entry.agreementEvidence, recordedAt:entry.recordedAt, recordedBy:entry.recordedBy },
    calendarReservation: confirms ? {state:'confirmed'} : {state:'draft'},
    payment:{ ...prior, provider:'external', method:payment.method, paymentType:'deposit_25', balanceCollection:'manual_after_service',
      totalCents:total(booking), depositCents, paidCents:cumulative, remainingCents:total(booking)-cumulative,
      status:cumulative===total(booking)?'fully_paid':confirms?'deposit_paid':'partial', paidAt:entry.receivedAt,
      remaining:{status:cumulative===total(booking)?'paid':'manual_due',amountCents:total(booking)-cumulative}, externalPayments:[...(prior.externalPayments || []),entry] } };
  booking = await cas(booking,{ estimate, status:booking.status==='New' && confirms?'Confirmed':booking.status });
  const delivery = await notifyPayment(booking.id, entry.operationId);
  return {ok:true,...summary({...resolved,booking:await shared.getBooking(booking.id)}),delivery};
}
async function notifyPayment(id, operationId) {
  let booking = await shared.getBooking(id);
  let payment = booking.estimate.payment.externalPayments.find(p=>p.operationId===operationId);
  const result = {};
  if (payment.newlyConfirmed) {
    try { result.calendar = (await shared.confirmBooking(id)).calendarSync || {status:'synced'}; }
    catch(error) { result.calendar={status:'failed',error:error.message}; }
  }
  for (const channel of ['email','sms']) {
    booking = await shared.getBooking(id);
    payment = booking.estimate.payment.externalPayments.find(p=>p.operationId===operationId);
    if (payment.delivery[channel].status !== 'pending') { result[channel]=payment.delivery[channel]; continue; }
    const entries = booking.estimate.payment.externalPayments.map(p=>p.operationId===operationId?{...p,delivery:{...p.delivery,[channel]:{status:'sending',attemptedAt:new Date().toISOString()}}}:p);
    try { booking = await cas(booking,{estimate:{...booking.estimate,payment:{...booking.estimate.payment,externalPayments:entries}}}); }
    catch { result[channel]={status:'pending'}; continue; }
    let delivery;
    try { delivery = await require('./_external-payment-notifications').send(booking,payment,channel); }
    catch(error) { delivery={status:'needs_review',error:text(error.message,300)}; }
    const latest = await shared.getBooking(id);
    const completed = latest.estimate.payment.externalPayments.map(p=>p.operationId===operationId?{...p,delivery:{...p.delivery,[channel]:delivery}}:p);
    try { await cas(latest,{estimate:{...latest.estimate,payment:{...latest.estimate.payment,externalPayments:completed}}}); }
    catch { /* Keep the durable sending claim: do not resend an uncertain delivery. */ }
    result[channel]=delivery;
  }
  return result;
}
module.exports={resolve,summary,record,validatePayment,cas,notifyPayment,METHODS,TERMS};

async function notifyBalanceDue(id) {
  const results={};
  for (const channel of ['email','sms']) {
    let booking=await shared.getBooking(id);
    if (booking?.estimate?.payment?.provider!=='external' || booking.status!=='Completed' || total(booking)<=paid(booking)) return {status:'not_due'};
    const prior=booking.estimate.externalBalanceNotice || {};
    if (prior[channel]?.status) {results[channel]=prior[channel];continue;}
    booking=await cas(booking,{estimate:{...booking.estimate,externalBalanceNotice:{...prior,[channel]:{status:'sending',attemptedAt:new Date().toISOString()}}}});
    const amount=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((total(booking)-paid(booking))/100);
    const text=`IMAN Cleaning Service: Your service for booking ${booking.estimate.orderNumber || id} is complete. The remaining balance is ${amount}. Please arrange payment using your agreed payment method. If you have already sent it, reply so we can verify receipt. No automatic card charge will be made. Call 929-232-1930 with questions.`;
    let delivery;
    try {
      const html=text.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      delivery=channel==='sms' && booking.estimate.communicationConsent?.transactionalSms?.granted === false ? {status:'skipped'} : channel==='email'
        ? await require('../quote/_photo-later').sendWalkthroughEmail(booking.email,{subject:'Your cleaning is complete — balance due',text,html:`<p>${html}</p>`})
        : await require('../booking/_notifications').sendCustomerSms(booking.phone,text+' Reply STOP to opt out.');
    } catch(error) {delivery={status:'needs_review',error:textError(error)};}
    const latest=await shared.getBooking(id);
    try {await cas(latest,{estimate:{...latest.estimate,externalBalanceNotice:{...latest.estimate.externalBalanceNotice,[channel]:delivery}}});} catch {}
    results[channel]=delivery;
  }
  return results;
}
function textError(error) {return text(error?.message || 'Delivery needs review.',300);}
module.exports.notifyBalanceDue=notifyBalanceDue;
