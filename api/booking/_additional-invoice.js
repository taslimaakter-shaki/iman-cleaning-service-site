const PDFDocument = require('pdfkit');
const { cleanText } = require('./_shared');
const { cardLabel, duration, teamDescription } = require('./_additional-approval');

const COLORS={ink:'#16363d',muted:'#607579',teal:'#0b7285',green:'#639b38',paleGreen:'#f1f7ec',line:'#d7e5e3',pale:'#f2f8f7'};
const safeText=value=>String(value ?? '').replace(/\u00d7/g,'x').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[^\x09\x0A\x0D\x20-\x7E]/g,'');
const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(cents || 0)/100);
const time = value => { const date=value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date) : ''; };
const escape = value => String(value || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mimeWord = value => `=?UTF-8?B?${Buffer.from(String(value || '')).toString('base64')}?=`;
const base64Url = value => Buffer.from(value).toString('base64url');

function actualWork(order) {
  const entries = order.time_tracking?.entries || [];
  const seconds = entries.reduce((sum,entry)=>sum+Math.max(0,Number(entry.seconds || 0)),0);
  return { entries, minutes: Math.round(seconds/60), laborMinutes: Math.round(seconds/60*Number(order.team_members || 1)) };
}

function buildAdditionalWorkInvoicePdf({booking,order}) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'LETTER',margin:45,bufferPages:true,info:{Title:`Additional Work Invoice ${safeText(order.id)}`,Author:'IMAN Cleaning Service LLC',Subject:'Paid additional-work invoice'}}),chunks=[];
    doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    const worked=actualWork(order);
    const left=doc.page.margins.left,right=doc.page.width-doc.page.margins.right,width=right-left,bottomLimit=doc.page.height-64;
    const drawPageBrand=()=>{doc.rect(0,0,doc.page.width,8).fill(COLORS.teal);doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10).text('IMAN CLEANING SERVICE LLC',left,25,{lineBreak:false});doc.y=48;};
    const ensureSpace=height=>{if(doc.y+height>bottomLimit){doc.addPage();drawPageBrand();}};
    const sectionTitle=title=>{ensureSpace(26);doc.y+=4;doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10.5).text(safeText(title),left,doc.y,{width,lineBreak:false});doc.y+=14;doc.moveTo(left,doc.y).lineTo(right,doc.y).strokeColor(COLORS.line).lineWidth(.7).stroke();doc.y+=2;};
    const infoGrid=items=>{const colWidth=width/2;for(let index=0;index<items.length;index+=2){ensureSpace(35);const y=doc.y;[items[index],items[index+1]].forEach((item,column)=>{if(!item)return;const [label,value]=item,x=left+column*colWidth;doc.rect(x,y,colWidth,35).fillAndStroke(COLORS.pale,COLORS.line);doc.fillColor(COLORS.teal).font('Helvetica-Bold').fontSize(7.2).text(safeText(label).toUpperCase(),x+9,y+5,{width:colWidth-18,lineBreak:false});doc.fillColor(COLORS.ink).font('Helvetica').fontSize(9).text(safeText(value),x+9,y+19,{width:colWidth-18,lineBreak:false});});doc.y=y+35;}};
    const detailRow=(label,value)=>{ensureSpace(39);const y=doc.y;doc.rect(left,y,width,39).fillAndStroke(COLORS.pale,COLORS.line);doc.fillColor(COLORS.teal).font('Helvetica-Bold').fontSize(7.2).text(safeText(label).toUpperCase(),left+9,y+6,{width:width-18,lineBreak:false});doc.fillColor(COLORS.ink).font('Helvetica').fontSize(9).text(safeText(value),left+9,y+20,{width:width-18,lineBreak:false});doc.y=y+39;};
    const moneyRows=(rows,highlight=new Set())=>rows.forEach(([label,value])=>{ensureSpace(19);const y=doc.y;if(highlight.has(label))doc.rect(left,y,width,19).fillAndStroke(COLORS.pale,COLORS.teal);else doc.moveTo(left,y+19).lineTo(right,y+19).strokeColor(COLORS.line).lineWidth(.5).stroke();doc.fillColor(COLORS.ink).font(highlight.has(label)?'Helvetica-Bold':'Helvetica').fontSize(8.6).text(safeText(label),left+8,y+5,{width:width-140,lineBreak:false});doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(8.6).text(safeText(value),right-130,y+5,{width:122,align:'right',lineBreak:false});doc.y=y+19;});

    drawPageBrand();
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(19).text('Additional Work Invoice');
    doc.moveDown(.2);
    const paidY=doc.y;doc.rect(left,paidY,width,50).fillAndStroke(COLORS.paleGreen,COLORS.green);
    doc.fillColor(COLORS.teal).font('Helvetica-Bold').fontSize(8).text('TOTAL PAID',left+14,paidY+11,{lineBreak:false});
    doc.fillColor(COLORS.teal).font('Helvetica-Bold').fontSize(17).text(money(order.amount_cents),right-150,paidY+9,{width:136,align:'right',lineBreak:false});
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text('Payment status',left+14,paidY+31,{lineBreak:false});
    doc.fillColor(COLORS.ink).font('Helvetica').fontSize(9.3).text('Paid in full',right-150,paidY+29,{width:136,align:'right',lineBreak:false});
    doc.y=paidY+54;

    sectionTitle('Invoice Information');
    infoGrid([
      ['Customer',booking.client_name || ''],
      ['Order number',booking.estimate?.orderNumber || booking.id],
      ['Additional-work reference',order.id],
      ['Completion status','Completed'],
      ['Completion date',time(order.completed_at)],
      ['Payment method',cardLabel(order)]
    ]);

    sectionTitle('Additional Work Details');
    detailRow('Approved additional labor',teamDescription(order));
    infoGrid([
      ['Actual on-site time',duration(worked.minutes)],
      ['Actual total labor time',duration(worked.laborMinutes)]
    ]);

    sectionTitle('Payment Summary');
    moneyRows([
      ['Additional-work total',money(order.amount_cents)],
      ['Amount paid',money(order.amount_cents)],
      ['Remaining balance','$0.00']
    ],new Set(['Amount paid','Remaining balance']));

    doc.moveDown(.8).font('Helvetica').fontSize(8.6).fillColor(COLORS.muted).text('This invoice confirms the separate additional-work payment connected to the booking above. It does not replace or change the original cleaning invoice.',left,doc.y,{width});
    const range=doc.bufferedPageRange();
    for(let index=range.start;index<range.start+range.count;index++){doc.switchToPage(index);const margin=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.moveTo(left,doc.page.height-33).lineTo(right,doc.page.height-33).strokeColor(COLORS.line).lineWidth(.5).stroke();doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text('IMAN Cleaning Service LLC - Additional Work Invoice',left,doc.page.height-25,{lineBreak:false});doc.text('929-232-1930  |  www.imancleaningservice.com',left,doc.page.height-25,{width,align:'center',lineBreak:false});doc.text(`Page ${index+1} of ${range.count}`,left,doc.page.height-25,{width,align:'right',lineBreak:false});doc.page.margins.bottom=margin;}
    doc.end();
  });
}

