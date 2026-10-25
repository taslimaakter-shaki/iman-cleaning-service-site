const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const admin = require('../api/crm/_quote-admin');
const shared = require('../api/quote/_shared');
const communications = require('../api/crm/_communications');
const receipts = require('../api/quote/_photo-later');
const original = { load:admin.load, google:shared.getGoogleClients, sms:communications.sendCustomerMessage, email:receipts.sendWalkthroughEmail, fetch:global.fetch };
const clone = value => JSON.parse(JSON.stringify(value));
const apiError = status => Object.assign(new Error('Mock failure'), { code:status });
let files, sent, sequence, writes, mode, record;
function reset(options={}) {
  files = new Map(); sent = []; sequence = 0; writes = 0; mode = options;
  record = {quoteId:'QUOTE-WALKTHROUGH',type:'custom_quote',createdAt:'2026-09-11T16:00:00Z',walkthroughConfirmationFileId:'reserved-confirmation',
    formFields:{'Request Type':'Commercial walkthrough','Full Name':'Sample Customer',Email:'customer@example.com',Phone:'+12125550101',
      'Street Address':'123 Example St',City:'Brooklyn',State:'NY','ZIP Code':'11201','Preferred Walkthrough Date':'2099-09-12','Preferred Walkthrough Time':'','Walkthrough Notes':'Floors and restrooms'}};
}
const drive = {files:{
  async generateIds({count}) {return {data:{ids:Array.from({length:count},()=>`reserved-${++sequence}`)}};},
  async get({fileId}) {if(mode.readFails) throw apiError(503); if(!files.has(fileId)) throw apiError(404); return {data:clone(files.get(fileId))};},
  async create(params, options) {
    assert.equal(options.retry,false); const id=params.requestBody.id;
    assert.equal(params.requestBody.parents[0],'parent');
    if(files.has(id)) throw apiError(409);
    const data=JSON.parse(params.media.body);
    if(mode.claimFails && data.channel==='sms') throw apiError(503);
    if(mode.createFails) throw apiError(503);
    files.set(id,data); writes++;
    // Simulate a lost successful-create response: the stored claim must prevent a retry.
    if(mode.createResponseLost && data.channel==='sms') throw apiError(503);
    return {data:{id}};
  },
  async update(params) {
    const data=JSON.parse(params.media.body);
    if(mode.trackingFails && data.channel==='sms') throw apiError(503);
    files.set(params.fileId,data); writes++; return {data:{id:params.fileId}};
  }
}};
admin.load = async (source,id) => {
  assert.equal(source,'custom'); if(id!==record.quoteId) throw Object.assign(new Error('Not found'),{statusCode:404});
  return {record:clone(record),version:admin.version(record),drive};
};
shared.getGoogleClients = () => ({drive,config:{parentFolderId:'parent'}});
communications.sendCustomerMessage = async body => {
  sent.push({channel:'sms',to:body.phone,content:body.message});
  if(mode.smsFails) throw apiError(400);
  if(mode.smsUnknown) throw new Error('Mock network timeout');
  return {messageId:'SM-MOCK'};
};
receipts.sendWalkthroughEmail = async (to,content) => {sent.push({channel:'email',to,content}); if(mode.emailFails) throw apiError(400); return {status:'sent',messageId:'EMAIL-MOCK'};};
global.fetch = async () => {throw new Error('No real network permitted in this test');};
const walkthroughs = require('../api/crm/_walkthroughs');
const {customizedQuote} = require('../api/crm/_quotes');
const handler = require('../api/crm/[action]');
const payload = (changes={}) => ({id:record.quoteId,version:admin.version(record),date:'2099-09-15',time:'10:30',...changes});
async function route(body,token='mock-admin',method='POST') {
  const req=Readable.from([JSON.stringify(body)]); req.method=method;req.query={action:'walkthroughs'};req.headers={'x-admin-token':token};
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(data){this.body=JSON.parse(data);}};
  await handler(req,res);return res;
}
const tokenBefore = process.env.ADMIN_TOKEN;
(async()=>{
  process.env.ADMIN_TOKEN='mock-admin'; reset();
  assert.equal((await route(payload(),'wrong')).statusCode,401);assert.equal(writes,0);assert.equal(sent.length,0);
  assert.equal((await route(payload(),'mock-admin','GET')).statusCode,405);
  assert.equal((await route(payload({version:'stale'}))).statusCode,409);
  for(const changes of [{date:''},{time:''},{date:'2000-01-01'},{date:'2099-02-30'},{time:'25:00'}]) {
    assert.equal((await route(payload(changes))).statusCode,400);
  }
  assert.equal(writes,0);assert.equal(sent.length,0);
  const initial=customizedQuote(record,{});
  assert.equal(initial.type,'Walkthrough request');assert.equal(initial.walkthrough.preferredTime,'');assert.equal(initial.walkthrough.confirmation,null);
  assert.equal(initial.address,'123 Example St, Brooklyn, NY, 11201');
  assert.throws(()=>walkthroughs.validateVisit('2027-03-14','02:30',new Date('2026-01-01')),/daylight-saving/);
  assert.throws(()=>walkthroughs.validateVisit('2027-11-07','01:30',new Date('2026-01-01')),/daylight-saving/);
  walkthroughs.validateVisit('2027-11-07','03:30',new Date('2026-01-01'));
  record.crmQuote={deletedAt:'2026-09-11'};assert.equal((await route(payload())).statusCode,404);delete record.crmQuote;
  record.formFields['Request Type']='Residential';assert.equal((await route(payload())).statusCode,404);reset();
  const result=await route(payload());assert.equal(result.statusCode,200);assert.equal(result.headers['Cache-Control'],'no-store');
  assert.equal(result.body.request.status,'Walkthrough confirmed');
  assert.equal(result.body.request.walkthrough.confirmation.date,'2099-09-15');
  assert.equal(result.body.request.walkthrough.confirmation.time,'10:30');
  assert.equal(sent.length,2);assert.equal(sent[0].to,'+12125550101');assert.equal(sent[1].to,'customer@example.com');
  assert.match(sent[0].content,/10:30 AM \(New York time\)/);assert.match(sent[0].content,/123 Example St/);
  assert.doesNotMatch(sent[0].content,/paid|deposit|payment|2099-09-12/);
  assert.equal(record.formFields['Preferred Walkthrough Time'],'','Never overwrite customer preferences');
  await route(payload());assert.equal(sent.length,2,'Retry must not duplicate either message');
  assert.equal((await route(payload({time:'11:00'}))).statusCode,409);assert.equal(sent.length,2);
  reset();const concurrent=await Promise.all([route(payload()),route(payload())]);assert.ok(concurrent.every(r=>r.statusCode===200));assert.equal(sent.length,2,'Concurrent requests claim each channel once');
  reset();const different=await Promise.all([route(payload()),route(payload({time:'11:00'}))]);assert.deepEqual(different.map(r=>r.statusCode).sort(),[200,409]);assert.equal(sent.length,2);
  for(const [options,expected] of [[{smsFails:true},'failed'],[{smsUnknown:true},'unknown'],[{trackingFails:true},'sending'],[{createResponseLost:true},'sending']]) {
    reset(options); const first=await route(payload());assert.equal(first.statusCode,200);
    assert.equal(first.body.request.walkthrough.confirmation.sms.status,expected);
    assert.equal(first.body.request.walkthrough.confirmation.email.status,'sent');
    const count=sent.length;mode={};await route(payload());assert.equal(sent.length,count,'Never retry an attempted/uncertain send');
  }
  reset({claimFails:true});let partial=await route(payload());assert.equal(partial.body.request.walkthrough.confirmation.sms.status,'pending');assert.equal(sent.length,1);
  mode={};await route(payload());assert.equal(sent.length,2);assert.equal(sent.filter(x=>x.channel==='email').length,1,'Only resume unclaimed channels');
  reset({createFails:true});assert.equal((await route(payload())).statusCode,500);assert.equal(sent.length,0);
  reset();delete record.walkthroughConfirmationFileId;assert.equal((await route(payload())).statusCode,409);assert.equal(sent.length,0);
  const email=walkthroughs.content({name:'<img onerror=x>',address:'A & B',date:'2099-09-15',time:'13:05',quoteId:'QUOTE-TEST'});
  assert.match(email.html,/&lt;img onerror=x&gt;/);assert.doesNotMatch(email.html,/<img/);assert.match(email.text,/1:05 PM/);
  console.log('Walkthrough CRM tests passed: admin-only confirmation, final date/time, correct recipients, persisted statuses, concurrent deduplication, safe failures and no real messages.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
  admin.load=original.load;shared.getGoogleClients=original.google;communications.sendCustomerMessage=original.sms;receipts.sendWalkthroughEmail=original.email;global.fetch=original.fetch;
  if(tokenBefore===undefined) delete process.env.ADMIN_TOKEN;else process.env.ADMIN_TOKEN=tokenBefore;
});
