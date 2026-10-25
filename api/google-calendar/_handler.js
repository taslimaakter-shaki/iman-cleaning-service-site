const connection = require('./_connection');
function json(response, status, value) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}
module.exports = async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const action = String(request.query?.action || '').replace(/^calendar-/, '');
  try {
    if (action === 'callback') {
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
      await connection.complete(request, response);
      response.statusCode = 303;
      response.setHeader('Location', `${connection.ORIGIN}/calendar-connect.html?connected=1`);
      return response.end();
    }
    if (!['start', 'status', 'sync'].includes(action)) return json(response, 404, { error: 'Not found.' });
    if (!connection.isAdmin(request)) return json(response, 401, { error: 'Sign in with your CRM admin password first.' });
    if (action === 'sync' && request.method === 'POST') {
      if (request.headers.origin !== connection.ORIGIN) return json(response, 403, { error: 'Open this page on the IMAN website.' });
      const body = await require('../booking/_shared').readJsonBody(request);
      return json(response, 200, await require('./_backfill').syncExistingBookings(body.offset ?? 0));
    }
    if (action === 'start' && request.method === 'POST') return json(response, 200, await connection.begin(request, response));
    if (action === 'status' && request.method === 'GET') return json(response, 200, await connection.connectionStatus());
    return json(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    if (action === 'callback') {
      response.statusCode = 303;
      response.setHeader('Location', `${connection.ORIGIN}/calendar-connect.html?connection_error=1`);
      return response.end();
    }
    // Never return Google client errors, authorization codes or tokens to a browser.
    return json(response, error.statusCode || 503, { error: error.statusCode ? error.message : 'Google Calendar needs authorization. Please connect with the business account.' });
  }
};
