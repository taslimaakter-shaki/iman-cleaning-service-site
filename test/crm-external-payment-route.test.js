const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve('api/crm');let result,calls=[];
const shared=require('../api/booking/_shared');const moduleMock={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(base,'[action].js'),'utf8'),{module:moduleMock,exports:moduleMock.exports,process:{env:{ADMIN_TOKEN:'test-only'}},URL,Date,Intl,console,
 require:name=>name==='../booking/_shared'?{...shared,json:(_,status,body)=>{result={status,body};},readJsonBody:async r=>r.body}:name==='./_external-payment'?{resolve:async body=>{calls.push(body);return {mock:true};},summary:x=>x,record:async body=>{calls.push(body);return {ok:true};}}:name.startsWith('.')?require(path.resolve(base,name)):require(name)});
const handler=moduleMock.exports;
(async()=>{
 const request={query:{action:'external-payment'},method:'POST',headers:{host:'example.test'},body:{operation:'record'}};
 const response={setHeader(){}};
 await handler(request,response);assert.equal(result.status,401);assert.equal(calls.length,0);
 request.headers['x-admin-token']='test-only';request.headers.origin='https://evil.test';await handler(request,response);assert.equal(result.status,403);assert.equal(calls.length,0);
 request.headers.origin='https://example.test';request.method='GET';await handler(request,response);assert.equal(result.status,405);assert.equal(calls.length,0);
 request.method='POST';request.body.operation='preview';await handler(request,response);assert.equal(result.status,200);assert.equal(calls.length,1);
 request.body.operation='record';await handler(request,response);assert.equal(result.status,200);assert.equal(calls.length,2);
 request.body.operation='anything';await handler(request,response);assert.equal(result.status,400);assert.equal(calls.length,2);
 console.log('External payment API: admin authentication, same-origin checks, POST-only, preview and record routing passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
