const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
class Element {
  constructor() { this.nodes = {}; this.lists = {}; this.listeners = {}; this.hidden = false; this.value = ''; this.innerHTML = ''; this.textContent = ''; this.dataset = {}; this.classList = {add(){},remove(){},toggle(){}}; }
  querySelector(key) { return this.nodes[key] ||= new Element(); }
  querySelectorAll(key) { return this.lists[key] || []; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  focus() {} contains() { return false; } showModal() { this.open = true; } close() { this.open = false; }
}
const document = new Element(), requests = [], window = {navigator:{},matchMedia:()=>({matches:false}),confirm:()=>true};
let source = fs.readFileSync(path.join(__dirname,'../crm.js'),'utf8');
source = source.replace(/\}\)\(\);\s*$/, 'window.test={state,quoteEditorMarkup,updateDiscountPreview,saveQuoteDiscount,quoteFormSnapshots};})();');
vm.runInNewContext(source,{document,window,navigator:{userAgent:'Test',platform:'Test'},sessionStorage:{getItem:()=>''},localStorage:{getItem:()=>''},setTimeout:()=>1,clearTimeout(){},console,
  fetch: async (url,options) => { assert.equal(url,'/api/crm/quotes'); requests.push({url,...options}); return {ok:true,json:async()=>options.method?{ok:true,paymentReady:true}:{quotes:window.test.state.quotes}}; }});
const api = window.test;
const quote = {id:'SELECTED',type:'Instant quote',editSource:'saved',editVersion:'version-1',customerName:'Selected Customer',editFields:{amountCents:19000,discountCents:5000,discountLabel:'Welcome',rushFeeCents:0,submittedFields:[]}};
api.state.token='mock-admin';api.state.quotes=[quote,{...quote,id:'OTHER'}];
(async()=>{
  for (const editSource of ['saved','booking','custom','legacy']) assert.match(api.quoteEditorMarkup({...quote,editSource}),/Add \/ edit discount/);
  assert.doesNotMatch(api.quoteEditorMarkup({...quote,editLocked:true}),/<form data-quote-discount-form/);
  assert.match(api.quoteEditorMarkup({...quote,editFields:{...quote.editFields,discountLabel:'<script>bad()</script>'}}),/&lt;script&gt;/);
  const form = new Element(); form.reportValidity=()=>true;form.elements={discount:{value:'25'},discountLabel:{value:'Loyalty'}};
  api.quoteFormSnapshots.set(form,quote);
  api.updateDiscountPreview(form);
  const preview = form.querySelector('[data-discount-preview]').innerHTML;
  for (const price of ['$240.00','$25.00','$215.00','$53.75','$161.25']) assert(preview.includes(price),price);
  form.elements.discount.value='240';api.updateDiscountPreview(form);
  assert.match(form.querySelector('[data-discount-preview]').textContent,/At least \$2/);
  form.elements.discount.value='25';
  await api.saveQuoteDiscount(form);
  const sent = JSON.parse(requests.find(r=>r.method==='PATCH').body);
  assert.equal(sent.id,'SELECTED');assert.equal(sent.source,'saved');assert.equal(sent.operation,'discount');
  assert.equal(sent.version,'version-1');assert.equal(sent.discountCents,2500);assert.equal(sent.discountLabel,'Loyalty');
  assert.equal(sent.fields,undefined,'Discount cannot overwrite customer or work details');
  assert(requests.every(r=>r.url==='/api/crm/quotes'),'No message/payment request');
  const html = fs.readFileSync(path.join(__dirname,'../book-now.html'),'utf8');
  const js = fs.readFileSync(path.join(__dirname,'../book-now.js'),'utf8');
  assert.match(html,/data-quote-discount-row hidden/);assert.match(html,/book-now\.js\?v=[^"']+/);
  assert(html.indexOf('data-quote-discount-row') < html.indexOf('data-quote-tax-label'), 'The FALL10 discount must appear before sales tax in the price breakdown');
  assert.match(html,/data-quote-discounted-subtotal-row hidden/);
  assert.match(html,/data-checkout-tax-row hidden/);
  assert(js.includes("querySelector('[data-quote-discount-label]').textContent"));
  assert.match(html,/data-quote-discount-description/);
  assert.match(js,/promo discount/);
  assert.match(js,/off before tax/);
  assert.match(js,/state\.promo\?\.amountCents/);
  assert.match(js,/state.quoteRevision = data.quoteRevision/);
  console.log('Discount UI passed: every quote source, selected-customer binding, replacement preview, exact deposit/balance, escaping, paid protection and no message/charge.');
})().catch(error=>{console.error(error);process.exitCode=1;});
