const {
  centsToDollars,
  cleanText,
  driveWebViewLink,
  getGoogleClients,
  json,
  readJsonBody
} = require("./_shared");
const { confirmBooking, updateBooking } = require("../booking/_shared");
const { createBookingManagementToken } = require("../booking/_manage");
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
    to: cleanText(process.env.OWNER_SMS_TO || process.env.ADMIN_SMS_TO)
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
  const invoice = typeof session.invoice === "object" ? session.invoice : null;
  const paidCents = Number(session.amount_total || metadata.payment_amount_cents || metadata.total_amount_cents || 0);
  const totalCents = Number(metadata.total_amount_cents || paidCents || 0);
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
    serviceDate: cleanText(metadata.service_date),
    serviceTime: cleanText(metadata.service_time),
    totalAmount: money(totalCents),
    paidAmount: money(paidCents),
    remainingAmount: money(Number(metadata.remaining_amount_cents || 0)),
    paymentType: cleanText(metadata.payment_type),
    paymentStatus: cleanText(session.payment_status),
    checkoutSessionId: session.id,
    paymentIntentId: cleanText(paymentIntent?.id || session.payment_intent),
    paidAt: stripeTime(paymentIntent?.created || session.created),
    agreementAcceptedAt: agreementTime(metadata.agreement_signed_at, session.created),
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
    `Service date: ${record.serviceDate}`,
    `Service start time: ${record.serviceTime}`,
    `Total quoted price: ${record.totalAmount}`,
    `Amount paid: ${record.paidAmount}`,
    `Remaining balance after this payment: ${record.remainingAmount}`,
    `Payment type: ${record.paymentType}`,
    `Payment status: ${record.paymentStatus}`,
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

