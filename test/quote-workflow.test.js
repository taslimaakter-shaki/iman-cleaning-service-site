const assert = require("assert");
const { Readable } = require("stream");
const Module = require("module");

const calls = {
  driveCreates: [],
  gmailSends: [],
  stripeSessions: [],
  checkoutSessionRetrieves: [],
  smsSends: []
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "googleapis") {
    return {
      google: {
        auth: {
          OAuth2: class OAuth2 {
            setCredentials(credentials) {
              this.credentials = credentials;
            }
          }
        },
        drive() {
          return {
            files: {
              async create(params) {
                calls.driveCreates.push(params);
                const id = `drive-file-${calls.driveCreates.length}`;
                return {
                  data: {
                    id,
                    name: params.requestBody.name,
                    webViewLink: `https://drive.google.com/mock/${id}`,
                    size: "12"
                  }
                };
              }
            }
          };
        },
        gmail() {
          return {
            users: {
              messages: {
                async send(params) {
                  calls.gmailSends.push(params);
                  return { data: { id: "gmail-message-1" } };
                }
              }
            }
          };
        }
      }
    };
  }
  return originalLoad(request, parent, isMain);
};

process.env.GOOGLE_CLIENT_ID = "client-id";
process.env.GOOGLE_CLIENT_SECRET = "client-secret";
process.env.GOOGLE_REFRESH_TOKEN = "refresh-token";
process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID = "parent-folder";
process.env.QUOTE_EMAIL_FROM = "Info@imancleaningservice.com";
process.env.QUOTE_EMAIL_TO = "Info@imancleaningservice.com";
process.env.ADMIN_TOKEN = "admin-token";
process.env.STRIPE_SECRET_KEY = "sk_mock_secret";
process.env.PUBLIC_SITE_URL = "https://www.imancleaningservice.com";
process.env.TWILIO_ACCOUNT_SID = "AC_mock_account";
process.env.TWILIO_AUTH_TOKEN = "twilio-auth-token";
process.env.TWILIO_FROM_NUMBER = "+15550001111";
process.env.OWNER_SMS_TO = "+15550002222";

const originalFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  if (String(url) === "https://api.stripe.com/v1/checkout/sessions") {
    calls.stripeSessions.push(options);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          id: "cs_test_mock",
          url: "https://checkout.stripe.com/c/pay/mock"
        });
      }
    };
  }
  if (String(url).startsWith("https://api.stripe.com/v1/checkout/sessions/cs_test_record")) {
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          id: "cs_test_record",
          status: "complete",
          payment_status: "paid",
          amount_total: 25000,
          customer_email: "customer@example.com",
          customer_details: {
            name: "Customer One",
            email: "customer@example.com"
          },
          created: 1780689000,
          payment_intent: {
            id: "pi_record_mock",
            created: 1780689001,
            latest_charge: {
              receipt_url: "https://pay.stripe.com/receipts/mock"
            }
          },
          invoice: {
            id: "in_record_mock",
            hosted_invoice_url: "https://invoice.stripe.com/i/mock",
            invoice_pdf: "https://pay.stripe.com/invoice/mock.pdf"
          },
          metadata: {
            quote_id: "QUOTE-RECORD",
            customer_name: "Customer One",
            service_location: "123 Main St, New York, NY 10001",
            service: "Deep Cleaning",
            service_date: "2026-06-12",
            service_time: "10:30",
            agreement_url: "https://www.imancleaningservice.com/agreement.html",
            total_amount_cents: "25000",
            payment_amount_cents: "25000",
            remaining_amount_cents: "0",
            payment_type: "full",
            id_folder_link: "https://drive.google.com/drive/folders/photo-id-folder",
            id_file_link: "https://drive.google.com/file/d/photo-id-file/view"
          }
        });
      }
    };
  }
  if (String(url).startsWith("https://api.twilio.com/2010-04-01/Accounts/AC_mock_account/Messages.json")) {
    calls.smsSends.push(options);
    return {
      ok: true,
      status: 201,
      async text() {
        return JSON.stringify({
          sid: "SM_mock_message"
        });
      }
    };
  }
  return originalFetch(url, options);
};

function request({ method = "POST", headers = {}, body = "" } = {}) {
  const stream = Readable.from(body ? [body] : []);
  stream.method = method;
  stream.headers = headers;
  return stream;
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      this.body = value || "";
    },
    json() {
      return this.body ? JSON.parse(this.body) : {};
    }
  };
}

