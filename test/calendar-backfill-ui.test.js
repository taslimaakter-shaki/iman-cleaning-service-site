const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const elements=new Map();for(const id of ['calendar-connect-form','connect-button','admin-login','admin-password','connection-status','existing-bookings','sync-bookings','sync-status'])elements.set(id,{hidden:true,disabled:false,value:'',textContent:'',listeners:{},addEventListener(k,v){this.listeners[k]=v;},focus(){}});
 const requests=[];let fail=false,delayed;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../calendar-connect.js'),'utf8'),{document:{getElementById:id=>elements.get(id)},sessionStorage:{getItem:()=> 'test-admin'},URLSearchParams,URL,location:{search:''},fetch:async(url,options)=>{
  requests.push({url,options});assert.equal(options.headers['x-admin-token'],'test-admin');
  if(url.endsWith('calendar-status'))return {ok:true,json:async()=>({connected:true,writable:true})};
  assert.equal(url,'/api/crm/calendar-sync');assert.equal(options.method,'POST');
  if(delayed)await delayed;
  if(fail)return {ok:false,json:async()=>({error:'Please try again.'})};
  const {offset}=JSON.parse(options.body);
  return {ok:true,json:async()=>offset===0?{results:[{status:'created'}],nextOffset:10}:{results:[{status:'already_exists'}],nextOffset:null}};
 }});
 await flush();assert.equal(elements.get('existing-bookings').hidden,false);
 const button=elements.get('sync-bookings'),status=elements.get('sync-status');
 let resume;delayed=new Promise(resolve=>{resume=resolve;});const pending=button.listeners.click();assert(button.disabled);
 await button.listeners.click();assert.equal(requests.filter(r=>r.url.endsWith('calendar-sync')).length,1,'Double click ignored');
 resume();await pending;delayed=null;
 assert(!button.disabled);assert.match(status.textContent,/1 appointment added. 1 already in Google Calendar. No customer notifications sent/);
 fail=true;await button.listeners.click();assert.match(status.textContent,/will not be duplicated/);assert(!button.disabled);
 const html=fs.readFileSync(path.join(__dirname,'../calendar-connect.html'),'utf8');assert(html.includes('id="existing-bookings" hidden'));assert(html.includes('20260910-existing-bookings'));
 console.log('Calendar sync UI passed: connected-only control, batch progress, duplicate-click guard, safe retries, no auto-import or reconnect. No browser activity.');
})().catch(e=>{console.error(e);process.exitCode=1;});
