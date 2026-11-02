const { json, listActiveBookings } = require('./_shared');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return json(res, 401, { error: 'Unauthorized.' });
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  try {
    // Reconciliation verifies/ends Stripe sessions before releasing capacity.
    await listActiveBookings();
    return json(res, 200, { checked: true });
  } catch { return json(res, 503, { error: 'Checkout expiry check could not complete.' }); }
};
