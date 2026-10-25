const store = require('../booking/_shared');
const allowed = new Set(['Confirmed', 'Cleaner assigned', 'In progress']);
const PAGE_SIZE = 10;

async function syncExistingBookings(offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    throw Object.assign(new Error('Invalid calendar sync page.'), { statusCode: 400 });
  }
  // Include yesterday in the storage query, then compare actual instants below.
  // Older deployments stored ISO timestamps with differing time-zone offsets.
  const since = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const records = await store.supabaseRequest(`?select=*&status=in.(Confirmed,Cleaner%20assigned,In%20progress)&schedule=gte.${since}&order=schedule.asc,id.asc&limit=${PAGE_SIZE + 1}&offset=${offset}`);
  const results = [];
  for (const record of (records || []).slice(0, PAGE_SIZE)) {
    try {
      // Re-read just before syncing; do not revive cancelled or unpaid bookings.
      const booking = await store.getBooking(record.id);
      if (!booking || !allowed.has(booking.status) || !(Date.parse(booking.schedule) > Date.now())) {
        results.push({ bookingId: record.id, status: 'skipped' });
        continue;
      }
      const result = await store.syncBookingToGoogleCalendar(booking, { notifyCustomer: false });
      results.push({ bookingId: booking.id, ...result });
    } catch {
      results.push({ bookingId: record.id, status: 'error' });
    }
  }
  return { results, nextOffset: records?.length > PAGE_SIZE ? offset + PAGE_SIZE : null };
}
module.exports = { syncExistingBookings };
