const handlers = {
  confirm: () => require("./_confirm"),
  dashboard: () => require("./_dashboard"),
  "forgot-password": () => require("./_forgot-password"),
  login: () => require("./_login"),
  logout: () => require("./_logout"),
  "magic-link": () => require("./_magic-link"),
  "reset-password": () => require("./_reset-password"),
  session: () => require("./_session"),
  signup: () => require("./_signup")
};

module.exports = async function handler(request, response) {
  const action = String(request.query?.action || "").trim().toLowerCase();
  const loadHandler = handlers[action];
  if (!loadHandler) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    return response.end(JSON.stringify({ error: "Account action not found." }));
  }
  return loadHandler()(request, response);
};
