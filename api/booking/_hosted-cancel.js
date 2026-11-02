const crypto = require('crypto');
const shared = () => require('./_shared');
const secret = () => process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
function cancelUrl(origin, bookingId, attempt, returnPath = '/book-now.html?payment=cancelled') {
  const payload = Buffer.from(JSON.stringify({ bookingId, attempt, returnPath })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret()).update(`hosted-cancel:${payload}`).digest('hex');
  return `${origin}/checkout-cancel.html#${payload}.${signature}`;
}
function verify(token) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (extra || !payload || !/^[a-f0-9]{64}$/.test(signature || '')) throw new Error('Invalid checkout cancellation link.');
  const expected = crypto.createHmac('sha256', secret()).update(`hosted-cancel:${payload}`).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('Invalid checkout cancellation link.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}
async function handler(req, res) {
  if (req.method !== 'POST') return shared().json(res, 405, { error: 'Method not allowed.' });
  try {
    const body = await shared().readJsonBody(req);
    let data;
    try { data = verify(body.token); } catch { return shared().json(res, 403, { error: 'Invalid checkout cancellation link.' }); }
    await require('./_calendar').expireBookingCheckout(data.bookingId, data.attempt);
    return shared().json(res, 200, { returnPath: data.returnPath });
  } catch (error) {
    return shared().json(res, error.statusCode || 503, { error: error.message || 'Payment status could not be checked. Please try again.' });
  }
}
module.exports = { cancelUrl, verify, handler };
