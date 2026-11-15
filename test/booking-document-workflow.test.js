const assert = require('node:assert/strict');
const fs = require('node:fs');
const model = require('../booking-conditions');
const { calculateResidentialQuoteBundle: quote } = require('../api/booking/_shared');
const { buildSections, buildBookingConfirmationPdf } = require('../api/booking/_confirmation-pdf');
const { pricingRows, buildPaymentReceiptPdf } = require('../api/booking/_payment-receipt-pdf');
const { conditionSections, unitLabel } = require('../api/booking/_document-details');
const eligibility = {roomConditionVersion: 3, propertyType:'house', houseFloorSelection:['Second floor'], requestedService:'deep', clutter:'low', buildup:'none', hazards:'none'};
const unit = {bedrooms:0,fullBathrooms:1,halfBathrooms:0,kitchens:1,livingRooms:0,diningRooms:0,livingDining:'none',additionalRooms:0,refrigerator:'empty',oven:'no',cabinets:'no',
 roomConditions:{'fullBathrooms:1':{clutter:'low',buildup:'heavy',mold:'none'},'kitchens:1':{clutter:'low',grease:'some'}}};
const pkg = quote([unit],'deep',eligibility);
const booking = {id:'BK-DOCUMENT-TEST',service:'deep',service_label:'Deep Cleaning',client_name:'Preview Customer',estimate:{...pkg,eligibility:{...eligibility,units:[unit]},subtotal:271.70,units:pkg.units,customerNotes:'Please focus on the bathroom and kitchen floor.'}};
const record = {quoteId:booking.id,service:'Deep Cleaning',subtotalBeforeTax:'$271.70',discountLabel:'Fall Cleaning Discount',discountAmount:'-$13.59',discountedSubtotalBeforeTax:'$258.11',salesTax:'$22.91',totalAmount:'$281.02',paidAmount:'$70.26',remainingAmount:'$210.76',paymentType:'deposit_25'};
const before = JSON.stringify(booking);
assert.deepEqual(pricingRows(booking,record),[
 ['Deep Cleaning Service','$146.96'],
 ['Second floor - Inside refrigerator (emptied)','$36.74'],
 ['Second floor - Full bathroom: Heavy buildup','$48.00'],
 ['Second floor - Kitchen: Moderate grease buildup','$40.00']
]);
const sections = buildSections({booking,record});
const text = JSON.stringify(sections);
assert.doesNotMatch(text,/Room Condition Version|Units Item|Buildup level|Room Conditions|0 bedrooms|Unit 1/);
assert(!sections.some(s=>s.title===model.definitions.dust.title), 'No invented dust answers for a bathroom/kitchen-only booking');
for(const [kind,level] of [['clutter','low'],['buildup','heavy'],['grease','some'],['mold','none']]) {
 const definition=model.definitions[kind], answer=model.levelFor(kind,level);
 const section=sections.find(s=>s.title===(kind==='clutter'?definition.title:definition.singularTitle));
 assert(section && section.rows.some(([,value])=>value===`${answer.label} - ${answer.description}`));
}
assert.equal(JSON.stringify(booking),before,'Formatting must not modify accepted answers or prices');
assert.equal(unitLabel({eligibility:{propertyType:'house',houseFloorSelection:'["Basement","Attic"]'}},1),'Attic');
assert.equal(unitLabel({eligibility:{propertyType:'house',houseFloorSelection:'broken'}},1),'Floor 2');
assert.equal(unitLabel({eligibility:{propertyType:'apartment'}},1),'Unit 2');
const allRooms = {halfBathrooms:0,refrigerator:'no',oven:'no',cabinets:'no',bedrooms:1,livingRooms:1,diningRooms:1,livingDining:'combined',additionalRooms:1,additionalRoomTypes:{office:1},kitchens:0,fullBathrooms:1};
allRooms.roomConditions=Object.fromEntries(model.roomsForUnit(allRooms).map(room=>[room.id,Object.fromEntries(Object.keys(model.definitions).filter(kind=>model.applicable(room,kind)).map(kind=>[kind,kind==='clutter'?'heavy':'heavy']))]));
const mixedEligibility={...eligibility,houseFloorSelection:['Basement','Attic']};
const mixed=quote([unit,allRooms],'deep',mixedEligibility);
const mixedBooking={...booking,estimate:{...mixed,eligibility:mixedEligibility}};
const mixedRows=pricingRows(mixedBooking,{subtotalBeforeTax:`$${mixed.subtotal.toFixed(2)}`});
assert.equal(mixedRows.reduce((sum,[,value])=>sum+Math.round(Number(value.slice(1))*100),0),mixed.subtotalCents);
assert(mixedRows.some(([label])=>label.includes('Attic - Living & dining area: Heavy dust and dirt')));
assert(mixedRows.some(([label])=>label.includes('Attic - Full bathroom: Significant mold')));
const details=conditionSections(mixedBooking.estimate);
assert(details.some(s=>s.title===model.definitions.dust.title));
assert(details.some(s=>s.rows.some(([label])=>label==='Attic - Office')));
const movingEligibility={...eligibility,requestedService:'move',movingKitchenPricingVersion:1,movingDirection:'move-in'};
const movingUnit={...unit,refrigerator:'per-kitchen',oven:'per-kitchen',cabinets:'per-kitchen',movingKitchenPricingVersion:1,movingKitchens:[{excludeKitchenItems:'no',excludeOven:'no',excludeRefrigerator:'no',excludeCabinets:'no',cabinetCount:12,drawerCount:6}],roomConditions:{'fullBathrooms:1':{buildup:'heavy',mold:'none'},'kitchens:1':{grease:'some'}}};
const moving=quote([movingUnit],'move',movingEligibility);
const moveBooking={...booking,service:'move',service_label:'Moving Cleaning',estimate:{...moving,eligibility:movingEligibility}};
const moveText=JSON.stringify(buildSections({booking:moveBooking,record}));
assert.doesNotMatch(moveText,/How cluttered|Moving Kitchen Pricing Version|Grease Base Price|per-kitchen/);
assert.match(moveText,/12 cabinet doors and 6 drawers/);
const moveRows=pricingRows(moveBooking,{subtotalBeforeTax:`$${moving.subtotal.toFixed(2)}`});
assert.equal(moveRows[0][0],'Moving Cleaning Service');
assert(moveRows.some(([label])=>label.includes('cabinet')));
assert(moveRows.some(([label])=>label.includes('Inside oven')));
assert.equal(moveRows.reduce((sum,[,value])=>sum+Math.round(Number(value.slice(1))*100),0),moving.subtotalCents);
const missing=structuredClone(booking); delete missing.estimate.units[0].roomConditions['fullBathrooms:1'].mold;
assert(!conditionSections(missing.estimate).some(s=>s.title.includes('mold')));
const mismatched=structuredClone(booking); mismatched.estimate.buildupAdjustment.affectedAreas[0].amountCents++;
assert(pricingRows(mismatched,record).some(([label,value])=>label.includes('Buildup adjustment') && value==='$88.00'));
(async()=>{
 for(const [name,build] of [['record',buildBookingConfirmationPdf],['receipt',buildPaymentReceiptPdf]]) {
  const pdf=await build({booking,record});
  assert.equal(pdf.subarray(0,4).toString(),'%PDF');
  if(process.env.DOCUMENT_PDF_OUTPUT) fs.writeFileSync(`${process.env.DOCUMENT_PDF_OUTPUT}-${name}.pdf`,pdf);
 }
 console.log('Document workflow: separate exact answers, floors, combined service price, recorded charges, Moving kitchens, compatibility and immutable totals passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
