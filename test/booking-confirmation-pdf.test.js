const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "googleapis") return { google: {} };
  return originalLoad(request, parent, isMain);
};

const { buildBookingConfirmationPdf, buildSections } = require("../api/booking/_confirmation-pdf");
const { buildCustomerEmail } = require("../api/quote/_payment-record");

const booking = {
  id: "BK-PDF-TEST",
  status: "New",
  service: "standard",
  service_label: "Standard Cleaning",
  schedule: "2026-08-24T13:00:00.000Z",
  client_name: "Amina Customer",
  phone: "929-555-0188",
  email: "amina@example.com",
  address: "123 Main Street, Apt 4B, Queens, NY, 11432",
  addons: ["Inside refrigerator", "Inside oven"],
  notes: "Customer requested special attention in the kitchen.",
  estimate: {
    manHours: 5,
    teamHours: 2.5,
    subtotal: 355.91,
    tax: 31.59,
    total: 387.50,
    agreementVersion: "2026-08-09-deposit-and-balance-authorization-v1",
    eligibility: {
      serviceIntent: "cleaning",
      requestedService: "standard",
      propertyStatus: "occupied",
      propertyType: "residential",
      serviceZip: "11432",
      unitCount: 1,
      utilitiesAvailable: "yes",
      clutter: "low",
      buildup: "none",
      hazards: "none"
    },
    units: [{
      unitNumber: 1,
      bedrooms: 2,
      fullBathrooms: 1,
      halfBathrooms: 0,
      hasPets: "yes",
      petCount: 2,
      petType: "cats-and-dogs",
      refrigeratorCleaning: "empty",
      ovenCleaning: "yes",
      baseItems: [{ label: "2 bedrooms", amount: 91.85 }],
      addOns: [{ label: "Inside refrigerator", amount: 40 }]
    }],
    payment: { totalCents: 38750, depositCents: 9688, remainingCents: 29062 }
  }
};

const record = {
  quoteId: booking.id,
  customerName: booking.client_name,
  customerEmail: booking.email,
  customerPhone: booking.phone,
  serviceLocation: booking.address,
  service: booking.service_label,
  serviceDate: "2026-08-24",
  serviceTime: "9:00 AM",
  totalAmount: "$387.50",
  paidAmount: "$96.88",
  remainingAmount: "$290.62",
  paymentType: "deposit_25",
  balanceCollection: "automatic_48h_authorization",
  paymentStatus: "paid",
  paymentMethod: "VISA ending in 4242",
  paymentIntentId: "pi_test_booking_confirmation",
  paidAt: "2026-08-23T20:30:00.000Z",
  agreementAcceptedAt: "2026-08-23T20:29:30.000Z",
  stripeReceiptUrl: "https://pay.stripe.com/receipts/test",
  stripeInvoiceUrl: "https://invoice.stripe.com/test"
};

(async () => {
  const sections = buildSections({ booking, record });
  assert.ok(sections.some((section) => section.title === "Eligibility and service answers"));
  assert.ok(sections.flatMap((section) => section.rows).some(([label, value]) => label === "Service ZIP code" && value === "11432"));
  assert.ok(sections.flatMap((section) => section.rows).some(([label, value]) => label === "Deposit / amount paid" && value === "$96.88"));
  assert.ok(sections.flatMap((section) => section.rows).some(([label, value]) => label === "Payment method" && value === "VISA ending in 4242"));

  const pdf = await buildBookingConfirmationPdf({ booking, record });
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(pdf.length > 3000);

  const outputPath = process.env.BOOKING_PDF_TEST_OUTPUT;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, pdf);
  }

  const email = buildCustomerEmail({
    record,
    invoicePdf: Buffer.from("stripe-invoice"),
    confirmationPdf: pdf,
    managementUrl: "https://www.imancleaningservice.com/manage-booking.html?token=test"
  });
  const decoded = Buffer.from(email.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.match(email.subject, /Booking confirmed - complete PDF record/);
  assert.match(decoded, /Iman-Cleaning-Booking-Record-BK-PDF-TEST\.pdf/);
  assert.match(decoded, /Iman-Cleaning-Invoice\.pdf/);
  assert.match(decoded, /Your complete booking record PDF is attached/);
  console.log("booking confirmation PDF tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
