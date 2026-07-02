const {
  centsToDollars,
  cleanText,
  driveWebViewLink,
  getGoogleClients,
  json,
  readJsonBody
} = require("./_shared");

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

async function stripeRequest(secretKey, url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${secretKey}`
    }
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

function extractDriveFolderId(link) {
  const value = String(link || "");
  const match = value.match(/\/folders\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function buildRecord({ session, siteUrl }) {
  const metadata = session.metadata || {};
  const paymentIntent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const invoice = typeof session.invoice === "object" ? session.invoice : null;
  const paidCents = Number(session.amount_total || metadata.payment_amount_cents || metadata.total_amount_cents || 0);
  const totalCents = Number(metadata.total_amount_cents || paidCents || 0);
  const agreementUrl = cleanText(metadata.agreement_url, `${siteUrl}/agreement.html`);
  const recordCreatedAt = new Date().toISOString();

  return {
    recordCreatedAt,
    quoteId: cleanText(metadata.quote_id, session.client_reference_id || session.id),
    customerName: cleanText(metadata.customer_name || session.customer_details?.name),
    customerEmail: cleanText(session.customer_details?.email || session.customer_email),
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
    agreementAcceptedAt: stripeTime(session.created),
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
    `Agreement accepted timestamp: ${record.agreementAcceptedAt}`,
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
    "This record was generated after Stripe redirected the customer to the quote paid confirmation page."
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

function buildCustomerEmail({ record }) {
  if (!record.customerEmail) return null;

  const from = process.env.QUOTE_EMAIL_FROM || "Info@imancleaningservice.com";
  const subject = `Your Iman Cleaning Service payment confirmation - ${record.quoteId}`;
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
    "Thank you. Your payment was received and your cleaning appointment is approved.",
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
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
    <p>Thank you. Your payment was received and your cleaning appointment is approved.</p>
    <table>${rows}</table>
    <p>Iman Cleaning Service LLC will follow up if any additional appointment details are needed.</p>
    <p>Thank you,<br>Iman Cleaning Service LLC</p>
  </body>
</html>`;

  const headers = [
    `From: ${encodeMimeWord("IMAN Cleaning Service LLC")} <${from}>`,
    `To: ${record.customerEmail}`,
    `Subject: ${encodeMimeWord(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: multipart/alternative; boundary=\"customer_payment_alt\""
  ];

  const parts = [
    headers.join("\r\n"),
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
    ""
  ];

  return {
    raw: base64Url(parts.join("\r\n")),
    subject
  };
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

module.exports = async function handler(request, response) {
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

    const session = await stripeRequest(
      secretKey,
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent.latest_charge&expand[]=invoice`
    );

    if (session.payment_status !== "paid") {
      return json(response, 400, { error: "Payment is not marked paid yet." });
    }

    const record = buildRecord({ session, siteUrl: getSiteUrl(request) });
    const text = recordText(record);
    const html = recordHtml(record, text);
    const { drive, gmail } = getGoogleClients();
    const recordFileLink = await saveRecordFile(drive, record, text);
    const email = buildEmail({ record, text, html, recordFileLink });
    const sent = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: email.raw
      }
    });
    const customerEmail = buildCustomerEmail({ record });
    const customerSent = customerEmail
      ? await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: customerEmail.raw
        }
      })
      : null;
    const ownerSms = await sendOwnerSmsNotification(record);

    return json(response, 200, {
      message: "Payment and agreement record sent.",
      quoteId: record.quoteId,
      gmailMessageId: sent.data.id,
      customerGmailMessageId: customerSent?.data?.id || "",
      ownerSmsStatus: ownerSms.status,
      ownerSmsMessageId: ownerSms.messageId,
      ownerSmsError: ownerSms.error,
      recordFileLink
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Payment and agreement record could not be sent.",
      details: error.details,
      setup: error.setup
    });
  }
};
