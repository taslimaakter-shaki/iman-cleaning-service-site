const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

class Element {
  constructor() { this.nodes = {}; this.lists = {}; this.listeners = {}; this.hidden = false; this.value = ""; this.innerHTML = ""; this.textContent = ""; this.dataset = {}; this.classList = {add(){},remove(){},toggle(){}}; }
  querySelector(key) { return this.nodes[key] ||= new Element(); }
  querySelectorAll(key) { return this.lists[key] || []; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  focus() {} contains() { return false; } showModal() { this.open = true; } close() { this.open = false; }
}
const document = new Element(), requests = [], window = {navigator:{},matchMedia:()=>({matches:false}),confirm:()=>true};
const context = {document,window,navigator:{userAgent:"Test",platform:"Test"},sessionStorage:{getItem:()=>""},localStorage:{getItem:()=>""},setTimeout:()=>1,clearTimeout(){},console,
  fetch:async(url,options)=>{
    assert.equal(url,"/api/crm/quotes","Test must never send messages or create payments");requests.push({url,...options});
    return {ok:true,json:async()=>options.method?{ok:true,paymentReady:true}:{quotes:window.test.state.quotes}};
  }
};
let source=fs.readFileSync(path.join(__dirname,"../crm.js"),"utf8");
source=source.replace(/\}\)\(\);\s*$/, "window.test={state,customPaymentButton,customQuotePaymentMarkup,quoteRow,mobileQuote,collectPaymentUnits,updatePaymentPreview,saveCustomPayment};})();");
vm.runInNewContext(source,context);
const api=window.test;
const quote={id:"QUOTE-SELECTED",type:"Customized quote",editSource:"custom",editVersion:"version-1",customerName:"Selected Customer",email:"selected@example.test",phone:"+12125550123",editFields:{internalNotes:"Private",submittedFields:[]}};
api.state.token="mock-admin";api.state.quotes=[quote,{...quote,id:"QUOTE-OTHER",phone:"+12125550456"}];
for(const source of ["custom","legacy"]){
  const q={...quote,editSource:source};assert.match(api.quoteRow(q),/data-prepare-custom-payment="QUOTE-SELECTED"/);assert.match(api.mobileQuote(q),/Payment link/);
}
for(const changes of [{deletedAt:"2030-01-01"},{editLocked:true},{type:"Instant quote",editSource:"saved"}]) assert.equal(api.customPaymentButton({...quote,...changes}),"");
const markup=api.customQuotePaymentMarkup(quote);
for(const name of ["Bedrooms","Full bathrooms","Half bathrooms","Living rooms","Dining rooms","Kitchens","Add another unit","Discount name","Hours per worker"])assert(markup.includes(name),name);
assert.match(markup,/name="cleanerCount"[^>]*value=""/);assert.match(markup,/name="teamHours"[^>]*value=""/);
assert.doesNotMatch(markup,/Private/);
assert.match(api.customQuotePaymentMarkup({...quote,editFields:{service:'<img src=x onerror="bad()">'}}),/&lt;img/);

const form=new Element();form.dataset.quoteId=quote.id;form.reportValidity=()=>true;form.closest=()=>form;
form.elements={};
const vals={customerName:"Selected Customer",email:quote.email,phone:quote.phone,address:"123 Example St",service:"Deep cleaning",serviceDate:"2030-09-15",serviceTime:"09:00",details:"Agreed scope",packageItems:"Supplies included",cleanerCount:"3",teamHours:"3",amount:"0",rushFeeCents:"0",discount:"20",discountLabel:"First-time customer discount"};
for(const [key,value] of Object.entries(vals)){form.elements[key]=new Element();form.elements[key].value=value;}
function unit(name,items){const unit=new Element();unit.querySelector("[data-unit-name]").value=name;unit.lists["[data-unit-item]"]=items.map(([name,q,price,kind="room"])=>{const row=new Element();row.dataset.kind=kind;for(const [selector,value]of [["[data-item-name]",name],["[data-item-quantity]",q],["[data-item-price]",price]])row.querySelector(selector).value=String(value);return row;});return unit;}
form.lists["[data-quote-unit]"]=[unit("Apartment 1",[["Bedrooms",2,50],["Bathroom",1,50],["Kitchen",1,50],["Unused room",0,100]]),unit("Apartment 2",[["Living room",1,40],["Dining room",1,30],["Inside refrigerator",1,30,"addon"]])];
api.updatePaymentPreview(form);
assert.equal(form.elements.amount.value,"306.63");assert.match(form.querySelector("[data-payment-totals]").innerHTML,/\$26.63/);
assert.match(form.querySelector("[data-payment-preview]").textContent,/3 workers × 3 hours = 9 total labor-hours/);
assert.match(form.querySelector("[data-payment-preview]").textContent,/\$76.66/);
assert.match(form.querySelector("[data-schedule-preview]").textContent,/Estimated finish: Sep 15, 12:00 PM.*Next possible start: Sep 15, 3:00 PM/);
form.elements.serviceDate.value = '2030-09-12'; form.elements.serviceTime.value = '08:00'; form.elements.teamHours.value = '9';
api.updatePaymentPreview(form);
assert.match(form.querySelector("[data-schedule-preview]").textContent,/Estimated finish: Sep 12, 5:00 PM.*Next possible start: Sep 12, 8:00 PM/);
form.elements.serviceDate.value = '2030-11-02'; form.elements.serviceTime.value = '23:00'; form.elements.teamHours.value = '9';
api.updatePaymentPreview(form);
assert.match(form.querySelector("[data-schedule-preview]").textContent,/Estimated finish: Nov 3, 7:00 AM.*Next possible start: Nov 3, 10:00 AM/);
for (const key of ['serviceDate','serviceTime','teamHours']) form.elements[key].value = vals[key];
api.updatePaymentPreview(form);
assert.equal(api.collectPaymentUnits(form)[0].items.length,3,"Zero-quantity rooms are omitted");
form.elements.discountLabel.value='<script>bad()</script>';api.updatePaymentPreview(form);assert.doesNotMatch(form.querySelector("[data-payment-totals]").innerHTML,/<script>/);
form.elements.discountLabel.value=vals.discountLabel;
(async()=>{
  await api.saveCustomPayment(form);
  const saved=JSON.parse(requests.find(r=>r.method==="PATCH").body);
  assert.equal(saved.id,"QUOTE-SELECTED");assert.equal(saved.operation,"payment_link");assert.equal(saved.fields.amountCents,30663);
  assert.equal(saved.fields.discountCents,2000);assert.equal(saved.fields.discountLabel,vals.discountLabel);assert.equal(saved.fields.units.length,2);
  assert.equal(saved.fields.laborHours,9);assert.equal(saved.fields.cleanerCount,3);assert.equal(saved.fields.internalNotes,"Private");
  assert.equal(saved.fields.units[1].items[2].kind,"addon");
  quote.paymentReady=true;quote.approvalUrl="https://www.imancleaningservice.com/q/test00000001";
  const button={dataset:{textPaymentLink:quote.id}};
  const target={closest:s=>s==="[data-text-payment-link]"?button:null};
  for(const fn of document.listeners.click)fn({target});
  assert.match(document.querySelector("[data-message-body]").value,/\/q\/test00000001/);
  assert.equal(document.querySelector("[data-message-phone]").value,quote.phone);
  assert.equal(requests.length,2,"Preparing the text does not send it");
  console.log("Custom-payment CRM UI: units, rooms, add-ons, tax, named discount, manual hours, correct customer binding and no auto-send passed.");
})().catch(error=>{console.error(error);process.exitCode=1;});
