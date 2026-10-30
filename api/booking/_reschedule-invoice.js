const PDFDocument = require('pdfkit');
const { staffingOptions } = require('./_staffing-options');
const money = n => `$${(Number(n || 0)/100).toFixed(2)}`;
function invoiceRows(booking) {
  const e = booking.estimate || {}, r = e.rescheduling?.request || {}, q = r.pricing;
  if (!q) return [['Cleaning total',money(e.payment?.totalCents || Number(e.total)*100)]];
  return [['Previous cleaning total',money(q.previousTotalCents)],['Service subtotal',money(q.subtotalCents)],['Previous flexibility discount',money(q.previousDiscount?.amountCents)],['New flexibility discount',q.arrivalDiscount?.amountCents ? `-${money(q.arrivalDiscount.amountCents)}` : '$0.00'],['Other agreed discounts','Unchanged'],['Discounted subtotal',money(q.discountedSubtotalCents)],['Sales tax',money(q.taxCents)],['Revised cleaning total',money(q.totalCents)],['Deposit originally paid',money(q.depositCents)],['Payments credited',money(Math.min(q.paidCents,q.totalCents))],['Remaining cleaning balance',money(q.remainingCents)],['Separate late-rescheduling fee',money(r.feeCents)],...(q.refundCents ? [['Price reduction refund',`${money(q.refundCents)} - ${(e.rescheduling.priceRefunds || []).filter(x=>x.requestId===r.id).every(x=>x.status==='succeeded') && (e.rescheduling.priceRefunds || []).some(x=>x.requestId===r.id) ? 'refunded' : 'pending'}`]] : [])];
}
function buildInvoice(booking) {
  return new Promise((resolve,reject) => {
    const doc = new PDFDocument({size:'LETTER',margin:48}); const chunks=[];
    doc.on('data',x=>chunks.push(x));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    doc.rect(0,0,612,12).fill('#0b7282');
    doc.fillColor('#16363d').font('Helvetica-Bold').fontSize(23).text('Revised Booking Invoice');
    doc.moveDown(.5).fontSize(10).font('Helvetica').text('IMAN Cleaning Service LLC | 929-232-1930');
    doc.text(`Order: ${booking.estimate?.orderNumber || booking.id}`);
    doc.text(`Revision: ${booking.estimate?.rescheduling?.request?.id || ''}`);
    doc.text(`Customer: ${booking.client_name || ''}`);
    doc.text(`Service: ${booking.service_label || booking.service || ''}`);
    doc.text(`Appointment: ${booking.schedule_label || booking.schedule}`);
    doc.text(`Work duration: ${staffingOptions(booking.estimate) || 'Contact us for details'}`);
    doc.moveDown();
    for (const [label,value] of invoiceRows(booking)) {
      const y=doc.y;
      doc.font('Helvetica').fontSize(10).text(label,48,y,{width:285});
      doc.font('Helvetica-Bold').text(value,340,y,{width:224,align:'right'});
      doc.y=Math.max(doc.y,y+16)+7;
    }
    doc.moveDown().font('Helvetica').fontSize(9).fillColor('#607579').text('This revision replaces the previous booking invoice. Your original payment history remains on record. A rescheduling fee is separate from the cleaning price and is not a second deposit. Future changes require approval.',48,doc.y,{width:516});
    doc.end();
  });
}
module.exports={buildInvoice,invoiceRows};