function multipartBody(boundary, fields, file, fieldName = "photo") {
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`));
  chunks.push(file.buffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

async function runHandler(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

async function testStartCreatesDriveFolder() {
  const handler = require("../api/quote/start");
  const res = await runHandler(handler, request({
    body: JSON.stringify({
      formFields: {
        "First Name": "Darshan",
        "Last Name": "Nandi"
      }
    })
  }));

  assert.strictEqual(res.statusCode, 201);
  assert.match(res.json().quoteId, /^QUOTE-/);
  assert.strictEqual(calls.driveCreates[0].requestBody.parents[0], "parent-folder");
  assert.match(calls.driveCreates[0].requestBody.name, /Darshan Nandi/);
}

async function testPhotoUploadsOneCompressedImage() {
  const handler = require("../api/quote/photo");
  const boundary = "quote-test-boundary";
  const body = multipartBody(boundary, {
    quoteId: "QUOTE-TEST",
    folderId: "folder-123",
    photoIndex: "2"
  }, {
    filename: "kitchen.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("jpeg-bytes")
  });

  const res = await runHandler(handler, request({
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.length)
    },
    body
  }));

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.json().originalName, "kitchen.jpg");
  assert.match(calls.driveCreates.at(-1).requestBody.name, /QUOTE-TEST-002-kitchen\.jpg/);
  assert.strictEqual(calls.driveCreates.at(-1).requestBody.parents[0], "folder-123");
}

async function testFinishSendsAllPhotoLinks() {
  const handler = require("../api/quote/finish");
  const photos = Array.from({ length: 100 }, (_, index) => ({
    originalName: `room-${index + 1}.jpg`,
    webViewLink: `https://drive.google.com/file/${index + 1}`
  }));
  const res = await runHandler(handler, request({
    body: JSON.stringify({
      quoteId: "QUOTE-TEST",
      folderLink: "https://drive.google.com/folders/folder-123",
      formFields: {
        "First Name": "Darshan",
        Email: "customer@example.com"
      },
      photos,
      attachments: [
        {
          filename: "room-1.jpg",
          dataUrl: `data:image/jpeg;base64,${Buffer.from("small-image").toString("base64")}`
        }
      ]
    })
  }));

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().attachmentCount, 1);
  assert.strictEqual(calls.gmailSends.length, 1);

  const raw = calls.gmailSends[0].requestBody.raw.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Buffer.from(raw, "base64").toString("utf8");
  assert.match(decoded, /Reply-To: customer@example.com/);
  assert.match(decoded, /Total uploaded photos: 100/);
  assert.match(decoded, /room-100\.jpg/);
  assert.match(decoded, /Content-Disposition: attachment; filename="room-1.jpg"/);
}

async function testApprovalLinkCreatesSignedCustomerLink() {
  const handler = require("../api/quote/approval-link");
  const res = await runHandler(handler, request({
    headers: {
      "x-admin-token": "admin-token",
      host: "www.imancleaningservice.com"
    },
      body: JSON.stringify({
        quoteId: "QUOTE-APPROVE",
        customerName: "Customer One",
        customerEmail: "customer@example.com",
        serviceLocation: "123 Main St, New York, NY 10001",
        service: "Deep Cleaning",
      amount: "250.00",
      serviceDate: "2026-06-12",
      serviceTime: "10:30",
      description: "Two bedroom deep cleaning",
      agreementUrl: "https://www.imancleaningservice.com/agreement.html"
    })
  }));

  assert.strictEqual(res.statusCode, 201);
  assert.match(res.json().approvalUrl, /approve-quote\.html\?token=/);
  assert.strictEqual(res.json().quoteId, "QUOTE-APPROVE");
}

