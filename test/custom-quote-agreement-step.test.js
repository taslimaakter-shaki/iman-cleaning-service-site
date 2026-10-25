const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const html = fs.readFileSync(path.join(__dirname,"../approve-quote.html"),"utf8");
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const quote = {quoteId:"QUOTE-EXAMPLE",revision:"revision-1",customerName:"Example Customer",serviceLocation:"123 Example St",
  service:"Deep cleaning",serviceDate:"2030-09-15",serviceTime:"09:00",amountCents:20000,laborHours:4,cleanerCount:2,
  agreementUrl:"https://www.imancleaningservice.com/agreement.html",balanceCollection:"automatic_48h_authorization"};

class Element {
  constructor(){this.open=false;this.hidden=false;this.disabled=false;this.checked=false;this.value="";this.dataset={};this.listeners={};this.scrollTop=0;this.clientHeight=200;this.scrollHeight=600;this.textContent="";this.innerHTML="";this.focusCount=0;}
  addEventListener(name,fn){this.listeners[name]=fn;}
  focus(){this.focusCount++;}appendChild(){}reportValidity(){return true;}
  showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}
}

async function fixture({invalid=false,legacy=false}={}) {
  const nodes=new Map(), requests=[], classes=new Set();
  const get=name=>{if(!nodes.has(name))nodes.set(name,new Element());return nodes.get(name);};
  const form=get("#approvalForm");
  form.agreementAccepted=new Element();form.agreementAccepted.disabled=true;
  form.agreementScrolled=new Element();form.agreementScrolled.value="false";
  form.agreementSignature=new Element();
  const trigger=new Element();let agreementResponse=null, checkoutResponse=null;
  const window={location:{search:legacy?"?token=legacy-example":"",pathname:legacy?"/approve-quote.html":"/q/test00000001",href:""},addEventListener(){}};
  const context={URLSearchParams,FormData,console,window,document:{querySelector:get,activeElement:trigger,body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}}},
    DOMParser:class{parseFromString(){return {querySelector:()=>new Element()};}},
    fetch:async(url,options={})=>{
      requests.push({url,...options});
      if(url.startsWith("/api/quote/resolve-approval?"))return {ok:!invalid,json:async()=>invalid?{error:"Expired quote"}:{quote}};
      if(url===quote.agreementUrl)return agreementResponse ? await agreementResponse : {ok:true,text:async()=>"Mock agreement"};
      assert.equal(url,"/api/quote/approve-checkout","No unrelated or real messages/payment endpoints");
      assert.equal(options.method,"POST");
      return checkoutResponse ? await checkoutResponse : {ok:true,json:async()=>({checkoutUrl:"https://checkout.stripe.test/quote-example"})};
    }
  };
  vm.runInNewContext(script.replace("      initializeQuote();","      globalThis.ready = initializeQuote();"),context);await context.ready;
  return {get,form,requests,classes,window,trigger,open:context.openAgreementReview,back:context.returnToEstimate,
    submit:()=>form.listeners.submit({preventDefault(){}}),
    pay:context.startSecurePayment,
    setAgreementResponse:p=>{agreementResponse=p;},setCheckoutResponse:p=>{checkoutResponse=p;}};
}

function completeReview(f){
  const scroll=f.get("#agreementScroll");scroll.scrollTop=400;scroll.listeners.scroll();
  f.form.agreementAccepted.checked=true;f.form.agreementAccepted.listeners.change();
  f.form.agreementSignature.value="Example Customer";f.form.agreementSignature.listeners.input();
}
const checkoutCount=f=>f.requests.filter(r=>r.url==="/api/quote/approve-checkout").length;

