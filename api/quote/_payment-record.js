const { staffingOptions } = require("../booking/_staffing-options");
const {
  centsToDollars,
  cleanText,
  driveWebViewLink,
  getGoogleClients,
  json,
  readJsonBody
} = require("./_shared");
const { confirmBooking, getBooking, updateBooking } = require("../booking/_shared");
const { buildBookingConfirmationPdf } = require("../booking/_confirmation-pdf");
const { buildPaymentReceiptPdf } = require("../booking/_payment-receipt-pdf");
const { sendCustomerSms } = require("../booking/_notifications");

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeMimeWord(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key || "";
}

function getSmsConfig() {
  return {
    accountSid: cleanText(process.env.TWILIO_ACCOUNT_SID),
    authToken: cleanText(process.env.TWILIO_AUTH_TOKEN),
    from: cleanText(process.env.TWILIO_FROM_NUMBER),
    to: cleanText(process.env.BOOKING_SMS_TO || "+19298034053")
  };
}

function getSiteUrl(request) {
  const configuredUrl = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

async function stripeRequest(secretKey, url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
    },
    body: options.body
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(data?.error?.message || "Stripe payment record could not be retrieved.");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function stripePost(secretKey, url, params) {
  const encoded = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      encoded.append(key, String(value));
    }
  });

  return stripeRequest(secretKey, url, {
    method: "POST",
    body: encoded.toString()
  });
}

