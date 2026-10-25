const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const clone = value => JSON.parse(JSON.stringify(value));
const conflict = "This quote was updated elsewhere. Refresh before saving.";

class Element {
  constructor() { this.nodes = {}; this.lists = {}; this.listeners = {}; this.dataset = {}; this.classList = {add(){},remove(){},toggle(){}}; this.textContent = ""; }
  querySelector(key) { return this.nodes[key] ||= new Element(); }
  querySelectorAll(key) { return this.lists[key] || []; }
  addEventListener(key, callback) { (this.listeners[key] ||= []).push(callback); }
  showModal() { this.open = true; }
  contains() { return false; }
}

function fixture() {
  const document = new Element(), requests = [], replies = [];
  const window = {navigator:{},matchMedia:()=>({matches:false})};
  let source = fs.readFileSync(path.join(__dirname, "../crm.js"), "utf8");
  source = source.replace(/\}\)\(\);\s*$/, "window.test={state,submitQuoteChange,quoteMutation,quoteEditFingerprint,openQuote,quoteFormSnapshots};})();");
  vm.runInNewContext(source, {document, window, navigator:{userAgent:"Test",platform:"Test"},
    sessionStorage:{getItem:()=>""},localStorage:{getItem:()=>""},setTimeout:()=>1,clearTimeout(){},console,
    fetch:async (url, options) => {
      assert.equal(url, "/api/crm/quotes", "Never send messages, create a payment or access other endpoints");
      requests.push({method:options.method || "GET",body:options.body && JSON.parse(options.body)});
      assert(replies.length, "No unplanned retries");
      const next = replies.shift();
      return {ok:next.status === 200,status:next.status,json:async()=>clone(next.data)};
    }
  });
  window.test.state.token = "mock-admin-only";
  return {api:window.test,document,requests,replies};
}

const original = {
  id:"QUOTE-SELECTED",editSource:"custom",type:"Customized quote",editVersion:"old-record-version",
  customerName:"Example Customer",email:"example@example.test",phone:"+12125550123",
  editFields:{customerName:"Example Customer",amountCents:10000,units:[{name:"Unit 1",items:[]}],internalNotes:"Retain this note"},
  editHistory:[],editLocked:false,deletedAt:"",approvalUrl:"",paymentReady:false,checkoutFlow:"",
  photoUpload:{scheduledReminders:[{status:"scheduled"}]}
};
const draft = {operation:"payment_link",fields:{...clone(original.editFields),amountCents:45000,serviceTime:"08:01",discountLabel:"First-time discount"}};
const latest = {...clone(original),editVersion:"new-record-version",photoUpload:{scheduledReminders:[{status:"sent"}]} };
const error = (message = conflict) => ({status:409,data:{error:message}});
const refreshed = quote => ({status:200,data:{quotes:[{...clone(quote),id:"ANOTHER-QUOTE"},quote]}});

(async () => {
  // Reproduce the existing server's full-record fingerprint changing for reminder metadata alone.
  const hash = record => crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex");
  assert.notEqual(hash(original),hash({...original,photoUpload:latest.photoUpload}));
  const f = fixture();
  assert.equal(f.api.quoteEditFingerprint(original),f.api.quoteEditFingerprint(latest));
  f.replies.push(error(),refreshed(latest),{status:200,data:{ok:true,paymentReady:true}});
  assert.equal((await f.api.submitQuoteChange(original,draft,"PATCH",new Element())).ok,true);
  assert.deepEqual(f.requests.map(r=>r.method),["PATCH","GET","PATCH"]);
  const writes = f.requests.filter(r=>r.method === "PATCH");
  assert.equal(writes[0].body.version,original.editVersion);
  assert.equal(writes[1].body.version,latest.editVersion);
  for (const request of writes) {
    assert.equal(request.body.id,original.id);assert.equal(request.body.source,"custom");
    assert.deepEqual(request.body.fields,draft.fields,"Preserve every entered price, date, unit and note");
  }
  assert.equal(original.editVersion,"old-record-version","Never silently rebase the open draft");

  for (const change of [
    {editFields:{...original.editFields,amountCents:25000}},
    {editFields:{...original.editFields,internalNotes:"Someone else's change"}},
    {editHistory:[{at:"2030-01-01",action:"edited"}]},
    {editLocked:true},{deletedAt:"2030-01-01"},{checkoutFlow:"instant_booking"},
    {approvalUrl:"https://example.test/q/changed"},{paymentReady:true},
    {id:"NOT-THE-SELECTED-QUOTE"},{editSource:"saved"},{editVersion:original.editVersion},{editFields:null}
  ]) {
    const blocked = fixture();blocked.replies.push(error(),refreshed({...latest,...change}));
    await assert.rejects(blocked.api.submitQuoteChange(original,draft,"PATCH",new Element()),/entries are still in this form/);
    assert.equal(blocked.requests.filter(r=>r.method === "PATCH").length,1,"Changed quote details must not be overwritten");
  }

  const race = fixture();race.replies.push(error(),refreshed(latest),error());
  await assert.rejects(race.api.submitQuoteChange(original,draft,"PATCH",new Element()),new RegExp(conflict.replaceAll(".","\\.")));
  assert.equal(race.requests.length,3,"A second race must stop; no retry loop");
  for (const [method,body,message] of [["DELETE",{confirmation:original.id},conflict],["PATCH",{operation:"restore"},conflict],["PATCH",draft,"Payment already received"]]) {
    const blocked = fixture();blocked.replies.push(error(message));
    await assert.rejects(blocked.api.submitQuoteChange(original,body,method,new Element()));
    assert.equal(blocked.requests.length,1,"Never retry deletion, restore or payment-protection errors");
  }
  const unavailable = fixture();unavailable.replies.push({status:503,data:{error:"Temporarily unavailable"}});
  await assert.rejects(unavailable.api.submitQuoteChange(original,draft,"PATCH",new Element()));
  assert.equal(unavailable.requests.length,1,"Uncertain failures must not be resubmitted");

  const preserved = fixture(), status = new Element(), button = new Element();
  const form = new Element();form.enteredValues = clone(draft.fields);
  const dialog = preserved.document.querySelector("[data-booking-dialog]");
  dialog.lists["[data-custom-payment-form], [data-quote-edit-form], [data-quote-discount-form], [data-walkthrough-confirm-form]"] = [form];
  preserved.api.state.quotes = [clone(original)];
  preserved.api.openQuote(original.id);
  preserved.api.state.quotes[0].editFields.amountCents = 90000;
  assert.equal(preserved.api.quoteFormSnapshots.get(form).editFields.amountCents,10000,"Background refresh must not change an open form's starting values");
  preserved.replies.push(error(),refreshed({...latest,editFields:{...latest.editFields,amountCents:80000}}));
  await preserved.api.quoteMutation(original,draft,"PATCH",status,button);
  assert.match(status.textContent,/entries are still in this form/);assert.equal(button.disabled,false);
  assert.deepEqual(form.enteredValues,draft.fields,"Real conflicts leave the owner's draft intact");
  console.log("Quote conflicts: metadata-only retry, exact customer, intact drafts, frozen form snapshot, real-change/payment protections and single retry passed (mock APIs only).");
})().catch(error=>{console.error(error);process.exitCode=1;});