(async()=>{
  const f=await fixture();assert.equal(f.form.hidden,true);assert.equal(f.requests.length,1);
  await f.submit();await f.pay();assert.equal(checkoutCount(f),0,"No checkout from the estimate before opening review");
  assert(f.get("#payDeposit").disabled);
  await f.open();assert(f.get("#agreementDialog").open);assert(f.classes.has("quote-agreement-open"));
  assert.equal(checkoutCount(f),0,"Opening review must not charge, book or prepare a checkout");
  await f.submit();assert.equal(checkoutCount(f),0,"Unread/unsigned agreement cannot submit");
  completeReview(f);assert.equal(f.get("#acceptAgreement").disabled,false);assert(f.get("#payDeposit").disabled);
  f.back();assert(!f.get("#agreementDialog").open);assert(!f.classes.has("quote-agreement-open"));assert.equal(f.trigger.focusCount,1);
  assert.equal(f.form.agreementSignature.value,"Example Customer");assert(f.form.agreementAccepted.checked);
  await f.submit();await f.pay();assert.equal(checkoutCount(f),0,"Back without Agree & continue cannot authorize payment");
  await f.open();assert.equal(f.requests.length,2,"Reopening retains the loaded agreement and signature");
  await f.pay();assert.equal(checkoutCount(f),0,"Payment cannot start while reviewing the agreement");
  await f.submit();assert.equal(checkoutCount(f),0,"Agree & continue only accepts; it must not create a checkout");
  assert(!f.get("#agreementDialog").open);assert(!f.classes.has("quote-agreement-open"));
  assert.equal(f.get("#payDeposit").disabled,false);assert.equal(f.get("#payDeposit").focusCount,1);
  assert.equal(f.get("[data-open-agreement-review]").textContent,"✓ Service Agreement accepted");
  assert(f.get("#agreementReviewStatus").hidden);
  let releaseCheckout;
  f.setCheckoutResponse(new Promise(resolve=>{releaseCheckout=resolve;}));
  const pending=f.pay();await f.pay();assert.equal(checkoutCount(f),1,"Double clicks prepare one checkout only");
  assert(f.get("#payDeposit").disabled);assert(f.get("[data-open-agreement-review]").disabled);
  await f.open();assert(!f.get("#agreementDialog").open,"Cannot reopen agreement during checkout preparation");
  releaseCheckout({ok:true,json:async()=>({checkoutUrl:"https://checkout.stripe.test/quote-example"})});await pending;
  assert.equal(f.window.location.href,"https://checkout.stripe.test/quote-example");
  const body=f.requests.at(-1).body;
  for(const [key,value] of Object.entries({code:"test00000001",revision:"revision-1",agreementScrolled:"true",agreementAccepted:"true",agreementSignature:"Example Customer"}))assert.equal(body.get(key),value);
  for(const key of ["amountCents","serviceDate","serviceTime","cleanerCount","laborHours"])assert.equal(body.get(key),null,"Customer cannot override server-defined quote details");

  const failure=await fixture();await failure.open();completeReview(failure);await failure.submit();
  failure.setCheckoutResponse(Promise.resolve({ok:false,json:async()=>({error:"Quote changed; reload to review the current terms."})}));
  await failure.pay();assert.match(failure.get("#checkoutStatus").textContent,/Quote changed/);assert.equal(failure.window.location.href,"");
  assert.equal(failure.get("#payDeposit").disabled,false);assert.equal(failure.get("[data-open-agreement-review]").disabled,false);
  assert.equal(failure.form.agreementSignature.value,"Example Customer","A recoverable payment error retains the signature");

  const loading=await fixture();let releaseAgreement;
  loading.setAgreementResponse(new Promise(resolve=>{releaseAgreement=resolve;}));
  const opening=loading.open();loading.back();
  const scroll=loading.get("#agreementScroll");scroll.scrollHeight=0;scroll.clientHeight=0;
  releaseAgreement({ok:true,text:async()=>"Mock agreement"});await opening;
  assert(loading.form.agreementAccepted.disabled,"Loading while the review is closed must never mark it read");
  scroll.scrollHeight=600;scroll.clientHeight=200;await loading.open();assert(loading.form.agreementAccepted.disabled);
  assert.equal(loading.form.agreementScrolled.value,"false");

  const unavailable=await fixture();unavailable.setAgreementResponse(Promise.resolve({ok:false}));await unavailable.open();
  assert(unavailable.form.agreementAccepted.disabled);assert(unavailable.get("#acceptAgreement").disabled);assert(unavailable.get("#payDeposit").disabled);
  assert.match(unavailable.get("#status").textContent,/could not be loaded/);assert.equal(checkoutCount(unavailable),0);
  unavailable.back();unavailable.setAgreementResponse(null);await unavailable.open();completeReview(unavailable);
  assert.equal(unavailable.get("#acceptAgreement").disabled,false,"Closing and reopening can retry a failed agreement fetch");

  const edited=await fixture();await edited.open();completeReview(edited);await edited.submit();
  await edited.open();assert(edited.get("#payDeposit").disabled,"Payment stays disabled while reviewing again");
  edited.back();assert.equal(edited.get("#payDeposit").disabled,false,"Back keeps an unchanged confirmed agreement");
  await edited.open();edited.form.agreementSignature.value="Changed Customer";edited.form.agreementSignature.listeners.input();
  edited.back();await edited.pay();assert.equal(checkoutCount(edited),0,"Editing a signature requires Agree & continue again");
  assert(edited.get("#payDeposit").disabled);
  await edited.open();await edited.submit();assert.equal(edited.get("#payDeposit").disabled,false);
  await edited.open();edited.form.agreementAccepted.checked=false;edited.form.agreementAccepted.listeners.change();edited.back();
  await edited.pay();assert.equal(checkoutCount(edited),0,"Revoking acceptance blocks payment");

  const invalid=await fixture({invalid:true});await invalid.open();assert(!invalid.get("#agreementDialog").open);assert.equal(invalid.requests.length,1);
  assert.match(invalid.get("#quoteSummary").textContent,/Expired quote/);
  const legacy=await fixture({legacy:true});await legacy.open();completeReview(legacy);await legacy.submit();await legacy.pay();
  assert.equal(legacy.requests.at(-1).body.get("token"),"legacy-example");assert.equal(legacy.requests.at(-1).body.get("code"),null);
  console.log("Instant-quote-style agreement flow: review, scroll/accept/sign, Agree & continue, separate payment, back/focus, edited-consent reset, load failure/retry, invalid/legacy links, duplicate-submit guard and exact checkout payload passed (mock APIs only).");
})().catch(error=>{console.error(error);process.exitCode=1;});
