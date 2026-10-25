const handlers = {
  "additional-work": () => require("./_additional-work"),
  availability: () => require("./_availability"),
  checkout: () => require("./_checkout"),
  manage: () => require("./_manage"),
  payments: () => require("./_payments"),
  promo: () => require("./_promo-validate"),
  "recurring-discount": () => require("./_recurring-discount"),
  "send-management-link": () => require("./_send-management-link"),
  "saved-quote": () => require("./_saved-quote"),
  "quote-reminders": () => require("./_quote-reminders"),
  reminders: () => require("./_reminders")
  ,"same-day": () => require("./_same-day")
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