function buildCustomerEmail({ record, invoicePdf, managementUrl }) {
  if (!record.customerEmail) return null;

  const from = process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com";
  const subject = `Booking confirmed and PDF invoice - ${record.quoteId}`;
  const details = [
    ["Customer", record.customerName],
    ["Location", record.serviceLocation],
    ["Service", record.service],
    ["Service date", record.serviceDate],
    ["Start time", record.serviceTime],
    ["Amount paid", record.paidAmount],
    ["Remaining balance", record.remainingAmount],
    ["Invoice", record.stripeInvoiceUrl],
    ["Invoice PDF", record.stripeInvoicePdf],
    ["Receipt", record.stripeReceiptUrl]
  ].filter(([, value]) => value);

  const text = [
    `Hi ${record.customerName || "there"},`,
    "",
    "Thank you for booking with Iman Cleaning Service LLC. Your full payment was received and your cleaning appointment is confirmed.",
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    invoicePdf ? "Your PDF invoice is attached to this email." : "Your PDF invoice is available from the invoice link above.",
    managementUrl ? `Reschedule or cancel: ${managementUrl}` : "",
    "Cancellation policy: cancel at least 24 hours before the appointment for a full refund. If less than 24 hours remain, 25% is retained and 75% is refunded to the original payment method.",
    "We will send email and text reminders about 6 hours and 1 hour before your appointment.",
    "Iman Cleaning Service LLC will follow up if any additional appointment details are needed.",
    "",
    "Thank you,",
    "Iman Cleaning Service LLC"
  ].join("\n");

  const rows = details.map(([label, value]) => {
    const escapedValue = escapeHtml(value);
    const link = /^https?:\/\//.test(String(value || ""));
    const content = link ? `<a href="${escapedValue}">${escapedValue}</a>` : escapedValue;
    return `<tr><th align="left" style="padding:6px 12px 6px 0;">${escapeHtml(label)}</th><td style="padding:6px 0;">${content}</td></tr>`;
  }).join("");

  const html = `<!doctype html>
<html>
  <body style="font-family:Arial,sans-serif;color:#1f2933;line-height:1.5;">
    <p>Hi ${escapeHtml(record.customerName || "there")},</p>
    <p>Thank you for booking with Iman Cleaning Service LLC. Your full payment was received and your cleaning appointment is confirmed.</p>
    <table>${rows}</table>
    <p><strong>${invoicePdf ? "Your PDF invoice is attached to this email." : "Your PDF invoice is available from the invoice link above."}</strong></p>
    ${managementUrl ? `<p><a href="${escapeHtml(managementUrl)}" style="display:inline-block;padding:13px 20px;background:#0b6474;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;">Reschedule or cancel my appointment</a></p>` : ""}
    <p>Cancellation policy: cancel at least 24 hours before the appointment for a full refund. If less than 24 hours remain, 25% is retained and 75% is refunded to the original payment method.</p>
    <p>We will send email and text reminders about 6 hours and 1 hour before your appointment.</p>
    <p>Iman Cleaning Service LLC will follow up if any additional appointment details are needed.</p>
    <p>Thank you,<br>Iman Cleaning Service LLC</p>
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
    ...(invoicePdf ? [
      "--customer_payment_mixed",
      "Content-Type: application/pdf; name=\"Iman-Cleaning-Invoice.pdf\"",
      "Content-Disposition: attachment; filename=\"Iman-Cleaning-Invoice.pdf\"",
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
  return [
    `IMAN Cleaning Service: Payment received and booking ${record.quoteId} is confirmed.`,
    `${record.service}: ${record.serviceDate} at ${record.serviceTime}.`,
    `Paid: ${record.paidAmount}.`,
    invoiceUrl ? `Invoice PDF: ${invoiceUrl}` : "",
    managementUrl ? `Reschedule/cancel: ${managementUrl}` : "",
    "We’ll remind you about 6 hours and 1 hour before. Reply STOP to opt out."
  ].filter(Boolean).join(" ");
}

function buildOwnerSmsMessage(record) {
  return [
    `IMAN Cleaning Service LLC: New paid booking: ${record.service}`,
    `Date/time: ${record.serviceDate} at ${record.serviceTime}`,
    `Customer: ${record.customerName}`,
    record.serviceLocation ? `Location: ${record.serviceLocation}` : "",
    `Paid: ${record.paidAmount}`,
    `Quote: ${record.quoteId}`,
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
      customerSmsStatus: "skipped",
      customerSmsMessageId: "",
      customerSmsError: "",
      ownerSmsStatus: "skipped",
      ownerSmsMessageId: "",
      ownerSmsError: "",
      stripeRecordMarkerStatus: "already_marked",
      stripeRecordMarkerError: "",
      recordFileLink: ""
    };
  }

  const record = buildRecord({ session, siteUrl, source });
  const text = recordText(record);
  const html = recordHtml(record, text);
  const { drive, gmail } = getGoogleClients();
  const recordFileLink = await saveRecordFile(drive, record, text);
  const bookingId = cleanText(session.metadata?.booking_id);
  const managementUrl = bookingId && record.customerEmail
    ? `${siteUrl}/manage-booking.html?token=${encodeURIComponent(createBookingManagementToken({
      bookingId,
      email: record.customerEmail
    }))}`
    : "";
  const invoicePdf = await fetchInvoicePdf(record);
  const email = buildEmail({ record, text, html, recordFileLink });
  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: email.raw
    }
  });
  const customerEmail = buildCustomerEmail({ record, invoicePdf, managementUrl });
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
    customerSmsStatus: customerSms.status,
    customerSmsMessageId: customerSms.messageId,
    customerSmsError: customerSms.error,
    ownerSmsStatus: ownerSms.status,
    ownerSmsMessageId: ownerSms.messageId,
    ownerSmsError: ownerSms.error,
    stripeRecordMarkerStatus: marker.status,
    stripeRecordMarkerError: marker.error,
    recordFileLink,
    managementUrl
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
  const result = await sendPaymentRecordForSession({ session, siteUrl, source, secretKey });
  const bookingId = cleanText(session.metadata?.booking_id);
  let bookingConfirmation = null;
  if (bookingId) {
    bookingConfirmation = await confirmBooking(bookingId);
    if (bookingConfirmation?.booking) {
      const paymentIntent = typeof session.payment_intent === "object" ? session.payment_intent : null;
      const invoice = typeof session.invoice === "object" ? session.invoice : null;
      const estimate = {
        ...(bookingConfirmation.booking.estimate || {}),
        payment: {
          paymentIntentId: cleanText(paymentIntent?.id || session.payment_intent),
          paidCents: Number(session.amount_total || 0),
          invoiceId: cleanText(invoice?.id || session.invoice),
          invoiceUrl: cleanText(invoice?.hosted_invoice_url),
          invoicePdf: cleanText(invoice?.invoice_pdf),
          receiptUrl: cleanText(paymentIntent?.latest_charge?.receipt_url),
          paidAt: stripeTime(paymentIntent?.created || session.created)
        }
      };
      bookingConfirmation.booking = await updateBooking(bookingId, { estimate });
    }
  }
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
