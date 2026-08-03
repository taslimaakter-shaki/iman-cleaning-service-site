const { authenticatedUser, json, publicUser } = require("./_shared");
const { createBookingManagementToken } = require("../booking/_manage");
const { listCustomerBookings } = require("../booking/_shared");

function siteUrl(request) {
  const configured = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

function safeBooking(booking, email, baseUrl) {
  const payment = booking.estimate?.payment || {};
  const token = createBookingManagementToken({ bookingId: booking.id, email });
  return {
    id: booking.id,
    status: booking.status,
    service: booking.service_label || booking.service,
    serviceKey: booking.service,
    schedule: booking.schedule,
    scheduleLabel: booking.schedule_label,
    address: booking.address,
    total: Number(booking.estimate?.total || booking.estimate?.high || booking.estimate?.low || 0),
    invoiceUrl: payment.invoicePdf || payment.invoiceUrl || payment.receiptUrl || "",
    manageUrl: `${baseUrl}/manage-booking.html?token=${encodeURIComponent(token)}`,
    rebookUrl: `${baseUrl}/book-now.html?service=${encodeURIComponent(booking.service || "")}`
  };
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "GET") return json(response, 405, { error: "Method not allowed." });
    const session = await authenticatedUser(request, response, { required: true });
    const email = String(session.user.email || "").trim().toLowerCase();
    const records = await listCustomerBookings(email);
    const baseUrl = siteUrl(request);
    return json(response, 200, {
      user: publicUser(session.user),
      bookings: (records || []).map((booking) => safeBooking(booking, email, baseUrl))
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Your account could not be loaded.",
      setup: error.setup
    });
  }
};