async function sendAdditionalWorkInvoice({booking,order}) {
  if (!booking.email) return {status:'skipped',messageId:'',error:'Customer email is missing.'};
  try {
    const pdf=await buildAdditionalWorkInvoicePdf({booking,order});
    const first=cleanText(booking.client_name,100).split(/\s+/)[0] || 'there';
    const subject=`Paid additional-work invoice — Booking ${booking.estimate?.orderNumber || booking.id}`;
    const text=`Hi ${first},\n\nThe additional work for your cleaning appointment is complete. Your paid invoice is attached for your records.\n\nQuestions? Call 929-232-1930.\n\nIMAN Cleaning Service LLC`;
    const html=`<html><body style="font-family:Arial,sans-serif;color:#243c40;line-height:1.6"><p>Hi ${escape(first)},</p><p>The additional work for your cleaning appointment is complete. Your paid invoice is attached for your records.</p><p>Questions? Call <a href="tel:+19292321930">929-232-1930</a>.</p><p><strong>IMAN Cleaning Service LLC</strong></p></body></html>`;
    const mixed=`iman_aw_invoice_${order.id}`,alt=`iman_aw_invoice_alt_${order.id}`,filename=`IMAN-Additional-Work-Invoice-${order.id}.pdf`;
    const raw=[`From: ${mimeWord('IMAN Cleaning Service LLC')} <${String(process.env.QUOTE_EMAIL_FROM || 'Info@imancleaningservice.com').replace(/[\r\n]/g,'')}>`,`To: ${booking.email}`,`Subject: ${mimeWord(subject)}`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${mixed}"`,'',`--${mixed}`,`Content-Type: multipart/alternative; boundary="${alt}"`,'',`--${alt}`,'Content-Type: text/plain; charset="UTF-8"','',text,`--${alt}`,'Content-Type: text/html; charset="UTF-8"','',html,`--${alt}--`,'',`--${mixed}`,'Content-Type: application/pdf',`Content-Disposition: attachment; filename="${filename}"`,'Content-Transfer-Encoding: base64','',pdf.toString('base64').match(/.{1,76}/g).join('\r\n'),`--${mixed}--`,''].join('\r\n');
    const {gmail}=require('../quote/_shared').getGoogleClients();
    const sent=await gmail.users.messages.send({userId:'me',requestBody:{raw:base64Url(raw)}});
    return {status:'sent',messageId:sent.data.id || '',error:''};
  } catch(error) { return {status:'failed',messageId:'',error:cleanText(error.message,300)}; }
}

module.exports={actualWork,buildAdditionalWorkInvoicePdf,sendAdditionalWorkInvoice};
