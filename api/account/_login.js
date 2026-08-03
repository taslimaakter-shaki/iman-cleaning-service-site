const {
  authRequest,
  cleanText,
  json,
  publicUser,
  readJsonBody,
  sameOrigin,
  setSessionCookies
} = require("./_shared");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    if (!sameOrigin(request)) return json(response, 403, { error: "Request not allowed." });
    const body = await readJsonBody(request);
    const email = cleanText(body.email, 180).toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return json(response, 400, { error: "Enter your email and password." });
    const session = await authRequest("/token?grant_type=password", {
      method: "POST",
      body: { email, password }
    });
    setSessionCookies(response, session);
    return json(response, 200, { ok: true, user: publicUser(session.user) });
  } catch (error) {
    const unauthorized = [400, 401].includes(error.statusCode);
    return json(response, unauthorized ? 401 : (error.statusCode || 500), {
      error: unauthorized ? "The email or password is incorrect, or the email has not been verified yet." : (error.message || "Login failed."),
      setup: error.setup
    });
  }
};
