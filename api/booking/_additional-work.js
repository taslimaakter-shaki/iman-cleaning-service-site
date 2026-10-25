const crypto = require("crypto");
const {
  cleanText,
  getBooking,
  json,
  readJsonBody,
  updateBookingEstimate
} = require("./_shared");
const {
  sendAdditionalWorkOfferEmail,
  sendAdditionalWorkOfferSms
} = require("./_notifications");

const LABOR_HOUR_RATE_CENTS = 8000;
const MIN_LABOR_HOURS = 0.5;
const MAX_LABOR_HOURS = 24;

function siteUrl(request) {
  const configured = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

function signingSecret() {
  return String(process.env.BOOKING_MANAGEMENT_SECRET || process.env.ADMIN_TOKEN || "");
}

function signatureFor(bookingId, secret = signingSecret()) {
  if (!secret) throw Object.assign(new Error("Additional-work links are not configured."), { statusCode: 503 });
  return crypto.createHmac("sha256", secret).update(`additional-work:${bookingId}`).digest("base64url");
}

function createAdditionalWorkToken(bookingId, secret = signingSecret()) {
  const id = cleanText(bookingId, 100);
  return `${Buffer.from(id).toString("base64url")}.${signatureFor(id, secret)}`;
}

function readAdditionalWorkToken(token, secret = signingSecret()) {
  const [encodedId, provided, extra] = String(token || "").split(".");
  if (!encodedId || !provided || extra !== undefined || !secret || String(token).length > 400) return "";
  let bookingId = "";
  try { bookingId = Buffer.from(encodedId, "base64url").toString("utf8"); } catch { return ""; }
  const expected = signatureFor(bookingId, secret);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right) ? cleanText(bookingId, 100) : "";
}

function additionalWorkUrl(booking, baseUrl) {
  return `${baseUrl}/additional-work.html?token=${encodeURIComponent(createAdditionalWorkToken(booking.id))}`;
}

function paymentIsSettled(booking) {
  const payment = booking?.estimate?.payment || {};
  const remaining = payment.remaining || {};
  return ["paid", "captured", "fully_paid"].includes(String(payment.status || "").toLowerCase())
    || ["captured"].includes(String(remaining.status || "").toLowerCase());
}

async function saveAdditionalWork(booking, additionalWork) {
  const estimate = booking.estimate && typeof booking.estimate === "object" ? booking.estimate : {};
  const nextEstimate = { ...estimate, additionalWork };
  await updateBookingEstimate(booking.id, nextEstimate);
  booking.estimate = nextEstimate;
  return additionalWork;
}

async function sendAdditionalWorkOffer({ booking, baseUrl, now = new Date() }) {
  if (!booking) throw Object.assign(new Error("Booking could not be found."), { statusCode: 404 });
  if (booking.status !== "Completed" || !paymentIsSettled(booking)) {
    throw Object.assign(new Error("The additional-work link can be sent only after the booking is completed and its balance is paid."), { statusCode: 409 });
  }
  const url = additionalWorkUrl(booking, baseUrl);
  const [email, sms] = await Promise.all([
    sendAdditionalWorkOfferEmail(booking, url),
    sendAdditionalWorkOfferSms(booking, url)
  ]);
  const sent = email.status === "sent" || sms.status === "sent";
  const previous = booking.estimate?.additionalWork || {};
  const timestamp = now.toISOString();
  const additionalWork = {
    ...previous,
    offerRequested: true,
    pendingUntilBalancePaid: false,
    offerSentAt: previous.offerSentAt || (sent ? timestamp : ""),
    lastOfferAttemptAt: timestamp,
    lastOfferSentAt: sent ? timestamp : (previous.lastOfferSentAt || ""),
    offerSendCount: Number(previous.offerSendCount || 0) + (sent ? 1 : 0),
    email,
    sms,
    orders: Array.isArray(previous.orders) ? previous.orders : []
  };
  await saveAdditionalWork(booking, additionalWork);
  return { sent, url, email, sms, additionalWork };
}

function laborHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < MIN_LABOR_HOURS || hours > MAX_LABOR_HOURS || Math.round(hours * 2) !== hours * 2) {
    throw Object.assign(new Error("Choose between 0.5 and 24 labor-hours in half-hour increments."), { statusCode: 400 });
  }
  return hours;
}

async function stripeCheckout(params) {
  const secretKey = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key || "";
  if (!secretKey.startsWith("sk_")) throw Object.assign(new Error("Secure payment is not configured."), { statusCode: 503 });
  const encoded = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => encoded.append(key, String(value)));
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: encoded.toString()
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || "Payment could not be started."), { statusCode: response.status });
  return data;
}

