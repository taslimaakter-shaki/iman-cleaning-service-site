const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const moduleObject={exports:{}};let sends=0;
vm.runInNewContext(fs.readFileSync('api/_form-notifications.js','utf8'),{module:moduleObject,Buffer,URLSearchParams,process:{env:{TWILIO_ACCOUNT_SID:'test',TWILIO_AUTH_TOKEN:'test',TWILIO_FROM_NUMBER:'+12125550100',OWNER_SMS_TO:'+12125550101'}},fetch:async()=>{sends++;return {ok:true,text:async()=>JSON.stringify({sid:'mock'})};}});
const api=moduleObject.exports;
(async()=>{
 const allowed=[['Appointment booked','confirmed'],['Appointment cancellation','cancelled'],['Appointment change','approval required'],['Appointment change','approved'],['Appointment change','declined'],['Same-day appointment request','submitted'],['Phone call request','submitted']];
 for(const [source,eventLabel] of allowed)assert.equal((await api.sendFormSubmissionNotification({source,eventLabel})).status,'sent');
 const before=sends;
 for(const source of ['Instant pricing form','Website form','Custom quote','Service concern','Quote photos','Payment attention','Rescheduling approval','Unknown'])assert.equal((await api.sendFormSubmissionNotification({source,eventLabel:'opened'})).status,'disabled');
 assert.equal((await api.sendFormSubmissionNotification({source:'Phone call request',eventLabel:'opened'})).status,'disabled');assert.equal(sends,before);
 assert(!fs.readFileSync('book-now.js','utf8').includes('notifyInstantPricingOpened'));
 const chat=require('../api/chat/_shared');assert.equal((await chat.sendOwnerSmsNotifications({})).status,'disabled');
 console.log('Owner text policy: bookings, cancellations, rescheduling, same-day and callback requests allowed; other categories and chat alerts blocked without provider calls.');
})().catch(e=>{console.error(e);process.exitCode=1});
