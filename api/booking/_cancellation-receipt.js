const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const money = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const clean = value => String(value ?? '').replace(/[\r\n]/g, ' ');
const date = value => value ? new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York',dateStyle:'long',timeStyle:'short' }).format(new Date(value)) : 'Not recorded';
function snapshot(booking, cancellation, authorization = {}, feeRefunds = []) {
  const e = booking.estimate || {}, p = e.payment || {}, state = e.rescheduling || {};
  const feesPaid = (state.fees || []).filter(f=>f.status==='paid').reduce((sum,f)=>sum+Number(f.amountCents || 0),0);
  const company = cancellation.source === 'iman';
  const applicable = !company && cancellation.lessThan48Hours;
  const grossFee = applicable ? (state.cancellationLocked ? Number(state.cancellationFeeCents || 0) : Math.round(Number(p.cleaningPriceCents || p.totalCents || Number(e.total)*100)*.25)) : 0;
  const credit = Math.min(feesPaid,grossFee);
  const refundCents = Number(cancellation.refundCents || 0);
  return {
    number: `CR-${crypto.createHash('sha256').update(`${booking.id}:${cancellation.cancelledAt}`).digest('hex').slice(0,12).toUpperCase()}`,
    issuedAt:cancellation.cancelledAt, order:e.orderNumber || booking.id, customer:booking.client_name || '', service:booking.service_label || booking.service || '', appointment:booking.schedule_label || date(booking.schedule),
    source: company ? 'iman' : 'customer', paidCents:Number(cancellation.paidCents ?? (Number(cancellation.retainedCents || 0)+refundCents)),
    feeCents: grossFee, feeCreditCents:credit, feesPaidCents:feesPaid, retainedCents:Number(cancellation.retainedCents || 0),refundCents,
    refundId:cancellation.refundId || '',refundStatus:cancellation.refundStatus || (refundCents ? 'unknown' : 'not_required'), feeRefunds,
    remainingCents:0, paymentMethod:p.cardLast4 ? `${p.cardBrand || 'Card'} ending in ${p.cardLast4}` : 'Original payment method',
    holdStatus: authorization.status === 'already_captured' ? 'Previously charged; included in payment totals' : p.remaining?.paymentIntentId && ['authorized','capture_failed','requires_action'].includes(p.remaining.status) ? (authorization.status === 'canceled' ? 'Release requested' : 'Release needs review') : 'No outstanding hold recorded',
    reason:company ? 'IMAN canceled this appointment. No cancellation fee applies.' : state.cancellationLocked ? 'An earlier late reschedule kept this booking subject to the 25% cancellation fee. Paid late-rescheduling fees are credited toward it.' : cancellation.lessThan48Hours ? 'Canceled less than 48 hours before the appointment. The 25% cancellation fee applies.' : 'Canceled at least 48 hours before the appointment. No cancellation fee applies.'
  };
}
function receiptFor(booking) {
  if (booking.status !== 'Cancelled' || !booking.estimate?.cancellation?.receipt) throw Object.assign(new Error('No cancellation receipt is available for this booking.'),{statusCode:404});
  return booking.estimate.cancellation.receipt;
}
function refundLabel(status, amount) {
  if (!amount) return 'No refund due';
  return status === 'succeeded' ? 'Completed' : ['pending','submitted','requires_action'].includes(status) ? 'Submitted - processing' : ['failed','canceled'].includes(status) ? 'Needs attention - contact IMAN' : 'Status not yet confirmed';
}
function rows(r) {
  return [['Booking payment received',money(r.paidCents)],...(r.feesPaidCents ? [['Late-rescheduling fees already paid',money(r.feesPaidCents)]] : []),['Cancellation fee',money(r.feeCents)],...(r.feeCreditCents ? [['Credit for paid late-rescheduling fees',`-${money(r.feeCreditCents)}`]] : []),['Amount retained from booking payment',money(r.retainedCents)],['Refund from booking payment',money(r.refundCents)],...r.feeRefunds.map(f=>['Rescheduling fee refund',`${money(f.amountCents)} - ${refundLabel(f.status,f.amountCents)}`]),['Remaining amount due',money(r.remainingCents)]];
}
async function refreshRefundStatus(booking) {
  const receipt = {...receiptFor(booking)};
  const key = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
  if (!key) return booking;
  const refresh = async (id, fallback) => {
    if (!id) return fallback;
    try {
      const response = await fetch(`https://api.stripe.com/v1/refunds/${encodeURIComponent(id)}`, {headers:{Authorization:`Bearer ${key}`}});
      if (!response.ok) return fallback;
      const refund = await response.json();
      return refund.id === id ? refund.status || fallback : fallback;
    } catch { return fallback; }
  };
  receipt.refundStatus = await refresh(receipt.refundId, receipt.refundStatus);
  receipt.feeRefunds = await Promise.all(receipt.feeRefunds.map(async refund=>({...refund,status:await refresh(refund.id,refund.status)})));
  return {...booking,estimate:{...booking.estimate,cancellation:{...booking.estimate.cancellation,receipt}}};
}
async function buildPdf(booking) {
  const r = receiptFor(booking);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({size:'LETTER',margin:44,bufferPages:true,info:{Title:`Cancellation receipt ${r.number}`,Author:'IMAN Cleaning Service LLC'}});
    const chunks=[]; doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
    const ink='#16363d', muted='#62777b', teal='#0b7282', line='#dce7e6', pale='#f0f7f6';
    const left=44, width=524, right=568;
    const text=(value,x,y,w,size=10,bold=false,color=ink,align='left')=>{
      doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(color).text(String(value ?? '').replace(/[\u2010-\u2015]/g,'-'),x,y,{width:w,align,lineGap:2});
      return doc.y;
    };
    const height=(value,w,size=10,bold=false)=>doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).heightOfString(String(value || ''),{width:w,lineGap:2});
    let y=44;
    const ensure=needed=>{if(y+needed>714){doc.addPage();text('IMAN CLEANING SERVICE',left,38,width,9,true,teal);y=68;}};
    doc.rect(0,0,612,7).fill(teal);
    text('IMAN',left,39,180,25,true,teal);
    text('CLEANING SERVICE LLC',left,69,220,8,true,muted);
    text('929-232-1930',350,43,218,10,false,ink,'right');
    text('imancleaningservice.com',350,59,218,9,false,muted,'right');
    doc.moveTo(left,92).lineTo(right,92).strokeColor(line).lineWidth(1).stroke();
    text('Cancellation & refund receipt',left,110,width,23,true);
    text('A record of your canceled appointment and final payment outcome.',left,142,width,9,false,muted);
    doc.roundedRect(left,167,150,24,12).fill(pale);
    text('APPOINTMENT CANCELED',left+12,175,130,7.5,true,teal);
    y=201;
    const metadata=[['CUSTOMER',r.customer || 'Customer','BOOKING NUMBER',r.order],['SERVICE',r.service,'RECEIPT NUMBER',r.number],['CANCELED APPOINTMENT',r.appointment,'CANCELED ON (EASTERN TIME)',date(r.issuedAt)]];
    for(const [label,value,label2,value2] of metadata){
      const h=Math.max(height(value,246,10,true),height(value2,246,10,true));
      text(label,left,y,246,7.5,true,muted);text(label2,322,y,246,7.5,true,muted);
      text(value,left,y+14,246,10,true);text(value2,322,y+14,246,10,true);y+=h+23;
    }
    y+=5;ensure(65);
    text('Payment summary',left,y,width,13,true);y+=25;
    doc.rect(left,y,width,25).fill(pale);text('DESCRIPTION',left+12,y+8,320,7.5,true,muted);text('AMOUNT',400,y+8,156,7.5,true,muted,'right');y+=25;
    for(const [label,value] of rows(r)){
      const refund=label==='Refund from booking payment',balance=label==='Remaining amount due';
      const h=Math.max(height(label,315,9.5),height(value,160,refund?15:10,true))+16;
      ensure(h+4);
      if(refund)doc.rect(left,y,width,h).fill(teal);
      else if(balance)doc.rect(left,y,width,h).fill(pale);
      text(label,left+12,y+10,315,9.5,refund||balance,refund?'#ffffff':ink);
      text(value,390,y+9,166,refund?15:10,true,refund?'#ffffff':ink,'right');
      y+=h;doc.moveTo(left,y).lineTo(right,y).strokeColor(line).lineWidth(.5).stroke();
    }
    y+=18;
    const reasonHeight=height(r.reason,width-24,9)+22;ensure(reasonHeight);
    doc.roundedRect(left,y,width,reasonHeight,6).fill('#f6f8f8');text(r.reason,left+12,y+10,width-24,9,false,muted);y+=reasonHeight+14;
    const details=[['REFUND STATUS',refundLabel(r.refundStatus,r.refundCents),'REFUND DESTINATION',r.paymentMethod],['BALANCE HOLD',r.holdStatus,'REFUND REFERENCE',r.refundId || 'Not applicable']];
    ensure(88);
    for(const [label,value,label2,value2] of details){
      const h=Math.max(height(value,246,9),height(value2,246,9));
      ensure(h+28);text(label,left,y,246,7,true,muted);text(label2,322,y,246,7,true,muted);
      text(value,left,y+13,246,9);text(value2,322,y+13,246,9);y+=h+23;
    }
    const note='Refunds return to your original payment method. Your bank may take several business days to display the credit.';
    ensure(height(note,width,8)+10);text(note,left,y,width,8,false,muted);
    const pages=doc.bufferedPageRange();
    for(let i=pages.start;i<pages.start+pages.count;i++){
      doc.switchToPage(i);doc.page.margins.bottom=20;doc.moveTo(left,738).lineTo(right,738).strokeColor(line).lineWidth(.7).stroke();
      text('No payment is requested by this receipt.',left,749,380,8,false,muted);
      text(`${i+1} / ${pages.count}`,500,749,68,8,false,muted,'right');
    }
    doc.end();
  });
}
function messages(booking) {
  const r=receiptFor(booking);
  const token=require('./_manage').createBookingManagementToken({bookingId:booking.id,email:booking.email});
  const link=`https://www.imancleaningservice.com/api/booking/manage?document=cancellation-receipt&token=${encodeURIComponent(token)}`;
  const subject='Your appointment cancellation is confirmed - IMAN Cleaning Service';
  const text=[
    `Hi ${r.customer || 'there'},`,
    '',
    `Your ${r.service || 'cleaning'} appointment for ${r.appointment} has been canceled.`,
    `Booking number: ${r.order}`,
    '',
    'Your Cancellation & Refund Receipt is attached. It contains your payment details and any applicable refund information.',
    '',
    'Questions? Call or text 929-232-1930.',
    '',
    'Thank you,',
    'IMAN Cleaning Service LLC'
  ].join('\n');
  const sms=`IMAN Cleaning Service: Your appointment (${r.order}) has been canceled. Booking payment retained: ${money(r.retainedCents)}. Booking payment refund: ${money(r.refundCents)} (${refundLabel(r.refundStatus,r.refundCents)}).${r.feeRefunds.length ? ' Separate rescheduling fee refunds are listed on your receipt.' : ''} Receipt: ${link} Questions? Call/text 929-232-1930. Reply STOP to opt out.`;
  return {subject,text,sms,link};
}
async function sendEmail(booking,message) {
  if(!booking.email)return {status:'skipped'};
  const pdf=await buildPdf(booking),boundary='iman_cancellation_receipt';
  const raw=[`From: IMAN Cleaning Service LLC <${clean(process.env.QUOTE_EMAIL_FROM || 'Info@imancleaningservice.com')}>`,`To: ${clean(booking.email)}`,`Subject: ${message.subject}`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset="UTF-8"','',message.text,`--${boundary}`,'Content-Type: application/pdf','Content-Disposition: attachment; filename="IMAN-Cancellation-Receipt.pdf"','Content-Transfer-Encoding: base64','',pdf.toString('base64').match(/.{1,76}/g).join('\r\n'),`--${boundary}--`,''].join('\r\n');
  const {gmail}=require('../quote/_shared').getGoogleClients();const sent=await gmail.users.messages.send({userId:'me',requestBody:{raw:Buffer.from(raw).toString('base64url')}});return {status:'sent',messageId:sent.data.id || ''};
}
async function notify(booking,{email=sendEmail,sms=require('./_notifications').sendCustomerSms}={}) {
  const shared=require('./_shared');const prior=booking.estimate?.cancellation?.receiptDelivery || {};const message=messages(booking);
  const results=await Promise.allSettled([prior.email?.status==='sent'?prior.email:email(booking,message),prior.sms?.status==='sent'?prior.sms:sms(booking.phone,message.sms)]);
  const outcome=r=>r.status==='fulfilled'?r.value:{status:'error',error:String(r.reason?.message || 'Delivery failed').slice(0,240)};
  const delivery={email:outcome(results[0]),sms:outcome(results[1]),attemptedAt:new Date().toISOString()};
  const latest=await shared.getBooking(booking.id);
  if(latest?.status==='Cancelled' && latest.estimate?.cancellation?.receipt?.number===receiptFor(booking).number) await shared.updateBookingEstimate(booking.id,{...latest.estimate,cancellation:{...latest.estimate.cancellation,receiptDelivery:delivery}});
  return delivery;
}
module.exports={refreshRefundStatus,snapshot,receiptFor,refundLabel,rows,buildPdf,messages,notify,sendEmail};