async function testApproveCheckoutRequiresAgreement() {
  const { signQuotePayload } = require("../api/quote/_shared");
  const handler = require("../api/quote/approve-checkout");
  const token = signQuotePayload({
    quoteId: "QUOTE-APPROVE",
    customerName: "Customer One",
    customerEmail: "customer@example.com",
    serviceLocation: "123 Main St, New York, NY 10001",
    service: "Deep Cleaning",
    amountCents: 25000,
    serviceDate: "2026-06-12",
    serviceTime: "10:30",
    description: "Two bedroom deep cleaning",
    agreementUrl: "https://www.imancleaningservice.com/agreement.html",
    expiresAt: Date.now() + 60_000
  });
  const body = new URLSearchParams({
    token,
    agreementAccepted: "true",
    agreementScrolled: "true"
  }).toString();

  const res = await runHandler(handler, request({
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": String(body.length),
      host: "www.imancleaningservice.com"
    },
    body
  }));

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.json().checkoutUrl, "https://checkout.stripe.com/c/pay/mock");
  assert.strictEqual(calls.stripeSessions.length, 1);
  const stripeBody = String(calls.stripeSessions[0].body);
  assert.match(stripeBody, /line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=6250/);
  assert.doesNotMatch(stripeBody, /payment_intent_data%5Bsetup_future_usage%5D=off_session/);
  assert.match(stripeBody, /payment_intent_data%5Breceipt_email%5D=customer%40example.com/);
  assert.match(stripeBody, /payment_intent_data%5Bmetadata%5D%5Bpayment_amount_cents%5D=6250/);
  assert.match(stripeBody, /payment_intent_data%5Bmetadata%5D%5Bremaining_amount_cents%5D=18750/);
  assert.match(stripeBody, /payment_intent_data%5Bmetadata%5D%5Bpayment_type%5D=deposit_25/);
  assert.match(stripeBody, /payment_intent_data%5Bmetadata%5D%5Bservice_date%5D=2026-06-12/);
  assert.match(stripeBody, /payment_intent_data%5Bmetadata%5D%5Bservice_time%5D=10%3A30/);
  assert.match(stripeBody, /payment_intent_data%5Bmetadata%5D%5Bservice_location%5D=123\+Main\+St/);
  assert.match(stripeBody, /metadata%5Bquote_id%5D=QUOTE-APPROVE/);
  assert.match(stripeBody, /metadata%5Btotal_amount_cents%5D=25000/);
  assert.match(stripeBody, /metadata%5Bpayment_amount_cents%5D=6250/);
  assert.match(stripeBody, /metadata%5Bremaining_amount_cents%5D=18750/);
  assert.match(stripeBody, /metadata%5Bpayment_type%5D=deposit_25/);
  assert.match(stripeBody, /metadata%5Bservice_date%5D=2026-06-12/);
  assert.match(stripeBody, /metadata%5Bservice_time%5D=10%3A30/);
  assert.match(stripeBody, /metadata%5Bservice_location%5D=123\+Main\+St/);
  assert.doesNotMatch(stripeBody, /metadata%5Bid_file_link%5D=/);
  assert.doesNotMatch(stripeBody, /metadata%5Bid_folder_link%5D=/);
  assert.match(stripeBody, /invoice_creation%5Benabled%5D=true/);
  assert.match(stripeBody, /invoice_creation%5Binvoice_data%5D%5Bmetadata%5D%5Bquote_id%5D=QUOTE-APPROVE/);
  assert.match(stripeBody, /invoice_creation%5Binvoice_data%5D%5Bmetadata%5D%5Bservice_location%5D=123\+Main\+St/);
}

async function testRemainingBalanceCheckoutSkipsAgreementAndId() {
  const handler = require("../api/stripe/checkout-session");
  const res = await runHandler(handler, request({
    headers: {
      "x-admin-token": "admin-token",
      host: "www.imancleaningservice.com"
    },
    body: JSON.stringify({
      quoteId: "QUOTE-APPROVE",
      customerName: "Customer One",
      customerEmail: "customer@example.com",
      serviceLocation: "123 Main St, New York, NY 10001",
      service: "Deep Cleaning",
      amount: "250.00",
      serviceDate: "2026-06-12",
      serviceTime: "10:30",
      description: "Two bedroom deep cleaning",
      paymentType: "remaining_75"
    })
  }));

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.json().checkoutUrl, "https://checkout.stripe.com/c/pay/mock");
  assert.strictEqual(calls.stripeSessions.length, 2);
  const stripeBody = String(calls.stripeSessions.at(-1).body);
  assert.match(stripeBody, /line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=18750/);
  assert.match(stripeBody, /75%25\+Remaining\+Balance/);
  assert.doesNotMatch(stripeBody, /consent_collection%5Bterms_of_service%5D=required/);
  assert.doesNotMatch(stripeBody, /custom_text%5Bterms_of_service_acceptance%5D/);
  assert.match(stripeBody, /payment_intent_data%5Bmetadata%5D%5Bpayment_type%5D=remaining_75/);
  assert.match(stripeBody, /payment_intent_data%5Bmetadata%5D%5Bpayment_amount_cents%5D=18750/);
  assert.match(stripeBody, /payment_intent_data%5Bmetadata%5D%5Bremaining_amount_cents%5D=0/);
  assert.match(stripeBody, /metadata%5Bservice_date%5D=2026-06-12/);
  assert.match(stripeBody, /metadata%5Bservice_time%5D=10%3A30/);
}

