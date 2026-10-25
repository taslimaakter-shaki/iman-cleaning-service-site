const {
  authRequest,
  consumeAccountEmailRateLimit,
  json,
  publicAccountUrl,
  readJsonBody,
  sameOrigin,
  validEmail
} = require("./_shared");

const GENERIC_SUCCESS = "If an account exists for that email, we sent a secure sign-in link.";

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    if (!sameOrigin(request)) return json(response, 403, { error: "Request not allowed." });

    const body = await readJsonBody(request);
    const email = validEmail(body.email);
    if (!email) return json(response, 400, { error: "Enter a valid email address." });

    const rateLimit = consumeAccountEmailRateLimit(request, email, "magic-link");
    if (!rateLimit.allowed) {
      response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      return json(response, 429, { error: "Too many requests. Please wait before trying again." });
    }

    try {
      const redirectTo = publicAccountUrl("/account-confirmed.html");
      await authRequest(`/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: "POST",
        body: { email, create_user: false }
      });
    } catch (error) {
      if (error.setup) throw error;
      if (error.statusCode === 429) {
        throw Object.assign(new Error("Please wait a minute before requesting another secure login link."), {
          statusCode: 429
        });
      }
      if (!error.statusCode || error.statusCode >= 500) {
        console.error("Secure login email delivery failed.", error);
        throw Object.assign(new Error("Secure login email is temporarily unavailable. Please try again shortly."), {
          statusCode: 503
        });
      }
      // Do not reveal whether the email belongs to an existing account.
    }

    return json(response, 200, { ok: true, message: GENERIC_SUCCESS });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Your secure sign-in request could not be completed.",
      setup: error.setup
    });
  }
};
