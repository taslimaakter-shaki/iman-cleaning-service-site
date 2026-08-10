const handlers = {
  availability: () => require("./_availability"),
  checkout: () => require("./_checkout"),
  manage: () => require("./_manage"),
  payments: () => require("./_payments"),
  "saved-quote": () => require("./_saved-quote"),
  reminders: () => require("./_reminders")
};

module.exports = async function handler(request, response) {
  const action = String(request.query?.action || "").trim().toLowerCase();
  const loadHandler = handlers[action];
  if (!loadHandler) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json");
    return response.end(JSON.stringify({ error: "Booking action not found." }));
  }
  return loadHandler()(request, response);
};
