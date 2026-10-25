const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const bookingSchema = fs.readFileSync(path.join(__dirname, "../supabase-schema.sql"), "utf8")
  .match(/create table if not exists public\.bookings \(([\s\S]*?)\n\);/)[1];
const requiredBookingText = [...bookingSchema.matchAll(/^\s*(\w+) text not null[^\n]*$/gm)]
  .filter(([definition]) => !/default/i.test(definition)).map(([, name]) => name);

function fixture({ clock = Date } = {}) {
  const files = new Map(); const bookings = new Map(); const sessions = [];
  let counter = 0, codes = 0, failedStripe = false, cancelled = 0;
  const add = (type, id, record) => {
    const file = { id: `file-${++counter}`, createdTime: "2026-09-10T00:00:00Z", name: id, appProperties: { iman_record_type: type, [type === "saved_quote" ? "saved_quote_id" : "quote_id"]: id } };
    files.set(file.id, { file, record: clone(record) }); return file.id;
  };
  const drive = { files: {
    list: async ({ q }) => ({ data: { files: [...files.values()].filter(({file}) => {
      if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) return file.mimeType === "application/vnd.google-apps.folder" && q.includes(file.name.split(" - ")[0]);
      return [...q.matchAll(/key='([^']+)' and value='([^']+)'/g)].every(([,k,v]) => file.appProperties?.[k] === v);
    }).map(({file}) => clone(file)) } }),
    get: async ({ fileId }) => ({ data: clone(files.get(fileId)?.record) }),
    update: async ({ fileId, media }) => { files.get(fileId).record = JSON.parse(media.body); return {data:{id:fileId}}; },
    create: async ({ requestBody, media }) => {
      const file = { ...requestBody, id: `file-${++counter}`, createdTime: "2026-09-10T00:00:00Z" };
      files.set(file.id, {file, record:JSON.parse(media.body)}); return {data:{id:file.id}};
    }
  }};
  const store = {
    assertScheduleAvailable: async () => {},
    availableSlotsForPackage: async () => [{value:"2030-10-20T09:00:00-04:00",date:"2030-10-20",time:"09:00",label:"Oct 20 at 9:00 AM"}],
    getBooking: async id => clone(bookings.get(id)),
    updateBookingEstimate: async (id, estimate) => { bookings.get(id).estimate = clone(estimate); },
    updateBooking: async (id, changes) => { bookings.set(id, {...bookings.get(id),...clone(changes)}); },
    createBooking: async record => {
      for (const key of requiredBookingText) assert.equal(typeof record[key], "string", `${key} must satisfy bookings NOT NULL`);
      if (record.sqft !== undefined) assert(Number.isInteger(record.sqft) && record.sqft >= 0);
      assert(!bookings.has(record.id), "No duplicate booking"); bookings.set(record.id, clone(record));
    },
    makeUniqueOrderNumber: async () => "ORDER-TEST",
    toZonedIso: (date, time) => `${date}T${time}:00-04:00`
  };
  const fetch = async (url, options) => {
    if (failedStripe) return {ok:false,json:async()=>({error:{message:"Stripe unavailable"}})};
    if (options.method === "GET") {
      const id = url.match(/sessions\/([^/?]+)$/)?.[1];
      return {ok:true,json:async()=>id ? clone(sessions.find(s => s.id === id)) : ({data:clone(sessions),has_more:false})};
    }
    const id = url.match(/sessions\/([^/]+)\/expire/)?.[1];
    assert(id, "Only session expiration is allowed in these tests");
    const session = sessions.find(s => s.id === id); assert(session);
    if (session.status !== "open") return {ok:false,json:async()=>({error:{message:"Session is not open"}})};
    session.status = "expired"; return {ok:true,json:async()=>clone(session)};
  };
  const module = {exports:{}};
  const dependencies = {
    "../booking/_discount": require('../api/booking/_discount'),
    "./_quotes": require('../api/crm/_quotes'),
    "../booking/_calendar": { expireBookingCheckout: async () => {} },
    "../quote/_shared": { getGoogleClients: () => ({drive,config:{parentFolderId:"test-parent"}}) },
    "../booking/_shared": store,
    "../quote/_short-approval": { createShortApproval: async () => ({code:`test${String(++codes).padStart(8,"0")}`,expiresAt:Date.now()+90*86400000}) },
    "../quote/_photo-later": { cancelPhotoUploadReminders: async () => { cancelled++; return []; } },
    "../booking/_saved-quote": {validateAndPrice: require('../api/booking/_saved-quote').validateAndPrice, assertQuoteUnused: async () => {}, decodeSavedQuote: token => {assert.equal(token,"VALID");return {quoteId:"SAVED-1"};}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../api/crm/_quote-admin.js"),"utf8"), {
    require: name => dependencies[name] || require(name), module, exports:module.exports,
    process:{env:{STRIPE_SECRET_KEY:"sk_test_mock"}}, fetch, Buffer, URLSearchParams, Date: clock, console, AbortSignal
  });
  return { api:module.exports, files, bookings, sessions, add, setFailure:value=>{failedStripe=value;}, get codes(){return codes;}, get cancelled(){return cancelled;} };
}

