const assert = require('node:assert/strict');
const { actualWork, buildAdditionalWorkInvoicePdf } = require('../api/booking/_additional-invoice');

(async()=>{
  const order={
    id:'11111111-1111-4111-8111-111111111111',booking_id:'BOOKING-1',status:'paid',team_members:2,total_minutes:180,minutes_per_member:90,amount_cents:24000,
    card_brand:'visa',card_last4:'4242',completed_at:'2026-11-08T18:35:00.000Z',
    time_tracking:{entries:[{clockInAt:'2026-11-08T17:00:00.000Z',clockOutAt:'2026-11-08T18:35:00.000Z',seconds:5700}]}
  };
  assert.deepEqual(actualWork(order),{entries:order.time_tracking.entries,minutes:95,laborMinutes:190});
  const pdf=await buildAdditionalWorkInvoicePdf({booking:{id:'BOOKING-1',client_name:'Test Customer',estimate:{orderNumber:'ORDER-1'}},order});
  assert.equal(pdf.subarray(0,4).toString(),'%PDF');
  assert(pdf.length>1000);
  console.log('Additional-work invoice tests passed.');
})().catch(error=>{console.error(error);process.exit(1);});
