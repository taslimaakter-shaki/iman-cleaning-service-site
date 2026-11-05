const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const shared = require('../api/booking/_shared');
const promo = require('../api/booking/_promo');
process.env.BOOKING_MANAGEMENT_SECRET = 'repeat-test-secret';
const management = require('../api/booking/_manage');
const initial = {id:'initial',status:'Completed',schedule:'2030-10-01',email:'test@example.com',phone:'9295550101',client_name:'Test Customer',estimate:{orderNumber:'11111111',payment:{status:'paid',paidCents:10000}}};
const repeat = {...initial,id:'repeat',schedule:'2030-10-10',address:'123 Example St, Apt 2, Queens, NY, 11367',estimate:{...initial.estimate,orderNumber:'22222222',recurringDiscount:{plan:'weekly',code:'WEEKLY20'},units:[{bedrooms:2}],eligibility:{serviceZip:'11367'}}};
let deliveries = 0;
const sandbox = {module:{exports:{}},require(name) {
  if(name === './_shared') return {...shared,listAllBookings:async()=>[initial,repeat],readJsonBody:async request=>request.body,json:(_res,status,data)=>({status,data})};
  if(name === '../../booking-discount-names') return require('../booking-discount-names');
  if(name === './_promo') return promo;
  if(name === './_manage') return {...management,requestVerificationForBooking:async booking=>{deliveries++;assert.equal(booking.id,'initial');return {challenge:'mock',destination:'your saved phone'};}};
  throw new Error(name);
}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../api/booking/_recurring-discount.js'),'utf8'),sandbox);
const handler=sandbox.module.exports;
const call=body=>handler({method:'POST',body},{});

async function checkCalendarRetry() {
  const source = fs.readFileSync(path.join(__dirname, "../book-now.js"), "utf8");
  const browserCode = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
  const state = {step:3, serviceKey:"recurring", arrivalPreference:"morning"};
  const fields = {recurringOrderNumber:"22222222", recurringPlan:"weekly", schedule:"2030-10-18",
    email:"changed@example.test", phone:"2125550199", state:"NY", zip:"11367"};
  const addressPanel = {hidden:false, open:false};
  let proceed, discount;
  const button = {addEventListener(type, listener) { proceed = listener; }};
  vm.runInNewContext(
    browserCode("  const serviceAddress =", "  const addressCard =") +
    browserCode('  document.querySelector("[data-continue-contact]").addEventListener', '  document.querySelectorAll("[data-back]")'),
    { state, document:{querySelector:()=>button}, form:{elements:{address:{focus() {}}}}, value:key=>fields[key] || "",
      repeatBookingMode:false, recurringAddress:addressPanel, addressMatchStatus:{}, setStatus() {}, setSchedulerStatus() {},
      async fetch(url, options) {
        assert.equal(url, "/api/booking/recurring-discount");
        const result = await call(JSON.parse(options.body));
        return {ok:result.status === 200, json:async()=>result.data};
      },
      applyPromoData(data) { discount = data; }, belowBookingMinimum:()=>false, syncCheckoutReview() {},
      goToStep(step) { state.step = step; } }
  );
  await proceed();
  assert.equal(addressPanel.open,true);
  assert.equal(state.step,3);
  Object.assign(fields,{address:"123 Example Street", address2:"Unit 3", city:"Queens"});
  await proceed();
  assert.equal(state.step,3);
  assert.equal(discount,undefined);
  fields.address2 = "Unit 2";
  await proceed();
  assert.equal(state.step,4);
  assert.equal(discount.percent,20);
}

(async()=>{
  await checkCalendarRetry();
  const lookup=await call({lookupOnly:true,previousOrderNumber:'11111111'});
  assert.equal(lookup.data.repeatBooking,true);
  assert.equal(lookup.data.customer,undefined);
  const verification = {
    previousOrderNumber:"22222222", recurringPlan:"weekly", schedule:"2030-10-18",
    customer:{email:"changed@example.test",phone:"2125550199"},
    serviceAddress:{address:"123 Example Street",address2:"Unit 2",city:"Queens",state:"NY",zip:"11367"}
  };
  const matched = await call(verification);
  assert.equal(matched.status,200);
  assert.equal(matched.data.percent,20);
  assert.equal(matched.data.customer,undefined);
  assert.equal(matched.data.unitDetails,undefined);
  for (const change of [{address2:"Unit 3"},{city:""},{zip:"11368"}]) {
    const rejected = await call({...verification,serviceAddress:{...verification.serviceAddress,...change}});
    assert.equal(rejected.data.code,"RECURRING_CUSTOMER_MISMATCH");
  }
  assert.equal((await call({...verification,schedule:"2030-11-20"})).data.code,"RECURRING_INTERVAL_INELIGIBLE");
  assert.equal((await call({...verification,serviceAddress:undefined,customer:{email:repeat.email}})).status,200);
  assert.equal((await call({action:'repeat-details',previousOrderNumber:'11111111'})).status,401);
  const wrong=management.createBookingManagementToken({bookingId:'someone-else',email:initial.email});
  assert.equal((await call({action:'repeat-details',previousOrderNumber:'11111111',token:wrong})).status,401);
  const token=management.createBookingManagementToken({bookingId:'initial',email:initial.email});
  const details=await call({action:'repeat-details',previousOrderNumber:'11111111',token});
  assert.equal(details.status,200);
  assert.equal(details.data.customer.address,'123 Example St, Apt 2');
  assert.equal(details.data.windowStart,'2030-10-17');
  assert.equal(details.data.unitDetails[0].bedrooms,2);
  assert.equal((await call({action:'request-repeat-code',previousOrderNumber:'11111111'})).status,200);
  assert.equal(deliveries,1);
  console.log('Repeat booking privacy, token scope, latest saved details and mocked verification passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