async function createAdditionalWorkCheckout({ booking, hours, request }) {
  const amountCents = Math.round(hours * LABOR_HOUR_RATE_CENTS);
  const orderId = `AW-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const baseUrl = siteUrl(request);
  const checkout = await stripeCheckout({
    mode: "payment",
    "payment_method_types[0]": "card",
    customer_email: booking.email,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": amountCents,
    "line_items[0][price_data][product_data][name]": `${hours} additional cleaning labor-hour${hours === 1 ? "" : "s"}`,
    "line_items[0][price_data][product_data][description]": `Additional work for booking ${booking.id}. The selected labor time and total price include applicable sales tax.`,
    "line_items[0][quantity]": 1,
    "payment_intent_data[description]": `Additional cleaning work for ${booking.client_name || booking.id}`,
    "payment_intent_data[receipt_email]": booking.email,
    "payment_intent_data[metadata][payment_type]": "additional_work",
    "payment_intent_data[metadata][parent_booking_id]": booking.id,
    "payment_intent_data[metadata][additional_work_order_id]": orderId,
    "metadata[payment_type]": "additional_work",
    "metadata[parent_booking_id]": booking.id,
    "metadata[additional_work_order_id]": orderId,
    "metadata[labor_hours]": hours,
    "metadata[amount_cents]": amountCents,
    "metadata[agreement_accepted]": "true",
    "consent_collection[terms_of_service]": "required",
    "custom_text[submit][message]": "Full payment is charged now for the selected additional labor-hours.",
    success_url: `${baseUrl}/additional-work-paid.html?order_id=${encodeURIComponent(orderId)}`,
    cancel_url: additionalWorkUrl(booking, baseUrl)
  });
  const previous = booking.estimate?.additionalWork || {};
  const orders = Array.isArray(previous.orders) ? [...previous.orders] : [];
  orders.push({ orderId, status: "checkout_created", laborHours: hours, rateCents: LABOR_HOUR_RATE_CENTS, amountCents, checkoutSessionId: checkout.id, createdAt: new Date().toISOString() });
  await saveAdditionalWork(booking, { ...previous, orders });
  return { url: checkout.url, orderId };
}

async function recordAdditionalWorkPayment(session) {
  const bookingId = cleanText(session?.metadata?.parent_booking_id, 100);
  const orderId = cleanText(session?.metadata?.additional_work_order_id, 100);
  if (!bookingId || !orderId) throw Object.assign(new Error("Additional-work payment metadata is incomplete."), { statusCode: 400 });
  const booking = await getBooking(bookingId);
  if (!booking) throw Object.assign(new Error("Parent booking could not be found."), { statusCode: 404 });
  const previous = booking.estimate?.additionalWork || {};
  const orders = Array.isArray(previous.orders) ? [...previous.orders] : [];
  const index = orders.findIndex((order) => order.orderId === orderId);
  const paidOrder = {
    ...(index >= 0 ? orders[index] : {}),
    orderId,
    status: "paid",
    laborHours: Number(session.metadata?.labor_hours || orders[index]?.laborHours || 0),
    rateCents: LABOR_HOUR_RATE_CENTS,
    amountCents: Number(session.amount_total || session.metadata?.amount_cents || 0),
    checkoutSessionId: cleanText(session.id, 120),
    paymentIntentId: cleanText(typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id, 120),
    paidAt: new Date().toISOString()
  };
  if (index >= 0) orders[index] = paidOrder;
  else orders.push(paidOrder);
  await saveAdditionalWork(booking, { ...previous, orders });
  return { bookingId, orderId, status: "paid" };
}

async function handler(request, response) {
  try {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    const token = request.method === "GET" ? request.query?.token : body.token;
    const bookingId = readAdditionalWorkToken(token);
    if (!bookingId) return json(response, 401, { error: "This additional-work link is invalid." });
    const booking = await getBooking(bookingId);
    if (!booking) return json(response, 404, { error: "Booking not found." });
    const offer = booking.estimate?.additionalWork || {};
    if (!offer.offerSentAt) return json(response, 403, { error: "This additional-work offer is not active." });
    if (booking.status !== 'Completed' || !paymentIsSettled(booking)) return json(response, 409, { error: 'The original appointment must be completed and its balance paid first.' });
    return await require('./_additional-approval').handler(request, response, booking, body);
  } catch (error) {
    return json(response, error.statusCode || 500, { error: error.message || "Additional work could not be processed." });
  }
}

module.exports = handler;
module.exports.LABOR_HOUR_RATE_CENTS = LABOR_HOUR_RATE_CENTS;
module.exports.additionalWorkUrl = additionalWorkUrl;
module.exports.createAdditionalWorkCheckout = createAdditionalWorkCheckout;
module.exports.createAdditionalWorkToken = createAdditionalWorkToken;
module.exports.laborHours = laborHours;
module.exports.paymentIsSettled = paymentIsSettled;
module.exports.readAdditionalWorkToken = readAdditionalWorkToken;
module.exports.recordAdditionalWorkPayment = recordAdditionalWorkPayment;
module.exports.sendAdditionalWorkOffer = sendAdditionalWorkOffer;
