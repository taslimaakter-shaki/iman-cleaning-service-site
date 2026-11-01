(() => {
 'use strict';
 const token=location.hash.slice(1), $=id=>document.getElementById(id);
 let stripe,elements,busy=false,current='loading';
 const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
 const message=(text,error=false)=>{$('message').textContent=text;$('message').className=error?'error':'';};
 function controls(){ $('pay').disabled=busy || !['draft','cancelled'].includes(current); $('status').disabled=busy; $('cancel').disabled=busy || current==='paid'; }
 async function call(action,extra={}) {
  const response=await fetch('/api/booking/deposit-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,action,...extra})});
  const data=await response.json();if(!response.ok)throw new Error(data.error || 'Payment could not be checked. Please try again.');return data;
 }
 async function show(data,verifyCard=false){
  current=data.status;controls();
  if(current==='paid'){message('Payment received. Opening your booking confirmation…');location.replace(data.confirmationUrl);return;}
  if(current==='requires_action'){
   message('Your bank needs to verify this payment.');
   if(verifyCard && data.clientSecret){
    const result=await stripe.handleNextAction({clientSecret:data.clientSecret});
    if(result.error){const updated=await call('cancel');await show(updated);message(updated.status==='cancelled'?'Payment was not completed. Your reservation has been released. You can try again.':'Payment is still being verified. Check its status before trying again.',true);}
    else await show(await call('status'));
   }
  } else if(['creating','ready','processing'].includes(current))message('Your payment is being verified. Please use Check payment status before trying again.');
  else if(current==='cancelled')message('Payment was cancelled and the reservation was released. You can try again if the appointment is still available.');
 }
 $('payment-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy || !['draft','cancelled'].includes(current))return;busy=true;controls();message('Checking your payment details…');
  try {
   const submitted=await elements.submit();if(submitted.error)throw new Error(submitted.error.message);
   const result=await stripe.createConfirmationToken({elements});if(result.error)throw new Error(result.error.message);
   current='processing';message('Checking availability and submitting your payment…');
   await show(await call('pay',{confirmationToken:result.confirmationToken.id}),true);
  } catch(error){message(error.message,true);try{await show(await call('status'));message(error.message,true);}catch{message('We could not verify the payment yet. Please use Check payment status before trying again.',true);}}
  finally{busy=false;controls();}
 });
 $('status').addEventListener('click',async()=>{if(busy)return;busy=true;controls();try{await show(await call('status'),true);}catch(e){message(e.message,true);}finally{busy=false;controls();}});
 $('cancel').addEventListener('click',async()=>{if(busy)return;busy=true;controls();try{const data=await call('cancel');await show(data);if(['draft','cancelled'].includes(data.status))location.assign('/book-now.html?payment=cancelled');}catch(e){message(e.message,true);}finally{busy=false;controls();}});
 (async()=>{try{
  if(!token)throw new Error('Reopen your booking link to start secure payment.');
  const data=await call('load');
  $('service').textContent=data.service;$('schedule').textContent=data.scheduleLabel;$('total').textContent=money(data.total);$('amount').textContent=money(data.amount);$('terms').textContent=data.paymentTerms;$('pay').textContent=`Pay ${money(data.amount)}`;
  stripe=Stripe(data.publishableKey);elements=stripe.elements({mode:'payment',amount:data.amount,currency:'usd',paymentMethodCreation:'manual',paymentMethodTypes:['card'],setupFutureUsage:'off_session',appearance:{theme:'stripe',variables:{colorPrimary:'#175d54',borderRadius:'8px'}}});
  elements.create('payment',{layout:'tabs'}).mount('#payment-element');await show(data);
 }catch(e){message(e.message,true);$('pay').textContent='Payment unavailable';}})();
})();
