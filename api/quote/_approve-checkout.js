const {
  cleanText,
  json,
  centsToDollars,
  verifyQuoteToken
} = require("./_shared");
const { resolveShortApproval } = require("./_short-approval");
const calendar = require('../booking/_calendar');

const TERMS_CHECKBOX_TEXT = "I agree to the Service Agreement and authorize disclosed booking fees to the saved payment method used for my deposit.";
const INSTANT_TERMS_CHECKBOX_TEXT = "I have reviewed and agree to the Service Agreement and payment terms. I authorize the 25% deposit, the remaining-balance authorization described below, customer-caused access charges, and disclosed booking fees to the same payment method used for my deposit.";
const INSTANT_PAYMENT_TERMS = "A 25% deposit is charged now. Your saved deposit payment method is used for approved booking fees and the remaining balance. You authorize a temporary hold for the remaining 75% about 48 hours before service, captured after completion. Cancel at least 48 hours ahead for a full deposit refund unless a prior late reschedule triggered the cancellation fee. Cancellations less than 48 hours ahead cost 25%. " + "One approved reschedule at least 48 hours ahead is free. Rescheduling with less than 48 hours notice costs 10% of the booked cleaning price, including tax, separate from the cleaning payment. If that booking is later canceled, the 25% cancellation fee applies regardless of the new date, with paid late-rescheduling fees credited toward it. Second requests require direct contact and approval. Approved booking fees are charged to the payment method used for the 25% deposit.";
const PAYMENT_BUTTON_TEXT = "A 25% deposit is charged now. You authorize saving the deposit payment method for approved booking fees. Cancellations less than 48 hours ahead cost 25%. " + "One approved reschedule at least 48 hours ahead is free. Rescheduling with less than 48 hours notice costs 10% of the booked cleaning price, including tax, separate from the cleaning payment. If that booking is later canceled, the 25% cancellation fee applies regardless of the new date, with paid late-rescheduling fees credited toward it. Second requests require direct contact and approval. Approved booking fees are charged to the payment method used for the 25% deposit.";

const CHECKOUT_SUMMARY_VERSION = "6";

function depositCents(totalCents) {
  return Math.max(1, Math.round((Number(totalCents) || 0) * 0.25));
}

function paymentBreakdown(baseAmountCents, rushFeeCents = 0) {
  const baseCents = Math.max(0, Number(baseAmountCents) || 0);
  const rushCents = Math.max(0, Number(rushFeeCents) || 0);
  const baseDepositCents = depositCents(baseCents);
  return {
    baseAmountCents: baseCents,
    rushFeeCents: rushCents,
    totalAmountCents: baseCents + rushCents,
    baseDepositCents,
    paymentAmountCents: baseDepositCents + rushCents,
    remainingAmountCents: Math.max(0, baseCents - baseDepositCents)
  };
}

function checkoutScheduleText(serviceDate, serviceTime) {
  const dateValue = cleanText(serviceDate);
  const timeValue = cleanText(serviceTime);
  if (!dateValue && !timeValue) return "";
  let dateLabel = dateValue;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    dateLabel = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "America/New_York"
    }).format(new Date(`${dateValue}T12:00:00-04:00`));
  }
  let timeLabel = timeValue;
  const timeMatch = timeValue.match(/^(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    timeLabel = `${hour % 12 || 12}:${timeMatch[2]} ${hour >= 12 ? "PM" : "AM"}`;
  }
  return [dateLabel, timeLabel].filter(Boolean).join(" at ");
}

function getSiteUrl(request) {
  const configuredUrl = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

function getClientIp(request) {
  const forwardedFor = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return cleanText(forwardedFor || request.socket?.remoteAddress || "");
}

function parseMultipartFields(request) {
  return new Promise((resolve, reject) => {
    const fields = {};
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const params = new URLSearchParams(body);
      params.forEach((value, key) => {
        fields[key] = value;
      });
      resolve(fields);
    });
    request.on("error", reject);
  });
}

async function readFields(request) {
  const contentType = String(request.headers["content-type"] || "");
  if (!contentType.includes("multipart/form-data")) {
    return parseMultipartFields(request);
  }

  const Busboy = require("busboy");
  return new Promise((resolve, reject) => {
    const fields = {};
    const busboy = Busboy({
      headers: request.headers,
      limits: {
        files: 0,
        fields: 10
      }
    });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (name, file) => {
      file.resume();
    });

    busboy.on("error", reject);
    busboy.on("finish", () => {
      resolve(fields);
    });

    request.pipe(busboy);
  });
}

