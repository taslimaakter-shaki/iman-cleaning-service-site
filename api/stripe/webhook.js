const crypto = require("crypto");
const { cleanText, json } = require("../quote/_shared");
const { sendPaymentRecordForSessionId } = require("../quote/_payment-record");

const MAX_WEBHOOK_BODY = 1024 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function getSiteUrl(request) {
  const configuredUrl = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

function getWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET || process.env.Stripe_Webhook_Secret || "";
}

function readRawBody(request, maxBytes = MAX_WEBHOOK_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(Object.assign(new Error("Webhook body is too large."), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function parseStripeSignature(header) {
  const values = {
    timestamp: "",
    signatures: []
  };

  String(header || "").split(",").forEach((part) => {
    const [key, value] = part.split("=");
    if (key === "t") values.timestamp = value;
    if (key === "v1" && value) values.signatures.push(value);
  });

  return values;
}

function timingSafeHexEqual(a, b) {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  const timestampSeconds = Number(timestamp);

  if (!timestamp || !Number.isFinite(timestampSeconds) || signatures.length === 0) {
    const error = new Error("Stripe webhook signature is missing or malformed.");
    error.statusCode = 400;
    throw error;
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) {
    const error = new Error("Stripe webhook signature timestamp is outside the allowed window.");
    error.statusCode = 400;
    throw error;
  }

  const signedPayload = Buffer.concat([
    Buffer.from(`${timestamp}.`, "utf8"),
    rawBody
  ]);
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  if (!signatures.some((signature) => timingSafeHexEqual(signature, expectedSignature))) {
    const error = new Error("Stripe webhook signature verification failed.");
    error.statusCode = 400;
    throw error;
  }
}

function shouldProcessCheckoutSession(event) {
  const session = event?.data?.object || {};
  const metadata = session.metadata || {};

  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event?.type)) {
    return false;
  }
  if (session.mode && session.mode !== "payment") {
    return false;
  }
  if (event.type === "checkout.session.completed" && session.payment_status !== "paid") {
    return false;
  }

  return metadata.agreement_accepted === "true" || Boolean(metadata.agreement_signature);
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const webhookSecret = getWebhookSecret();
    if (!webhookSecret || !String(webhookSecret).startsWith("whsec_")) {
      return json(response, 503, {
        error: "Stripe webhook is not configured yet.",
        setup: "Add STRIPE_WEBHOOK_SECRET in Vercel. The value starts with whsec_."
      });
    }

    const rawBody = await readRawBody(request);
    verifyStripeSignature(rawBody, request.headers["stripe-signature"], webhookSecret);

    const event = JSON.parse(rawBody.toString("utf8"));
    if (!shouldProcessCheckoutSession(event)) {
      return json(response, 200, {
        received: true,
        processed: false,
        eventType: cleanText(event.type)
      });
    }

    const sessionId = cleanText(event.data?.object?.id);
    if (!sessionId || !sessionId.startsWith("cs_")) {
      return json(response, 400, { error: "Webhook event did not include a valid Checkout Session ID." });
    }

    const result = await sendPaymentRecordForSessionId({
      sessionId,
      siteUrl: getSiteUrl(request),
      source: "stripe_webhook"
    });

    return json(response, 200, {
      received: true,
      processed: true,
      eventType: event.type,
      ...result
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Stripe webhook could not be processed.",
      details: error.details,
      setup: error.setup
    });
  }
};
