const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const shared = require("../api/booking/_shared");
const {createRequire} = require("node:module");
const saved = require("../api/booking/_saved-quote");

const unit = { bedrooms: 3, fullBathrooms: 2, halfBathrooms: 1, kitchens: 1,
  livingRooms: 1, diningRooms: 1, livingDining: "separate", additionalRooms: 0,
  refrigerator: "no", oven: "no", cabinets: "no" };
const eligibility = { propertyType: "apartment", propertyStatus: "occupied", unitCount: 3, requestedService: "deep",
  serviceIntent: "cleaning", waterDamage:"no", excessiveBelongings:"no", utilitiesAvailable:"yes", unsafeConditions:"no", cleaningCategory: "residential", serviceZip: "11218", clutter: "low", buildup: "none", hazards: "none" };
const request = { pricingMode: "deep_formula", serviceKey: "deep", serviceZip: "11218", eligibility, unitDetails: [unit, unit, unit] };
const moduleRoot = path.resolve(__dirname, "../api/booking");
const pairSlot = s => Boolean(s.fixedSecondStart || s.anytimeSecondStart);
let stored = [];
let versionInstalled = true;
let calendarReads = 0;
const dbFetch = async url => {
  if (String(url).endsWith("/rpc/iman_consecutive_visit_version")) {
    return new Response(versionInstalled ? "1" : "", {status:versionInstalled ? 200 : 404});
  }
  assert.match(String(url), /^https:\/\/db\.example\/rest\/v1\/bookings\?/);
  calendarReads++;
  return new Response(JSON.stringify(stored));
};
const env = {SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "test_fixture", STRIPE_SECRET_KEY:"sk_test_fixture"};
const now = Date.parse("2030-11-19T15:00:00Z");
class FixtureDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
function loadHandler(file, overrides = {}, fetch = dbFetch) {
  const filename = path.resolve(moduleRoot, file);
  const localRequire = createRequire(filename);
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, URL, URLSearchParams, Date:FixtureDate, Intl, AbortSignal, Buffer, fetch, process: {env},
    require(name) { return overrides[name] ?? localRequire(name); }
  }, {filename});
  return module.exports;
}
const scheduling = loadHandler("_shared.js", {"./_calendar":{reconcileReservation: async record => record}});
const dependencies = {
  "./_shared": { ...scheduling, readJsonBody: async req => req.body, json: (_, status, data) => ({status, data}) },
  "../crm/_quote-admin":{checkSavedCheckout:async()=>""}
};
const post = (handler, body) => handler({method:"POST",headers:{},body},{});

