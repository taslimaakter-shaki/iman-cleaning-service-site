const routes = {
  "send-link": () => require("./_send-link"),
  start: () => require("./_start"),
  "upload-url": () => require("./_upload-url"),
  finish: () => require("./_finish")
};

module.exports = async function handler(request, response) {
  const action = String(request.query?.action || new URL(request.url || "", "https://www.imancleaningservice.com").pathname.split("/").filter(Boolean).pop() || "");
  const load = routes[action];
  if (!load) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json");
    return response.end(JSON.stringify({ error: "Service concern endpoint was not found." }));
  }
  return load()(request, response);
};
