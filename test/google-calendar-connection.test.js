const assert = require('node:assert/strict');
const path = require('node:path');
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.ADMIN_TOKEN = 'test-admin';
process.env.SUPABASE_URL = 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
let states = [], saved = [], exchanges = 0, userEmail = 'info@imancleaningservice.com', googleScope = 'https://www.googleapis.com/auth/calendar.events';
class OAuth2Client {
  generateAuthUrl(options) { return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ ...options, scope: options.scope.join(' ') })}`; }
  async getToken(options) { exchanges++; assert(options.codeVerifier.length >= 43); assert.equal(options.redirect_uri, 'https://www.imancleaningservice.com/api/crm/calendar-callback'); return { tokens: { id_token: 'test-id', refresh_token: 'test-private-refresh-token', scope: googleScope } }; }
  async verifyIdToken() { return { getPayload: () => ({ email: userEmail, email_verified: true }) }; }
  setCredentials(value) { this.credentials = value; }
  async getAccessToken() { return { token: 'test-access' }; }
  async getTokenInfo() { return { scopes: [googleScope] }; }
}
require.cache[require.resolve('google-auth-library')] = { exports: { OAuth2Client } };
require.cache[require.resolve('googleapis/build/src/apis/calendar')] = { exports: { calendar: ({ auth }) => ({ events: { list: async options => { assert.equal(options.calendarId, 'info@imancleaningservice.com'); return { data: { accessRole: 'owner', items: [] } }; } } }) } };
global.fetch = async (target, options = {}) => {
  const url = new URL(target), method = options.method || 'GET';
  assert.equal(url.origin, 'https://test.invalid');
  let result;
  if (url.pathname.endsWith('google_calendar_oauth_states')) {
    if (method === 'POST') states.push(JSON.parse(options.body));
    else if (method === 'DELETE' && url.searchParams.has('state_hash')) {
      const index = states.findIndex(row => `eq.${row.state_hash}` === url.searchParams.get('state_hash') && `eq.${row.browser_hash}` === url.searchParams.get('browser_hash') && Date.parse(row.expires_at) > Date.now());
      result = index < 0 ? [] : states.splice(index, 1);
    } else if (method === 'DELETE') states = states.filter(row => Date.parse(row.expires_at) > Date.now());
  } else if (url.pathname.endsWith('google_calendar_connection')) {
    if (method === 'POST') saved = [JSON.parse(options.body)]; else result = saved;
  } else throw Error('Unexpected database route');
  return { ok: true, text: async () => result === undefined ? '' : JSON.stringify(result) };
};
const connection = require('../api/google-calendar/_connection');
const handler = require('../api/google-calendar/_handler');
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = value; } });
const startRequest = () => ({ method: 'POST', query: { action: 'start' }, headers: { 'x-admin-token': 'test-admin', origin: connection.ORIGIN } });
async function attempt() {
  const res = response();
  const result = await connection.begin(startRequest(), res);
  const url = new URL(result.url);
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert(res.headers['Set-Cookie'].includes('HttpOnly; Secure; SameSite=Lax'));
  return { query: { action: 'callback', state: url.searchParams.get('state'), code: 'test-code' }, headers: { cookie: res.headers['Set-Cookie'].split(';')[0] }, method: 'GET' };
}
(async () => {
  const encrypted = connection._test.encrypt('private-test-value');
  assert(!encrypted.includes('private-test-value')); assert.equal(connection._test.decrypt(encrypted), 'private-test-value');
  const parts = encrypted.split('.'); parts[3] = Buffer.from('tampered').toString('base64url'); assert.throws(() => connection._test.decrypt(parts.join('.')));
  await assert.rejects(connection.begin({ ...startRequest(), headers: { origin: connection.ORIGIN } }, response()), /admin password/);
  await assert.rejects(connection.begin({ ...startRequest(), headers: { ...startRequest().headers, origin: 'https://attacker.invalid' } }, response()), /IMAN website/);
  let request = await attempt();
  assert(!JSON.stringify(states).includes('test-private-refresh-token'));
  await assert.rejects(connection.complete({ ...request, headers: {} }, response()), /expired/);
  const wrongCookie = { ...request, headers: { cookie: '__Host-iman_calendar_connect=' + 'A'.repeat(43) } };
  await assert.rejects(connection.complete(wrongCookie, response()), /expired/); assert.equal(exchanges, 0);
  const outcomes = await Promise.allSettled([connection.complete(request, response()), connection.complete(request, response())]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1); assert.equal(exchanges, 1);
  assert.equal(saved.length, 1); assert(!JSON.stringify(saved).includes('test-private-refresh-token'));
  assert.equal((await connection.calendarAuth()).credentials.refresh_token, 'test-private-refresh-token');
  assert.deepEqual(await connection.connectionStatus(), { connected: true, writable: true, calendarId: connection.CALENDAR_ID });
  const original = JSON.stringify(saved);
  userEmail = 'different@example.com'; request = await attempt();
  await assert.rejects(connection.complete(request, response()), /info@imancleaningservice.com/); assert.equal(JSON.stringify(saved), original);
  userEmail = connection.CALENDAR_ID; googleScope = 'https://www.googleapis.com/auth/calendar.events.readonly'; request = await attempt();
  await assert.rejects(connection.complete(request, response()), /approve permission/); assert.equal(JSON.stringify(saved), original);
  request = await attempt(); request.query.error = 'access_denied';
  await assert.rejects(connection.complete(request, response()), /not approved/); assert.equal(JSON.stringify(saved), original);
  request = await attempt(); states[0].expires_at = '2000-01-01T00:00:00Z';
  await assert.rejects(connection.complete(request, response()), /expired/);
  let res = response(); await handler({ method: 'GET', query: { action: 'status' }, headers: {} }, res); assert.equal(res.statusCode, 401);
  res = response(); await handler({ method: 'GET', query: { action: 'callback', code: 'must-not-leak' }, headers: {} }, res);
  assert.equal(res.statusCode, 303); assert.equal(res.headers.Location, `${connection.ORIGIN}/calendar-connect.html?connection_error=1`); assert(!JSON.stringify(res).includes('must-not-leak'));
  if (process.env.PGLITE_TEST_MODULE) {
    const { PGlite } = require(process.env.PGLITE_TEST_MODULE);
    const db = new PGlite();
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(require('node:fs').readFileSync(path.join(__dirname, '../supabase/migrations/20260910_google_calendar_oauth.sql'), 'utf8'));
    const rows = (await db.query("select relname, relrowsecurity from pg_class where relname in ('google_calendar_connection','google_calendar_oauth_states')")).rows;
    assert.equal(rows.length, 2); assert(rows.every(row => row.relrowsecurity));
    assert.equal((await db.query("select has_table_privilege('anon','public.google_calendar_connection','SELECT') as allowed")).rows[0].allowed, false);
    await db.close();
  }
  console.log('Google Calendar connection tests passed: admin/origin guards, browser-bound PKCE, one-time/expired state, identity/scope validation, encrypted private storage, existing-connection preservation, sanitized errors and RLS. No live API calls.');
})().catch(error => { console.error(error); process.exitCode = 1; });
