const {
  authRequest,
  consumeAccountEmailRateLimit,
  json,
  publicAccountUrl,
  readJsonBody,
  sameOrigin,
  validEmail
} = require("./_shared");

const GENERIC_SUCCESS = "If an account exists for that email, we sent a secure password-reset link.";

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    if (!sameOrigin(request)) return json(response, 403, { error: "Request not allowed." });

    const body = await readJsonBody(request);
    const email = validEmail(body.email);
    if (!email) return json(response, 400, { error: "Enter a valid email address." });

    const rateLimit = consumeAccountEmailRateLimit(request, email, "forgot-password");
    if (!rateLimit.allowed) {
      response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      return json(response, 429, { error: "Too many requests. Please wait before trying again." });
    }

    try {
      const redirectTo = publicAccountUrl("/reset-password.html");
      await authRequest(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: "POST",
        body: { email }
      });
    } catch (error) {
      if (error.setup) throw error;
      if (error.statusCode === 429) {
        throw Object.assign(new Error("Please wait a minute before requesting another password-reset email."), {
          statusCode: 429
        });
      }
      if (!error.statusCode || error.statusCode >= 500) {
        console.error("Password-reset email delivery failed.", error);
        throw Object.assign(new Error("Password-reset email is temporarily unavailable. Please try again shortly."), {
          statusCode: 503
        });
      }
      // Supabase returns the same privacy-preserving result for unknown accounts.
    }

    return json(response, 200, { ok: true, message: GENERIC_SUCCESS });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Your password-reset request could not be completed.",
      setup: error.setup
    });
  }
};
