const { accountConfigAvailable, authenticatedUser, json, publicUser } = require("./_shared");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "GET") return json(response, 405, { error: "Method not allowed." });
    const session = await authenticatedUser(request, response);
    return json(response, 200, {
      available: accountConfigAvailable(),
      signedIn: Boolean(session),
      user: publicUser(session?.user)
    });
  } catch (error) {
    return json(response, error.statusCode || 500, { error: error.message || "Account session could not be checked." });
  }
};