async function testPaymentRecordSendsEmailAndSavesDriveFile() {
  const handler = require("../api/quote/payment-record");
  const res = await runHandler(handler, request({
    body: JSON.stringify({
      sessionId: "cs_test_record"
    })
  }));

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().quoteId, "QUOTE-RECORD");
  assert.match(res.json().recordFileLink, /drive-file/);
  assert.strictEqual(res.json().ownerSmsStatus, "sent");
  assert.strictEqual(res.json().ownerSmsMessageId, "SM_mock_message");

  const recordFile = calls.driveCreates.at(-1);
  assert.strictEqual(recordFile.requestBody.parents[0], "photo-id-folder");
  assert.match(recordFile.requestBody.name, /QUOTE-RECORD-agreement-payment-record\.txt/);
  assert.match(String(recordFile.media.body), /Agreement accepted before payment: Yes/);
  assert.match(String(recordFile.media.body), /Amount paid: \$250\.00/);
  assert.match(String(recordFile.media.body), /Service location: 123 Main St, New York, NY 10001/);
  assert.match(String(recordFile.media.body), /Service date: 2026-06-12/);
  assert.match(String(recordFile.media.body), /Service start time: 10:30/);
  assert.match(String(recordFile.media.body), /Stripe invoice: https:\/\/invoice\.stripe\.com\/i\/mock/);

  const internalRaw = calls.gmailSends.at(-2).requestBody.raw.replace(/-/g, "+").replace(/_/g, "/");
  const internalDecoded = Buffer.from(internalRaw, "base64").toString("utf8");
  assert.match(internalDecoded, /Subject: =\?UTF-8\?B\?/);
  assert.match(internalDecoded, /Quote ID: QUOTE-RECORD/);
  assert.match(internalDecoded, /Service date: 2026-06-12/);
  assert.match(internalDecoded, /Photo ID file: https:\/\/drive\.google\.com\/file\/d\/photo-id-file\/view/);
  assert.match(internalDecoded, /Stripe Checkout Session ID: cs_test_record/);

  const customerRaw = calls.gmailSends.at(-1).requestBody.raw.replace(/-/g, "+").replace(/_/g, "/");
  const customerDecoded = Buffer.from(customerRaw, "base64").toString("utf8");
  assert.match(customerDecoded, /To: customer@example.com/);
  assert.match(customerDecoded, /Your payment was received and your cleaning appointment is approved/);
  assert.match(customerDecoded, /Location: 123 Main St, New York, NY 10001/);
  assert.match(customerDecoded, /Service date: 2026-06-12/);
  assert.match(customerDecoded, /Invoice: https:\/\/invoice\.stripe\.com\/i\/mock/);

  assert.strictEqual(calls.smsSends.length, 1);
  const smsBody = String(calls.smsSends[0].body);
  assert.match(smsBody, /To=%2B15550002222/);
  assert.match(smsBody, /From=%2B15550001111/);
  assert.match(smsBody, /New\+paid\+booking%3A\+Deep\+Cleaning/);
  assert.match(smsBody, /Date%2Ftime%3A\+2026-06-12\+at\+10%3A30/);
  assert.match(smsBody, /Location%3A\+123\+Main\+St/);
}

(async () => {
  await testStartCreatesDriveFolder();
  await testPhotoUploadsOneCompressedImage();
  await testFinishSendsAllPhotoLinks();
  await testApprovalLinkCreatesSignedCustomerLink();
  await testApproveCheckoutRequiresAgreement();
  await testRemainingBalanceCheckoutSkipsAgreementAndId();
  await testPaymentRecordSendsEmailAndSavesDriveFile();
  console.log("quote workflow tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
