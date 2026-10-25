const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require(process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite');
const root = path.join(__dirname, '..');
const clone = o => JSON.parse(JSON.stringify(o));
(async () => {
  const pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create table bookings(id text primary key,status text,estimate jsonb,client_name text,email text,phone text);");
  await pg.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260911_additional_work_approvals.sql'),'utf8'));
  const one = async (q, args = []) => (await pg.query(q,args)).rows[0] || null;
  const fail = (s,c=409) => Object.assign(new Error(s),{statusCode:c});
  const db = {
    fail, ORDERS:'iman_additional_work_orders', NOTICES:'iman_additional_work_notifications',
    get:(id,booking) => one('select * from iman_additional_work_orders where id=$1' + (booking ? ' and booking_id=$2' : ''),booking ? [id,booking] : [id]),
    latest:b=>one('select * from iman_additional_work_orders where booking_id=$1 order by created_at desc,id desc limit 1',[b]),
    rpc:async (name,p) => (await one('select '+name+'('+Object.keys(p).map((_,i)=>'$'+(i+1)).join(',')+') as o',Object.values(p).map(v=>typeof v==='object'?JSON.stringify(v):v))).o,
    patch:async (o,p,statuses=[o.status]) => {
      const keys=Object.keys(p),args=Object.values(p).concat([o.id,o.revision,statuses,o.payment_intent_id]);
      const n=keys.length;
      const row=await one('update iman_additional_work_orders set '+keys.map((k,i)=>k+'=$'+(i+1)).join(',')+' where id=$'+(n+1)+' and revision=$'+(n+2)+' and status=any($'+(n+3)+'::text[]) and payment_intent_id is not distinct from $'+(n+4)+' returning *',args);
      if(!row)throw fail('Request changed'); return row;
    },
    notices:async(id,rev)=>(await pg.query('select * from iman_additional_work_notifications where order_id=$1'+(rev?' and revision=$2':''),rev?[id,rev]:[id])).rows,
    claim:n=>one("update iman_additional_work_notifications set status='sending',attempted_at=now() where order_id=$1 and revision=$2 and channel=$3 and status='pending' returning *",[n.order_id,n.revision,n.channel]),
    finish:(n,r)=>pg.query("update iman_additional_work_notifications set status=$4,provider_id=$5 where order_id=$1 and revision=$2 and channel=$3 and status='sending'",[n.order_id,n.revision,n.channel,r.status,r.messageId||null])
  };
  let mode='succeeded', sent=[], calls=[], counter=0, deliveriesFail=false, createTimeout=false, confirmTimeout=false;
  const intents=new Map(), keys=new Map(), setups=new Map();
  const card=(id='pm_card')=>({id,type:'card',customer:'cus_test',card:{brand:id==='pm_new'?'amex':'visa',last4:id==='pm_new'?'1009':'4242'}});
  async function fetchMock(url,opt) {
    assert.match(url,/^https:\/\/api.stripe.com\/v1\//,'No real network is allowed');
    const route=url.split('/v1/')[1], p=Object.fromEntries(new URLSearchParams(opt.body||'')), key=opt.headers['Idempotency-Key'];
    calls.push({route,p,key});
    let obj;
    if(route.startsWith('payment_methods/')) obj=card(route.split('/')[1]);
    else if(route==='payment_intents') {
      if(key && keys.has(key)) obj=intents.get(keys.get(key));
      else {
        obj={id:'pi_'+(++counter),amount:Number(p.amount),currency:p.currency,customer:p.customer,payment_method:p.payment_method,status:'requires_confirmation',
          metadata:{payment_type:p['metadata[payment_type]'],parent_booking_id:p['metadata[parent_booking_id]'],additional_work_order_id:p['metadata[additional_work_order_id]'],approval_revision:p['metadata[approval_revision]']}};
        intents.set(obj.id,obj); keys.set(key,obj.id);
      }
      assert.equal(p.confirm,undefined);
      if(createTimeout){createTimeout=false;throw Error('timeout after create');}
    } else if(route.startsWith('payment_intents/')) {
      const id=route.split('/')[1]; obj=intents.get(id);assert(obj,'Only known intents');
      if(route.endsWith('/confirm')){
        const persisted=await db.get(obj.metadata.additional_work_order_id);
        assert.equal(persisted.payment_intent_id,id,'Intent must be persisted BEFORE charging');
        if(obj.status==='requires_confirmation'){
          obj.status=mode;
          if(mode==='succeeded')obj.amount_received=obj.amount;
          if(mode==='requires_action')obj.next_action={type:'redirect_to_url',redirect_to_url:{url:'https://hooks.stripe.com/test-verification'}};
        }
        if(confirmTimeout){confirmTimeout=false;throw Error('timeout after confirm');}
      }
      if(route.endsWith('/cancel'))obj.status='canceled';
    } else if(route==='checkout/sessions') {
      assert.equal(p.mode,'setup'); assert.equal(p.amount,undefined);
      obj={id:'cs_setup_'+(++counter),mode:'setup',customer:p.customer,status:'open',url:'https://checkout.stripe.com/setup',
        setup_intent:{status:'succeeded',customer:p.customer,payment_method:'pm_new',metadata:{additional_work_order_id:p['setup_intent_data[metadata][additional_work_order_id]'],approval_revision:p['setup_intent_data[metadata][approval_revision]']}}};
      setups.set(obj.id,obj);
    } else if(route.startsWith('checkout/sessions/'))obj=setups.get(route.split('/')[2].split('?')[0]);
    else throw Error('Unexpected Stripe operation '+route);
    return {ok:true,json:async()=>clone(obj)};
  }
  const mockRequire = name => {
    if(name==='./_additional-store')return db;
    if(name==='./_shared')return {json:(r,status,data)=>({status,data})};
    if(name==='./_additional-work')return {additionalWorkUrl:()=> 'https://www.imancleaningservice.com/additional-work.html?token=private'};
    if(name==='./_additional-notifications')return {send:async(n,status)=>{sent.push({n:clone(n),status});if(deliveriesFail&&n.channel==='email')throw Error('unknown delivery');return{status:'sent',messageId:n.channel+'_test'};}};
    throw Error('Unexpected dependency '+name);
  };
  const context={module:{exports:{}},require:mockRequire,process:{env:{STRIPE_SECRET_KEY:'sk_test_mock'}},fetch:fetchMock,URLSearchParams,AbortSignal,Buffer,Intl,Date,console};
  vm.runInNewContext(fs.readFileSync(path.join(root,'api/booking/_additional-approval.js'),'utf8'),context);
  const api=context.module.exports;
  for(const [h,m,total,cents] of [[0,1,1,133],[0,60,60,8000],[1,30,90,12000],[25,0,1500,200000],[0,59,59,7867]]) {
    const v=api.timeInput(h,m);assert.equal(v.totalMinutes,total);assert.equal(v.amountCents,cents);
  }
  for(const [h,m] of [[0,0],[-1,0],[1,61],[1,1.5],[true,2],[Infinity,0],[100000000,0],['',1]]) assert.throws(()=>api.timeInput(h,m));
  const booking=async(id,estimate={payment:{status:'paid',stripeCustomerId:'cus_test',paymentMethodId:'pm_card'}})=>{
    const b={id,status:'Completed',estimate,client_name:'Mock Customer',email:'test@example.invalid',phone:'+12025550100'};
    await pg.query('insert into bookings values($1,$2,$3,$4,$5,$6)',Object.values(b).map(v=>typeof v==='object'?JSON.stringify(v):v));return b;
  };
  const prepare=async b=>api.prepare(b,{hours:1,minutes:15});
  const b=await booking('B1'), original=JSON.stringify(await one("select * from bookings where id='B1'"));
  let o=await prepare(b);assert.equal(o.amount_cents,10000);assert.equal(calls.filter(c=>c.route==='payment_intents').length,0);
  await assert.rejects(prepare(b),/already exists/);
  await assert.rejects(api.approve(b,o,{revision:o.revision,accepted:false}),/authorize/);
  const results=await Promise.all([api.approve(b,o,{revision:o.revision,accepted:true}),api.approve(b,o,{revision:o.revision,accepted:true})]);
  assert(results.every(r=>r.order.status==='paid'));assert.equal(intents.size,1);assert.equal(sent.length,2);
  o=await db.get(o.id);await api.reconcile(o);await api.approve(b,o,{revision:o.revision,accepted:true});assert.equal(sent.length,2);assert.equal(intents.size,1);
  assert.equal(JSON.stringify(await one("select * from bookings where id='B1'")),original,'Original payment untouched');
  await assert.rejects(api.recordIntent({...intents.get(o.payment_intent_id),amount:1}),/do not match/);
  const publicRecord=JSON.stringify(api.customerOrder(o));assert(!publicRecord.includes('pm_card'));assert(!publicRecord.includes('cus_test'));
  await assert.rejects(api.changeCard(o),/Check the payment/);
  let bad=await booking('bad',{});await assert.rejects(prepare(bad),/settle/);
  bad=await booking('unpaid',{payment:{status:'deposit_paid',remainingCents:0}});await assert.rejects(prepare(bad),/settle/);

  // Decline -> cancel old attempt -> setup-only -> new exact-card approval.
  mode='requires_payment_method';const b2=await booking('B2');o=await prepare(b2);
  let r=await api.approve(b2,o,{revision:o.revision,accepted:true});assert.equal(r.order.status,'payment_failed');
  o=await db.get(o.id);const oldIntent=clone(intents.get(o.payment_intent_id)),oldRevision=o.revision;
  o=await api.changeCard(o);assert.equal(intents.get(oldIntent.id).status,'canceled');assert.equal(o.approved_at,null);
  r=await api.setupCard(b2,o);o=await db.get(o.id);assert.equal(o.status,'setting_up');
  await assert.rejects(api.approve(b2,o,{revision:o.revision,accepted:true}),/card|valid/);
  const setup=setups.get(o.setup_session_id);setup.status='complete';setup.setup_intent.customer='cus_other';
  await assert.rejects(api.completeSetup(o),/verified/);setup.setup_intent.customer='cus_test';
  r=await api.completeSetup(o);o=await db.get(o.id);assert.equal(o.card_last4,'1009');assert.equal(o.approved_at,null);
  assert.equal(r.order.card,'American Express ending in 1009');
  await assert.rejects(api.approve(b2,o,{revision:oldRevision,accepted:true}),/authorize/);
  await api.recordIntent(oldIntent);assert.equal((await db.get(o.id)).status,'draft','Old webhook cannot overwrite fresh card');
  mode='succeeded';r=await api.approve(b2,o,{revision:o.revision,accepted:true});assert.equal(r.order.status,'paid');
  assert(sent.some(s=>s.n.snapshot.card_last4==='1009'&&s.n.channel==='sms'));

  // Bank authentication remains unpaid until Stripe confirms; late event retrieves current state.
  mode='requires_action';const b3=await booking('B3');o=await prepare(b3);
  r=await api.approve(b3,o,{revision:o.revision,accepted:true});assert.equal(r.order.status,'requires_action');assert(r.verificationUrl);
  o=await db.get(o.id);const pi=intents.get(o.payment_intent_id);pi.status='succeeded';pi.amount_received=pi.amount;
  r=await api.handlePaymentEvent({type:'payment_intent.requires_action',data:{object:clone(pi)}});
  assert.equal(r.status,'paid');const count=sent.length;await api.reconcile(await db.get(o.id));assert.equal(sent.length,count);

  // Timeouts reuse the created intent; never duplicate an unknown/successful charge.
  mode='succeeded';const b4=await booking('B4');o=await prepare(b4);createTimeout=true;
  await assert.rejects(api.approve(b4,o,{revision:o.revision,accepted:true}),/timeout/);
  o=await db.get(o.id);assert(o.approved_at);assert.equal(o.payment_intent_id,null);const before=intents.size;
  confirmTimeout=true;r=await api.approve(b4,o,{revision:o.revision,accepted:true});
  assert.equal(r.order.status,'paid');assert.equal(intents.size,before);
  // Email outcome uncertain must never trigger a duplicate, SMS still sent.
  deliveriesFail=true;const b5=await booking('B5');o=await prepare(b5);await api.approve(b5,o,{revision:o.revision,accepted:true});
  const n=await db.notices(o.id);assert.equal(n.find(x=>x.channel==='email').status,'uncertain');assert.equal(n.find(x=>x.channel==='sms').status,'sent');
  const delivered=sent.length;await api.reconcile(await db.get(o.id));assert.equal(sent.length,delivered);

  // A stale request after Stripe's 24-hour key cache expires must never attach/confirm a second intent.
  deliveriesFail=false;const b6=await booking('B6');o=await prepare(b6);
  o=await db.rpc('iman_additional_work_approve',{p_booking_id:b6.id,p_id:o.id,p_revision:o.revision,p_text:api.consentText(o)});
  const stale=clone(o);await api.payApproved(o,b6);const attached=(await db.get(o.id)).payment_intent_id;
  keys.clear();await api.payApproved(stale,b6);
  assert.equal((await db.get(o.id)).payment_intent_id,attached);
  const attempts=[...intents.values()].filter(p=>p.metadata.additional_work_order_id===o.id);
  assert.equal(attempts.filter(p=>p.status==='succeeded').length,1);
  assert.equal(attempts.filter(p=>p.status==='requires_confirmation').length,1);
  const response={setHeader(){}};
  await assert.rejects(api.handler({method:'POST',headers:{origin:'https://other.invalid'}},response,b6,{action:'prepare',hours:1,minutes:0}),/IMAN website/);
  await assert.rejects(api.handler({method:'POST',headers:{origin:'https://www.imancleaningservice.com'}},response,b6,{action:'status',orderId:(await db.latest('B1')).id}),/not found/);

  assert.equal((await one("select has_table_privilege('anon','iman_additional_work_orders','select') as ok")).ok,false);
  assert.equal((await one("select has_function_privilege('authenticated','iman_additional_work_approve(text,uuid,integer,text)','execute') as ok")).ok,false);
  assert.equal((await one("select relrowsecurity as ok from pg_class where relname='iman_additional_work_orders'")).ok,true);
  await pg.close();
  console.log('Additional approval tests passed: minute pricing, PostgreSQL locks and outbox, concurrent approvals, repeat clicks, decline, card setup, 3DS, stale events, timeout recovery, privacy and original-payment isolation. All payments/messages simulated.');
})().catch(e=>{console.error(e);process.exitCode=1;});
