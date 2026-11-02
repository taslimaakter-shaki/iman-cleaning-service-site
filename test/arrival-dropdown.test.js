const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.value='';this.hidden=false;this.dataset={};}
 append(...items){this.children.push(...items);} add(item){this.append(item);} replaceChildren(...items){this.children=items;} setAttribute(){} addEventListener(name,fn){this.listeners[name]=fn;} dispatchEvent(event){this.listeners[event.type]?.(event);} focus(){this.focused=true;}
 querySelector(tag){for(const child of this.children){if(child.tag===tag)return child;const found=child.querySelector?.(tag);if(found)return found;}return null;}
}
const source=fs.readFileSync('book-now.js','utf8');
const code=source.slice(source.indexOf('  const renderTimeSlots ='),source.indexOf('  const renderCalendar ='));
const morning={key:'morning',title:'Morning',fixedStart:true},afternoon={key:'afternoon',title:'Afternoon',fixedStart:true},anytime={key:'any_day',title:'Anytime that day',flexible:true,percent:5};
const options=[anytime,morning,afternoon],state={selectedDate:'2030-11-06',arrivalPreference:'',package:{}},arrivalOptions=new Element('div'),timeSlots=new Element('div'),scheduleSelect=new Element('select');
const slots={morning:[{value:'morning-slot',time:'08:00'}],afternoon:[{value:'afternoon-slot',time:'12:30'}],any_day:[{value:'anytime-slot',time:'08:00'}]};
const context=vm.createContext({state,arrivalOptions,timeSlots,scheduleSelect,selectedDateLabel:{},arrivalNote:{},document:{createElement:tag=>new Element(tag)},Option:function(text,value){return {tag:'option',text,value};},Event:class{constructor(type){this.type=type;}},longDate:x=>x,arrivalOption:key=>options.find(o=>o.key===key),visibleArrivalOptions:()=>options,slotsForArrivalOption:option=>slots[option.key],arrivalWindowText:option=>option.title,displayTime:x=>x,clearArrivalDiscount(){},applyArrivalDiscount(){},renderQuoteOverview(){},renderPriceBreakdown(){},resetAgreementReview(){},setSchedulerStatus(){},persistBookingDraft(){}});
vm.runInContext(code,context);const render=()=>vm.runInContext('renderTimeSlots()',context);render();
arrivalOptions.children[1].listeners.click();assert.equal(scheduleSelect.value,'','Selecting Morning does not silently choose its time');assert.equal(timeSlots.hidden,false);
let dropdown=timeSlots.querySelector('select');assert.equal(dropdown.children[0].text,'Select an available time');assert.deepEqual(dropdown.children.map(o=>o.value),['','morning-slot']);assert.equal(dropdown.required,true);assert.equal(dropdown.focused,true);
dropdown.value='morning-slot';dropdown.listeners.change();assert.equal(scheduleSelect.value,'morning-slot');render();assert.equal(timeSlots.querySelector('select').value,'morning-slot','Rendering preserves explicit time selection');
arrivalOptions.children[2].listeners.click();assert.equal(scheduleSelect.value,'','Changing period requires a new explicit selection');dropdown=timeSlots.querySelector('select');assert.deepEqual(dropdown.children.map(o=>o.value),['','afternoon-slot']);
dropdown.value='afternoon-slot';dropdown.listeners.change();assert.equal(scheduleSelect.value,'afternoon-slot');arrivalOptions.children[0].listeners.click();assert.equal(timeSlots.hidden,true);assert.equal(scheduleSelect.value,'anytime-slot','Anytime remains one flexible choice');
state.arrivalPreference='morning';scheduleSelect.value='old-date-slot';render();assert.equal(scheduleSelect.value,'','Stale times are cleared');
state.arrivalPreference='any_day';scheduleSelect.value='anytime-slot';let cleared=0;context.visibleArrivalOptions=()=>[morning,afternoon];context.clearArrivalDiscount=()=>cleared++;render();assert.equal(state.arrivalPreference,'');assert.equal(scheduleSelect.value,'');assert.equal(cleared,1,'Changing to a restricted date clears the old Anytime discount');
console.log('Arrival dropdown: explicit Morning/Afternoon selection, correct available slots, preserved selection, period switching, stale-time clearing and unchanged Anytime passed.');
