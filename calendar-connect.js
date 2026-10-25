(() => {
  'use strict';
  const form = document.getElementById('calendar-connect-form');
  const button = document.getElementById('connect-button');
  const login = document.getElementById('admin-login');
  const password = document.getElementById('admin-password');
  const status = document.getElementById('connection-status');
  const existing = document.getElementById('existing-bookings');
  const syncButton = document.getElementById('sync-bookings');
  const syncStatus = document.getElementById('sync-status');
  let token = sessionStorage.getItem('imanCrmAdminToken') || '';
  login.hidden = Boolean(token);
  const params = new URLSearchParams(location.search);
  if (params.has('connection_error')) status.textContent = 'Google Calendar was not connected. Please try again using info@imancleaningservice.com and approve Calendar access. Existing connections have not changed.';
  async function check() {
    if (!token) return;
    try {
      const response = await fetch('/api/crm/calendar-status', { headers: { 'x-admin-token': token }, cache: 'no-store' });
      const result = await response.json();
      if (response.ok && result.connected && result.writable) {
        status.textContent = 'Booking calendar sync is active for info@imancleaningservice.com. Confirmed bookings sync to Google Calendar, and busy calendar events are checked when offering appointment times.';
        button.textContent = 'Reconnect Google Calendar';
        existing.hidden = false;
      } else if (response.status === 401) { token = ''; login.hidden = false; }
    } catch { status.textContent = 'The connection status could not be checked. Please try again.'; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const adminToken = token || password.value.trim();
    if (!adminToken) { status.textContent = 'Enter your CRM admin password to continue.'; password.focus(); return; }
    button.disabled = true; status.textContent = 'Opening Google authorization…';
    try {
      const response = await fetch('/api/crm/calendar-start', { method: 'POST', headers: { 'x-admin-token': adminToken, 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The connection could not be started.');
      const destination = new URL(result.url);
      if (destination.origin !== 'https://accounts.google.com') throw new Error('The authorization address could not be verified.');
      sessionStorage.setItem('imanCrmAdminToken', adminToken);
      password.value = '';
      location.assign(destination.href);
    } catch (error) { status.textContent = error.message; button.disabled = false; }
  });
  syncButton.addEventListener('click', async () => {
    if (syncButton.disabled) return;
    syncButton.disabled = true;
    syncStatus.textContent = 'Syncing existing confirmed bookings…';
    let offset = 0, created = 0, kept = 0, failed = 0;
    try {
      do {
        const response = await fetch('/api/crm/calendar-sync', { method: 'POST', headers: { 'x-admin-token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ offset }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Calendar sync could not finish. Please try again.');
        for (const item of result.results || []) {
          if (item.status === 'created') created++;
          else if (item.status === 'already_exists') kept++;
          else if (item.status !== 'skipped') failed++;
        }
        if (result.nextOffset !== null && (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset)) throw new Error('Calendar sync paused. Please try again.');
        offset = result.nextOffset;
      } while (offset !== null);
      syncStatus.textContent = `${created} appointment${created === 1 ? '' : 's'} added. ${kept} already in Google Calendar. No customer notifications sent.${failed ? ` ${failed} could not be synced; please try again.` : ''}`;
    } catch (error) { syncStatus.textContent = `${error.message} Any appointments already copied will not be duplicated.`; }
    finally { syncButton.disabled = false; }
  });
  check();
})();
