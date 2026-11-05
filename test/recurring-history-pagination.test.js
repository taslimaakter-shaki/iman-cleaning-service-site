const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {createRequire} = require('node:module');
const old = {id:'old-paid',status:'Completed',schedule:'2026-10-01T08:00:00-04:00',email:'customer@example.test',estimate:{orderNumber:'12345678',payment:{status:'paid',paidCents:12000}}};
const records = Array.from({length:500},(_,i)=>({id:'other-'+i,status:'Completed',email:'other@example.test',estimate:{}})).concat(old);
let offsets=[];
function load(file, overrides={}, extras={}) {
 const filename=path.resolve('api/booking',file), local=createRequire(filename), module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,Buffer,URL,URLSearchParams,Date,Intl,process:{env:{SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'fixture'}},require:n=>overrides[n]||local(n),...extras},{filename});
 return module.exports;
}
(async()=>{
 const shared=load('_shared.js',{}, {fetch:async url=>{
  const offset=Number(new URL(url).searchParams.get('offset')); offsets.push(offset);
  return {ok:true,text:async()=>JSON.stringify(records.slice(offset,offset+500))};
 }});
 const handler=load('_recurring-discount.js',{'./_shared':{...shared,readJsonBody:async r=>r.body,json:(_,status,data)=>({status,data})}});
 const body={previousOrderNumber:'12345678',recurringPlan:'weekly',schedule:'2026-10-10T08:00:00-04:00',customer:{email:old.email}};
 for(const lookupOnly of [true,false]) {
  offsets=[];
  const result=await handler({method:'POST',body:{...body,lookupOnly}},{});
  assert.equal(result.status,200,result.data.error);assert.equal(result.data.percent,20);
  assert.deepEqual(offsets,[0,500]); assert.equal(result.data.windowStart,'2026-10-08');
 }
 const mismatch=await handler({method:'POST',body:{...body,customer:{email:'wrong@example.test'}}},{});
 assert.equal(mismatch.data.code,'RECURRING_CUSTOMER_MISMATCH');
 const missing=await handler({method:'POST',body:{...body,previousOrderNumber:'missing'}},{});
 assert.equal(missing.data.code,'RECURRING_ORDER_NOT_FOUND');
 const source=fs.readFileSync('api/booking/_checkout.js','utf8');
 assert.match(source,/recurring\.verifyRecurringDiscount\(await listAllBookings\(\{ complete: true \}\)/);
 console.log('Recurring history: order 501 verifies through both API paths; full-history checkout and identity checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
