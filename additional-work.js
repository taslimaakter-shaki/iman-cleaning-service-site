(() => {
  'use strict';
  const $ = name => document.querySelector('[data-' + name + ']');
  const token = new URLSearchParams(location.search).get('token') || '';
  // Keep bank-return parameters and payment secrets out of subsequent navigation.
  history.replaceState(null, '', location.pathname + '?token=' + encodeURIComponent(token));
  const money = cents => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(cents / 100);
  let order = null, previousId = null, busy = false, verification = null;
  async function call(action, extra = {}) {
    const r = await fetch('/api/booking/additional-work', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ token, action, orderId:order?.id, revision:order?.revision, ...extra }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'This request could not be completed. Please check its status.');
    return data;
  }
  function values() {
    const h = $('hours').value, m = $('minutes').value;
    if (!/^\d+$/.test(h) || !/^\d+$/.test(m) || Number(m) > 60 || !Number.isSafeInteger(Number(h))) throw new Error('Enter whole hours starting at 0 and minutes from 0 to 60.');
    const total = Number(h) * 60 + Number(m);
    if (!Number.isSafeInteger(total) || total > 749999) throw new Error('This amount exceeds the payment limit. Please contact our team.');
    return { hours:Number(h), minutes:Number(m), total };
  }
  function updateTotal() {
    $('consent').checked = false;
    try { $('total').textContent = money(Math.round(values().total * 8000 / 60)); } catch { $('total').textContent = '—'; }
  }
  function render(data) {
    order = data.order;
    verification = data;
    $('consent').checked = false;
    $('edit').hidden = !!order;
    const review = order && ['draft','setting_up'].includes(order.status);
    $('review').hidden = !review;
    $('result').hidden = !order || !!review;
    if (!order) return;
    if (review) {
      $('hours').value = order.hours; $('minutes').value = order.minutes; updateTotal();
      $('summary').textContent = order.duration + ' of additional labor — ' + money(order.amountCents) + ' total.';
      $('card').textContent = order.card ? 'Payment method: ' + order.card : 'Add a card securely. Saving a card does not charge it; you will return here to review and approve.';
      const canApprove = order.status === 'draft' && !!order.card;
      $('consent-row').hidden = !canApprove; $('approve').hidden = !canApprove;
      $('consent-text').textContent = order.consent || '';
      $('approve').textContent = 'Approve & authorize ' + money(order.amountCents);
      $('edit-button').hidden = order.status !== 'draft';
      $('card-button').textContent = order.status === 'setting_up' ? 'Continue secure card setup' : (order.card ? 'Use a different card' : 'Add a card securely');
      return;
    }
    const paid = order.status === 'paid';
    $('result-title').textContent = paid ? 'Additional payment received' : 'Additional work approved';
    $('result-text').textContent = paid ? money(order.amountCents) + ' was charged successfully to your ' + order.card + '.' : (order.error || 'Your approval is recorded. Payment has not yet been confirmed.');
    $('result-details').textContent = order.duration + ' of additional labor · ' + money(order.amountCents) + ' · ' + order.card + ' · Reference: ' + order.id;
    $('check').hidden = paid;
    $('verify').hidden = order.status !== 'requires_action' || !(data.verificationUrl || data.clientSecret);
    $('resume').hidden = order.status !== 'approved';
    $('retry').hidden = !['payment_failed','requires_action'].includes(order.status);
    $('new').hidden = !['paid','canceled'].includes(order.status);
  }
  async function run(task) {
    if (busy) return;
    busy = true; $('status').textContent = '';
    const buttons = [...document.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true);
    try { await task(); } catch (error) { $('status').textContent = error.message; }
    finally { busy = false; buttons.forEach(b => b.disabled = false); }
  }
  function redirect(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !(url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com'))) throw new Error('The secure payment link could not be verified. Please contact our team.');
    location.assign(url.href);
  }
  async function pay() {
    $('status').textContent = 'Recording your approval and checking payment…';
    try { render(await call('approve', { accepted:true })); $('status').textContent = ''; }
    catch (error) { try { render(await call('status')); } catch {} throw error; }
  }
  $('hours').addEventListener('input', updateTotal); $('minutes').addEventListener('input', updateTotal);
  $('minutes').addEventListener('change', () => {
    try { const v = values(); if (v.minutes === 60) { $('hours').value = v.hours + 1; $('minutes').value = 0; } } catch {}
    updateTotal();
  });
  $('form').addEventListener('submit', e => { e.preventDefault(); run(async () => {
    const v = values(); if (!v.total) throw new Error('Choose at least 1 minute of additional work.');
    render(await call('prepare', { hours:v.hours, minutes:v.minutes, previousId }));
  }); });
  $('edit-button').addEventListener('click', () => { $('consent').checked = false; $('review').hidden = true; $('edit').hidden = false; });
  $('approve').addEventListener('click', () => run(async () => {
    if (!$('consent').checked) throw new Error('Please check the box to approve the time, amount and card charge.');
    await pay();
  }));
  $('resume').addEventListener('click', () => run(pay));
  $('check').addEventListener('click', () => run(async () => render(await call('status'))));
  $('card-button').addEventListener('click', () => run(async () => {
    if (order.card && order.status === 'draft') render(await call('change-card'));
    const data = await call('setup'); render(data);
    if (data.setupUrl) redirect(data.setupUrl);
    else render(await call('setup-return'));
  }));
  $('retry').addEventListener('click', () => run(async () => {
    render(await call('change-card'));
    const data = await call('setup'); render(data); redirect(data.setupUrl);
  }));
  $('verify').addEventListener('click', () => run(async () => {
    if (verification.verificationUrl) return redirect(verification.verificationUrl);
    if (!window.Stripe || !verification.publishableKey || !verification.clientSecret) throw new Error('Bank verification could not load. Please refresh or contact our team.');
    const result = await window.Stripe(verification.publishableKey).handleNextAction({ clientSecret:verification.clientSecret });
    render(await call('status'));
    if (result.error) throw new Error('Bank verification was not completed. No successful payment has been confirmed.');
  }));
  $('new').addEventListener('click', () => { previousId = order.id; render({ order:null }); $('hours').value = 0; $('minutes').value = 0; updateTotal(); });
  (async () => {
    try {
      const r = await fetch('/api/booking/additional-work?token=' + encodeURIComponent(token));
      const data = await r.json(); if (!r.ok) throw new Error(data.error || 'This link is unavailable.');
      $('customer').textContent = data.customerName; $('booking').textContent = data.bookingId; $('service').textContent = data.service;
      render(data); $('loading').hidden = true; $('form').hidden = false;
      if (order?.status === 'setting_up') await run(async () => render(await call('setup-return')));
      else if (order?.approvedAt && order.status !== 'paid') await run(async () => render(await call('status')));
    } catch (error) { $('loading').textContent = error.message; }
  })();
})();
