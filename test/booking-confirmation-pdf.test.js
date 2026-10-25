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
const { buildCustomerEmail, selectedServiceDetailsUrl } = require("../api/quote/_payment-record");

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
    cleanerCount: 2,
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
  originalAmount: "$430.56",
  discountLabel: "FALL10 — First-time customer fall discount",
  discountAmount: "-$43.06",
  paidAt: "2026-08-23T20:30:00.000Z",
  agreementAcceptedAt: "2026-08-23T20:29:30.000Z",
  stripeReceiptUrl: "https://pay.stripe.com/receipts/test",
  stripeInvoiceUrl: "https://invoice.stripe.com/test"
};

(async () => {
  const serviceLinkCases = [
    ["standard", "Standard Cleaning", "standard-cleaning.html"],
    ["recurring", "Recurring Cleaning Service", "standard-cleaning.html"],
    ["deep", "Deep Cleaning", "deep-cleaning.html"],
    ["details", "Detailed Cleaning", "deep-cleaning.html"],
    ["move", "Move-In Cleaning", "move-in-move-out-cleaning.html"],
    ["post", "Post-Construction Cleaning", "post-construction-cleaning.html"],
    ["hourly", "Hourly Cleaning Service", "services-hub.html"],
    ["organization", "Organization", "services-hub.html"],
    ["window", "Window Cleaning", "services-hub.html"],
    ["", "Airbnb Cleaning", "airbnb-cleaning.html"],
    ["", "Office Cleaning", "office-cleaning.html"],
    ["", "Retail Store Cleaning", "retail-store-cleaning.html"],
    ["", "Restaurant Cleaning", "restaurant-cleaning.html"],
    ["", "Medical Clinic Cleaning", "medical-clinic-cleaning.html"],
    ["", "Janitorial Cleaning", "janitorial-recurring-cleaning.html"],
    ["", "Commercial Cleaning", "commercial-cleaning.html"]
  ];
  serviceLinkCases.forEach(([service, serviceLabel, expectedPage]) => {
    assert.equal(
      selectedServiceDetailsUrl({ service: serviceLabel }, { service, service_label: serviceLabel, estimate: {} }),
      `https://www.imancleaningservice.com/${expectedPage}`,
      `${serviceLabel} uses its expected service-details page`
    );
  });
  assert.equal(
    selectedServiceDetailsUrl(
      { service: "Custom Service", serviceDescriptionUrl: "https://www.imancleaningservice.com/custom-details.html" },
      { service: "custom", estimate: {} }
    ),
    "https://www.imancleaningservice.com/custom-details.html",
    "A validated custom-quote service-details URL takes priority"
  );

  const sections = buildSections({ booking, record });
  assert.ok(sections.some((section) => section.title === "Eligibility and service answers"));
  const pricingSection = sections.find((section) => section.title === "Itemized Pricing Summary");
  assert.ok(pricingSection, "The existing complete booking PDF includes an Itemized Pricing Summary section");
  assert.ok(pricingSection.rows.some(([label, value]) => label === "2 bedrooms" && value === "$91.85"));
  assert.ok(pricingSection.rows.some(([label, value]) => label === "Deposit paid" && value === "$96.88"));
  assert.ok(pricingSection.rows.some(([label, value]) => label === "Remaining balance" && value === "$290.62"));
  assert.ok(pricingSection.rows.some(([label, value]) => label === "Original total" && value === "$430.56"));
  assert.ok(pricingSection.rows.some(([label, value]) => /FALL10/.test(label) && value === "-$43.06"));
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

  const emailRecord = {
    ...record,
    service: "Move-In Cleaning",
    subtotalBeforeTax: "$514.58",
    discountLabel: "FALL10 discount",
    discountAmount: "-$51.46",
    discountApplication: "before_tax",
    discountedSubtotalBeforeTax: "$463.12",
    salesTax: "$41.10",
    totalAmount: "$504.22",
    paidAmount: "$126.06",
    remainingAmount: "$378.16"
  };
  const emailBooking = {
    ...booking,
    service: "move",
    service_label: "Move-In Cleaning"
  };
  const email = buildCustomerEmail({
    record: emailRecord,
    booking: emailBooking,
    invoicePdf: Buffer.from("stripe-invoice"),
    confirmationPdf: pdf,
    managementUrl: "https://www.imancleaningservice.com/manage-booking.html?token=test"
  });
  const decoded = Buffer.from(email.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.match(email.subject, /Booking confirmed - IMAN Cleaning Service/);
  assert.match(decoded, /Iman-Cleaning-Booking-Record-BK-PDF-TEST\.pdf/);
  assert.match(decoded, /Iman-Cleaning-Invoice\.pdf/);
  assert.match(decoded, /Hi Amina,/);
  assert.match(decoded, /Appointment Details/);
  assert.match(decoded, /Estimated arrival time/);
  assert.match(decoded, /2 cleaning professionals, up to 2 hours 30 minutes/);
  assert.match(decoded, /https:\/\/www\.imancleaningservice\.com\/move-in-move-out-cleaning\.html/);
  assert.match(decoded, /View Move-In Cleaning Details &amp; Inclusions/);
  assert.match(decoded, /Your Payment Summary/);
  assert.ok(decoded.indexOf("Service subtotal") < decoded.indexOf("FALL10 discount"));
  assert.ok(decoded.indexOf("FALL10 discount") < decoded.indexOf("NY sales tax \(8\.875%\)"));
  assert.match(decoded, /Service subtotal: \$514\.58/);
  assert.match(decoded, /FALL10 discount: -\$51\.46/);
  assert.match(decoded, /Discounted subtotal: \$463\.12/);
  assert.match(decoded, /NY sales tax \(8\.875%\): \$41\.10/);
  assert.match(decoded, /Final service price: \$504\.22/);
  assert.match(decoded, /Deposit paid: -\$126\.06/);
  assert.match(decoded, /Remaining balance: \$378\.16/);
  assert.match(decoded, /Before Our Team Arrives/);
  assert.match(decoded, /Your booking covers only the services listed in your service details and attached booking record/);
  assert.match(decoded, /Any work outside that scope requires approval before it begins and may result in an additional charge/);
  assert.match(decoded, /Manage Your Appointment/);
  assert.match(decoded, /Your booking record and payment receipt are attached/);
  console.log("booking confirmation PDF tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
