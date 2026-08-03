const routes = {
  "approval-link": () => require("./_approval-link"),
  "approve-checkout": () => require("./_approve-checkout"),
  finish: () => require("./_finish"),
  "payment-record": () => require("./_payment-record"),
  photo: () => require("./_photo"),
  "send-link": () => require("./_send-link"),
  start: () => require("./_start")
};

function json(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function getAction(request) {
  const queryAction = request.query?.action;
  if (Array.isArray(queryAction)) return String(queryAction[0] || "");
  if (queryAction) return String(queryAction);

  const url = new URL(request.url || "", "https://www.imancleaningservice.com");
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

module.exports = async function handler(request, response) {
  const action = getAction(request);
  const loadRoute = routes[action];
  if (!loadRoute) {
    return json(response, 404, { error: "Quote endpoint was not found." });
  }

  return loadRoute()(request, response);
};
