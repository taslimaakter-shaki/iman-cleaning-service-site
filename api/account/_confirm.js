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
    const accessToken = cleanText(body.accessToken, 5000);
    const refreshToken = cleanText(body.refreshToken, 5000);
    const expiresIn = Math.max(60, Math.min(86400, Number(body.expiresIn || 3600)));
    if (!accessToken || !refreshToken) {
      return json(response, 400, { error: "The confirmation link is incomplete. Please log in with your email and password." });
    }

    const user = await authRequest("/user", { accessToken });
    setSessionCookies(response, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn
    });
    return json(response, 200, { ok: true, user: publicUser(user) });
  } catch (error) {
    return json(response, [400, 401, 403].includes(error.statusCode) ? 401 : (error.statusCode || 500), {
      error: [400, 401, 403].includes(error.statusCode)
        ? "This confirmation link has expired or was already used. Please log in with your email and password."
        : (error.message || "Your email confirmation could not be completed.")
    });
  }
};
