const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const actual=require('../api/booking/_shared');
const records=new Map(),emails=[],texts=[];let smsFails=false,priceChanged=false;
const drive={files:{create:async args=>{const r=JSON.parse(args.media.body);records.set(r.quoteId,r);return{data:{id:r.quoteId}};},list:async args=>{const id=args.q.match(/saved_quote_id' and value='([^']+)'/)[1];return{data:{files:records.has(id)?[{id}]:[]}};},get:async args=>({data:structuredClone(records.get(args.fileId))}),update:async args=>{records.set(args.fileId,JSON.parse(args.media.body));}}};
const moduleObject={exports:{}};
vm.runInNewContext(fs.readFileSync('api/booking/_saved-quote.js','utf8'),{module:moduleObject,Buffer,URLSearchParams,console,process:{env:{QUOTE_APPROVAL_SECRET:'test',TWILIO_ACCOUNT_SID:'test',TWILIO_AUTH_TOKEN:'test',TWILIO_FROM_NUMBER:'+12125550100'}},require:name=>{
 if(name==='crypto')return crypto;
 if(name==='./_shared')return{...actual,calculateHourlyCleaningQuote:h=>{const p=actual.calculateHourlyCleaningQuote(h);return priceChanged?{...p,price:p.price+100}:p;},listAllBookings:async()=>[],readJsonBody:async req=>req.body,json:(res,status,body)=>({status,...body})};
 if(name==='../quote/_shared')return{getGoogleClients:()=>({drive,config:{parentFolderId:'test'},gmail:{users:{messages:{send:async args=>{emails.push(Buffer.from(args.requestBody.raw,'base64url').toString());return{data:{id:'email'}};}}}}})};
 if(name==='./_promo')return require('../api/booking/_promo');
 if(name==='./_discount')return require('../api/booking/_discount');
 throw Error(name);
},fetch:async(_url,args)=>{texts.push(new URLSearchParams(args.body));return{ok:!smsFails,status:smsFails?500:201,text:async()=>JSON.stringify(smsFails?{message:'test failure'}:{sid:'sms'})};}});
const handler=moduleObject.exports;
const body={eligibility:{requestedService:'hourly',serviceZip:'11432'},pricingMode:'hourly_formula',unitDetails:[{hours:4}],customer:{firstName:'Test',lastName:'Customer',email:'test@example.invalid',phone:'2125550101'},smsConsent:true};
const post=b=>handler({method:'POST',headers:{host:'example.test'},body:b},{});
const get=url=>handler({method:'GET',headers:{host:'example.test'},query:{token:new URL(url).searchParams.get('quote')}},{setHeader(){}});
(async()=>{
 const [first,repeat]=await Promise.all([post(body),post(body)]);assert.equal(first.quoteUrl,repeat.quoteUrl);assert.equal(records.size,1);assert.equal(emails.length,1);assert.equal(texts.length,1);
 const original=await get(first.quoteUrl);assert.equal(original.status,200);
 const edited=await post({...body,unitDetails:[{hours:6}]});assert.notEqual(first.quoteUrl,edited.quoteUrl);assert.equal(records.size,2);assert.equal(emails.length,2);assert.equal(texts.length,2);
 const updated=await get(edited.quoteUrl);assert.equal(updated.unitDetails[0].hours,6);assert.equal((await get(first.quoteUrl)).unitDetails[0].hours,4);assert.notEqual(original.package.price,updated.package.price);
 priceChanged=true;assert.equal((await get(first.quoteUrl)).package.price,original.package.price,'Saved version does not reprice when pricing changes');priceChanged=false;
 const changedContact=await post({...body,customer:{...body.customer,email:'new@example.invalid',phone:'2125550102'}});assert.notEqual(changedContact.quoteUrl,first.quoteUrl);assert.match(emails.at(-1),/To: new@example.invalid/);assert.equal(texts.at(-1).get('To'),'+12125550102');assert.equal((await get(first.quoteUrl)).customer.email,body.customer.email);
 smsFails=true;const failing={...body,unitDetails:[{hours:5}]};const failed=await post(failing);assert.equal(failed.delivery.sms,'failed');const emailCount=emails.length;const recordCount=records.size;smsFails=false;const retry=await post(failing);assert.equal(retry.quoteUrl,failed.quoteUrl);assert.equal(retry.delivery.sms,'sent');assert.equal(emails.length,emailCount,'Retry sends only failed channel');assert.equal(records.size,recordCount);
 const denied=await post({...body,smsConsent:false});assert.equal(denied.status,400);
 console.log('Saved quote versions: immutable details/prices/contacts, changed-content delivery, concurrent deduplication, consent and partial-delivery retry passed. Providers mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
