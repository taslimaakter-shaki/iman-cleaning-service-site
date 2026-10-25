const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { buildSections } = require("../api/booking/_confirmation-pdf");
const html=fs.readFileSync(path.join(__dirname,"../approve-quote.html"),"utf8");
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
new vm.Script(script);
const quote={quoteId:"QUOTE-TEST",revision:"revision-1",customerName:"Example Customer",serviceLocation:"123 Example St",service:"Deep cleaning",serviceDate:"2030-09-15",serviceTime:"09:00",amountCents:30663,rushFeeCents:0,laborHours:9,cleanerCount:3,description:"Agreed scope",packageItems:"Supplies included",agreementUrl:"https://www.imancleaningservice.com/agreement.html",balanceCollection:"automatic_48h_authorization",
  units:[{name:"Apartment 1",subtotalCents:20000,items:[{name:"Bedrooms",quantity:2,unitPriceCents:5000,lineTotalCents:10000},{name:"Bathroom and kitchen",quantity:1,unitPriceCents:10000,lineTotalCents:10000}]},{name:"Apartment 2",subtotalCents:10000,items:[{name:"Living room and add-ons",quantity:1,unitPriceCents:10000,lineTotalCents:10000}]}],
  pricing:{subtotalCents:30000,taxCents:2663,discountCents:2000,discountLabel:"First-time customer discount",discountApplication:"after_tax",totalCents:30663}
};
class Element {
  constructor(){this.hidden=false;this.open=false;this.value="";this.dataset={};this.listeners={};this.innerHTML="";this.textContent="";this.scrollTop=0;this.clientHeight=200;this.scrollHeight=600;}
  addEventListener(event,fn){this.listeners[event]=fn;}appendChild(){}focus(){}querySelector(){return new Element();}
  showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}
}
async function render(data,failAgreement=false) {
  const nodes={};const get=s=>nodes[s] ||= new Element();const form=get("#approvalForm");
  form.agreementAccepted=new Element();form.agreementAccepted.disabled=true;form.agreementScrolled=new Element();form.agreementScrolled.value="false";form.agreementSignature=new Element();
  const requests=[];
  const context={URLSearchParams,console,window:{location:{search:"",pathname:"/q/test00000001"},addEventListener(){}},document:{querySelector:get,body:{classList:{add(){},remove(){}}}},DOMParser:class{parseFromString(){return {querySelector:()=>new Element()};}},
    fetch:async(url)=>{requests.push(url);if(url.startsWith("/api/quote/resolve-approval?"))return {ok:true,json:async()=>({quote:data})};assert.equal(url,quote.agreementUrl);return {ok:!failAgreement,text:async()=>"mock agreement"};}
  };
  vm.runInNewContext(script.replace("      initializeQuote();","      globalThis.ready = initializeQuote();"),context);await context.ready;return {nodes,get,form,requests,open:context.openAgreementReview,back:context.returnToEstimate};
}
(async()=>{
  const result=await render(quote), summary=result.get("#quoteSummary").innerHTML;
  for(const expected of ["Apartment 1","Apartment 2","2 × Bedrooms","$200.00","$100.00","$300.00","$26.63","-$20.00","First-time customer discount","$306.63","$76.66","$229.97","3 workers for approximately 3 hours each"]){assert(summary.includes(expected),expected);}
  assert.match(summary,/September 15, 2030/);assert.match(summary,/9:00 AM \(New York time\)/);
  assert.match(summary,/date and time are set by IMAN Cleaning Service and cannot be edited/);
  assert.doesNotMatch(summary,/<input|<select|<textarea/);
  assert.doesNotMatch(html, /type="(?:date|time|number)"|Choose an appointment|Edit quote details/);
  assert.equal(result.form.hidden,true);assert.equal(result.get("#agreementDialog").open,false);
  assert.equal(result.requests.length,1,"Estimate does not load the agreement before the customer opens the review step");
  assert.doesNotMatch(summary,/href="#approvalForm"/);assert.match(summary,/data-open-agreement-review/);
  assert(html.indexOf('<dialog class="agreement-dialog"')>html.indexOf('</main>'),"Agreement is a separate dialog, not a section under the estimate");
  await result.open();assert.equal(result.form.hidden,false);assert.equal(result.get("#agreementDialog").open,true);
  assert.equal(result.form.agreementAccepted.disabled,true,"Agreement must be read first");
  const scroll=result.get("#agreementScroll");scroll.scrollTop=400;scroll.listeners.scroll();
  assert.equal(result.form.agreementAccepted.disabled,false);assert.equal(result.form.agreementScrolled.value,"true");
  assert.equal(result.get("#acceptAgreement").disabled,true,"Scrolling alone cannot enable acceptance");
  result.form.agreementAccepted.checked=true;result.form.agreementAccepted.listeners.change();
  assert.equal(result.get("#acceptAgreement").disabled,true,"A signature is still required");
  result.form.agreementSignature.value="Example Customer";result.form.agreementSignature.listeners.input();
  assert.equal(result.get("#acceptAgreement").disabled,false);
  assert.equal(result.get("#payDeposit").disabled,true,"Payment requires the separate Agree & continue action");
  assert.match(summary,/Pay \$76\.66 &amp; confirm booking/);
  result.back();assert.equal(result.get("#agreementDialog").open,false);await result.open();
  assert.equal(result.form.agreementSignature.value,"Example Customer");assert.equal(result.form.agreementAccepted.checked,true);
  assert.equal(result.requests.length,2,"Back and reopen preserve agreement progress without another request");
  assert.match(result.get("#agreementAcceptance").textContent,/remaining-balance authorization/);
  assert.match(result.get("#agreementAcceptance").textContent,/authorization shown on this quote/);
  assert.doesNotMatch(html,/paymentPolicy|paymentTermsTitle|payment-policy|Review the terms, accept the agreement and sign before continuing to payment/);
  assert.match(html,/<form id="approvalForm" hidden>\s*<section class="agreement-reader" aria-labelledby="agreementReaderTitle">/,"The dialog opens directly to the full service agreement");
  assert.match(html, /id="closeAgreement" aria-label="Back to estimate">×/);
  assert(html.indexOf('id="agreementScroll"') < html.indexOf('name="agreementAccepted"'),"The full service agreement still precedes acceptance");
  assert.match(summary,/captured after completion/);
  assert.match(summary,/48-hour authorization hold/);
  assert.match(summary,/remaining \$229.97/);
  assert.match(summary,/Cancel or reschedule at least 48 hours ahead/);
  assert.match(summary,/Cancellation qualifies for a full deposit refund/);
  assert.match(summary,/Rescheduling is free, subject to availability, with your deposit kept toward the new appointment/);
  const sameDay=await render({...quote,rushFeeCents:10000});
  assert.doesNotMatch(sameDay.get("#quoteSummary").innerHTML,/48-hour authorization hold|Cancellation qualifies for a full deposit refund/);
  assert.match(sameDay.get("#quoteSummary").innerHTML,/25% service deposit \+ \$100 rush fee/);
  assert.match(sameDay.get("#quoteSummary").innerHTML,/Pay \$176\.66 &amp; confirm booking/);
  const bad=await render({...quote,description:'<img src=x onerror="bad()">',pricing:{...quote.pricing,discountLabel:'<script>bad()</script>'}});
  assert.doesNotMatch(bad.get("#quoteSummary").innerHTML,/<img|<script/);assert.match(bad.get("#quoteSummary").innerHTML,/&lt;script/);
  const failed=await render(quote,true);await failed.open();assert.equal(failed.get("#agreementDialog").open,true);assert.equal(failed.form.agreementAccepted.disabled,true);
  assert.equal(failed.get("#acceptAgreement").disabled,true);assert.equal(failed.get("#payDeposit").disabled,true);assert.match(failed.get("#status").textContent,/could not be loaded/);
  const legacy=await render({...quote,units:[],pricing:null});assert.match(legacy.get("#quoteSummary").innerHTML,/Deep cleaning \(including tax\)/);
  const sections=buildSections({booking:{id:"BK-TEST",notes:"Scope",estimate:{total:306.63,subtotal:300,tax:26.63,manHours:9,teamHours:3,customQuotePricing:quote.pricing,units:[{baseItems:[{label:"2 × Bedrooms",amount:100}],addOns:[]}]}} ,record:{}});
  const rows=sections.flatMap(s=>s.rows);
  assert(rows.some(([label,value])=>label==="First-time customer discount (after tax)"&&value==="-$20.00"));
  assert(rows.some(([label,value])=>label==="Sales tax"&&value==="$26.63"));
  console.log("Customer estimate and confirmation: per-unit breakdown, exact tax/discount/deposit, manual team hours, escaping, legacy links and agreement gating passed.");
})().catch(error=>{console.error(error);process.exitCode=1;});
