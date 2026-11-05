const assert = require("node:assert/strict");
const shared = require("../api/booking/_shared");

const quote = shared.calculateHourlyCleaningQuote(4);
assert.equal(quote.serviceKey, "hourly");
assert.equal(quote.pricingMode, "hourly_formula");
assert.equal(quote.manHourRate, 80);
assert.equal(quote.manHours, 4);
assert.equal(quote.priceCents, 32000);
assert.equal(quote.teamHours, 2);
assert.equal(quote.units[0].baseItems[0].label, "4 work-hours");
assert.doesNotMatch(quote.units[0].baseItems[0].label, /\$|per (?:work-)?hour/i);
assert.throws(() => shared.calculateHourlyCleaningQuote(3), /4 to 23 work-hours/);
assert.throws(() => shared.calculateHourlyCleaningQuote(4.5), /whole number/);

console.log("Hourly cleaning instant quote passed: 4-hour minimum, correct total, and no customer-facing hourly rate.");

const maximum = shared.calculateHourlyCleaningQuote(23);
assert.equal(maximum.teamHours,11.5);
assert.equal(maximum.priceCents,184000);
assert(shared.planBookingDay(shared.toZonedIso('2030-11-20','08:00'),maximum.teamHours+1,[]));
assert.equal(shared.planBookingDay(shared.toZonedIso('2030-11-20','08:30'),maximum.teamHours+1,[]),null);
assert.throws(()=>shared.calculateHourlyCleaningQuote(24),/4 to 23 work-hours/);
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('book-now.js','utf8');
const controls={value:'24',max:'23',focus(){}};
let message,continued=false;
const handler=source.slice(source.indexOf('      const selectedHours = Number(organizationHoursInput?.value);'),source.indexOf('      state.serviceKey = "hourly";',source.indexOf('      const selectedHours = Number(organizationHoursInput?.value);')));
vm.runInNewContext('(function(){'+handler+';continued=true;})()', {organizationHoursInput:controls,Number,setStatus:(_s,m)=>message=m,status:{},get continued(){return continued},set continued(v){continued=v}});
assert.match(message,/maximum is 23 work-hours/);
assert.equal(continued,false);
assert.match(fs.readFileSync('book-now.html','utf8'),/name="organizationHours"[^>]*max="23"/);
const saved=require('../api/booking/_saved-quote');
assert.throws(()=>saved.validateAndPrice({pricingMode:'hourly_formula',eligibility:{requestedService:'hourly',serviceZip:'11218'},unitDetails:[{hours:24}]}),/4 to 23 work-hours/);
let requestedHours=24,availabilityCalls=0;
const box={exports:{}};
vm.runInNewContext(fs.readFileSync('api/booking/_availability.js','utf8'),{module:box,require:name=>{
  assert.equal(name,'./_shared');
  return {...shared,readJsonBody:async()=>({pricingMode:'hourly_formula',serviceKey:'hourly',serviceZip:'11218',unitDetails:[{hours:requestedHours}]}),
    availableSlotsForPackage:async pkg=>{availabilityCalls++;return shared.availableSlotsForDate(pkg,'2030-11-20',[]).filter(slot=>shared.planBookingDay(slot.value,pkg.teamHours+1,[]))},
    json:(_res,status,body)=>({status,...body})};
}});
(async()=>{
 const rejected=await box.exports({method:'POST'},{});
 assert.equal(rejected.status,400);
 assert.equal(availabilityCalls,0);
 requestedHours=23;
 const allowed=await box.exports({method:'POST'},{});
 assert.equal(allowed.status,200);
 assert.equal(allowed.slots.length,1);
 assert.equal(allowed.slots[0].time,'08:00');
})().catch(e=>{console.error(e);process.exitCode=1});

for (let hours=4;hours<=23;hours++) {
 const pkg=shared.calculateHourlyCleaningQuote(hours);
 assert(shared.planBookingDay(shared.toZonedIso('2030-11-20','08:00'),pkg.teamHours+1,[]),`${hours} work-hours must fit an empty business day`);
}
for (const hours of [0,3,23.5,24,25,NaN,Infinity,null,'']) {
 assert.throws(()=>shared.calculateHourlyCleaningQuote(hours),/4 to 23 work-hours|whole number/);
}

// The draft recovery branch must run before rendering an obsolete 24-hour price.
const draftSource=source.slice(source.indexOf('  const restoreBookingDraft ='));
const recoveryStart=draftSource.indexOf('      if (state.serviceKey === "hourly"');
const recoveryEnd=draftSource.indexOf('      if (state.package) {',recoveryStart);
assert(recoveryStart>=0 && recoveryEnd>recoveryStart);
const staleState={serviceKey:'hourly',package:{price:1920},promo:{code:'FALL10'},highestStageReached:7};
let recoveryStep;
const recoveryResult=vm.runInNewContext('(function(){'+draftSource.slice(recoveryStart,recoveryEnd)+'})()',{
 state:staleState,organizationHoursInput:{value:'24',max:'23'},
 resetAppointmentSelection:()=>{staleState.package={price:1920}},
 goToStep:step=>{recoveryStep=step},enterOrganizationDetails(){},setStatus(){},
 document:{querySelector:()=>({})},closeZipGate(){},suspendDraftSaving:true,
 window:{setTimeout(){}},persistBookingDraft(){}
});
assert.equal(recoveryResult,true);
assert.equal(recoveryStep,1);
assert.equal(staleState.package,null);
assert.equal(staleState.promo,null);
assert.equal(staleState.highestStageReached,2);