(async () => {
  const availability = loadHandler("_availability.js", dependencies);
  const checkout = loadHandler("_checkout.js", dependencies);
  const policy = require("../booking-day");
  for (const [work, minutes] of [[19.5,0],[20,0],[20.5,308],[23,345],[23.5,353],[24,360],[26.5,398],[46,690],[46.5,0]]) {
    assert.equal(policy.splitVisitHours({serviceKey:"deep",manHours:work,teamHours:work/2}), minutes/60, String(work));
  }
  assert.equal(policy.splitVisitHours({serviceKey:"hourly",manHours:22,teamHours:11}),0);
  const large = shared.calculateResidentialQuoteBundle(request.unitDetails, "deep", eligibility);
  assert.equal(large.price, 2100);
  assert.equal(large.teamHours, 13.25);
  const split = await post(availability, request);
  assert.equal(split.status, 200);
  assert.equal(split.data.package.price,2100);
  assert.equal(shared.splitVisitHours(large),398/60);
  const morning = split.data.slots.find(slot => slot.arrivalOptions.includes("morning"));
  assert.equal(morning.fixedSecondStart, "2030-11-21T08:00:00-05:00");
  assert.equal(saved.validateAndPrice(request).pkg.price,2100);

  const tooLarge = {...request, eligibility:{...eligibility,unitCount:6}, unitDetails:Array(6).fill(unit)};
  for (const handler of [availability,checkout]) {
    const rejected = await post(handler,tooLarge);
    assert.equal(rejected.status,409);
    assert.equal(rejected.data.code,"RESIDENTIAL_DAY_LIMIT");
    assert.equal(rejected.data.package,undefined);
    assert.match(rejected.data.reviewUrl,/^\/contact\.html\?/);
  }
  assert.throws(() => saved.validateAndPrice(tooLarge), {code:"RESIDENTIAL_DAY_LIMIT"});
  // 23 work-hours can fit in one day or be split, using the same availability snapshot.
  const exact = {...request, unitDetails: [unit, unit, {...unit, bedrooms: 0, diningRooms: 0, oven: "yes"}]};
  const before = calendarReads;
  const {status, data} = await post(availability, exact);
  assert.equal(status, 200);
  assert.equal(data.package.manHours, 23);
  assert.equal(calendarReads, before+1);
  assert(data.slots.some(s=>pairSlot(s) && s.fixedSecondStart));
  assert(data.slots.some(s=>!pairSlot(s) && s.flexibleEligible && s.time==="08:00"));
  for (const s of data.slots.filter(pairSlot)) {
    const second = s.fixedSecondStart || s.anytimeSecondStart;
    assert.equal(second.slice(0,10),policy.nextDate(s.date));
    if(s.fixedSecondStart) assert.equal(s.time, s.fixedSecondStart.slice(11,16));
  }
  const atCutoff = await scheduling.residentialAvailability({serviceKey:"deep",teamHours:10,manHours:20});
  assert(atCutoff.some(s=>s.flexibleEligible));
  assert(!atCutoff.some(pairSlot));
  const forTwoUnits = last => ({...request, unitDetails:[unit,{...unit,...last}], eligibility:{...eligibility,unitCount:2}});
  const twenty = forTwoUnits({bedrooms:2,fullBathrooms:0,halfBathrooms:2,additionalRooms:4,oven:"yes"});
  const justOver = forTwoUnits({bedrooms:4,fullBathrooms:0,additionalRooms:4});
  assert.equal(shared.calculateResidentialQuoteBundle(twenty.unitDetails,"deep",twenty.eligibility).manHours,20);
  const optional = (await post(availability, justOver)).data;
  assert.equal(optional.package.manHours,20.5);
  const one = optional.slots.find(s=>!pairSlot(s) && s.arrivalOptions.includes("morning"));
  const two = optional.slots.find(s=>pairSlot(s) && s.anytimeSecondStart);
  assert(one && two);

  const bookings = [], charges = [];
  env.BOOKING_PAYMENT_FLOW = "hosted_unreserved";
  const pay = loadHandler("_checkout.js", {...dependencies,
    "./_shared":{...dependencies["./_shared"], makeUniqueOrderNumber:async()=>"12345678", createBooking:async b=>bookings.push(b)},
    "./_calendar":{newReservation:()=>({state:"creating",attempt:"test"}),attachCheckout:async()=>{},cleanupCheckout:async()=>{}},
    "./_hosted-cancel":{cancelUrl:()=>"/cancel"},
  }, async (url, opts)=>{
    assert.equal(url,"https://api.stripe.com/v1/checkout/sessions");
    charges.push(new URLSearchParams(opts.body));
    return new Response(JSON.stringify({id:"test-session",url:"https://stripe.example/checkout"}));
  });
  const {AGREEMENT_VERSION,AGREEMENT_ACCEPTANCE_TEXT} = pay._test;
  function bodyFor(request, pkg, slot, key) {
    const pair = pairSlot(slot);
    const secondSchedule = key==="any_day" ? slot.anytimeSecondStart : slot.fixedSecondStart;
    const price = require("../api/booking/_arrival-preference").applyArrivalDiscount(
      {...pkg,teamHours:pair ? policy.splitVisitHours(pkg) : pkg.teamHours}, key).price;
    const context = {packageId:pkg.id,total:price,laborHours:pkg.manHours,schedule:slot.value,
      ...(pair ? {secondSchedule,arrivalPreference:key} : {})};
    const timestamp = new Date(now).toISOString();
    return {...request, schedule:slot.value, ...(pair ? {secondSchedule} : {}), arrivalPreference:key,
      customer:{firstName:"Case",lastName:"Example",email:"case@example.test",phone:"+12125550123",address:"1 Example Ave",city:"Brooklyn",state:"NY",zip:"11218"},
      agreements:{laborHours:true,completion:true,condition:true,terms:true},
      agreementReview:{version:AGREEMENT_VERSION,acceptanceText:AGREEMENT_ACCEPTANCE_TEXT,signedName:"Case Example",accepted:true,
        openedAt:timestamp,scrolledToEndAt:timestamp,acceptedAt:timestamp,contextFingerprint:JSON.stringify(context)}};
  }
  const elective = bodyFor(justOver,optional.package,two,"any_day");
  const oneDay = bodyFor(justOver,optional.package,one,"morning");
  for (const body of [
    {...elective, ...twenty}, // cannot reserve only half of a 20-hour job
    {...elective, secondSchedule:policy.nextDate(elective.secondSchedule.slice(0,10)) + elective.secondSchedule.slice(10)},
    {...elective, agreementReview:oneDay.agreementReview},
    {...bodyFor(request,large,morning,"morning"), secondSchedule:""},
  ]) {
    const rejected = await post(pay,body);
    assert([400,409].includes(rejected.status));
    assert.match(rejected.data.error, /qualify for two visits|second visit has changed|Service Agreement again|requires two visits/i);
  }
  assert.equal(charges.length,0);
  assert.equal(bookings.length,0);
  for (const [body,expectedVisits] of [[oneDay,1],[elective,2]]) {
    const paid = await post(pay,body);
    assert.equal(paid.status,201,paid.data.error);
    const held=bookings.at(-1).estimate, charged=charges.at(-1);
    assert.equal(held.secondVisitSchedule,body.secondSchedule);
    assert.equal(held.calendarReservationHours,1+(expectedVisits===1 ? optional.package.teamHours : policy.splitVisitHours(optional.package)));
    assert.equal(held.calendarReservation.state,expectedVisits===1 ? "draft" : "creating");
    assert.equal(held.agreementAcceptance.context.secondScheduledFor,body.secondSchedule);
    assert.equal(held.payment.totalCents,Math.round(JSON.parse(body.agreementReview.contextFingerprint).total*100));
    assert.equal(held.arrivalDiscount?.amountCents || 0, expectedVisits===2 ? Math.round(optional.package.subtotalCents*0.05) : 0);
    assert.equal(Number(charged.get("line_items[0][price_data][unit_amount]")),Math.round(held.payment.totalCents/4));
    assert.equal(charged.get("line_items[0][quantity]"),"1");
  }
  const days = ["2030-11-30","2030-12-01","2030-12-03"];
  const slot = (date,time,anytimeEligible) => ({date,time,value:scheduling.toZonedIso(date,time),flexibleEligible:true,anytimeEligible});
  const acrossMonth = scheduling.consecutiveArrivalSlots([slot(days[0],"08:00",true),slot(days[1],"09:00",true),slot(days[2],"09:00",true)]);
  assert.equal(acrossMonth.length,1);
  assert.equal(acrossMonth[0].fixedSecondStart,"");
  assert.equal(acrossMonth[0].anytimeSecondStart,scheduling.toZonedIso(days[1],"09:00"));
  assert.equal(scheduling.consecutiveArrivalSlots([slot(days[0],"08:00",true),slot(days[1],"09:00",false)]).length,0);

  // A busy second day invalidates both visits; do not skip to a later free day.
  stored=[{id:"busy",status:"Confirmed",schedule:"2030-11-21T08:00:00-05:00",estimate:{teamHours:12.5}}];
  const blocked = await scheduling.residentialAvailability(large);
  assert(!blocked.some(s=>s.date==="2030-11-20" || s.date==="2030-11-21"));
  assert(blocked.some(s=>s.date==="2030-11-22"));
  stored=Array.from({length:48},(_,i)=>{
    const date=new Date(Date.UTC(2030,10,21+i*2)).toISOString().slice(0,10);
    return {id:"block-"+date,status:"Confirmed",schedule:scheduling.toZonedIso(date,"08:00"),estimate:{teamHours:12.5}};
  });
  assert.equal((await post(availability, request)).data.code,"RESIDENTIAL_DAY_LIMIT");
  const alternating=(await post(availability,justOver)).data.slots;
  assert(alternating.some(s=>s.flexibleEligible));
  assert(!alternating.some(pairSlot));
  stored=[];
  versionInstalled=false;
  assert.equal((await post(availability, request)).data.code, "RESIDENTIAL_DAY_LIMIT");
  const singles = (await post(availability, exact)).data.slots;
  assert(singles.some(s=>s.flexibleEligible));
  assert(!singles.some(pairSlot));
  console.log("Residential quotes: strictly over 20 work-hours, optional one-day dates, consecutive pairs, and custom review passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
