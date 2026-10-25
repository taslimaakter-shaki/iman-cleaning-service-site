const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const clone=x=>JSON.parse(JSON.stringify(x));
const load=(file,deps)=>{const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{module,require:key=>{assert(key in deps,key);return deps[key];},Date,Set,Number});return module.exports;};
(async()=>{
 const records=[{id:'paid',status:'Confirmed',schedule:'2030-09-12T08:00:00-04:00',estimate:{teamHours:9,payment:{paidCents:100}},email:'customer@example.test'},
 {id:'unpaid',status:'New',schedule:'2030-09-12T08:00:00-04:00'},
 {id:'cancelled',status:'Cancelled',schedule:'2030-09-12T08:00:00-04:00'},
 {id:'past',status:'Confirmed',schedule:'2020-09-12T08:00:00-04:00'}];
 const originals=JSON.stringify(records),events=new Set(),calls=[];
 const store={supabaseRequest:async query=>{assert(query.includes('status=in.(Confirmed,Cleaner%20assigned,In%20progress)'));assert(query.includes('limit=11&offset=0'));return clone(records);},getBooking:async id=>clone(records.find(r=>r.id===id)),syncBookingToGoogleCalendar:async(b,options)=>{assert.equal(options.notifyCustomer,false);calls.push(b.id);const status=events.has(b.id)?'already_exists':'created';events.add(b.id);return {status,eventId:'event-'+b.id};},readJsonBody:async req=>req.body};
 const backfill=load('api/google-calendar/_backfill.js',{'../booking/_shared':store});
 for(const offset of [-1,'0',.5,100001])await assert.rejects(backfill.syncExistingBookings(offset));
 let result=await backfill.syncExistingBookings();assert.equal(result.results[0].status,'created');assert.equal(result.nextOffset,null);
 assert.deepEqual(calls,['paid']);assert.equal(result.results.filter(r=>r.status==='skipped').length,3);
 result=await backfill.syncExistingBookings();assert.equal(result.results[0].status,'already_exists');assert.equal(events.size,1);
 assert.equal(JSON.stringify(records),originals,'No booking, payment or customer fields modified');
 store.getBooking=async()=>{throw Error('Secret provider error');};
 result=await backfill.syncExistingBookings();assert(result.results.every(r=>r.status==='error'));assert(!JSON.stringify(result).includes('Secret'));
 store.supabaseRequest=async()=>Array.from({length:11},(_,i)=>({id:'x'+i}));
 result=await backfill.syncExistingBookings(20);assert.equal(result.nextOffset,30);assert.equal(result.results.length,10);
 const origin='https://www.imancleaningservice.com';let invoked=0;
 const handler=load('api/google-calendar/_handler.js',{'./_connection':{ORIGIN:origin,isAdmin:req=>req.headers['x-admin-token']==='test'},'../booking/_shared':store,'./_backfill':{syncExistingBookings:async offset=>{invoked++;return {offset};}}});
 async function request(method,headers={},body={}){const res={setHeader(){},end(text){this.body=JSON.parse(text);}};await handler({method,headers,query:{action:'calendar-sync'},body},res);return res;}
 assert.equal((await request('POST')).statusCode,401);
 assert.equal((await request('POST',{'x-admin-token':'test',origin:'https://evil.test'})).statusCode,403);
 assert.equal((await request('GET',{'x-admin-token':'test',origin})).statusCode,405);assert.equal(invoked,0);
 assert.equal((await request('POST',{'x-admin-token':'test',origin},{offset:10})).statusCode,200);assert.equal(invoked,1);
 console.log('Calendar backfill passed: future-confirmed only, re-read cancellation, no payments/booking writes, silent sync, duplicates, pagination, sanitized failures, admin/origin/method guards. Mock providers only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
