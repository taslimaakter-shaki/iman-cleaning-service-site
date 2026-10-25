const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Readable } = require("node:stream");

const quote = { quoteId:"QUOTE-TEST", managedSource:"custom", managedId:"QUOTE-TEST", revision:"revision-2", amountCents:55000, rushFeeCents:10000, customerName:"Test Customer", customerEmail:"test@example.test", serviceLocation:"Test Address", service:"Deep Cleaning", serviceDate:"2030-09-15", serviceTime:"10:00", description:"Changed scope", agreementUrl:"https://www.imancleaningservice.com/agreement.html" };
let posts = [], existing, ensureCount = 0, guardError = false, calendarConflict = false;
quote.bookingId = 'BK-TEST';
const calendar = { reserveBooking: async () => { if(calendarConflict)throw Object.assign(new Error('Slot conflict'),{statusCode:409});return {id:'BK-TEST',estimate:{calendarReservation:{attempt:'test-attempt'}}}; }, attachCheckout: async () => {}, cleanupCheckout: async () => {} };
const admin = {
  resolveManaged: async()=>({...quote}),
  currentCheckout: async()=>({session:existing,previousId:"first"}),
  ensureManagedBooking:async q=>{ensureCount++;return {...q,bookingId:"BK-TEST"};},
  guardCheckout:async()=>{if(guardError)throw Object.assign(new Error("Quote changed"),{statusCode:409});}
};
const shared = {cleanText:(value,fallback="")=>String(value||fallback).trim(),centsToDollars:c=>(c/100).toFixed(2),verifyQuoteToken:()=>({}),json:(res,status,body)=>{res.status=status;res.body=body;}};
const moduleStub = {exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../api/quote/_approve-checkout.js"),"utf8"),{
  module:moduleStub, exports:moduleStub.exports,
  require:name=>name==="./_shared"?shared:name==="./_short-approval"?{resolveShortApproval:async()=>({...quote})}:name==="../crm/_quote-admin"?admin:name==="../booking/_calendar"?calendar:require(name),
  process:{env:{STRIPE_SECRET_KEY:"sk_test_mock",PUBLIC_SITE_URL:"https://www.imancleaningservice.com"}},URLSearchParams,Date,console,
  fetch:async(url,options)=>{assert.equal(url,"https://api.stripe.com/v1/checkout/sessions");posts.push(options);return {ok:true,text:async()=>JSON.stringify({id:"cs_test",url:"https://checkout.stripe.test/mock"})};}
});
async function request(extra={}) {
  const body = new URLSearchParams({code:"test00000001",revision:quote.revision,agreementAccepted:"true",agreementScrolled:"true",agreementSignature:"Test Customer",...extra});
  const req = Readable.from([body.toString()]); req.method="POST";req.headers={"content-type":"application/x-www-form-urlencoded"};
  const res = {}; await moduleStub.exports(req,res);return res;
}
(async()=>{
  let res=await request({revision:"old"}); assert.equal(res.status,409);assert.equal(posts.length,0);assert.equal(ensureCount,0);
  res=await request({agreementAccepted:"false"});assert.equal(res.status,400);assert.equal(posts.length,0);
  res=await request({agreementScrolled:"false"});assert.equal(res.status,400);assert.equal(posts.length,0);
  res=await request({agreementSignature:""});assert.equal(res.status,400);assert.equal(posts.length,0);
  res=await request({serviceDate:"2040-01-01"});assert.equal(res.status,400);assert.match(res.body.error,/date and time are locked/);assert.equal(posts.length,0);
  res=await request({serviceTime:"23:59"});assert.equal(res.status,400);assert.match(res.body.error,/date and time are locked/);assert.equal(posts.length,0);
  calendarConflict=true;res=await request();assert.equal(res.status,409);assert.equal(posts.length,0,'A conflicting appointment never creates a Stripe session');calendarConflict=false;
  res=await request();assert.equal(res.status,201);
  let params=new URLSearchParams(posts[0].body);
  assert.equal(params.get("metadata[total_amount_cents]"),"65000");
  assert.equal(params.get("metadata[payment_amount_cents]"),"23750");
  assert.equal(params.get("metadata[remaining_amount_cents]"),"41250");
  assert.equal(params.get("line_items[0][price_data][unit_amount]"),"13750");
  assert.equal(params.get("line_items[1][price_data][unit_amount]"),"10000");
  assert.equal(params.get("metadata[booking_id]"),"BK-TEST");
  assert(Math.abs(Number(params.get('expires_at')) - Date.now()/1000 - 1800) < 5, 'Checkout expires in 30 minutes');
  assert.match(posts[0].headers["Idempotency-Key"],/^crm-quote-[a-f0-9]{64}$/);
  assert(!posts[0].body.includes("internalNotes"));
  existing={id:"cs_test",url:"https://checkout.stripe.test/mock"};res=await request();assert.equal(res.status,200);assert.equal(posts.length,1,"Repeated payment clicks reuse the checkout");
  guardError=true;res=await request();assert.equal(res.status,409,"A stale checkout URL is never returned");guardError=false;existing=undefined;
  quote.rushFeeCents=0;quote.balanceCollection="automatic_48h_authorization";
  res=await request();assert.equal(res.status,201);params=new URLSearchParams(posts.at(-1).body);
  assert.equal(params.get("payment_intent_data[setup_future_usage]"),"off_session");
  assert.equal(params.get("metadata[balance_collection]"),"automatic_48h_authorization");
  assert.equal(params.get("metadata[payment_amount_cents]"),"13750");
  const notice=params.get("custom_text[submit][message]");
  assert.match(notice,/temporary hold for the remaining 75% about 48 hours/);
  assert.match(notice,/Cancel at least 48 hours.*full deposit refund/);
  assert.match(notice,/Reschedule at least 48 hours.*deposit stays with your booking/);
  assert.match(notice,/cancellations less than 48 hours.*non-refundable/);
  quote.amountCents=30663;quote.laborHours=9;quote.cleanerCount=3;quote.units=[{},{}];
  quote.pricing={subtotalCents:30000,taxCents:2663,discountCents:2000,discountLabel:"First-time customer discount",discountApplication:"after_tax",totalCents:30663};
  res=await request();assert.equal(res.status,201);params=new URLSearchParams(posts.at(-1).body);
  assert.equal(params.get("metadata[total_amount_cents]"),"30663");assert.equal(params.get("metadata[payment_amount_cents]"),"7666");assert.equal(params.get("metadata[remaining_amount_cents]"),"22997");
  assert.equal(params.get("metadata[discount_label]"),"First-time customer discount");assert.equal(params.get("metadata[tax_cents]"),"2663");
  assert.equal(params.get("metadata[cleaner_count]"),"3");assert.equal(params.get("metadata[labor_hours]"),"9");assert.equal(params.get("metadata[team_hours]"),"3");
  assert.match(params.get("custom_text[terms_of_service_acceptance][message]"),/remaining-balance authorization/);
  assert.equal(params.get("metadata[agreement_signature]"),"Test Customer");

  const token=process.env.ADMIN_TOKEN;process.env.ADMIN_TOKEN="test-only-admin";
  try {
    const handler=require("../api/crm/[action]");
    for(const method of ["PATCH","DELETE"]) {
      const req=Readable.from([]);req.method=method;req.query={action:"quotes"};req.headers={"x-admin-token":"incorrect"};
      const response={setHeader(){},end(data){this.body=JSON.parse(data);}};
      await handler(req,response);assert.equal(response.statusCode,401);
    }
  } finally { if(token===undefined)delete process.env.ADMIN_TOKEN;else process.env.ADMIN_TOKEN=token; }
  console.log("CRM quote checkout: exact totals, rush fee, consent, stale revision, idempotency, existing-session reuse, retained balance terms, and admin authorization passed.");
})().catch(e=>{console.error(e);process.exitCode=1;});
