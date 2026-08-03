const { authenticatedUser, authRequest, clearSessionCookies, json, sameOrigin } = require("./_shared");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    if (!sameOrigin(request)) return json(response, 403, { error: "Request not allowed." });
    const session = await authenticatedUser(request, response);
    if (session?.accessToken) {
      await authRequest("/logout", { method: "POST", accessToken: session.accessToken }).catch(() => {});
    }
    clearSessionCookies(response);
    return json(response, 200, { ok: true });
  } catch {
    clearSessionCookies(response);
    return json(response, 200, { ok: true });
  }
};
