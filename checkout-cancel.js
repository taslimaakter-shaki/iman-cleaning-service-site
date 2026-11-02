(async function () {
  const token = location.hash.slice(1);
  const status = document.getElementById('status'), retry = document.getElementById('retry');
  async function cancel() {
    retry.hidden = true;
    try {
      const response = await fetch('/api/booking/hosted-cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not verify payment status.');
      const destination = new URL(data.returnPath, location.origin);
      if (destination.origin !== location.origin) throw new Error('Invalid return address.');
      location.replace(destination.href);
    } catch (error) { status.textContent = error.message; retry.hidden = false; }
  }
  retry.addEventListener('click', cancel);
  await cancel();
})();
