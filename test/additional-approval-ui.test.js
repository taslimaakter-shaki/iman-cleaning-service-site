const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../additional-work.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const draft={id:'00000000-0000-4000-8000-000000000001',revision:1,status:'draft',hours:1,minutes:30,totalMinutes:90,amountCents:12000,duration:'1 hour 30 minutes',card:'American Express ending in 1009',consent:'I approve 1 hour 30 minutes for $120.00 and authorize my American Express ending in 1009.'};
async function page(initial=null) {
 const nodes=new Map(),calls=[];
 function node(name){if(!nodes.has(name))nodes.set(name,{value:'0',hidden:false,checked:false,textContent:'',disabled:false,handlers:{},addEventListener(e,f){this.handlers[e]=f;}});return nodes.get(name);}
 const buttons=['approve','edit-button','card-button','check','retry','new','verify','resume'].map(node);
 const document={querySelector:q=>node(q.match(/data-([a-z-]+)/)[1]),querySelectorAll:()=>buttons};
 let active=initial;
 const location={pathname:'/additional-work.html',search:'?token=secret&payment_intent_client_secret=should-not-stay',assign:u=>calls.push({redirect:u})};
 const c={document,location,history:{replaceState:(_,__,s)=>{assert(!s.includes('client_secret'));}},URL,URLSearchParams,Intl,window:{},fetch:async(u,o)=>{
  const b=o?JSON.parse(o.body):null;calls.push({u,b});
  if(!b)return{ok:true,json:async()=>({bookingId:'MOCK',customerName:'Mock',service:'Cleaning',order:initial})};
  if(b.action==='prepare')active={...draft,hours:b.hours,minutes:b.minutes,amountCents:Math.round((b.hours*60+b.minutes)*8000/60)};
  if(b.action==='approve')active={...active,status:'paid',approvedAt:'2030-01-01',paidAt:'2030-01-01'};
  return{ok:true,json:async()=>({order:active})};
 }};
 vm.runInNewContext(source,c);await tick();await tick();
 const click=async name=>{await node(name).handlers.click();await tick();await tick();};
 const submit=async()=>{node('form').handlers.submit({preventDefault(){}});await tick();await tick();};
 return{node,calls,click,submit};
}
(async()=>{
 let p=await page();assert.equal(p.calls.length,1,'Load must never charge');
 await p.submit();assert.match(p.node('status').textContent,/at least 1 minute/);assert.equal(p.calls.length,1);
 p.node('hours').value='1';p.node('minutes').value='60';p.node('minutes').handlers.change();
 assert.equal(Number(p.node('hours').value),2);assert.equal(Number(p.node('minutes').value),0);assert.equal(p.node('total').textContent,'$160.00');
 await p.submit();assert.equal(p.calls.at(-1).b.action,'prepare');assert.equal(p.node('review').hidden,false);
 await p.click('approve');assert.match(p.node('status').textContent,/check the box/);assert(!p.calls.some(c=>c.b?.action==='approve'));
 p.node('consent').checked=true;await p.click('edit-button');assert.equal(p.node('consent').checked,false);
 p.node('minutes').value='30';await p.submit();assert.equal(p.node('consent').checked,false);
 p.node('consent').checked=true;
 p.node('approve').handlers.click();p.node('approve').handlers.click();await tick();await tick();
 assert.equal(p.calls.filter(c=>c.b?.action==='approve').length,1,'Busy guard blocks duplicate click');
 assert.match(p.node('result-text').textContent,/charged successfully/);assert.equal(p.node('new').hidden,false);
 p=await page({...draft,status:'paid',approvedAt:'2030-01-01'});assert.equal(p.calls.length,1,'Reload paid never starts another charge');
 await p.click('new');assert.equal(p.node('edit').hidden,false);assert.equal(p.calls.length,1);
 p=await page({...draft,status:'requires_action',approvedAt:'2030-01-01',error:'Bank verification required'});
 assert.equal(p.calls.filter(c=>c.b?.action==='status').length,1);assert(!p.calls.some(c=>c.b?.action==='approve'));
 assert.equal(p.node('retry').hidden,false);assert.match(p.node('result-text').textContent,/verification/);
 const {content}=require('../api/booking/_additional-notifications');
 const snapshot={id:draft.id,booking_id:'MOCK',total_minutes:90,amount_cents:12000,card_brand:'amex',card_last4:'1009',customer_name:'<Customer>'};
 const msg=content(snapshot,'requires_action');
 for(const text of [msg.sms,msg.text,msg.html]){assert.match(text,/1 hour 30 minutes/);assert.match(text,/\$120\.00/);assert.match(text,/American Express ending in 1009/);assert(!text.includes('charged successfully'));}
 assert.match(msg.html,/&lt;Customer&gt;/);assert.match(content(snapshot,'paid').text,/charged successfully/);
 console.log('Customer UI and confirmation copy passed: explicit consent, 60-minute normalization, no auto-charge, repeated-click guard, card privacy, 3DS messaging and email/SMS detail consistency.');
})().catch(e=>{console.error(e);process.exitCode=1;});