const fields = () => ({customerName:"Jane Example",email:"jane@example.test",phone:"+12125550123",address:"123 Example St, NY",service:"Deep Cleaning",amountCents:40000,rushFeeCents:0,serviceDate:"2030-09-15",serviceTime:"09:00",laborHours:5,cleanerCount:2,details:"Kitchen and living room",internalNotes:"Internal only",submittedFields:[{name:"Rooms",value:"2"}]});
const rejectsStatus = (promise, code) => assert.rejects(promise, e => e.statusCode === code);
async function edit(f, source, id, values = fields()) { const current = await f.api.load(source,id); return f.api.saveEdit({source,id,version:current.version,fields:values}); }

module.exports = { fixture, fields };
if (require.main === module) (async () => {
  const f = fixture(); f.add("custom_quote","QUOTE-1",{quoteId:"QUOTE-1",createdAt:"2026-09-10T00:00:00Z",formFields:{Email:"original@example.test"}});
  assert.equal(f.api.validateFields(fields()).amountCents,40000);
  for (const invalid of [{amountCents:-1},{amountCents:1},{serviceDate:"2030-99-99"},{serviceTime:"25:00"},{cleanerCount:0},{rushFeeCents:10},{submittedFields:[{name:"",value:"x"}]}]) {
    assert.throws(()=>f.api.validateFields({...fields(),...invalid}),e=>e.statusCode===400);
  }
  const oldVersion = (await f.api.load("custom","QUOTE-1")).version;
  f.sessions.push({id:"cs_old",status:"open",metadata:{quote_id:"QUOTE-1"}});
  const result = await edit(f,"custom","QUOTE-1");
  assert.match(result.approvalUrl,/\/q\/[\w-]{12}$/); assert(!result.approvalUrl.includes("token="));
  assert.equal(f.sessions[0].status,"expired"); assert.equal(f.bookings.size,0,"Saving a custom quote does not book or charge");
  await rejectsStatus(f.api.saveEdit({source:"custom",id:"QUOTE-1",version:oldVersion,fields:fields()}),409);
  let offer = await f.api.resolveManaged({quoteId:"QUOTE-1",amountCents:10000});
  assert.equal(offer.amountCents,40000); assert.equal(offer.description,"Kitchen and living room"); assert.equal(offer.internalNotes,undefined); assert.equal(offer.submittedFields,undefined);
  const changed = await edit(f,"custom","QUOTE-1",{...fields(),amountCents:55000});
  assert.equal(changed.approvalUrl,result.approvalUrl); assert.equal(f.codes,1);
  await rejectsStatus(f.api.ensureManagedBooking(offer),409);
  offer = await f.api.resolveManaged({quoteId:"QUOTE-1"});
  const linked = await f.api.ensureManagedBooking(offer);
  assert.equal(f.bookings.size,1); assert.equal(f.bookings.get(linked.bookingId).estimate.payment.depositCents,13750);
  assert.equal(f.bookings.get(linked.bookingId).bedrooms_label, "");
  assert.equal(f.bookings.get(linked.bookingId).bathrooms_label, "");
  await f.api.ensureManagedBooking(offer); assert.equal(f.bookings.size,1);
  const record = await f.api.load("custom","QUOTE-1");
  assert.equal(record.record.formFields.Email,"jane@example.test"); assert.equal(record.record.originalFormFields.Email,"original@example.test");
  const session = {id:"cs_current",status:"open",metadata:{quote_id:"QUOTE-1",quote_revision:offer.revision},url:"https://checkout.stripe.test/test"}; f.sessions.push(session);
  assert.equal((await f.api.currentCheckout(linked)).session.id,session.id);
  await edit(f,"custom","QUOTE-1",{...fields(),amountCents:60000});
  assert.equal(session.status,"expired");
  f.sessions.push({id:"cs_race",status:"open",metadata:{quote_id:"QUOTE-1",quote_revision:offer.revision}});
  await rejectsStatus(f.api.guardCheckout(offer,{id:"cs_race"}),409); assert.equal(f.sessions.at(-1).status,"expired");
  f.sessions.push({id:"cs_paid",status:"complete",payment_status:"paid",metadata:{quote_id:"QUOTE-1"}});
  await rejectsStatus(edit(f,"custom","QUOTE-1",{...fields(),amountCents:90000}),409);
  assert.equal((await f.api.load("custom","QUOTE-1")).state.fields.amountCents,60000,"A received payment blocks price overwrite");
  f.sessions.pop(); f.setFailure(true);
  await rejectsStatus(edit(f,"custom","QUOTE-1"),502); f.setFailure(false);
  assert(!((await f.api.load("custom","QUOTE-1")).state.updating));
  assert.equal((await f.api.load("custom","QUOTE-1")).state.fields.amountCents,60000);
  let current = await f.api.load("custom","QUOTE-1");
  await rejectsStatus(f.api.deleteQuote({source:"custom",id:"QUOTE-1",version:current.version,confirmation:"wrong"}),400);
  f.sessions.push({id:"cs_balance",status:"open",metadata:{booking_id:linked.bookingId,payment_type:"remaining_balance"}});
  await f.api.deleteQuote({source:"custom",id:"QUOTE-1",version:current.version,confirmation:"QUOTE-1"});
  assert.equal(f.sessions.at(-1).status,"open","Deleting the quote retains separate balance collection");
  assert.equal(f.cancelled,1); assert.equal(f.bookings.size,1,"Deleting a quote never deletes the booking");
  await rejectsStatus(f.api.resolveManaged({quoteId:"QUOTE-1"}),410);
  current = await f.api.load("custom","QUOTE-1"); await f.api.restoreQuote({source:"custom",id:"QUOTE-1",version:current.version});
  assert.equal((await f.api.resolveManaged({quoteId:"QUOTE-1"})).amountCents,60000);

  f.add("saved_quote","SAVED-1",{quoteId:"SAVED-1",createdAt:Date.now(),customer:{firstName:"Jane",email:"jane@example.test"}});
  assert.equal(await f.api.checkSavedCheckout("VALID"),"SAVED-1");
  f.sessions.push({id:"cs_saved",status:"open",metadata:{saved_quote_id:"SAVED-1",booking_id:"OTHER"}});
  await edit(f,"saved","SAVED-1"); assert.equal(f.sessions.at(-1).status,"expired");
  await rejectsStatus(f.api.checkSavedCheckout("VALID"),409);
  f.sessions.push({id:"cs_saved_race",status:"open",metadata:{saved_quote_id:"SAVED-1"}});
  await rejectsStatus(f.api.checkSavedCheckout("VALID",{id:"cs_saved_race"}),409); assert.equal(f.sessions.at(-1).status,"expired");

  f.bookings.set("BK-1",{id:"BK-1",created_at:"2026-09-10",estimate:{payment:{status:"deposit_pending",balanceCollection:"automatic_48h_authorization"},units:[{price:20}]}});
  await edit(f,"booking","BK-1",{...fields(),amountCents:45000});
  assert.equal(f.bookings.get("BK-1").estimate.payment.totalCents,45000); assert.equal(f.bookings.get("BK-1").client_name,"Jane Example");
  assert.equal(f.bookings.get("BK-1").estimate.payment.balanceCollection,"automatic_48h_authorization");
  f.bookings.get("BK-1").estimate.payment.paidCents=11250;
  await rejectsStatus(edit(f,"booking","BK-1"),409);

  const file = {id:"legacy-folder",name:"QUOTE-LEGACY - Old Customer",createdTime:"2026-09-10",mimeType:"application/vnd.google-apps.folder"};
  f.files.set(file.id,{file,record:null});
  await edit(f,"legacy","QUOTE-LEGACY");
  assert.equal((await f.api.load("custom","QUOTE-LEGACY")).state.fields.amountCents,40000);
  assert(f.files.has("legacy-folder"),"Legacy folder is preserved");

  const custom = fixture();
  custom.add("custom_quote", "QUOTE-UNITS", {quoteId:"QUOTE-UNITS",createdAt:"2026-09-10",formFields:{"Service Type":"Deep cleaning"}});
  const units = [
    {name:"Apartment 1",items:[{name:"Bedrooms",quantity:2,unitPriceCents:5000},{name:"Bathroom",quantity:1,unitPriceCents:5000},{name:"Kitchen",quantity:1,unitPriceCents:5000}]},
    {name:"Apartment 2",items:[{name:"Living room",quantity:1,unitPriceCents:4000},{name:"Dining room",quantity:1,unitPriceCents:3000},{name:"Inside refrigerator",quantity:1,unitPriceCents:3000,kind:"addon"}]}
  ];
  const values = {...fields(),units,amountCents:30663,discountCents:2000,discountLabel:"First-time customer discount",cleanerCount:3,laborHours:9};
  const savePayment = async changes => custom.api.saveEdit({source:"custom",id:"QUOTE-UNITS",version:(await custom.api.load("custom","QUOTE-UNITS")).version,operation:"payment_link",fields:{...values,...changes}});
  for (const invalid of [{email:""},{serviceTime:""},{address:"ZIP 11432"},{cleanerCount:0},{laborHours:0},{amountCents:30664},{discountCents:99999},{discountLabel:"x".repeat(161)}]) await rejectsStatus(savePayment(invalid),400);
  for (const invalid of [[{name:"",items:units[0].items}],[{name:"Unit",items:[]}],[{name:"Unit",items:[{name:"Room",quantity:-1,unitPriceCents:100}]}],[{name:"Unit",items:[{name:"Room",quantity:1,unitPriceCents:1.5}]}]]) assert.throws(()=>custom.api.validateUnits(invalid));
  assert.equal(custom.codes,0,"Invalid drafts never create payable links");
  const noUnits = fixture();
  noUnits.add("custom_quote", "QUOTE-NO-UNITS", {quoteId:"QUOTE-NO-UNITS",createdAt:"2026-09-10",formFields:{"Service Type":"Deep cleaning"}});
  const noUnitFound = await noUnits.api.load("custom", "QUOTE-NO-UNITS");
  const noUnitResult = await noUnits.api.saveEdit({source:"custom",id:"QUOTE-NO-UNITS",version:noUnitFound.version,operation:"payment_link",fields:{...fields(),units:[],amountCents:30663,cleanerCount:3,laborHours:9}});
  assert(noUnitResult.paymentReady);assert.match(noUnitResult.approvalUrl,/\/q\/[\w-]{12}$/,"Unit information is optional when the manual total and required booking details are present");
  const unscheduled = fixture();
  unscheduled.add("custom_quote", "QUOTE-UNSCHEDULED", {quoteId:"QUOTE-UNSCHEDULED",createdAt:"2026-09-10",formFields:{"Service Type":"Deep cleaning"}});
  const unscheduledFound = await unscheduled.api.load("custom", "QUOTE-UNSCHEDULED");
  const unscheduledResult = await unscheduled.api.saveEdit({source:"custom",id:"QUOTE-UNSCHEDULED",version:unscheduledFound.version,operation:"payment_link",fields:{...fields(),serviceDate:"",serviceTime:""}});
  assert(unscheduledResult.paymentReady);assert.match(unscheduledResult.approvalUrl,/\/q\/[\w-]{12}$/,"A custom quote can be paid before its appointment is scheduled");
  const unscheduledQuote = await unscheduled.api.resolveManaged({quoteId:"QUOTE-UNSCHEDULED"});
  assert.equal(unscheduledQuote.serviceDate,"");assert.equal(unscheduledQuote.serviceTime,"");
  const selectedQuote = await unscheduled.api.selectCustomerSchedule(unscheduledQuote,"2030-10-20T09:00:00-04:00");
  assert.equal(selectedQuote.serviceDate,"2030-10-20");assert.equal(selectedQuote.serviceTime,"09:00");
  const unscheduledManaged = await unscheduled.api.ensureManagedBooking(selectedQuote);
  const unscheduledBooking = unscheduled.bookings.get(unscheduledManaged.bookingId);
  assert.match(unscheduledBooking.schedule,/2030-10-20/);assert.match(unscheduledBooking.schedule_label,/2030-10-20/);
  assert.equal(unscheduledBooking.estimate.awaitingSchedule,false);
  const prepared = await savePayment({});
  assert(prepared.paymentReady);assert.match(prepared.approvalUrl,/\/q\/[\w-]{12}$/);assert(!prepared.approvalUrl.includes("token="));
  assert.equal(custom.bookings.size,0,"Preparing a link is not a booking or a charge");
  let publicQuote = await custom.api.resolveManaged({quoteId:"QUOTE-UNITS"});
  assert.equal(publicQuote.pricing.subtotalCents,30000);assert.equal(publicQuote.pricing.taxCents,2663);
  assert.equal(publicQuote.pricing.discountCents,2000);assert.equal(publicQuote.pricing.discountLabel,"First-time customer discount");
  assert.equal(publicQuote.amountCents,30663);assert.equal(publicQuote.pricing.totalCents,30663);
  assert.equal(publicQuote.units[0].subtotalCents,20000);assert.equal(publicQuote.units[1].subtotalCents,10000);
  assert.equal(publicQuote.balanceCollection,"automatic_48h_authorization");
  assert.equal(publicQuote.laborHours,9,"Price must not recalculate manually chosen hours");
  assert.equal(publicQuote.cleanerCount,3);assert.equal(publicQuote.internalNotes,undefined);
  const managed = await custom.api.ensureManagedBooking(publicQuote);
  const booked = custom.bookings.get(managed.bookingId);
  assert.equal(booked.bedrooms_label,"2 bedrooms");assert.equal(booked.bathrooms_label,"1 bathroom");
  assert.equal(booked.sqft,0,"Unknown custom-quote area uses the existing storage default, not an invented size");
  assert.equal(booked.estimate.payment.depositCents,7666);assert.equal(booked.estimate.payment.remainingCents,22997);
  assert.equal(booked.estimate.subtotal,300);assert.equal(booked.estimate.tax,26.63);assert.equal(booked.estimate.total,306.63);
  assert.equal(booked.estimate.teamHours,3);assert.equal(booked.estimate.customQuotePricing.discountLabel,values.discountLabel);
  assert.equal(booked.estimate.units[1].addOns[0].label,"1 × Inside refrigerator");
  await savePayment({amountCents:32663,discountCents:0});
  publicQuote = await custom.api.resolveManaged({quoteId:"QUOTE-UNITS"});
  assert.equal(publicQuote.laborHours,9);assert.equal(publicQuote.amountCents,32663);
  const rush = custom.api.unitPricing(custom.api.validateUnits(units),2000,10000);
  assert.equal(rush.taxCents,3550);assert.equal(rush.totalCents,41550,"Tax adds to all charges, then dollar discount is deducted");
  booked.estimate.payment.paidCents=7666;
  custom.bookings.set(managed.bookingId,booked);
  await rejectsStatus(savePayment({}),409);
  console.log("Custom payment links: per-unit prices, add-ons, 8.875% added tax, named after-tax discount, manual crew/hours, exact deposit/balance and paid-booking protection passed.");
  console.log("CRM quote editor: validation, revisions, stable links, payment protection, expiration, saved quotes, booking updates, soft-delete/restore, legacy records passed.");
})().catch(error=>{console.error(error);process.exitCode=1;});
