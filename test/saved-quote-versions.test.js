const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const actual=require('../api/booking/_shared');
const records=new Map(),emails=[],texts=[],bookings=[];let smsFails=false,priceChanged=false;
const drive={files:{create:async args=>{const r=JSON.parse(args.media.body);records.set(r.quoteId,r);return{data:{id:r.quoteId}};},list:async args=>{const id=args.q.match(/saved_quote_id' and value='([^']+)'/)[1];return{data:{files:records.has(id)?[{id}]:[]}};},get:async args=>({data:structuredClone(records.get(args.fileId))}),update:async args=>{records.set(args.fileId,JSON.parse(args.media.body));}}};
function loadHandler() {
const moduleObject={exports:{}};
vm.runInNewContext(fs.readFileSync('api/booking/_saved-quote.js','utf8'),{module:moduleObject,Buffer,URLSearchParams,console,process:{env:{QUOTE_APPROVAL_SECRET:'test',TWILIO_ACCOUNT_SID:'test',TWILIO_AUTH_TOKEN:'test',TWILIO_FROM_NUMBER:'+12125550100'}},require:name=>{
 if(name==='./_service-policy') return require('../api/booking/_service-policy');
 if(name==='crypto')return crypto;
 if(name==='./_shared')return{...actual,calculateHourlyCleaningQuote:h=>{const p=actual.calculateHourlyCleaningQuote(h);return priceChanged?{...p,price:p.price+100}:p;},listAllBookings:async()=>bookings,readJsonBody:async req=>req.body,json:(res,status,body)=>({status,...body})};
 if(name==='../quote/_shared')return{getGoogleClients:()=>({drive,config:{parentFolderId:'test'},gmail:{users:{messages:{send:async args=>{emails.push(Buffer.from(args.requestBody.raw,'base64url').toString());return{data:{id:'email'}};}}}}})};
 if(name==='./_promo')return require('../api/booking/_promo');
 if(name==='./_discount')return require('../api/booking/_discount');
 throw Error(name);
},fetch:async(_url,args)=>{texts.push(new URLSearchParams(args.body));return{ok:!smsFails,status:smsFails?500:201,text:async()=>JSON.stringify(smsFails?{message:'test failure'}:{sid:'sms'})};}});
return moduleObject.exports;
}
const handler=loadHandler();
const body={eligibility:{requestedService:'hourly',serviceZip:'11432'},pricingMode:'hourly_formula',unitDetails:[{hours:4}],customer:{firstName:'Test',lastName:'Customer',email:'test@example.invalid',phone:'2125550101'},smsConsent:true};
const post=b=>handler({method:'POST',headers:{host:'example.test'},body:b},{});
const get=url=>handler({method:'GET',headers:{host:'example.test'},query:{token:new URL(url).searchParams.get('quote')}},{setHeader(){}});
(async()=>{
 const [first,repeat]=await Promise.all([post(body),post(body)]);assert.equal(first.quoteUrl,repeat.quoteUrl);assert.equal(records.size,1);assert.equal(emails.length,1);assert.equal(texts.length,1);
 const original=await get(first.quoteUrl);assert.equal(original.status,200);
 const previousQuoteToken=new URL(first.quoteUrl).searchParams.get('quote');
 const coldHandler=loadHandler();
 const unchanged=await coldHandler({method:'POST',headers:{host:'example.test'},body:{...body,previousQuoteToken,customer:{...body.customer,firstName:' Test ',phone:'(212) 555-0101'},eligibility:{serviceZip:'11432',requestedService:'hourly'}}},{});
 assert.equal(unchanged.unchanged,true);assert.equal(unchanged.quoteUrl,first.quoteUrl);assert.equal(unchanged.delivery.email,'not_resent');assert.equal(unchanged.delivery.sms,'not_resent');assert.equal(emails.length,1);assert.equal(texts.length,1);assert.equal(records.size,1,'No-change edit in a fresh server process reuses original record');

 const edited=await post({...body,previousQuoteToken,unitDetails:[{hours:6}]});assert.notEqual(first.quoteUrl,edited.quoteUrl);assert.equal(records.size,2);assert.equal(emails.length,2);assert.equal(texts.length,2);
 const updated=await get(edited.quoteUrl);assert.equal(updated.unitDetails[0].hours,6);assert.equal((await get(first.quoteUrl)).unitDetails[0].hours,4);assert.notEqual(original.package.price,updated.package.price);
 priceChanged=true;assert.equal((await get(first.quoteUrl)).package.price,original.package.price,'Saved version does not reprice when pricing changes');priceChanged=false;
 const reverted=await post({...body,previousQuoteToken:new URL(edited.quoteUrl).searchParams.get('quote')});assert.notEqual(reverted.quoteUrl,first.quoteUrl,'Changing back to older details is still a genuine new edit');assert.notEqual(reverted.quoteUrl,edited.quoteUrl);

 const changedContact=await post({...body,previousQuoteToken,customer:{...body.customer,email:'new@example.invalid',phone:'2125550102'}});assert.notEqual(changedContact.quoteUrl,first.quoteUrl);assert.match(emails.at(-1),/To: new@example.invalid/);assert.equal(texts.at(-1).get('To'),'+12125550102');assert.equal((await get(first.quoteUrl)).customer.email,body.customer.email);
 const emailCountBeforeEmailOnly=emails.length,textCountBeforeEmailOnly=texts.length;
 const emailOnlyBody={...body,unitDetails:[{hours:7}],customer:{...body.customer,email:'email-only@example.invalid',phone:''}};
 const emailOnly=await post(emailOnlyBody);
 assert.equal(emailOnly.status,201,emailOnly.error);assert.equal(emailOnly.delivery.email,'sent');assert.equal(emailOnly.delivery.sms,'not_available');
 assert.equal(emails.length,emailCountBeforeEmailOnly+1);assert.equal(texts.length,textCountBeforeEmailOnly,'No SMS attempted without a phone');
 assert.equal((await get(emailOnly.quoteUrl)).customer.phone,'');
 const emailOnlyRepeat=await post(emailOnlyBody);assert.equal(emailOnlyRepeat.quoteUrl,emailOnly.quoteUrl);assert.equal(emailOnlyRepeat.delivery.email,'already_sent');assert.equal(emailOnlyRepeat.delivery.sms,'not_available');assert.equal(emails.length,emailCountBeforeEmailOnly+1,'Email-only quote delivery is deduplicated');
 const missingEmail=await post({...body,customer:{...body.customer,email:''}});assert.equal(missingEmail.status,400);assert.match(missingEmail.error,/valid email/i);
 smsFails=true;const failing={...body,unitDetails:[{hours:5}]};const failed=await post(failing);assert.equal(failed.delivery.sms,'failed');const emailCount=emails.length;const recordCount=records.size;smsFails=false;const retry=await post(failing);assert.equal(retry.quoteUrl,failed.quoteUrl);assert.equal(retry.delivery.sms,'sent');assert.equal(emails.length,emailCount,'Retry sends only failed channel');assert.equal(records.size,recordCount);
 const denied=await post({...body,smsConsent:false});assert.equal(denied.status,400);
 bookings.push({status:'Confirmed',phone:'(212) 555-0101',estimate:{payment:{status:'deposit_paid',paidCents:8000}}});
 const returning=await get(first.quoteUrl);
 assert.equal(returning.package.promoCode,'RETURNING5');
 assert.equal(returning.package.priceCents,30400);
 const reopened=await post({...body,previousQuoteToken});
 assert.equal(reopened.unchanged,true);
 assert.equal(reopened.package.promoCode,'RETURNING5');
 assert.equal(reopened.package.priceCents,30400);
 const recurringBody={...body,eligibility:{requestedService:'recurring',propertyStatus:'occupied',serviceIntent:'cleaning',cleaningCategory:'residential',serviceZip:'11432',buildup:'none',clutter:'low',hazards:'none'},
   pricingMode:'recurring_formula',recurringOrderNumber:' 12345678 ',recurringPlan:'weekly',
   unitDetails:[{bedrooms:1,fullBathrooms:1,halfBathrooms:0,kitchens:1,livingRooms:0,diningRooms:0,additionalRooms:0,refrigerator:'no',oven:'no',cabinets:'no'}]};
 const recurring=await post(recurringBody);
 assert.equal(recurring.status,201,recurring.error);
 const fresh=loadHandler();
 const recurringToken=new URL(recurring.quoteUrl).searchParams.get('quote');
 const opened=await fresh({method:'GET',headers:{host:'example.test'},query:{token:recurringToken}},{setHeader(){}});
 assert.equal(opened.recurringOrderNumber,'12345678');
 assert.equal(opened.recurringPlan,'weekly');
 const source=fs.readFileSync('book-now.js','utf8');
 const controls=Object.fromEntries(['recurringOrderNumber','recurringPlan','firstName','lastName','email','phone','houseFloorSelection'].map(name=>[name,{value:''}]));
 const state={};let lookup;
 const noop=()=>{};
 const browser=vm.createContext({state,form:{elements:controls},quoteContactForm:null,zipStatus:null,URL,
   window:{location:{href:recurring.quoteUrl}},value:name=>controls[name]?.value||'',serviceArea:{normalize:x=>x},canUseInstantQuoteZip:()=>false,
   allMobileQuestions:[],fetch:async(url,args)=>{
     if(!args)return{ok:true,json:async()=>opened};
     if(url==='/api/booking/recurring-discount'){lookup=JSON.parse(args.body);return{ok:true,json:async()=>({plan:'weekly',windowStart:'2030-11-08'})};}
     return{ok:true,json:async()=>({slots:[]})};
   },showQuoteLoadError:message=>{throw Error(message)},
   ...Object.fromEntries(['syncAnswerChoices','showQuoteLoading','syncServiceChoice','syncPropertyTypeChoice','syncUnitCount','renderQuoteOverview','syncQuotedServiceCopy',
     'renderPriceBreakdown','showSavedQuoteDelivery','hideQuoteLoading','closeZipGate','openWizard','goToStep'].map(name=>[name,noop]))});
 vm.runInContext(source.slice(source.indexOf('  const restoreSavedQuote ='),source.indexOf('  const savedQuoteToken ='))+
   source.slice(source.indexOf('  const availabilityRequest ='),source.indexOf('  const showSavedQuoteDelivery =')),browser);
 await vm.runInContext("restoreSavedQuote('test')",browser);
 await vm.runInContext('availabilityRequest()',browser);
 assert.equal(lookup.previousOrderNumber,'12345678');
 assert.equal(lookup.recurringPlan,'weekly');
 delete opened.recurringOrderNumber;
 delete opened.recurringPlan;
 let recovery=false,restoredStep;
 Object.assign(browser,{enterRecurringDetails:()=>{recovery=true},goToStep:step=>{restoredStep=step},
   recurringInitialButtons:[{dataset:{recurringInitial:'yes'},click:noop}],setStatus:noop,document:{querySelector:()=>({})}});
 await vm.runInContext("restoreSavedQuote('legacy')",browser);
 assert.equal(recovery,true,'Older links offer a way to re-enter missing recurring details');
 assert.equal(restoredStep,1);

 const samePlan=await post({...recurringBody,previousQuoteToken:recurringToken});
 assert.equal(samePlan.unchanged,true);
 const changedPlan=await post({...recurringBody,previousQuoteToken:recurringToken,recurringPlan:'monthly'});
 assert.notEqual(changedPlan.quoteUrl,recurring.quoteUrl);
 assert.equal((await get(changedPlan.quoteUrl)).recurringPlan,'monthly');
 const biweekly=await post({...recurringBody,previousQuoteToken:recurringToken,recurringPlan:'biweekly'});
 assert.equal((await get(biweekly.quoteUrl)).recurringPlan,'biweekly');
 assert.equal((await get(biweekly.quoteUrl)).recurringOrderNumber,'12345678');

 const changedOrder=await post({...recurringBody,previousQuoteToken:recurringToken,recurringOrderNumber:'87654321'});
 assert.notEqual(changedOrder.quoteUrl,recurring.quoteUrl);
 assert.equal((await get(changedOrder.quoteUrl)).recurringOrderNumber,'87654321');
 assert.equal((await get(recurring.quoteUrl)).recurringOrderNumber,'12345678','Editing a reference preserves the original saved quote');

 // Old hourly links must open an editable form even without a stored price snapshot.
 const legacyId='LEGACY24',expiresAt=Date.now()+86400000;
 const legacy={quoteId:legacyId,...body,unitDetails:[{hours:24}],expiresAt};
 records.set(legacyId,legacy);
 const legacyToken=handler.encodeSavedQuote({version:1,quoteId:legacyId,expiresAt});
 const legacyUrl='https://example.test/book-now?quote='+legacyToken;
 const legacyOpened=await get(legacyUrl);
 assert.equal(legacyOpened.status,200,legacyOpened.error);
 assert.equal(legacyOpened.requiresHourlyUpdate,true);
 assert.equal(legacyOpened.package,null);
 records.set(legacyId,{...legacy,packageSnapshot:{...actual.calculateHourlyCleaningQuote(23),manHours:24}});
 assert.equal((await get(legacyUrl)).requiresHourlyUpdate,true);
 // Run the actual browser restore function and simulate a stale arrival-discount backup.
 let hourlyRecovery=false,renderedInvalid=false;
 Object.assign(browser,{organizationHoursInput:{value:'',max:'23'},
   fetch:async()=>({ok:true,json:async()=>legacyOpened}),
   resetAppointmentSelection:()=>{state.package={price:1920};state.selectedDate='';state.initialSlots=[];},
   enterOrganizationDetails:()=>{hourlyRecovery=true},
   renderQuoteOverview:()=>{renderedInvalid=true}});
 state.highestStageReached=6;
 await vm.runInContext("restoreSavedQuote('old-hourly')",browser);
 assert.equal(hourlyRecovery,true);
 assert.equal(restoredStep,1);
 assert.equal(state.package,null,'Invalid old price is cleared after appointment reset');
 assert.equal(state.promo,null);
 assert.equal(state.highestStageReached,2,'Later booking stages remain locked until repriced');
 assert.equal(renderedInvalid,false,'Invalid package is never rendered');
 assert.equal(controls.firstName.value,body.customer.firstName);
 // Previously issued residential links use the stored duration, or recalculate if no snapshot exists.
 const legacyUnit = {bedrooms:3,fullBathrooms:2,halfBathrooms:1,kitchens:1,livingRooms:1,diningRooms:1,
   livingDining:'separate',additionalRooms:0,refrigerator:'no',oven:'no',cabinets:'no'};
 const oversized = {...legacy, eligibility:{...recurringBody.eligibility, requestedService:'deep', unitCount:3},
   pricingMode:'deep_formula', unitDetails:Array(6).fill(legacyUnit)};
 const snapshot = actual.calculateResidentialQuoteBundle(oversized.unitDetails,'deep',oversized.eligibility);
 for (const packageSnapshot of [snapshot, undefined]) {
   records.set(legacyId,{...oversized,packageSnapshot});
   const result = await get(legacyUrl);
   assert.equal(result.status,409);
   assert.equal(result.code,'RESIDENTIAL_DAY_LIMIT');
   assert.match(result.reviewUrl,/^\/contact\.html\?/);
   assert.equal(result.customer.email,oversized.customer.email);
   assert.equal(result.package,undefined);
 }

 // A cached package or a CRM approval link must not revive a discontinued service.
 for (const extra of [{}, {crmQuote:{fields:{service:"Window Cleaning"},approvalCode:"old-code"}}]) {
   records.set(legacyId,{...legacy,...extra,packageSnapshot:{serviceKey:"window",id:"window__instant_quote"}});
   const retired = await get(legacyUrl);
   assert.equal(retired.status,410);
   assert.equal(retired.package,undefined);
   assert.equal(retired.redirectUrl,undefined);
 }


 const kitchenBody = {
   ...body,
   eligibility: {requestedService:'standard',propertyStatus:'occupied',serviceIntent:'cleaning',cleaningCategory:'residential',
     serviceZip:'11432',buildup:'some',clutter:'low',hazards:'none',waterDamage:'no',utilitiesAvailable:'yes',unsafeConditions:'no'},
   pricingMode:'standard_formula',
   customer:{...body.customer,email:'kitchen-test@example.invalid',phone:''},
   unitDetails:[
     {bedrooms:0,fullBathrooms:1,halfBathrooms:0,kitchens:1,livingRooms:0,diningRooms:0,additionalRooms:0,
       refrigerator:'empty',oven:'yes',cabinets:'no',grease:'heavy',buildupAreas:{kitchens:1}},
     {bedrooms:1,fullBathrooms:0,halfBathrooms:0,kitchens:0,livingRooms:0,diningRooms:0,additionalRooms:0}
   ]
 };
 const kitchenSaved = await post(kitchenBody);
 assert.equal(kitchenSaved.status,201,kitchenSaved.error);
 const kitchenOpened = await get(kitchenSaved.quoteUrl);
 assert.equal(kitchenOpened.unitDetails[0].grease,'heavy');
 assert.equal(kitchenOpened.package.units[0].grease,'heavy');
 assert.equal(kitchenOpened.package.buildupAdjustment.amount,130);
 const kitchenToken = new URL(kitchenSaved.quoteUrl).searchParams.get('quote');
 const kitchenEdited = await post({...kitchenBody,previousQuoteToken:kitchenToken,
   unitDetails:kitchenBody.unitDetails.map((unit,index)=>index ? unit : {...unit,grease:'none'})});
 assert.equal(kitchenEdited.status,201,kitchenEdited.error);
 assert.notEqual(kitchenEdited.quoteUrl,kitchenSaved.quoteUrl);
 assert.equal((await get(kitchenEdited.quoteUrl)).package.buildupAdjustment.amount,70);
 assert.equal((await get(kitchenSaved.quoteUrl)).package.buildupAdjustment.amount,130);
 console.log('Saved quote versions: immutable details/prices/contacts, changed-content delivery, concurrent deduplication, consent and partial-delivery retry passed. Providers mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
