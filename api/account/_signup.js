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
    const fullName = cleanText(body.fullName, 160);
    const phone = cleanText(body.phone, 40);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json(response, 400, { error: "Enter a valid email address." });
    }
    if (password.length < 8) {
      return json(response, 400, { error: "Create a password with at least 8 characters." });
    }
    const result = await authRequest("/signup", {
      method: "POST",
      body: {
        email,
        password,
        data: { full_name: fullName, phone }
      }
    });
    if (result.access_token) setSessionCookies(response, result);
    return json(response, 201, {
      ok: true,
      signedIn: Boolean(result.access_token),
      requiresEmailConfirmation: !result.access_token,
      user: publicUser(result.user)
    });
  } catch (error) {
    const duplicate = /already|registered|exists/i.test(error.message || "");
    return json(response, duplicate ? 409 : (error.statusCode || 500), {
      error: duplicate ? "An account already uses this email. Please log in instead." : (error.message || "Your account could not be created."),
      setup: error.setup
    });
  }
};