async function createCheckoutSession(secretKey, params, idempotencyKey) {
  const encoded = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      encoded.append(key, String(value));
    }
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body: encoded.toString()
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(data?.error?.message || "Stripe checkout session could not be created.");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

module.exports = async function handler(request, response) {
  let reservedBooking, checkoutSession;
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const secretKey = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
    if (!secretKey) {
      return json(response, 503, {
        error: "Stripe is not configured yet.",
        setup: "Add STRIPE_SECRET_KEY in Vercel."
      });
    }
    if (!String(secretKey).startsWith("sk_")) {
      return json(response, 503, {
        error: "Stripe secret key is saved incorrectly in Vercel.",
        setup: "Update STRIPE_SECRET_KEY or Stripe_Secret_Key so the value starts with sk_live_."
      });
    }

    const fields = await readFields(request);
    if (Object.prototype.hasOwnProperty.call(fields, "serviceDate") || Object.prototype.hasOwnProperty.call(fields, "serviceTime")) {
      return json(response, 400, { error: "The appointment date and time are locked. Please contact Iman Cleaning Service to request a schedule change." });
    }
    if (fields.agreementAccepted !== "true") {
      return json(response, 400, { error: "You must agree to the service agreement before payment." });
    }
    if (fields.agreementScrolled !== "true") {
      return json(response, 400, { error: "Please scroll through the service agreement before payment." });
    }

    const agreementSignature = cleanText(fields.agreementSignature);
    if (agreementSignature.length < 2) {
      return json(response, 400, { error: "Please type your full legal name to sign the service agreement." });
    }

    const shortCode = cleanText(fields.code);
    const adminQuotes = require("../crm/_quote-admin");
    let quote = shortCode
      ? await resolveShortApproval(shortCode)
      : await adminQuotes.resolveManaged(verifyQuoteToken(fields.token));
    if (quote.managedSource && fields.revision !== quote.revision) return json(response, 409, { error: "Your quote has been updated. Reopen the payment link and review the latest price before paying." });
    if (!quote.serviceDate || !quote.serviceTime) {
      if (!fields.selectedSchedule) return json(response, 400, { error: "Please choose an available appointment date and time before payment." });
      quote = await adminQuotes.selectCustomerSchedule(quote, fields.selectedSchedule);
    }
    const existingCheckout = await adminQuotes.currentCheckout(quote, { summaryVersion: CHECKOUT_SUMMARY_VERSION });
    if (existingCheckout.session) {
      await adminQuotes.guardCheckout(quote, existingCheckout.session);
      if (!quote.bookingId) throw Object.assign(new Error('Our team needs to update this quote with its appointment duration before payment.'), { statusCode: 409 });
      if (quote.serviceDate && quote.serviceTime) await calendar.reserveBooking(quote.bookingId, existingCheckout.session);
      return json(response, 200, { quoteId: quote.quoteId, checkoutUrl: existingCheckout.session.url, sessionId: existingCheckout.session.id });
    }
    quote = await adminQuotes.ensureManagedBooking(quote);
    if (!quote.bookingId) throw Object.assign(new Error('Our team needs to update this quote with its appointment duration before payment.'), { statusCode: 409 });
    if (quote.serviceDate && quote.serviceTime) reservedBooking = await calendar.reserveBooking(quote.bookingId);

    const siteUrl = getSiteUrl(request);
    const breakdown = paymentBreakdown(quote.amountCents, quote.rushFeeCents);
    const { baseAmountCents, rushFeeCents, totalAmountCents, baseDepositCents, paymentAmountCents, remainingAmountCents } = breakdown;
    const scheduleText = checkoutScheduleText(quote.serviceDate, quote.serviceTime);
    const sameDay = rushFeeCents > 0;
    const automaticBalance = !sameDay && quote.balanceCollection === "automatic_48h_authorization";
    const agreementSignedAt = new Date().toISOString();
    const agreementIp = getClientIp(request);
    const teamHours = quote.cleanerCount && quote.laborHours
      ? Number((quote.laborHours / quote.cleanerCount).toFixed(2))
      : 0;
    const includedText = cleanText(quote.description)
      .replace(/(\d)(?=[A-Za-z])/g, "$1 ")
      .replace(/\s*,\s*/g, ", ");
    const checkoutDetails = [
      scheduleText ? `✓ Appointment — ${scheduleText}` : "",
      quote.laborHours ? `✓ Maximum service time — ${quote.laborHours} labor-hours` : "",
      quote.cleanerCount && teamHours ? `✓ Team — ${quote.cleanerCount} cleaners, up to ${teamHours} hours each` : "",
      quote.serviceLocation ? `✓ Address — ${quote.serviceLocation}` : "",
      includedText ? `✓ Included — ${includedText}` : "",
      `✓ Total service price — $${centsToDollars(totalAmountCents)} including tax`
    ];
    const productDescription = checkoutDetails.join("\n").slice(0, 500);

    checkoutSession = await createCheckoutSession(secretKey, {
      mode: "payment",
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      customer_email: quote.customerEmail,
      customer_creation: "always",
      "payment_intent_data[setup_future_usage]": "off_session", "payment_method_types[0]": "card",
      "phone_number_collection[enabled]": "true",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": baseDepositCents,
      "line_items[0][price_data][product_data][name]": `${quote.service} - 25% Deposit`,
      "line_items[0][price_data][product_data][description]": productDescription,
      "line_items[0][quantity]": 1,
      ...(sameDay ? {
        "line_items[1][price_data][currency]": "usd",
        "line_items[1][price_data][unit_amount]": rushFeeCents,
        "line_items[1][price_data][product_data][name]": "Same-day rush fee",
        "line_items[1][price_data][product_data][description]": "Required fee for an approved same-day appointment.",
        "line_items[1][quantity]": 1
      } : {}),
      "consent_collection[terms_of_service]": "required",
      "custom_text[terms_of_service_acceptance][message]": automaticBalance ? INSTANT_TERMS_CHECKBOX_TEXT : TERMS_CHECKBOX_TEXT,
      "custom_text[submit][message]": sameDay
        ? "By continuing, you agree to pay the full $100 same-day rush fee and a 25% deposit of the base cleaning price now. The appointment is confirmed only after payment. The remaining 75% of the base cleaning price is due after service. The rush fee is nonrefundable after confirmation unless Iman Cleaning Service cancels. Approved late rescheduling costs 10% of the cleaning price; later cancellation costs 25% less paid rescheduling fees. Booking fees use the saved deposit payment method."
        : automaticBalance ? INSTANT_PAYMENT_TERMS : PAYMENT_BUTTON_TEXT,
      "payment_intent_data[description]": `${quote.service} for ${quote.customerName}`,
      "payment_intent_data[receipt_email]": quote.customerEmail,
      "payment_intent_data[metadata][quote_id]": quote.quoteId,
      "payment_intent_data[metadata][customer_name]": quote.customerName,
      "payment_intent_data[metadata][service_location]": quote.serviceLocation,
      "payment_intent_data[metadata][service]": quote.service,
      "payment_intent_data[metadata][service_description_url]": quote.serviceDescriptionUrl || "",
      "payment_intent_data[metadata][service_date]": quote.serviceDate,
      "payment_intent_data[metadata][service_time]": quote.serviceTime,
      "payment_intent_data[metadata][total_amount_cents]": totalAmountCents,
      "payment_intent_data[metadata][payment_amount_cents]": paymentAmountCents,
      "payment_intent_data[metadata][remaining_amount_cents]": remainingAmountCents,
      "payment_intent_data[metadata][payment_type]": sameDay ? "same_day_deposit" : "deposit_25",
      "payment_intent_data[metadata][rush_fee_cents]": rushFeeCents,
      "payment_intent_data[metadata][booking_id]": quote.bookingId || "",
      "payment_intent_data[metadata][agreement_accepted]": "true",
      "payment_intent_data[metadata][agreement_signature]": agreementSignature,
      "payment_intent_data[metadata][agreement_signed_at]": agreementSignedAt,
      "payment_intent_data[metadata][agreement_ip]": agreementIp,
      "metadata[quote_id]": quote.quoteId,
      "metadata[quote_revision]": quote.revision || "",
      "metadata[checkout_summary_version]": CHECKOUT_SUMMARY_VERSION,
      "metadata[customer_name]": quote.customerName,
      "metadata[service_location]": quote.serviceLocation,
      "metadata[service]": quote.service,
      "metadata[service_description_url]": quote.serviceDescriptionUrl || "",
      "metadata[service_date]": quote.serviceDate,
      "metadata[service_time]": quote.serviceTime,
      "metadata[cleaner_count]": quote.cleanerCount || "",
      "metadata[labor_hours]": quote.laborHours || "",
      "metadata[team_hours]": quote.cleanerCount ? quote.laborHours / quote.cleanerCount : "",
      "metadata[unit_count]": quote.units?.length || "",
      "metadata[subtotal_cents]": quote.pricing?.subtotalCents ?? "",
      "metadata[tax_cents]": quote.pricing?.taxCents ?? "",
      "metadata[discount_cents]": quote.pricing?.discountCents ?? "",
      "metadata[discount_label]": quote.pricing?.discountLabel || "",
      "metadata[discount_application]": quote.pricing?.discountApplication || "",
      "metadata[agreement_url]": quote.agreementUrl,
      "metadata[total_amount_cents]": totalAmountCents,
      "metadata[payment_amount_cents]": paymentAmountCents,
      "metadata[remaining_amount_cents]": remainingAmountCents,
      "metadata[payment_type]": sameDay ? "same_day_deposit" : "deposit_25",
      "metadata[balance_collection]": automaticBalance ? "automatic_48h_authorization" : "after_service",
      "metadata[rush_fee_cents]": rushFeeCents,
      "metadata[booking_id]": quote.bookingId || "",
      "metadata[agreement_accepted]": "true",
      "metadata[agreement_signature]": agreementSignature,
      "metadata[agreement_signed_at]": agreementSignedAt,
      "metadata[agreement_ip]": agreementIp,
      "invoice_creation[enabled]": "true",
      "invoice_creation[invoice_data][description]": productDescription,
      "invoice_creation[invoice_data][metadata][quote_id]": quote.quoteId,
      "invoice_creation[invoice_data][metadata][customer_name]": quote.customerName,
      "invoice_creation[invoice_data][metadata][service_location]": quote.serviceLocation,
      "invoice_creation[invoice_data][metadata][service]": quote.service,
      "invoice_creation[invoice_data][metadata][service_description_url]": quote.serviceDescriptionUrl || "",
      "invoice_creation[invoice_data][metadata][service_date]": quote.serviceDate,
      "invoice_creation[invoice_data][metadata][service_time]": quote.serviceTime,
      "invoice_creation[invoice_data][metadata][agreement_accepted]": "true",
      "invoice_creation[invoice_data][metadata][agreement_signature]": agreementSignature,
      "invoice_creation[invoice_data][metadata][agreement_signed_at]": agreementSignedAt,
      success_url: `${siteUrl}/quote-paid.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: shortCode
        ? `${siteUrl}/q/${encodeURIComponent(shortCode)}`
        : `${siteUrl}/approve-quote.html?token=${encodeURIComponent(fields.token)}`
    }, `crm-quote-${require("crypto").createHash("sha256").update(`${quote.bookingId}:${quote.revision || ''}:${reservedBooking?.estimate?.calendarReservation?.attempt || 'unscheduled'}`).digest("hex")}`);

    await adminQuotes.guardCheckout(quote, checkoutSession);
    if (reservedBooking) await calendar.attachCheckout(quote.bookingId, reservedBooking.estimate.calendarReservation.attempt, checkoutSession);

    return json(response, 201, {
      quoteId: quote.quoteId,
      checkoutUrl: checkoutSession.url,
      sessionId: checkoutSession.id
    });
  } catch (error) {
    try { await calendar.cleanupCheckout(reservedBooking?.id, reservedBooking?.estimate?.calendarReservation?.attempt, checkoutSession, error); } catch { /* Retain the slot if expiry cannot be verified. */ }
    return json(response, error.statusCode || 500, {
      error: error.message || "Quote approval could not be completed.",
      details: error.details,
      setup: error.setup
    });
  }
};

module.exports._test = { depositCents, paymentBreakdown };
