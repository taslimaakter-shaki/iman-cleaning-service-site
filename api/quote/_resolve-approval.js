const { json } = require("./_shared");
const { resolveShortApproval } = require("./_short-approval");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "GET") return json(response, 405, { error: "Method not allowed." });
    const quote = request.query?.code ? await resolveShortApproval(request.query.code)
      : await require("../crm/_quote-admin").resolveManaged(require("./_shared").verifyQuoteToken(request.query?.token));
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("Referrer-Policy", "no-referrer");
    const slots = !quote.serviceDate && quote.laborHours && quote.cleanerCount
      ? await require("../booking/_shared").availableSlotsForPackage({ teamHours: quote.laborHours / quote.cleanerCount })
      : [];
    return json(response, 200, { quote, slots });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Quote approval link could not be opened."
    });
  }
};
