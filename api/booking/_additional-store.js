const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const ORDERS = 'iman_additional_work_orders', NOTICES = 'iman_additional_work_notifications';
async function request(path, options = {}) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw fail('Additional-work storage is not configured. Please contact our team.', 503);
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers },
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json();
  if (!response.ok) throw fail(data?.code === 'P0001' ? data.message : 'This request could not be saved. Refresh and try again.', ['P0001','23505'].includes(data?.code) ? 409 : 503);
  return data;
}
const rpc = (name, body) => request(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
async function latest(bookingId) { return (await request(`${ORDERS}?booking_id=eq.${encodeURIComponent(bookingId)}&order=created_at.desc,id.desc&limit=1`))[0] || null; }
async function get(id, bookingId) { return (await request(`${ORDERS}?id=eq.${encodeURIComponent(id)}${bookingId ? `&booking_id=eq.${encodeURIComponent(bookingId)}` : ''}&limit=1`))[0] || null; }
async function patch(order, values, statuses = [order.status]) {
  const rows = await request(`${ORDERS}?id=eq.${order.id}&revision=eq.${order.revision}&status=in.(${statuses.join(',')})&payment_intent_id=${order.payment_intent_id ? 'eq.' + order.payment_intent_id : 'is.null'}`, {
    method: 'PATCH', body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
  if (!rows[0]) throw fail('This request changed. Refresh before continuing.');
  return rows[0];
}
async function notices(id, revision) { return request(`${NOTICES}?order_id=eq.${id}${revision ? `&revision=eq.${revision}` : ''}&order=revision.asc,channel.asc`); }
async function claim(notice) {
  const rows = await request(`${NOTICES}?order_id=eq.${notice.order_id}&revision=eq.${notice.revision}&channel=eq.${notice.channel}&status=eq.pending`, {
    method: 'PATCH', body: JSON.stringify({ status: 'sending', attempted_at: new Date().toISOString() })
  });
  return rows[0] || null;
}
async function finish(notice, result) {
  return request(`${NOTICES}?order_id=eq.${notice.order_id}&revision=eq.${notice.revision}&channel=eq.${notice.channel}&status=eq.sending`, {
    method: 'PATCH', body: JSON.stringify({ status: result.status, provider_id: result.messageId || null, error: result.error || null, sent_at: result.status === 'sent' ? new Date().toISOString() : null })
  });
}
module.exports = { request, rpc, latest, get, patch, notices, claim, finish, fail, ORDERS, NOTICES };
