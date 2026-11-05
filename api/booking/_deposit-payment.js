const crypto = require('crypto');
const shared = () => require('./_shared');
const calendar = () => require('./_calendar');
const fail = (message, statusCode=409) => Object.assign(new Error(message), { statusCode });
const ORIGIN = 'https://www.imancleaningservice.com';
const enabled = () => process.env.BOOKING_PAYMENT_FLOW === 'server';
const secret = () => process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key || '';
async function db(path, options={}) {
 const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { ...options,
  headers: { apikey:process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json', ...options.headers }, signal:AbortSignal.timeout(15000) });
 const data = await response.json();
 if (!response.ok) throw fail(data.message || 'Payment reservation could not be checked.', response.status >= 500 ? 503 : 409);
 return data;
}
const rpc = (action,id,data={}) => db('rpc/iman_payment_order', {method:'POST',body:JSON.stringify({p_action:action,p_id:id,p_data:data})});
async function get(id) { return (await db(`booking_payment_orders?id=eq.${encodeURIComponent(id)}&select=*`))[0]; }
function sign(id) { return crypto.createHmac('sha256',secret()).update(`booking-payment:${id}`).digest('hex'); }
function token(id) { return `${id}.${sign(id)}`; }
function verify(value) {
 const [id, signature, extra] = String(value || '').split('.');
 if (extra || !/^[a-f0-9-]{36}$/.test(id || '') || !/^[a-f0-9]{64}$/.test(signature || '') || !crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(sign(id)))) throw fail('This payment link is invalid.',403);
 return id;
}
async function stripe(path, params, key) {
 const response = await fetch(`https://api.stripe.com/v1/${path}`, {method:params?'POST':'GET',headers:{Authorization:`Bearer ${secret()}`,...(params?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(key?{'Idempotency-Key':key}:{})},...(params?{body:new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined && v!==null).map(([k,v])=>[k,String(v)]))}:{}),signal:AbortSignal.timeout(20000)});
 const data = await response.json();
 if (!response.ok) throw Object.assign(fail(data.error?.message || 'Payment could not be verified.',response.status), { stripeIntent:data.error?.payment_intent });
 return data;
}
async function validateDraft(order) {
 const guard=order.draft.guard || {}, quotes=require('../crm/_quote-admin');
 if (guard.savedQuoteToken) await quotes.checkSavedCheckout(guard.savedQuoteToken,undefined,guard.revision || '');
 if (guard.quote?.managedSource) {
  const current=await quotes.resolveManaged(guard.quote);
  if (current.revision!==guard.quote.revision) throw fail('Your quote changed. Reopen the payment link to review the latest details.');
 }
}
async function prepare(bookingId, params, guard={}) {
 if (!/^pk_(live|test)_/.test(process.env.STRIPE_PUBLISHABLE_KEY || '')) throw fail('Secure payment setup is not ready. Please contact IMAN.',503);
 const booking=await shared().getBooking(bookingId);
 if (!booking || booking.status!=='New') throw fail('This booking is no longer awaiting payment.');
 const amount=Object.entries(params).filter(([k])=>/^line_items\[\d+\]\[price_data\]\[unit_amount\]$/.test(k)).reduce((sum,[,v])=>sum+Number(v),0);
 if (!Number.isSafeInteger(amount) || amount<=0 || amount!==Number(booking.estimate?.payment?.depositCents)) throw fail('The payment amount needs to be refreshed. Reopen your quote.');
 const id=crypto.randomUUID();
 await rpc('prepare',id,{bookingId,draft:{params,guard,amount}});
 return { id:`bp_${id}`,url:`${ORIGIN}/booking-payment.html#${token(id)}` };
}
async function readToken(value) { const order=await get(verify(value)); if (!order) throw fail('Payment link was not found.',404); return order; }
async function intentFor(order) { return stripe(`payment_intents/${encodeURIComponent(order.intent_id)}?expand[]=latest_charge`); }
async function record(order,intent) {
 if (intent.metadata?.booking_payment_order!==order.id || intent.metadata?.booking_payment_attempt!==order.attempt || intent.id!==order.intent_id) return order;
 if (Number(intent.amount)!==order.draft.amount || intent.currency!=='usd') throw fail('Payment amount needs review. Please contact IMAN.',409);
 return rpc('record',order.id,{attempt:order.attempt,intentId:intent.id,status:intent.status});
}
async function cancel(order) {
 if (order.state==='paid') return order;
 if (!order.intent_id) return rpc('cancel_unattached',order.id,{attempt:order.attempt});
 let intent=await intentFor(order);
 if (['requires_payment_method','requires_confirmation','requires_action'].includes(intent.status)) {
  try { intent=await stripe(`payment_intents/${intent.id}/cancel`,{},`booking-cancel-${order.attempt}`); }
  catch { intent=await intentFor(order); }
 }
 return record(order,intent); // Only Stripe's canceled status frees capacity.
}
async function finish(order, intent) {
 // Confirm capacity before returning. The signed webhook and confirmation page
 // deliver receipts, so email/PDF outages never delay a customer's Pay response.
 return record(order,intent);
}

