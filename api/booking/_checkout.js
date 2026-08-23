const {
  HOLD_MINUTES,
  availableSlotsForPackage,
  calculateOrganizationQuote,
  calculateResidentialQuoteBundle,
  cleanText,
  createBooking,
  deletePendingBooking,
  getPackageBundle,
  json,
  makeBookingId,
  readJsonBody,
  recommendResidentialService
} = require("./_shared");
const { authenticatedUser } = require("../account/_shared");

const AGREEMENT_VERSION = "2026-08-09-deposit-and-balance-authorization-v1";
const DEPOSIT_PERCENT = 25;

function depositCents(totalCents) {
  return Math.max(1, Math.round((Number(totalCents) || 0) * DEPOSIT_PERCENT / 100));
}

function getSiteUrl(request) {
  const configuredUrl = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

async function createStripeCheckout(secretKey, params) {
  const encoded = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") encoded.append(key, String(value));
  });
  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: encoded.toString()
  });
  const text = await stripeResponse.text();
  const data = text ? JSON.parse(text) : {};
  if (!stripeResponse.ok) {
    throw Object.assign(new Error(data?.error?.message || "Secure payment could not be started."), {
      statusCode: stripeResponse.status,
      details: data
    });
  }
  return data;
}

module.exports = async function handler(request, response) {
  let bookingId = "";
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const secretKey = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
    if (!secretKey || !String(secretKey).startsWith("sk_")) {
      return json(response, 503, { error: "Secure payment is not configured yet." });
    }

    const body = await readJsonBody(request);
    const accountMode = cleanText(body.accountMode, 20);
    const accountSession = accountMode === "account"
      ? await authenticatedUser(request, response, { required: true })
      : null;
    const submittedUnitDetails = Array.isArray(body.unitDetails) ? body.unitDetails.slice(0, 10) : [];
    const pricingMode = cleanText(body.pricingMode, 40);
    const formulaServiceKey = cleanText(body.eligibility?.requestedService, 40);
    const organizationMode = formulaServiceKey === "organization" &&
      pricingMode === "organization_formula";
    const residentialFormulaMode = ["standard", "deep", "move"].includes(formulaServiceKey) &&
      pricingMode === `${formulaServiceKey}_formula`;
    const formulaMode = organizationMode || residentialFormulaMode;
    const requestedPackageIds = Array.isArray(body.packageIds) && body.packageIds.length
      ? body.packageIds
      : [body.packageId];
    const pkg = organizationMode
      ? calculateOrganizationQuote(submittedUnitDetails[0]?.hours)
      : residentialFormulaMode
      ? calculateResidentialQuoteBundle(submittedUnitDetails, formulaServiceKey)
      : getPackageBundle(requestedPackageIds);
    if (!pkg) return json(response, 400, { error: "Please select a valid cleaning package." });

    const unitDetails = formulaMode
      ? pkg.units.map((unit, index) => ({
        ...unit,
        unitNumber: index + 1,
        tierKey: organizationMode ? "hourly" : "instant_quote",
        tierLabel: organizationMode ? pkg.tierLabel : `Unit ${index + 1} personalized ${pkg.serviceLabel}`,
        squareFootage: 0
      }))
      : submittedUnitDetails.length
      ? submittedUnitDetails.map((unit, index) => ({
        unitNumber: index + 1,
        tierKey: cleanText(unit?.tierKey, 40),
        tierLabel: pkg.units[index]?.tierLabel || "",
        squareFootage: Number(unit?.squareFootage)
      }))
      : [{
        unitNumber: 1,
        tierKey: pkg.units[0]?.tierKey || "",
        tierLabel: pkg.units[0]?.tierLabel || pkg.tierLabel,
        squareFootage: Number(body.squareFootage)
      }];
    if (unitDetails.length !== pkg.packageIds.length) {
      return json(response, 400, { error: "Complete the home details for every unit before checkout." });
    }
    const invalidUnit = formulaMode ? null : unitDetails.find((unit, index) => (
      !Number.isFinite(unit.squareFootage) ||
      unit.squareFootage <= 0 ||
      unit.tierKey !== pkg.units[index]?.tierKey
    ));
    if (invalidUnit) {
      return json(response, 400, { error: "Enter a valid home size and approximate square footage for every unit." });
    }
    const squareFootage = unitDetails.reduce((total, unit) => total + unit.squareFootage, 0);
    if (!formulaMode && (!Number.isFinite(squareFootage) || squareFootage <= 0)) {
      return json(response, 400, { error: "Enter the approximate square footage to confirm package eligibility." });
    }

    const eligibility = body.eligibility || {};
    const requiredEligibility = organizationMode ? [
      "serviceIntent",
      "requestedService"
    ] : [
      "propertyStatus",
      "cleaningCategory",
      "propertyOver2000",
      "waterDamage",
      "recentRenovation",
      "excessiveBelongings",
      "utilitiesAvailable",
      "propertyAccess",
      "clutter",
      "buildup",
      "hazards"
    ];
    if (!organizationMode && submittedUnitDetails.length) {
      requiredEligibility.push("propertyType", "unitCount");
    }
    if (!organizationMode && cleanText(eligibility.propertyStatus, 40) === "occupied") {
      requiredEligibility.push("requestedService");
    }
    if (requiredEligibility.some((field) => !cleanText(eligibility[field], 40))) {
      return json(response, 400, { error: "Complete every package eligibility question before checkout." });
    }
    if (!organizationMode && submittedUnitDetails.length && Number(eligibility.unitCount) !== unitDetails.length) {
      return json(response, 400, { error: "The number of units does not match the submitted home details." });
    }

    if (!organizationMode) {
      const recommendation = recommendResidentialService({
        ...eligibility,
        squareFootage
      });
      if (recommendation.type !== "instant") {
        return json(response, 409, {
          error: recommendation.reason,
          reviewRequired: true,
          reviewUrl: recommendation.reviewUrl || "/quote.html?category=residential"
        });
      }
      if (recommendation.serviceKey !== pkg.serviceKey) {
        return json(response, 409, {
          error: `Based on the property details, ${recommendation.serviceKey === "deep" ? "Deep Cleaning" : recommendation.serviceKey === "move" ? "Move-In / Move-Out Cleaning" : recommendation.serviceKey === "post" ? "Post-Construction Cleaning" : "Standard Cleaning"} is required.`,
          recommendedService: recommendation.serviceKey
        });
      }
    }

    const selectedSlot = cleanText(body.schedule, 80);
    const slots = await availableSlotsForPackage(pkg);
    const slot = slots.find((item) => item.value === selectedSlot);
    if (!slot) {
      return json(response, 409, { error: "That appointment is no longer available. Please choose another time." });
    }

    const customer = body.customer || {};
    const firstName = cleanText(customer.firstName, 80);
    const lastName = cleanText(customer.lastName, 80);
    const customerName = cleanText(`${firstName} ${lastName}`, 160);
    const email = cleanText(customer.email, 180);
    const phone = cleanText(customer.phone, 40);
    const address = cleanText(customer.address, 240);
    const address2 = cleanText(customer.address2, 80);
    const city = cleanText(customer.city, 80);
    const state = cleanText(customer.state, 30);
    const zip = cleanText(customer.zip, 15);
    const fullAddress = cleanText([address, address2, city, state, zip].filter(Boolean).join(", "), 400);

    if (!firstName || !lastName || !email || !phone || !address || !city || !state || !zip) {
      return json(response, 400, { error: "Complete all customer and service-address fields." });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json(response, 400, { error: "Enter a valid email address." });
    }
    const accountEmail = cleanText(accountSession?.user?.email, 180).toLowerCase();
    if (accountEmail && accountEmail !== email.toLowerCase()) {
      return json(response, 409, {
        error: `You are logged in as ${accountEmail}. Use that email for this booking or continue as a guest after logging out.`
      });
    }

    const agreements = body.agreements || {};
    if (!agreements.laborHours || !agreements.completion || !agreements.condition || !agreements.terms) {
      return json(response, 400, { error: "All required service acknowledgments must be accepted." });
    }

    bookingId = makeBookingId();
    const priorities = Array.isArray(body.priorities)
      ? body.priorities.map((item) => cleanText(item, 60)).filter(Boolean).slice(0, 6)
      : [];
    const notes = cleanText(body.notes, 1200);
    const depositAmountCents = depositCents(pkg.priceCents);
    const remainingAmountCents = Math.max(0, pkg.priceCents - depositAmountCents);
    const depositSubtotalCents = Math.min(depositAmountCents, Math.round(pkg.subtotalCents * DEPOSIT_PERCENT / 100));
    const depositTaxCents = depositAmountCents - depositSubtotalCents;
    const unitSummary = organizationMode
      ? `${pkg.manHours} hours of organization / decluttering with one professional organizer, $${pkg.total.toFixed(2)} including tax.`
      : unitDetails
      .map((unit) => residentialFormulaMode
        ? [
          `Unit ${unit.unitNumber}: ${unit.bedrooms} bedroom(s), ${unit.fullBathrooms} full bathroom(s), ${unit.halfBathrooms} half bathroom(s), $${unit.subtotal.toFixed(2)} including tax.`,
          unit.hasPets === "yes"
            ? `Pets: ${unit.petCount}; type: ${unit.petType === "other" ? "Other" : unit.petType[0].toUpperCase() + unit.petType.slice(1)}.`
            : "No pets.",
          unit.additionalCleaning === "yes"
            ? "Additional cleaning requested at $80 per labor-hour."
            : ""
        ].filter(Boolean).join(" ")
        : `Unit ${unit.unitNumber}: ${unit.tierLabel}, ${unit.squareFootage} sq. ft.`)
      .join(" ");
    const booking = {
      id: bookingId,
      status: "New",
      service: pkg.serviceKey,
      service_label: pkg.serviceLabel,
      schedule: slot.value,
      schedule_label: slot.label,
      bedrooms_label: pkg.bedroomsLabel,
      bathrooms_label: pkg.bathroomsLabel,
      sqft: squareFootage,
      addons: priorities,
      client_name: customerName,
      phone,
      email,
      address: fullAddress,
      notes: [
        organizationMode
          ? "Service type: Organization / Decluttering."
          : `Property type: ${cleanText(eligibility.propertyType, 40) || "residential"}.`,
        `Package: ${pkg.tierLabel}.`,
        unitSummary,
        organizationMode
          ? `Included service: ${pkg.manHours} hours with one professional organizer at $60 per hour.`
          : `Included labor: ${pkg.manHours} man-hours; two-person team for approximately ${pkg.teamHours} hours.`,
        priorities.length ? `Priorities: ${priorities.join(", ")}.` : "",
        notes ? `Customer notes: ${notes}` : ""
      ].filter(Boolean).join(" "),
      estimate: {
        low: pkg.price,
        high: pkg.price,
        hours: pkg.teamHours,
        teamHours: pkg.teamHours,
        manHours: pkg.manHours,
        cleanerCount: pkg.cleanerCount,
        manHourRate: pkg.manHourRate,
        packageId: pkg.id,
        packageIds: pkg.packageIds,
        pricingMode: formulaMode ? pkg.pricingMode : "published_package",
        subtotal: pkg.subtotal,
        tax: pkg.tax,
        taxRate: pkg.taxRate,
        total: pkg.price,
        propertyType: organizationMode ? "organization" : cleanText(eligibility.propertyType, 40),
        unitCount: unitDetails.length,
        units: unitDetails.map((unit, index) => ({
          ...unit,
          packageId: pkg.packageIds[index],
          price: pkg.units[index].price ?? pkg.units[index].subtotal,
          manHours: pkg.units[index].manHours,
          teamHours: pkg.units[index].teamHours ?? pkg.units[index].manHours / pkg.cleanerCount,
          baseItems: pkg.units[index].baseItems,
          addOns: pkg.units[index].addOns
        })),
        agreementVersion: AGREEMENT_VERSION,
        agreements: {
          fixedLaborHours: true,
          completionDependsOnCondition: true,
          conditionConfirmed: true,
          termsAccepted: true
        },
        paymentStatus: "deposit_pending",
        payment: {
          paymentType: "deposit_25",
          balanceCollection: "automatic_48h_authorization",
          status: "deposit_pending",
          totalCents: pkg.priceCents,
          paidCents: 0,
          depositCents: depositAmountCents,
          remainingCents: remainingAmountCents,
          remaining: {
            status: "pending",
            amountCents: remainingAmountCents,
            authorizationDueHours: 48
          }
        },
        accountUserId: cleanText(accountSession?.user?.id, 120),
        accountEmail: accountEmail
      }
    };

    await createBooking(booking);

    const siteUrl = getSiteUrl(request);
    const description = cleanText(
      organizationMode
        ? `${pkg.tierLabel}. One professional organizer for ${pkg.teamHours} hours at $60 per hour.`
        : `${pkg.tierLabel}. ${unitSummary} Two-person team for approximately ${pkg.teamHours} hours (${pkg.manHours} total labor-hours).`,
      500
    );
    const stripeLineItems = {
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": depositSubtotalCents,
      "line_items[0][price_data][product_data][name]": `${pkg.serviceLabel} — 25% booking deposit`,
      "line_items[0][price_data][product_data][description]": `${description} Total service price: $${pkg.price.toFixed(2)}.`,
      "line_items[0][quantity]": 1,
      "line_items[1][price_data][currency]": "usd",
      "line_items[1][price_data][unit_amount]": depositTaxCents,
      "line_items[1][price_data][product_data][name]": "Deposit tax portion (NY sales tax included)",
      "line_items[1][quantity]": 1
    };
    const checkout = await createStripeCheckout(secretKey, {
      mode: "payment",
      "payment_method_types[0]": "card",
      customer_email: email,
      customer_creation: "always",
      "phone_number_collection[enabled]": "true",
      ...stripeLineItems,
      "payment_intent_data[setup_future_usage]": "off_session",
      "payment_intent_data[description]": `${pkg.serviceLabel} for ${customerName}`,
      "payment_intent_data[receipt_email]": email,
      "payment_intent_data[metadata][booking_id]": bookingId,
      "payment_intent_data[metadata][customer_name]": customerName,
      "payment_intent_data[metadata][service_location]": fullAddress,
      "payment_intent_data[metadata][service]": pkg.serviceLabel,
      "payment_intent_data[metadata][service_date]": slot.date,
      "payment_intent_data[metadata][service_time]": slot.time,
      "payment_intent_data[metadata][total_amount_cents]": pkg.priceCents,
      "payment_intent_data[metadata][payment_amount_cents]": depositAmountCents,
      "payment_intent_data[metadata][remaining_amount_cents]": remainingAmountCents,
      "payment_intent_data[metadata][payment_type]": "deposit_25",
      "payment_intent_data[metadata][balance_collection]": "automatic_48h_authorization",
      "metadata[booking_id]": bookingId,
      "metadata[quote_id]": bookingId,
      "metadata[customer_name]": customerName,
      "metadata[service_location]": fullAddress,
      "metadata[service]": pkg.serviceLabel,
      "metadata[service_date]": slot.date,
      "metadata[service_time]": slot.time,
      "metadata[schedule_label]": slot.label,
      "metadata[package_id]": pkg.id,
      "metadata[package_ids]": pkg.packageIds.join(","),
      "metadata[pricing_mode]": formulaMode ? pkg.pricingMode : "published_package",
      "metadata[subtotal_cents]": pkg.subtotalCents,
      "metadata[tax_cents]": pkg.taxCents,
      "metadata[property_type]": cleanText(eligibility.propertyType, 40),
      "metadata[unit_count]": unitDetails.length,
      "metadata[agreement_accepted]": "true",
      "metadata[agreement_version]": AGREEMENT_VERSION,
      "metadata[agreement_url]": `${siteUrl}/agreement.html`,
      "metadata[total_amount_cents]": pkg.priceCents,
      "metadata[payment_amount_cents]": depositAmountCents,
      "metadata[remaining_amount_cents]": remainingAmountCents,
      "metadata[payment_type]": "deposit_25",
      "metadata[balance_collection]": "automatic_48h_authorization",
      "metadata[account_user_id]": cleanText(accountSession?.user?.id, 120),
      "consent_collection[terms_of_service]": "required",
      "custom_text[terms_of_service_acceptance][message]": organizationMode
        ? "I agree to the Service Agreement, the 25% deposit, and authorization of the remaining balance about 48 hours before service for capture after completion."
        : "I agree to the Service Agreement, the 25% deposit, and authorization of the remaining balance about 48 hours before service for capture after completion.",
      "custom_text[submit][message]": "The 25% deposit is charged now. The remaining 75% will be authorized about 48 hours before the appointment and captured after service is completed.",
      "invoice_creation[enabled]": "true",
      expires_at: Math.floor(Date.now() / 1000) + HOLD_MINUTES * 60,
      success_url: `${siteUrl}/booking-confirmed.html?session_id={CHECKOUT_SESSION_ID}&booking_id=${encodeURIComponent(bookingId)}`,
      cancel_url: `${siteUrl}/book-now.html?payment=cancelled`
    });

    return json(response, 201, {
      bookingId,
      checkoutUrl: checkout.url,
      expiresInMinutes: HOLD_MINUTES
    });
  } catch (error) {
    if (bookingId) {
      try {
        await deletePendingBooking(bookingId);
      } catch (cleanupError) {
        // Preserve the original checkout error if cleanup needs manual attention.
      }
    }
    return json(response, error.statusCode || 500, {
      error: error.message || "Booking checkout could not be started.",
      reviewRequired: Boolean(error.reviewRequired),
      reviewUrl: error.reviewUrl,
      setup: error.setup,
      details: error.details
    });
  }
};
