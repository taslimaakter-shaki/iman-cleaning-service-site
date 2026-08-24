const {
  json,
  oauthAuthorizeUrl,
  publicAccountUrl,
  sameOrigin
} = require("./_shared");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    if (!sameOrigin(request)) return json(response, 403, { error: "Request not allowed." });

    const redirectTo = publicAccountUrl("/account-confirmed.html");
    return json(response, 200, {
      ok: true,
      url: oauthAuthorizeUrl("google", redirectTo)
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Google login is temporarily unavailable. Please try again.",
      setup: error.setup
    });
  }
};