async function pay(order, confirmationToken) {
 if (!/^ctoken_[A-Za-z0-9]+$/.test(confirmationToken || '')) throw fail('Please enter your payment details again.',400);
 if (order.state==='paid') return order;
 await validateDraft(order);
 const booking=await shared().getBooking(order.booking_id);
 if (!booking || booking.status!=='New') throw fail('Payment has already been received or this booking is no longer available.');
 if (!['creating','ready','processing','requires_action'].includes(order.state)) {
  await shared().assertScheduleAvailable(booking.schedule,shared().bookingDurationHours(booking),booking.id);
  if (booking.estimate?.secondVisitSchedule) await shared().assertScheduleAvailable(booking.estimate.secondVisitSchedule,shared().bookingDurationHours(booking),booking.id);
 }
 order=await rpc('acquire',order.id,{attempt:crypto.randomUUID(),confirmationToken});
 if (order.state==='paid') return order;
 if (!order.acquired) return reconcile(order);
 try { await validateDraft(order); } catch(error) { await cancel(order); throw error; }
 let intent;
 if (!order.intent_id) {
  try {
   const customer=await stripe('customers',{email:booking.email,name:booking.client_name},`booking-customer-${order.id}`);
   intent=await stripe('payment_intents',{amount:order.draft.amount,currency:'usd',customer:customer.id,'payment_method_types[0]':'card',setup_future_usage:'off_session',description:`Booking deposit ${booking.estimate?.orderNumber || booking.id}`,receipt_email:booking.email,
    'metadata[booking_id]':booking.id,'metadata[booking_payment_order]':order.id,'metadata[booking_payment_attempt]':order.attempt,'metadata[payment_flow]':'booking_capacity_v1'},`booking-intent-${order.attempt}`);
   order=await rpc('attach',order.id,{attempt:order.attempt,intentId:intent.id,customerId:customer.id});
  } catch(error) {
   // An unattached intent cannot be confirmed. Fence the attempt before freeing it.
   await cancel(await get(order.id));
   if (intent?.id) { try { await stripe(`payment_intents/${intent.id}/cancel`,{}); } catch {} }
   throw error;
  }
 }
 intent=await intentFor(order);
 if (intent.status==='requires_payment_method' || intent.status==='requires_confirmation') {
  try { intent=await stripe(`payment_intents/${intent.id}/confirm`,{confirmation_token:order.confirmation_token,use_stripe_sdk:'true',return_url:`${ORIGIN}/booking-payment.html#${token(order.id)}`},`booking-confirm-${order.attempt}`); }
  catch(error) {
   // A timeout is not a failure. Re-read Stripe; keep capacity if still uncertain.
   intent=await intentFor(order);
   if (intent.status==='requires_payment_method') { await cancel(order); throw fail('Payment was not completed. Please check your card details and try again.',402); }
   if (intent.status==='requires_confirmation') throw fail('Payment is still being verified. Use Check payment status before trying again.',503);
  }
 }
 return finish(order,intent);
}
async function publicResult(order) {
 const booking=await shared().getBooking(order.booking_id);
 const result={paymentTerms:order.draft.params['custom_text[submit][message]'] || 'Your booking deposit is charged now. The remaining balance is due under your Service Agreement.',status:order.state,publishableKey:process.env.STRIPE_PUBLISHABLE_KEY,amount:order.draft.amount,total:Number(booking?.estimate?.payment?.totalCents || 0),scheduleLabel:booking?.schedule_label || '',orderNumber:booking?.estimate?.orderNumber || booking?.id,service:booking?.service_label || 'Cleaning service'};
 if (order.intent_id && order.state==='requires_action') {const intent=await intentFor(order);if(intent.status==='requires_action')result.clientSecret=intent.client_secret;}
 if(order.state==='paid') result.confirmationUrl=`/booking-confirmed.html?session_id=bp_${order.id}`;
 return result;
}
async function reconcile(order) {
 if (order.intent_id) {
  let intent=await intentFor(order);
  if (['requires_payment_method','requires_confirmation','requires_action'].includes(intent.status) && Date.parse(order.started_at || order.updated_at)<Date.now()-1800000) return cancel(order);
  if (intent.status==='requires_payment_method' && (intent.last_payment_error || Date.parse(order.started_at || order.updated_at)<Date.now()-120000)) return cancel(order);
  order=await finish(order,intent);
 } else if (order.state==='creating' && Date.parse(order.started_at || order.updated_at)<Date.now()-120000) order=await cancel(order);
 return order;
}
async function syntheticSession(id) {
 const order=await get(String(id).slice(3));
 if (!order?.intent_id) throw fail('Payment has not completed.',400);
 const intent=await intentFor(order);
 if(intent.status!=='succeeded') throw fail('Payment has not completed.',400);
 await record(order,intent);
 const metadata={};
 for(const [key,value] of Object.entries(order.draft.params)) {const match=key.match(/^metadata\[([^\]]+)\]$/);if(match)metadata[match[1]]=String(value);}
 return {id:`bp_${order.id}`,mode:'payment',payment_status:'paid',status:'complete',created:intent.created,amount_total:intent.amount_received,currency:'usd',customer:order.customer_id,customer_email:order.draft.params.customer_email,metadata,payment_intent:intent};
}
async function handleEvent(event) {
 const id=event.data?.object?.metadata?.booking_payment_order;
 const order=id && await get(id);
 if (!order || order.intent_id!==event.data.object.id) return {processed:false};
 const current=await reconcile(order);
 if(current.state==='paid') {
  const result=await require('../quote/_payment-record').sendPaymentRecordForSessionId({sessionId:`bp_${order.id}`,siteUrl:ORIGIN,source:'stripe_webhook'});
  if(result.calendarStatus==='error') throw fail('Calendar confirmation will be retried.',503);
 }
 return {processed:true,status:current.state};
}
async function handler(req,res) {
 try {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return shared().json(res,405,{error:'Method not allowed.'});
  if(req.headers.origin && req.headers.origin!==ORIGIN) throw fail('Open payment from the IMAN website.',403);
  const body=await shared().readJsonBody(req);
  let order=await readToken(body.token);
  if(body.action==='pay') order=await pay(order,body.confirmationToken);
  else if(body.action==='cancel') order=await cancel(order);
  else if(body.action==='status') order=await reconcile(order);
  else if(body.action!=='load') throw fail('Unsupported payment action.',400);
  return shared().json(res,200,await publicResult(order));
 } catch(error) {return shared().json(res,error.statusCode || 500,{error:error.statusCode===409?'This time is no longer available or your quote changed. Please reopen your booking and choose an available appointment.':error.message || 'Payment could not be checked. Please try again.'});}
}
module.exports={enabled,prepare,handler,get,reconcile,cancel,syntheticSession,handleEvent,_test:{rpc,verify,token,pay,record,publicResult}};