async function twilioRequest({ accountSid, authToken, from, to, body }) {
  const encoded = new URLSearchParams({
    From: from,
    To: to,
    Body: body
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: encoded.toString()
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(data?.message || "SMS notification could not be sent.");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function money(cents) {
  return `$${centsToDollars(cents)}`;
}

function stripeTime(seconds) {
  const value = Number(seconds || 0);
  if (!value) return new Date().toISOString();
  return new Date(value * 1000).toISOString();
}

function agreementTime(value, fallbackSeconds) {
  const cleaned = cleanText(value);
  return cleaned || stripeTime(fallbackSeconds);
}

function extractDriveFolderId(link) {
  const value = String(link || "");
  const match = value.match(/\/folders\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function buildRecord({ session, siteUrl, source = "success_page" }) {
  const metadata = session.metadata || {};
  const paymentIntent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const charge = paymentIntent?.latest_charge && typeof paymentIntent.latest_charge === "object"
    ? paymentIntent.latest_charge
    : null;
  const card = charge?.payment_method_details?.card;
  const invoice = typeof session.invoice === "object" ? session.invoice : null;
  const paidCents = Number(session.amount_total || metadata.payment_amount_cents || metadata.total_amount_cents || 0);
  const totalCents = Number(metadata.total_amount_cents || paidCents || 0);
  const promoDiscountCents = Number(metadata.promo_discount_cents || metadata.discount_cents || 0);
  const arrivalDiscountCents = Number(metadata.arrival_discount_cents || 0);
  const discountCents = promoDiscountCents + arrivalDiscountCents;
  const originalTotalCents = Number(metadata.original_total_cents || (totalCents + discountCents) || 0);
  const subtotalCents = Number(metadata.subtotal_cents || 0);
  const discountedSubtotalCents = Number(metadata.discounted_subtotal_cents || 0);
  const taxCents = Number(metadata.tax_cents || 0);
  const discountApplication = cleanText(metadata.promo_discount_application || metadata.discount_application);
  const agreementUrl = cleanText(metadata.agreement_url, `${siteUrl}/agreement.html`);
  const recordCreatedAt = new Date().toISOString();

  return {
    recordCreatedAt,
    recordSource: source,
    quoteId: cleanText(metadata.quote_id, session.client_reference_id || session.id),
    customerName: cleanText(metadata.customer_name || session.customer_details?.name),
    customerEmail: cleanText(session.customer_details?.email || session.customer_email),
    customerPhone: cleanText(session.customer_details?.phone),
    serviceLocation: cleanText(metadata.service_location),
    service: cleanText(metadata.service, "Cleaning Service Quote"),
    serviceDescriptionUrl: cleanText(metadata.service_description_url),
    serviceDate: cleanText(metadata.service_date),
    serviceTime: cleanText(metadata.service_time),
    arrivalPreference: cleanText(metadata.arrival_preference),
    arrivalWindow: cleanText(metadata.arrival_window),
    totalAmount: money(totalCents),
    originalAmount: discountCents ? money(originalTotalCents) : "",
    subtotalBeforeTax: subtotalCents ? money(subtotalCents) : "",
    discountedSubtotalBeforeTax: discountedSubtotalCents ? money(discountedSubtotalCents) : "",
    salesTax: taxCents ? money(taxCents) : "",
    discountApplication,
    discountLabel: promoDiscountCents ? cleanText(metadata.promo_code || metadata.discount_label || "Discount") : "",
    discountAmount: promoDiscountCents ? `-${money(promoDiscountCents)}` : "",
    arrivalDiscountLabel: arrivalDiscountCents ? cleanText(metadata.arrival_discount_label || "Flexible arrival discount") : "",
    arrivalDiscountAmount: arrivalDiscountCents ? `-${money(arrivalDiscountCents)}` : "",
    paidAmount: money(paidCents),
    remainingAmount: money(Number(metadata.remaining_amount_cents || 0)),
    paymentType: cleanText(metadata.payment_type),
    balanceCollection: cleanText(metadata.balance_collection),
    paymentStatus: cleanText(session.payment_status),
    paymentMethod: card?.brand && card?.last4
      ? `${cleanText(card.brand).toUpperCase()} ending in ${cleanText(card.last4)}`
      : cleanText(charge?.payment_method_details?.type || paymentIntent?.payment_method_types?.[0]),
    checkoutSessionId: session.id,
    paymentIntentId: cleanText(paymentIntent?.id || session.payment_intent),
    paidAt: stripeTime(paymentIntent?.created || session.created),
    agreementAcceptedAt: agreementTime(metadata.agreement_accepted_at || metadata.agreement_signed_at, session.created),
    agreementSignature: cleanText(metadata.agreement_signature),
    agreementIp: cleanText(metadata.agreement_ip),
    agreementUrl,
    termsAcceptanceRequired: "Yes",
    approvalPageAgreementRequired: "Yes",
    idFolderLink: cleanText(metadata.id_folder_link),
    idFileLink: cleanText(metadata.id_file_link),
    stripeReceiptUrl: cleanText(paymentIntent?.latest_charge?.receipt_url),
    stripeInvoiceId: cleanText(invoice?.id || session.invoice),
    stripeInvoiceUrl: cleanText(invoice?.hosted_invoice_url),
    stripeInvoicePdf: cleanText(invoice?.invoice_pdf)
  };
}

function buildAnalyticsPurchase(session) {
  const metadata = session.metadata || {};
  return {
    transactionId: cleanText(session.id, 120),
    value: Math.max(0, Number(session.amount_total || metadata.payment_amount_cents || 0)) / 100,
    currency: cleanText(session.currency || "usd", 8).toUpperCase(),
    bookingId: cleanText(metadata.booking_id || metadata.quote_id, 120),
    paymentType: cleanText(metadata.payment_type || "deposit_25", 40)
  };
}

function recordText(record) {
  const lines = [
    "Iman Cleaning Service LLC - Quote Approval, Agreement, and Payment Record",
    "",
    `Record created: ${record.recordCreatedAt}`,
    `Record source: ${record.recordSource}`,
    `Quote ID: ${record.quoteId}`,
    `Customer: ${record.customerName}`,
    `Customer email: ${record.customerEmail}`,
    `Service location: ${record.serviceLocation}`,
    `Service: ${record.service}`,
    record.serviceDescriptionUrl ? `Service description: ${record.serviceDescriptionUrl}` : "",
    `Service date: ${record.serviceDate}`,
    `Service start time: ${record.serviceTime}`,
    record.subtotalBeforeTax ? `Service subtotal before tax: ${record.subtotalBeforeTax}` : "",
    record.discountAmount ? `${record.discountLabel}${record.discountApplication === "before_tax" ? " (before tax)" : ""}: ${record.discountAmount}` : "",
    record.arrivalDiscountAmount ? `${record.arrivalDiscountLabel} (before tax): ${record.arrivalDiscountAmount}` : "",
    record.discountedSubtotalBeforeTax ? `Discounted subtotal before tax: ${record.discountedSubtotalBeforeTax}` : "",
    record.salesTax ? `NY sales tax (8.875%): ${record.salesTax}` : "",
    `Final service price: ${record.totalAmount}`,
    `Amount paid: ${record.paidAmount}`,
    `Remaining balance after this payment: ${record.remainingAmount}`,
    `Payment type: ${record.paymentType}`,
    `Payment status: ${record.paymentStatus}`,
    record.paymentMethod ? `Payment method: ${record.paymentMethod}` : "",
    `Stripe Checkout Session ID: ${record.checkoutSessionId}`,
    `Stripe Payment Intent ID: ${record.paymentIntentId}`,
    `Paid at: ${record.paidAt}`,
    "",
    "Agreement record:",
    `Agreement accepted before payment: ${record.approvalPageAgreementRequired}`,
    record.agreementSignature ? `Electronic signature: ${record.agreementSignature}` : "",
    `Agreement accepted timestamp: ${record.agreementAcceptedAt}`,
    record.agreementIp ? `Agreement IP address: ${record.agreementIp}` : "",
    `Agreement URL: ${record.agreementUrl}`,
    `Stripe terms acceptance required: ${record.termsAcceptanceRequired}`,
    "",
    record.idFolderLink || record.idFileLink ? "Photo ID record:" : "",
    record.idFolderLink ? `Photo ID folder: ${record.idFolderLink}` : "",
    record.idFileLink ? `Photo ID file: ${record.idFileLink}` : "",
    record.idFolderLink || record.idFileLink ? "" : "",
    record.stripeReceiptUrl ? `Stripe receipt: ${record.stripeReceiptUrl}` : "",
    record.stripeInvoiceUrl ? `Stripe invoice: ${record.stripeInvoiceUrl}` : "",
    record.stripeInvoicePdf ? `Stripe invoice PDF: ${record.stripeInvoicePdf}` : "",
    "",
    "This record was generated after Stripe confirmed the payment."
  ];

  return lines.filter((line) => line !== "").join("\n");
}

function recordHtml(record, text) {
  const rows = text.split("\n")
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");

  return `<!doctype html><html><body><h2>Quote approval, agreement, and payment record</h2>${rows}</body></html>`;
}

function buildEmail({ record, text, html, recordFileLink }) {
  const to = process.env.QUOTE_EMAIL_TO || "Info@imancleaningservice.com";
  const from = process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com";
  const subject = `Quote paid and agreement accepted - ${record.quoteId}`;
  const fullText = [text, "", recordFileLink ? `Saved record file: ${recordFileLink}` : ""].filter(Boolean).join("\n");
  const fullHtml = recordFileLink
    ? html.replace("</body>", `<p><strong>Saved record file:</strong> <a href="${recordFileLink}">${recordFileLink}</a></p></body>`)
    : html;

  const headers = [
    `From: ${encodeMimeWord("IMAN Cleaning Service LLC")} <${from}>`,
    `To: ${to}`,
    record.customerEmail ? `Reply-To: ${record.customerEmail}` : "",
    `Subject: ${encodeMimeWord(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: multipart/alternative; boundary=\"payment_record_alt\""
  ].filter(Boolean);

  const parts = [
    headers.join("\r\n"),
    "",
    "--payment_record_alt",
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "",
    fullText,
    "--payment_record_alt",
    "Content-Type: text/html; charset=\"UTF-8\"",
    "",
    fullHtml,
    "--payment_record_alt--",
    ""
  ];

  return {
    raw: base64Url(parts.join("\r\n")),
    subject
  };
}

function customerFirstName(value) {
  return cleanText(value).split(/\s+/).filter(Boolean)[0] || "there";
}

function formatAppointmentParts(booking, record) {
  const scheduled = booking?.schedule ? new Date(booking.schedule) : null;
  if (scheduled && Number.isFinite(scheduled.getTime())) {
    const arrival = booking?.estimate?.arrivalPreference || {};
    return {
      date: new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      }).format(scheduled),
      time: arrival.flexible && arrival.windowLabel
        ? `${arrival.windowLabel} estimated arrival window`
        : new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit"
      }).format(scheduled)
    };
  }
  return { date: record.serviceDate, time: record.arrivalWindow ? `${record.arrivalWindow} estimated arrival window` : record.serviceTime };
}

function formatMaximumTime(hours) {
  const totalMinutes = Math.round(Number(hours || 0) * 60);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "";
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return [
    wholeHours ? `${wholeHours} ${wholeHours === 1 ? "hour" : "hours"}` : "",
    minutes ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : ""
  ].filter(Boolean).join(" ");
}

function selectedServiceDetailsUrl(record, booking) {
  const supplied = cleanText(record.serviceDescriptionUrl || booking?.estimate?.serviceDescriptionUrl, 500);
  if (supplied) {
    try {
      const url = new URL(supplied);
      if (url.protocol === "https:") return url.toString();
    } catch {
      // Use the service-name fallback below when a saved link is incomplete.
    }
  }

  const site = "https://www.imancleaningservice.com";
  const serviceKey = cleanText(
    booking?.service || booking?.estimate?.serviceKey || booking?.estimate?.eligibility?.requestedService,
    80
  ).toLowerCase();
  const pagesByServiceKey = {
    standard: "/standard-cleaning.html",
    recurring: "/recurring-cleaning.html",
    deep: "/deep-cleaning.html",
    details: "/deep-cleaning.html",
    move: "/move-in-move-out-cleaning.html",
    post: "/post-construction-cleaning.html",
    post_construction: "/post-construction-cleaning.html",
    hourly: "/services-hub.html",
    organization: "/services-hub.html",
    window: "/services-hub.html"
  };
  if (pagesByServiceKey[serviceKey]) return `${site}${pagesByServiceKey[serviceKey]}`;

  const service = [
    booking?.service,
    booking?.service_label,
    booking?.estimate?.eligibility?.requestedService,
    record.service
  ].filter(Boolean).join(" ").toLowerCase();
  if (/move[\s-]*(in|out)|moving/.test(service)) return `${site}/move-in-move-out-cleaning.html`;
  if (/deep|detail/.test(service)) return `${site}/deep-cleaning.html`;
  if (/post[\s-]*construction/.test(service)) return `${site}/post-construction-cleaning.html`;
  if (/airbnb|vacation rental/.test(service)) return `${site}/airbnb-cleaning.html`;
  if (/office/.test(service)) return `${site}/office-cleaning.html`;
  if (/retail/.test(service)) return `${site}/retail-store-cleaning.html`;
  if (/restaurant/.test(service)) return `${site}/restaurant-cleaning.html`;
  if (/medical|clinic/.test(service)) return `${site}/medical-clinic-cleaning.html`;
  if (/janitorial/.test(service)) return `${site}/janitorial-recurring-cleaning.html`;
  if (/commercial/.test(service)) return `${site}/commercial-cleaning.html`;
  if (/recurring/.test(service)) return `${site}/recurring-cleaning.html`;
  if (/standard|hourly/.test(service)) return `${site}/standard-cleaning.html`;
  return `${site}/services-hub.html`;
}

function buildCustomerEmail({ record, booking = null, invoicePdf, confirmationPdf, managementUrl }) {
  if (!record.customerEmail) return null;

  const from = process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com";
  const subject = `Booking confirmed - IMAN Cleaning Service - ${record.orderNumber || record.quoteId}`;
  const automaticBalance = record.paymentType === "deposit_25"
    && record.balanceCollection === "automatic_48h_authorization";
  const awaitingSchedule = !(booking?.schedule || (record.serviceDate && record.serviceTime));
  const appointment = formatAppointmentParts(booking, record);
  const cleanerCount = Number(booking?.estimate?.cleanerCount || 0);
  const maximumTime = formatMaximumTime(booking?.estimate?.teamHours);
  const serviceDetailsUrl = selectedServiceDetailsUrl(record, booking);
  const serviceDetailsLabel = `View ${record.service || "Service"} Details & Inclusions`;
  const staffing = staffingOptions(booking?.estimate) || (cleanerCount
    ? `${cleanerCount} cleaning ${cleanerCount === 1 ? "professional" : "professionals"}${maximumTime ? `, up to ${maximumTime}` : ""}`
    : maximumTime
      ? `Up to ${maximumTime}`
      : "");
  const remainingValue = Number(String(record.remainingAmount).replace(/[^0-9.-]/g, ""));
  const hasRemainingBalance = Number.isFinite(remainingValue) && remainingValue > 0;
  const discountLabel = /^FALL10\b/i.test(record.discountLabel || "")
    ? "FALL10 discount"
    : record.discountLabel || "Discount";
  const appointmentDetails = [
    ["Date", appointment.date],
    ["Estimated arrival time", appointment.time],
    ["Service", record.service],
    ["Address", record.serviceLocation],
    ["Cleaning team", staffing]
  ].filter(([, value]) => value);
  const paymentDetails = [
    ["Service subtotal", record.subtotalBeforeTax],
    [discountLabel, record.discountAmount],
    [record.arrivalDiscountLabel || "Flexible arrival discount", record.arrivalDiscountAmount],
    ["Discounted subtotal", record.discountedSubtotalBeforeTax],
    ["NY sales tax (8.875%)", record.salesTax],
    ["Final service price", record.totalAmount],
    [record.paymentType === "deposit_25" ? "Deposit paid" : "Amount paid", record.paidAmount ? `-${record.paidAmount}` : ""],
    ["Remaining balance", record.remainingAmount]
  ].filter(([, value]) => value);
  const balanceMessage = automaticBalance
    ? "The remaining balance will be temporarily authorized approximately 48 hours before your appointment and charged after service completion, according to your booking agreement."
    : hasRemainingBalance
      ? "The remaining balance is due according to your accepted booking agreement."
      : "Your service has been paid in full.";
  const attachmentMessage = confirmationPdf && invoicePdf
    ? "Your booking record and payment receipt are attached for your reference."
    : confirmationPdf
      ? "Your booking record is attached for your reference."
      : invoicePdf
        ? "Your payment receipt is attached for your reference."
        : "Your booking and payment details are included in this email for your reference.";
  const paymentReferenceUrl = invoicePdf
    ? ""
    : record.stripeInvoiceUrl || record.stripeReceiptUrl || "";

  const text = [
    `Hi ${customerFirstName(record.customerName)},`,
    "",
    awaitingSchedule
      ? "Thank you for choosing IMAN Cleaning Service! Your payment has been successfully received. We will contact you to schedule your cleaning appointment."
      : `Thank you for choosing IMAN Cleaning Service! Your ${record.paymentType === "deposit_25" ? "deposit" : "payment"} has been successfully received, and your cleaning appointment is confirmed.`,
    "",
    ...(awaitingSchedule ? [] : ["Appointment Details", "", ...appointmentDetails.map(([label, value]) => `${label}: ${value}`), ""]),
    `${record.service || "Service"} details and inclusions: ${serviceDetailsUrl}`,
    "",
    "Your Payment Summary",
    "",
    ...paymentDetails.map(([label, value]) => `${label}: ${value}`),
    "",
    balanceMessage,
    "",
    "Before Our Team Arrives",
    "",
    "- Ensure electricity and running water are available.",
    "- Provide access instructions, including any entry codes.",
    "- Make sure the areas being cleaned are accessible.",
    "- Contact us before the appointment if your property condition or requested cleaning tasks have changed.",
    "",
    "Important: Your booking covers only the services listed in your service details and attached booking record, for up to the maximum labor time shown. Any work outside that scope requires approval before it begins and may result in an additional charge.",
    "",
    ...(managementUrl && !awaitingSchedule ? ["Need to Make Changes?", "", "You can reschedule or cancel your appointment using the secure link below.", managementUrl, ""] : []),
    awaitingSchedule
      ? "Cancellation timing will be measured from the appointment after it is scheduled."
      : "Cancellations less than 48 hours ahead cost 25%. An approved late reschedule does not restore free cancellation; paid rescheduling fees are credited toward the 25% fee. Otherwise, cancellation at least 48 hours ahead qualifies for a full deposit refund. Any uncaptured authorization is released.",
    "",
    attachmentMessage,
    paymentReferenceUrl ? `Payment receipt: ${paymentReferenceUrl}` : "",
    "",
    "We look forward to making your space fresh and ready!",
    "",
    "IMAN Cleaning Service LLC",
    "929-232-1930",
    "www.imancleaningservice.com"
  ].join("\n");

  const tableRows = (rows, emphasis = new Set()) => rows.map(([label, value]) => {
    const strong = emphasis.has(label);
    return `<tr><th align="left" style="padding:8px 12px 8px 0;border-bottom:1px solid #e5ecea;${strong ? "font-weight:700;color:#073f49;" : ""}">${escapeHtml(label)}</th><td align="right" style="padding:8px 0;border-bottom:1px solid #e5ecea;${strong ? "font-weight:700;color:#073f49;" : ""}">${escapeHtml(value)}</td></tr>`;
  }).join("");
  const appointmentRows = tableRows(appointmentDetails);
  const paymentRows = tableRows(paymentDetails, new Set(["Final service price", "Remaining balance"]));

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#243c40;line-height:1.6;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #dbe7e2;border-radius:16px;padding:30px;">
        <p>Hi ${escapeHtml(customerFirstName(record.customerName))},</p>
        <p>${escapeHtml(awaitingSchedule
          ? "Thank you for choosing IMAN Cleaning Service! Your payment has been successfully received. We will contact you to schedule your cleaning appointment."
          : `Thank you for choosing IMAN Cleaning Service! Your ${record.paymentType === "deposit_25" ? "deposit" : "payment"} has been successfully received, and your cleaning appointment is confirmed.`)}</p>
        ${awaitingSchedule ? "" : `<h2 style="color:#073f49;font-size:20px;margin:28px 0 8px;">Appointment Details</h2><table style="width:100%;border-collapse:collapse;">${appointmentRows}</table>`}
        <p><a href="${escapeHtml(serviceDetailsUrl)}" style="display:inline-block;padding:11px 18px;border:1px solid #0b6474;color:#0b6474;text-decoration:none;border-radius:999px;font-weight:bold;">${escapeHtml(serviceDetailsLabel)}</a></p>
        <h2 style="color:#073f49;font-size:20px;margin:28px 0 8px;">Your Payment Summary</h2>
        <table style="width:100%;border-collapse:collapse;">${paymentRows}</table>
        <p style="margin-top:18px;">${escapeHtml(balanceMessage)}</p>
        <h2 style="color:#073f49;font-size:20px;margin:28px 0 8px;">Before Our Team Arrives</h2>
        <ul style="padding-left:20px;">
          <li>Ensure electricity and running water are available.</li>
          <li>Provide access instructions, including any entry codes.</li>
          <li>Make sure the areas being cleaned are accessible.</li>
          <li>Contact us before the appointment if your property condition or requested cleaning tasks have changed.</li>
        </ul>
        <p><strong>Important:</strong> Your booking covers only the services listed in your service details and attached booking record, for up to the maximum labor time shown. Any work outside that scope requires approval before it begins and may result in an additional charge.</p>
        ${managementUrl && !awaitingSchedule ? `<h2 style="color:#073f49;font-size:20px;margin:28px 0 8px;">Need to Make Changes?</h2><p>You can reschedule or cancel your appointment using the secure link below.</p><p><a href="${escapeHtml(managementUrl)}" style="display:inline-block;padding:13px 20px;background:#0b6474;color:#fff;text-decoration:none;border-radius:999px;font-weight:bold;">Manage Your Appointment</a></p>` : ""}
        <p>${escapeHtml(awaitingSchedule
          ? "Cancellation timing will be measured from the appointment after it is scheduled."
          : "Cancellations less than 48 hours ahead cost 25%. An approved late reschedule does not restore free cancellation; paid rescheduling fees are credited toward the 25% fee. Otherwise, cancellation at least 48 hours ahead qualifies for a full deposit refund. Any uncaptured authorization is released.")}</p>
        <p>${escapeHtml(attachmentMessage)}</p>
        ${paymentReferenceUrl ? `<p><a href="${escapeHtml(paymentReferenceUrl)}" style="color:#0b6474;font-weight:bold;">View Payment Receipt</a></p>` : ""}
        <p>We look forward to making your space fresh and ready!</p>
        <p style="margin-bottom:0;"><strong>IMAN Cleaning Service LLC</strong><br><a href="tel:+19292321930" style="color:#0b6474;">929-232-1930</a><br><a href="https://www.imancleaningservice.com" style="color:#0b6474;">www.imancleaningservice.com</a></p>
      </div>
    </div>
  </body>
</html>`;

  const headers = [
    `From: ${encodeMimeWord("IMAN Cleaning Service LLC")} <${from}>`,
    `To: ${record.customerEmail}`,
    `Subject: ${encodeMimeWord(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=\"customer_payment_mixed\""
  ];

  const parts = [
    headers.join("\r\n"),
    "",
    "--customer_payment_mixed",
    "Content-Type: multipart/alternative; boundary=\"customer_payment_alt\"",
    "",
    "--customer_payment_alt",
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "",
    text,
    "--customer_payment_alt",
    "Content-Type: text/html; charset=\"UTF-8\"",
    "",
    html,
    "--customer_payment_alt--",
    "",
    ...(confirmationPdf ? [
      "--customer_payment_mixed",
      `Content-Type: application/pdf; name="Iman-Cleaning-Booking-Record-${safeAttachmentName(record.quoteId)}.pdf"`,
      `Content-Disposition: attachment; filename="Iman-Cleaning-Booking-Record-${safeAttachmentName(record.quoteId)}.pdf"`,
      "Content-Transfer-Encoding: base64",
      "",
      (Buffer.from(confirmationPdf).toString("base64").match(/.{1,76}/g) || [""]).join("\r\n"),
      ""
    ] : []),
    ...(invoicePdf ? [
      "--customer_payment_mixed",
      "Content-Type: application/pdf; name=\"Iman-Cleaning-Payment-Receipt.pdf\"",
      "Content-Disposition: attachment; filename=\"Iman-Cleaning-Payment-Receipt.pdf\"",
      "Content-Transfer-Encoding: base64",
      "",
      (Buffer.from(invoicePdf).toString("base64").match(/.{1,76}/g) || [""]).join("\r\n"),
      ""
    ] : []),
    "--customer_payment_mixed--",
    ""
  ];

  return {
    raw: base64Url(parts.join("\r\n")),
    subject
  };
}

function safeAttachmentName(value) {
  return String(value || "confirmation").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
}

async function fetchInvoicePdf(record) {
  if (!record.stripeInvoicePdf) return null;
  try {
    const response = await fetch(record.stripeInvoicePdf);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function buildCustomerConfirmationSms(record, managementUrl) {
  const invoiceUrl = record.stripeInvoicePdf || record.stripeInvoiceUrl || record.stripeReceiptUrl;
  const automaticBalance = record.paymentType === "deposit_25"
    && record.balanceCollection === "automatic_48h_authorization";
  const awaitingSchedule = !record.serviceDate || !record.serviceTime;
  return [
    `IMAN Cleaning Service: ${automaticBalance ? "25% deposit received" : "Payment received"}. Order ${record.orderNumber || record.quoteId}${awaitingSchedule ? " is awaiting scheduling" : " is confirmed"}.`,
    awaitingSchedule ? `${record.service}: we will contact you to schedule the date and time.` : `${record.service}: ${record.serviceDate} at ${record.serviceTime}.`,
    `Paid: ${record.paidAmount}.`,
    automaticBalance ? `Remaining ${record.remainingAmount}: temporary authorization hold about 48 hours before service; charged after completion.` : "",
    invoiceUrl ? `Invoice PDF: ${invoiceUrl}` : "",
    managementUrl && !awaitingSchedule ? `Reschedule/cancel: ${managementUrl}` : "",
    awaitingSchedule ? "Reminders begin after scheduling. Reply STOP to opt out." : "We’ll remind you about 24 hours and 6 hours before. Reply STOP to opt out."
  ].filter(Boolean).join(" ");
}

function buildOwnerSmsMessage(record) {
  return [
    `IMAN Cleaning Service LLC: New paid booking: ${record.service}`,
    record.serviceDate && record.serviceTime ? `Date/time: ${record.serviceDate} at ${record.serviceTime}` : "Date/time: scheduling required",
    `Customer: ${record.customerName}`,
    record.serviceLocation ? `Location: ${record.serviceLocation}` : "",
    `Paid: ${record.paidAmount}`,
    `Order: ${record.orderNumber || record.quoteId}`,
    "Reply STOP to opt out or HELP for help."
  ].filter(Boolean).join("\n");
}

async function sendOwnerSmsNotification(record) {
  const config = getSmsConfig();
  if (!config.accountSid || !config.authToken || !config.from || !config.to) {
    return { status: "not_configured", messageId: "", error: "" };
  }

  try {
    const sent = await twilioRequest({
      ...config,
      body: buildOwnerSmsMessage(record)
    });
    return { status: "sent", messageId: cleanText(sent.sid), error: "" };
  } catch (error) {
    return { status: "failed", messageId: "", error: cleanText(error.message) };
  }
}

async function saveRecordFile(drive, record, text) {
  const folderId = extractDriveFolderId(record.idFolderLink);
  if (!folderId) return "";

  const created = await drive.files.create({
    requestBody: {
      name: `${record.quoteId}-agreement-payment-record.txt`,
      parents: [folderId],
      mimeType: "text/plain"
    },
    media: {
      mimeType: "text/plain",
      body: text
    },
    fields: "id, name, webViewLink"
  });

  return created.data.webViewLink || driveWebViewLink(created.data.id);
}

function getPaymentRecordSentAt(session) {
  const metadata = session.metadata || {};
  const paymentIntent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  return cleanText(metadata.agreement_record_sent_at || paymentIntent?.metadata?.agreement_record_sent_at);
}

async function markPaymentRecordSent(secretKey, record, source) {
  if (!record.paymentIntentId || !record.paymentIntentId.startsWith("pi_")) {
    return { status: "skipped", error: "" };
  }

  try {
    await stripePost(
      secretKey,
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(record.paymentIntentId)}`,
      {
        "metadata[agreement_record_sent_at]": new Date().toISOString(),
        "metadata[agreement_record_source]": source
      }
    );
    return { status: "marked", error: "" };
  } catch (error) {
    return { status: "failed", error: cleanText(error.message) };
  }
}

async function retrieveCheckoutSession(secretKey, sessionId) {
  return stripeRequest(
    secretKey,
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent.latest_charge&expand[]=invoice`
  );
}

async function sendPaymentRecordForSession({ session, siteUrl, source = "success_page", secretKey = getStripeSecretKey() }) {
  if (session.payment_status !== "paid") {
    const error = new Error("Payment is not marked paid yet.");
    error.statusCode = 400;
    throw error;
  }

  const alreadySentAt = getPaymentRecordSentAt(session);
  if (alreadySentAt) {
    const existingRecord = buildRecord({ session, siteUrl, source });
    return {
      message: "Payment and agreement record was already sent.",
      alreadySent: true,
      alreadySentAt,
      quoteId: existingRecord.quoteId,
      gmailMessageId: "",
      customerGmailMessageId: "",
      customerInvoicePdfAttached: false,
      customerBookingPdfAttached: false,
      customerSmsStatus: "skipped",
      customerSmsMessageId: "",
      customerSmsError: "",
      ownerSmsStatus: "skipped",
      ownerSmsMessageId: "",
      ownerSmsError: "",
      stripeRecordMarkerStatus: "already_marked",
      stripeRecordMarkerError: "",
      recordFileLink: "",
      analyticsPurchase: buildAnalyticsPurchase(session)
    };
  }

  const record = buildRecord({ session, siteUrl, source });
  const text = recordText(record);
  const html = recordHtml(record, text);
  const { drive, gmail } = getGoogleClients();
  const recordFileLink = await saveRecordFile(drive, record, text);
  const bookingId = cleanText(session.metadata?.booking_id);
  const booking = bookingId ? await getBooking(bookingId) : null;
  record.orderNumber = cleanText(booking?.estimate?.orderNumber || session.metadata?.order_number || bookingId, 40);
  if (!record.customerPhone && booking?.phone) record.customerPhone = cleanText(booking.phone);
  const managementUrl = bookingId && record.customerEmail
    ? `${siteUrl}/manage-booking.html`
    : "";
  const invoicePdf = await buildPaymentReceiptPdf({ booking, record });
  const confirmationPdf = await buildBookingConfirmationPdf({ booking, record });
  const email = buildEmail({ record, text, html, recordFileLink });
  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: email.raw
    }
  });
  const customerEmail = buildCustomerEmail({ record, booking, invoicePdf, confirmationPdf, managementUrl });
  const customerSent = customerEmail
    ? await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: customerEmail.raw
      }
    })
    : null;
  const [ownerSms, customerSms] = await Promise.all([
    sendOwnerSmsNotification(record),
    sendCustomerSms(record.customerPhone, buildCustomerConfirmationSms(record, managementUrl))
  ]);
  const marker = await markPaymentRecordSent(secretKey, record, source);

  return {
    message: "Payment and agreement record sent.",
    alreadySent: false,
    quoteId: record.quoteId,
    gmailMessageId: sent.data.id,
    customerGmailMessageId: customerSent?.data?.id || "",
    customerInvoicePdfAttached: Boolean(invoicePdf),
    customerBookingPdfAttached: Boolean(confirmationPdf),
    customerSmsStatus: customerSms.status,
    customerSmsMessageId: customerSms.messageId,
    customerSmsError: customerSms.error,
    ownerSmsStatus: ownerSms.status,
    ownerSmsMessageId: ownerSms.messageId,
    ownerSmsError: ownerSms.error,
    stripeRecordMarkerStatus: marker.status,
    stripeRecordMarkerError: marker.error,
    recordFileLink,
    managementUrl,
    analyticsPurchase: buildAnalyticsPurchase(session)
  };
}

async function sendPaymentRecordForSessionId({ sessionId, siteUrl, source = "success_page" }) {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    const error = new Error("Stripe is not configured yet.");
    error.statusCode = 503;
    error.setup = "Add STRIPE_SECRET_KEY in Vercel.";
    throw error;
  }

  const session = await retrieveCheckoutSession(secretKey, sessionId);
  if (session.payment_status !== 'paid') throw Object.assign(new Error('Payment is not marked paid yet.'), { statusCode: 400 });
  const bookingId = cleanText(session.metadata?.booking_id);
  let bookingConfirmation = null;
  if (bookingId) {
    bookingConfirmation = await confirmBooking(bookingId);
    if (bookingConfirmation?.booking && !Number(bookingConfirmation.booking.estimate?.payment?.paidCents || 0)) {
      const paymentIntent = typeof session.payment_intent === "object" ? session.payment_intent : null;
      const invoice = typeof session.invoice === "object" ? session.invoice : null;
      const metadata = session.metadata || {};
      const priorPayment = bookingConfirmation.booking.estimate?.payment || {};
      const paidCents = Number(session.amount_total || metadata.payment_amount_cents || 0);
      const totalCents = Number(metadata.total_amount_cents || paidCents);
      const remainingCents = Number(metadata.remaining_amount_cents || Math.max(0, totalCents - paidCents));
      const automaticBalance = metadata.payment_type === "deposit_25"
        && metadata.balance_collection === "automatic_48h_authorization";
      const estimate = {
        ...(bookingConfirmation.booking.estimate || {}),
        payment: {
          ...priorPayment,
          paymentType: cleanText(metadata.payment_type || priorPayment.paymentType),
          balanceCollection: cleanText(metadata.balance_collection || priorPayment.balanceCollection),
          status: remainingCents > 0 ? "deposit_paid" : "paid",
          totalCents,
          cleaningPriceCents: Math.max(0, totalCents - Number(metadata.rush_fee_cents || 0)),
          paymentIntentId: cleanText(paymentIntent?.id || session.payment_intent),
          depositPaymentIntentId: cleanText(paymentIntent?.id || session.payment_intent),
          stripeCustomerId: cleanText(typeof session.customer === "object" ? session.customer?.id : session.customer, 120),
          paymentMethodId: cleanText(typeof paymentIntent?.payment_method === "object"
            ? paymentIntent.payment_method?.id
            : paymentIntent?.payment_method, 120),
          paymentMethodFingerprint: cleanText(paymentIntent?.latest_charge?.payment_method_details?.card?.fingerprint, 180),
          paidCents,
          depositCents: automaticBalance ? paidCents : Number(priorPayment.depositCents || paidCents),
          remainingCents,
          invoiceId: cleanText(invoice?.id || session.invoice),
          invoiceUrl: cleanText(invoice?.hosted_invoice_url),
          invoicePdf: cleanText(invoice?.invoice_pdf),
          receiptUrl: cleanText(paymentIntent?.latest_charge?.receipt_url),
          paidAt: stripeTime(paymentIntent?.created || session.created),
          remaining: automaticBalance ? {
            ...(priorPayment.remaining || {}),
            status: "pending",
            amountCents: remainingCents,
            authorizationDueHours: 48,
            attempts: 0,
            paymentIntentId: ""
          } : priorPayment.remaining
        }
      };
      bookingConfirmation.booking = await updateBooking(bookingId, { estimate });
    }
  }
  // The slot is confirmed before email/SMS/PDF delivery, so a notification
  // outage cannot leave a successfully paid appointment available to others.
  const result = await sendPaymentRecordForSession({ session, siteUrl, source, secretKey });
  return {
    ...result,
    bookingConfirmed: Boolean(bookingId),
    bookingId,
    calendarStatus: bookingConfirmation?.calendarSync?.status || ""
  };
}

async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const secretKey = getStripeSecretKey();
    if (!secretKey) {
      return json(response, 503, {
        error: "Stripe is not configured yet.",
        setup: "Add STRIPE_SECRET_KEY in Vercel."
      });
    }

    const body = await readJsonBody(request);
    const sessionId = cleanText(body.sessionId);
    if (!sessionId || !sessionId.startsWith("cs_")) {
      return json(response, 400, { error: "A valid Stripe Checkout Session ID is required." });
    }

    const result = await sendPaymentRecordForSessionId({
      sessionId,
      siteUrl: getSiteUrl(request),
      source: "success_page"
    });

    return json(response, 200, result);
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Payment and agreement record could not be sent.",
      details: error.details,
      setup: error.setup
    });
  }
}

module.exports = handler;
module.exports.sendPaymentRecordForSession = sendPaymentRecordForSession;
module.exports.sendPaymentRecordForSessionId = sendPaymentRecordForSessionId;
module.exports.buildCustomerEmail = buildCustomerEmail;
module.exports.buildCustomerConfirmationSms = buildCustomerConfirmationSms;
module.exports.selectedServiceDetailsUrl = selectedServiceDetailsUrl;
