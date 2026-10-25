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
    const password = String(body.password || "");
    const requestedExpiresIn = Number(body.expiresIn);
    const expiresIn = Number.isFinite(requestedExpiresIn)
      ? Math.max(60, Math.min(86400, requestedExpiresIn))
      : 3600;
    if (!accessToken || !refreshToken) {
      return json(response, 400, { error: "This password-reset link is incomplete or has expired." });
    }
    if (password.length < 8) {
      return json(response, 400, { error: "Create a password with at least 8 characters." });
    }

    const user = await authRequest("/user", {
      method: "PUT",
      accessToken,
      body: { password }
    });
    await authRequest("/logout?scope=others", { method: "POST", accessToken }).catch((error) => {
      console.error("Other customer sessions could not be revoked after password recovery.", error);
    });
    setSessionCookies(response, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn
    });
    return json(response, 200, { ok: true, user: publicUser(user) });
  } catch (error) {
    const invalidLink = [400, 401, 403].includes(error.statusCode);
    return json(response, invalidLink ? 401 : (error.statusCode || 500), {
      error: invalidLink
        ? "This password-reset link has expired or was already used. Request a new link and try again."
        : (error.message || "Your password could not be updated."),
      setup: error.setup
    });
  }
};
