const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('crm.js','utf8');
const nodes={},elements={};
for(const key of ['amount','receivedAt','agreementEvidence','agreementVerified']) elements[key]={};
const form={elements};let agreement={signedName:'Jane Example',acceptedAt:'2026-10-31T14:00:00Z'};
const context={externalPaymentInput:()=>({source:'booking',id:'TEST'}),$:selector=>nodes[selector] ||= {},crypto:{randomUUID:()=> 'test-operation-001'},
  escapeHtml:s=>String(s||''),money:c=>'$'+(c/100).toFixed(2),submittedDate:s=>s,Date,Intl,
  api:async()=>({remainingCents:15457,totalCents:20609,depositCents:5152,paidCents:5152,agreement})};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  async function previewExternalPayment('),source.indexOf('  async function recordExternalPayment(')),context);
(async()=>{
 await context.previewExternalPayment(form);
 assert.equal(nodes['[data-manual-agreement-evidence]'].hidden,true);
 assert.equal(elements.agreementEvidence.required,false);assert.equal(elements.agreementVerified.disabled,true);
 assert.match(nodes['[data-saved-service-agreement]'].textContent,/Jane Example/);
 agreement=null;await context.previewExternalPayment(form);
 assert.equal(nodes['[data-manual-agreement-evidence]'].hidden,false);
 assert.equal(elements.agreementEvidence.required,true);assert.equal(elements.agreementVerified.disabled,false);
 assert.equal(nodes['[data-saved-service-agreement]'].hidden,true);
 console.log('Manual payment UI reuses saved agreement and requires evidence only when unavailable or stale.');
})().catch(e=>{console.error(e);process.exitCode=1});
