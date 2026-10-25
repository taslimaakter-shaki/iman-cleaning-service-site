const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const { calendar: createCalendar } = require('googleapis/build/src/apis/calendar');

const CALENDAR_ID = 'info@imancleaningservice.com';
const ORIGIN = 'https://www.imancleaningservice.com';
const REDIRECT_URI = `${ORIGIN}/api/crm/calendar-callback`;
const COOKIE = '__Host-iman_calendar_connect';
const EVENT_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const fail = (message, statusCode = 503) => Object.assign(new Error(message), { statusCode });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function encryptionKey() {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw fail('Google Calendar setup is not configured.');
  return crypto.createHash('sha256').update(`iman-calendar-credentials-v1:${secret}`).digest();
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(CALENDAR_ID));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
function decrypt(value) {
  const [version, iv, tag, body] = String(value).split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw fail('Please reconnect Google Calendar.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(CALENDAR_ID));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}
async function database(path, options = {}) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw fail('Google Calendar storage is not configured.');
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw fail('Google Calendar storage is temporarily unavailable.');
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
function newAuth() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw fail('Google Calendar setup is not configured.');
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, REDIRECT_URI);
}
function isAdmin(request) {
  const expected = Buffer.from(String(process.env.ADMIN_TOKEN || ''));
  const provided = Buffer.from(String(request.headers?.['x-admin-token'] || ''));
  return expected.length > 0 && provided.length === expected.length && crypto.timingSafeEqual(expected, provided);
}
function browserCookie(request) {
  const entry = String(request.headers?.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`));
  const value = entry?.slice(COOKIE.length + 1) || '';
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
}
function setCookie(response, value, maxAge = 600) {
  response.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}
async function begin(request, response) {
  if (!isAdmin(request)) throw fail('Sign in with your CRM admin password first.', 401);
  if (request.headers.origin !== ORIGIN) throw fail('Open this page on the IMAN website.', 403);
  const state = crypto.randomBytes(32).toString('base64url');
  const browser = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  await database(`google_calendar_oauth_states?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, { method: 'DELETE' });
  await database('google_calendar_oauth_states', { method: 'POST', body: JSON.stringify({
    state_hash: hash(state), browser_hash: hash(browser), verifier_encrypted: encrypt(verifier),
    expires_at: new Date(Date.now() + 600000).toISOString()
  }) });
  const url = newAuth().generateAuthUrl({
    access_type: 'offline', prompt: 'consent', include_granted_scopes: true,
    scope: ['openid', 'email', EVENT_SCOPE], state, login_hint: CALENDAR_ID,
    code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url')
  });
  setCookie(response, browser);
  return { url };
}
async function complete(request, response) {
  const state = request.query?.state, browser = browserCookie(request);
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state) || !browser) throw fail('This connection attempt expired. Please start again.', 400);
  // Atomically consume a browser-bound, unexpired attempt before exchanging a code.
  const attempts = await database(`google_calendar_oauth_states?state_hash=eq.${hash(state)}&browser_hash=eq.${hash(browser)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, {
    method: 'DELETE', headers: { Prefer: 'return=representation' }
  });
  setCookie(response, '', 0);
  if (!attempts?.[0]) throw fail('This connection attempt expired or was already used. Please start again.', 400);
  if (request.query?.error) throw fail('Google access was not approved. Your existing connections have not changed.', 400);
  const code = request.query?.code;
  if (typeof code !== 'string' || !code || code.length > 4096) throw fail('Google did not return an authorization code. Please start again.', 400);
  const auth = newAuth();
  const { tokens } = await auth.getToken({ code, codeVerifier: decrypt(attempts[0].verifier_encrypted), redirect_uri: REDIRECT_URI });
  if (!tokens.id_token || !tokens.refresh_token) throw fail('Google did not grant ongoing access. Please reconnect and approve Calendar access.', 400);
  const identity = (await auth.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID })).getPayload();
  if (identity?.email_verified !== true || String(identity.email).toLowerCase() !== CALENDAR_ID) throw fail(`Please connect using ${CALENDAR_ID}. Your existing connections have not changed.`, 400);
  auth.setCredentials(tokens);
  const scopes = (tokens.scope || '').split(/\s+/);
  if (!scopes.includes(EVENT_SCOPE) && !scopes.includes('https://www.googleapis.com/auth/calendar')) throw fail('Please approve permission to manage Calendar events.', 400);
  const calendar = createCalendar({ version: 'v3', auth });
  const result = await calendar.events.list({ calendarId: CALENDAR_ID, maxResults: 1, timeMin: new Date().toISOString() });
  if (!['owner', 'writer'].includes(result.data.accessRole)) throw fail('This Google account cannot update the business calendar.', 403);
  await database('google_calendar_connection?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({
    id: 'business', calendar_id: CALENDAR_ID, account_email: CALENDAR_ID,
    token_encrypted: encrypt(tokens.refresh_token), updated_at: new Date().toISOString()
  }) });
  // Calendar gets a separate encrypted credential; Gmail/Drive environment values are untouched.
  return { connected: true, calendarId: CALENDAR_ID };
}
async function calendarAuth() {
  const rows = await database('google_calendar_connection?id=eq.business&select=calendar_id,token_encrypted');
  if (rows?.[0]) {
    if (rows[0].calendar_id !== CALENDAR_ID) throw fail('The saved calendar does not match the business calendar.');
    const auth = newAuth();
    auth.setCredentials({ refresh_token: decrypt(rows[0].token_encrypted) });
    return auth;
  }
  return require('../quote/_shared').getGoogleClients().auth;
}
async function connectionStatus() {
  const auth = await calendarAuth();
  const calendar = createCalendar({ version: 'v3', auth });
  const result = await calendar.events.list({ calendarId: CALENDAR_ID, maxResults: 1, timeMin: new Date().toISOString() });
  const { token } = await auth.getAccessToken();
  const info = await auth.getTokenInfo(token);
  const scopes = info.scopes || [], role = result.data.accessRole;
  const writable = ['owner', 'writer'].includes(role) && (scopes.includes(EVENT_SCOPE) || scopes.includes('https://www.googleapis.com/auth/calendar') || (role === 'owner' && scopes.includes('https://www.googleapis.com/auth/calendar.events.owned')));
  return { connected: true, writable, calendarId: CALENDAR_ID };
}
module.exports = { CALENDAR_ID, ORIGIN, REDIRECT_URI, begin, complete, calendarAuth, connectionStatus, isAdmin };
module.exports._test = { encrypt, decrypt, hash, browserCookie };
