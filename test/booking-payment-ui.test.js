const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('booking-payment.js','utf8'),html=fs.readFileSync('booking-payment.html','utf8');
assert.match(html,/https:\/\/js.stripe.com\/v3\//);assert.match(html,/name="referrer" content="no-referrer"/);assert.match(html,/id="consent" required/);
async function fixture(mode){
 const events={},nodes=new Map(),calls=[],redirects=[];let statusCalls=0,cardActions=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,addEventListener:(event,fn)=>events[id+':'+event]=fn});return nodes.get(id);};
 const data={status:'draft',publishableKey:'pk_test_mock',amount:8000,total:32000,service:'Cleaning',scheduleLabel:'12:30 PM',paymentTerms:'Agreed payment terms'};
 vm.runInNewContext(source,{document:{getElementById:node},location:{hash:'#testtoken',replace:url=>redirects.push(url),assign:url=>redirects.push(url)},Intl,console,
  Stripe:key=>{assert.equal(key,'pk_test_mock');return{elements:opts=>{assert.equal(opts.amount,8000);return{create:()=>({mount:selector=>assert.equal(selector,'#payment-element')}),submit:async()=>({})};},createConfirmationToken:async()=>({confirmationToken:{id:'ctoken_mock'}}),handleNextAction:async()=>{cardActions++;return{};}};},
  fetch:async(url,options)=>{assert.equal(url,'/api/booking/deposit-payment');const body=JSON.parse(options.body);calls.push(body.action);assert.equal(body.token,'testtoken');
   let value=data,ok=true;
   if(body.action==='pay'){assert.equal(body.confirmationToken,'ctoken_mock');if(mode==='decline'){ok=false;value={error:'Card declined'};}else if(mode==='unknown')throw Error('Network unavailable');else value={...data,status:'requires_action',clientSecret:'pi_mock_secret'};}
   if(body.action==='status'){statusCalls++;if(mode==='unknown')throw Error('Still unavailable');value={...data,status:mode==='decline'?'cancelled':'paid',confirmationUrl:'/booking-confirmed.html?session_id=bp_test'};}
   return{ok,json:async()=>value};}
 });
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['load'],'Opening payment only reads the draft');assert.equal(node('pay').disabled,false);assert.equal(node('amount').textContent,'$80.00');
 await Promise.all([events['payment-form:submit']({preventDefault(){}}),events['payment-form:submit']({preventDefault(){}})]);
 assert.equal(calls.filter(x=>x==='pay').length,1,'Repeated clicks cannot submit two payments');
 if(mode==='success'){assert.equal(cardActions,1);assert.deepEqual(redirects,['/booking-confirmed.html?session_id=bp_test']);assert.equal(node('pay').disabled,true);}
 if(mode==='decline'){assert.equal(node('pay').disabled,false);assert.match(node('message').textContent,/Card declined/);}
 if(mode==='unknown'){assert.equal(node('pay').disabled,true);assert.match(node('message').textContent,/could not verify/);assert.equal(node('status').disabled,false);}
}
(async()=>{await fixture('success');await fixture('decline');await fixture('unknown');console.log('Payment UI: read-only opening, exact deposit, repeated-click guard, bank verification, confirmed redirect, declined retry and unknown-payment protection passed.');})().catch(e=>{console.error(e);process.exitCode=1;});
