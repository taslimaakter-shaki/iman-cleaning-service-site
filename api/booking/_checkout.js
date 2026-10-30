const { staffingOptions } = require("./_staffing-options");
const crypto = require("crypto");
const {
  HOLD_MINUTES,
  availableSlotsForPackage,
  calculateHourlyCleaningQuote,
  calculateWindowQuote,
  calculateResidentialQuoteBundle,
  cleanText,
  createBooking,
  getPackageBundle,
  isNYCServiceZip,
  listAllBookings,
  temporarilyPausedServiceBorough,
  json,
  makeBookingId,
  makeUniqueOrderNumber,
  readJsonBody,
  recommendResidentialService
} = require("./_shared");
const { authenticatedUser } = require("../account/_shared");
const calendar = require('./_calendar');
const {
  applyArrivalDiscount,
  assertArrivalPreferenceEligible,
  arrivalPreferenceForKey,
  arrivalWindowLabel,
  slotMatchesArrivalPreference
} = require('./_arrival-preference');

const AGREEMENT_VERSION = "2026-10-30-rescheduling-v1";
const AGREEMENT_ACCEPTANCE_TEXT = "I have reviewed and agree to the Service Agreement and payment terms. I authorize the 25% deposit, the remaining-balance authorization described above, any customer-caused access charge, and disclosed booking fees to the same payment method used for my deposit, as described in the agreement.";
const AGREEMENT_KEY_TERMS = [
  "A 25% deposit is charged today.",
  "One approved reschedule at least 48 hours ahead is free. Rescheduling with less than 48 hours notice costs 10% of the booked cleaning price, including tax, separate from the cleaning payment. If that booking is later canceled, the 25% cancellation fee applies regardless of the new date, with paid late-rescheduling fees credited toward it. Second requests require direct contact and approval. Approved booking fees are charged to the payment method used for the 25% deposit.",
  "A temporary hold for the remaining 75% is placed about 48 hours before service and captured after completion.",
  "Cancellations at least 48 hours ahead receive a full deposit refund unless an approved late reschedule has already triggered the cancellation policy.",
  "If our team arrives but cannot work for a customer-caused reason, the total charge is 50% of the scheduled service price."
];
const DEPOSIT_PERCENT = 25;

function agreementError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function validReviewTime(value) {
  const date = new Date(cleanText(value, 40));
  return Number.isFinite(date.getTime()) ? date : null;
}

function buildAgreementAcceptance({ review, request, secretKey, pkg, slot }) {
  if (!review || review.accepted !== true || review.version !== AGREEMENT_VERSION) {
    throw agreementError("Please review and accept the current Service Agreement before payment.");
  }
  if (cleanText(review.acceptanceText, 500) !== AGREEMENT_ACCEPTANCE_TEXT) {
    throw agreementError("The Service Agreement acceptance is incomplete. Please review it again.");
  }
  const signedName = cleanText(review.signedName, 120).replace(/\s+/g, " ").trim();
  if (signedName.split(" ").filter(Boolean).length < 2 || signedName.length < 3) {
    throw agreementError("Type your full legal name to sign the Service Agreement.");
  }
  const openedAt = validReviewTime(review.openedAt);
  const scrolledToEndAt = validReviewTime(review.scrolledToEndAt);
  const acceptedAt = validReviewTime(review.acceptedAt);
  const now = new Date();
  if (!openedAt || !scrolledToEndAt || !acceptedAt || openedAt > scrolledToEndAt || scrolledToEndAt > acceptedAt) {
    throw agreementError("Please open the Service Agreement, scroll to the end, and accept it before payment.");
  }
  if (acceptedAt.getTime() > now.getTime() + 5 * 60 * 1000 || now.getTime() - acceptedAt.getTime() > 24 * 60 * 60 * 1000) {
    throw agreementError("Your Service Agreement review has expired. Please review and accept it again.");
  }
  const expectedFingerprint = JSON.stringify({
    packageId: pkg.id || "",
    total: Number(pkg.price || 0),
    laborHours: Number(pkg.manHours || 0),
    schedule: slot.value
  });
  if (cleanText(review.contextFingerprint, 800) !== expectedFingerprint) {
    throw agreementError("Your booking details changed. Please review and accept the Service Agreement again.");
  }
  const forwardedIp = cleanText(String(request.headers["x-forwarded-for"] || "").split(",")[0], 80);
  const ipHash = crypto.createHmac("sha256", secretKey).update(forwardedIp || "unavailable").digest("hex");
  const evidence = {
    version: AGREEMENT_VERSION,
    agreementUrl: `${getSiteUrl(request)}/agreement.html`,
    presentedAt: openedAt.toISOString(),
    scrolledToEndAt: scrolledToEndAt.toISOString(),
    customerAcceptedAt: acceptedAt.toISOString(),
    serverRecordedAt: now.toISOString(),
    acceptanceMethod: "scroll_to_end_typed_name_then_checkbox",
    signedName,
    acceptanceText: AGREEMENT_ACCEPTANCE_TEXT,
    keyTerms: pkg.serviceKey === "hourly"
      ? [...AGREEMENT_KEY_TERMS, "Hourly Cleaning Service is charged for every work-hour booked, with a four-work-hour minimum, even if cleaning is completed sooner."]
      : AGREEMENT_KEY_TERMS,
    context: {
      packageId: pkg.id,
      service: pkg.serviceLabel,
      scheduledFor: slot.value,
      totalCents: pkg.priceCents,
      depositCents: depositCents(pkg.priceCents),
      remainingCents: Math.max(0, pkg.priceCents - depositCents(pkg.priceCents)),
      laborHours: pkg.manHours
    },
    userAgent: cleanText(request.headers["user-agent"], 500),
    ipEvidenceHash: ipHash
  };
  evidence.recordHash = crypto.createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  return evidence;
}

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
  let reservation, checkout;
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const secretKey = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
    if (!secretKey || !String(secretKey).startsWith("sk_")) {
      return json(response, 503, { error: "Secure payment is not configured yet." });
    }

    const body = await readJsonBody(request);
    const quoteAdmin = require("../crm/_quote-admin");
    const savedQuoteId = await quoteAdmin.checkSavedCheckout(body.savedQuoteToken, undefined, body.quoteRevision || '');
    const eligibilityZip = cleanText(body.eligibility?.serviceZip, 15);
    const pausedBorough = temporarilyPausedServiceBorough(eligibilityZip);
    if (pausedBorough) {
      return json(response, 409, { error: `We’re temporarily not providing service in ${pausedBorough}. We expect to resume service there soon.` });
    }
    if (!isNYCServiceZip(eligibilityZip)) {
      return json(response, 400, { error: "Enter a ZIP code within our New York City service area." });
    }
    const accountMode = cleanText(body.accountMode, 20);
    const accountSession = accountMode === "account"
      ? await authenticatedUser(request, response, { required: true })
      : null;
    const submittedUnitDetails = Array.isArray(body.unitDetails) ? body.unitDetails.slice(0, 10) : [];
    const pricingMode = cleanText(body.pricingMode, 40);
    const formulaServiceKey = cleanText(body.eligibility?.requestedService, 40);
    if (formulaServiceKey === "organization") {
      return json(response, 410, { error: "Organization Service is no longer available. Please choose another cleaning service." });
    }
    const hourlyMode = formulaServiceKey === "hourly" &&
      pricingMode === "hourly_formula";
    const timeBasedMode = hourlyMode;
    const residentialFormulaMode = ["standard", "recurring", "deep", "move", "post"].includes(formulaServiceKey) &&
      pricingMode === `${formulaServiceKey}_formula`;
    const windowMode = formulaServiceKey === "window" && pricingMode === "window_formula";
    const formulaMode = timeBasedMode || residentialFormulaMode || windowMode;
    const requestedPackageIds = Array.isArray(body.packageIds) && body.packageIds.length
      ? body.packageIds
      : [body.packageId];
    let pkg = hourlyMode
      ? calculateHourlyCleaningQuote(submittedUnitDetails[0]?.hours)
      : windowMode
      ? calculateWindowQuote(submittedUnitDetails[0], body.eligibility?.serviceZip || body.customer?.zip)
      : residentialFormulaMode
      ? calculateResidentialQuoteBundle(submittedUnitDetails, formulaServiceKey, body.eligibility)
      : getPackageBundle(requestedPackageIds);
    if (!pkg) return json(response, 400, { error: "Please select a valid cleaning package." });
    if (body.savedQuoteToken) pkg = await quoteAdmin.applySavedDiscount(body.savedQuoteToken, pkg, body.quoteRevision || '');

    const unitDetails = formulaMode
      ? pkg.units.map((unit, index) => ({
        ...unit,
        unitNumber: index + 1,
        tierKey: timeBasedMode ? "hourly" : "instant_quote",
        tierLabel: timeBasedMode || windowMode ? pkg.tierLabel : `Unit ${index + 1} personalized ${pkg.serviceLabel}`,
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
    const suppliedPropertySquareFootage = Math.max(0, Number(body.eligibility?.squareFootage) || 0);
    const bookingSquareFootage = squareFootage || suppliedPropertySquareFootage;
    if (!formulaMode && (!Number.isFinite(squareFootage) || squareFootage <= 0)) {
      return json(response, 400, { error: "Enter the approximate square footage to confirm package eligibility." });
    }

    const eligibility = body.eligibility || {};
    const requiredEligibility = timeBasedMode ? [
      "serviceIntent",
      "requestedService"
    ] : windowMode ? [
      "serviceIntent",
      "requestedService",
      "cleaningCategory",
      "propertyType",
      "serviceZip"
    ] : [
      "propertyStatus",
      "cleaningCategory",
      "waterDamage",
      "excessiveBelongings",
      "utilitiesAvailable",
      "unsafeConditions",
      "clutter",
      "buildup",
      "hazards"
    ];
    if (!timeBasedMode && !windowMode && submittedUnitDetails.length) {
      requiredEligibility.push("propertyType", "unitCount");
    }
    if (!timeBasedMode && !windowMode && cleanText(eligibility.propertyStatus, 40) === "occupied") {
      requiredEligibility.push("requestedService");
    }
    if (!timeBasedMode && !windowMode && cleanText(eligibility.propertyStatus, 40) === "renovated") {
      requiredEligibility.push("constructionFinished", "contractorItemsRemoved");
    }
    if (!timeBasedMode && !windowMode && cleanText(eligibility.hazards, 20) === "mold") {
      requiredEligibility.push("moldCleaningRequested");
    }
    if (requiredEligibility.some((field) => !cleanText(eligibility[field], 40))) {
      return json(response, 400, { error: "Complete every package eligibility question before checkout." });
    }
    if (!timeBasedMode && !windowMode && submittedUnitDetails.length && Number(eligibility.unitCount) !== unitDetails.length) {
      return json(response, 400, { error: "The number of units does not match the submitted home details." });
    }

    if (!timeBasedMode && !windowMode) {
      const recommendation = recommendResidentialService({
        ...eligibility,
        squareFootage: bookingSquareFootage
      });
      if (recommendation.type !== "instant") {
        if (recommendation.type === "ineligible") {
          return json(response, 409, {
            error: recommendation.reason,
            ineligible: true
          });
        }
        return json(response, 409, {
          error: recommendation.reason,
          reviewRequired: true,
          reviewUrl: recommendation.reviewUrl || "/contact.html"
        });
      }
      if (recommendation.serviceKey !== pkg.serviceKey) {
        return json(response, 409, {
          error: `Based on the property details, ${recommendation.serviceKey === "deep" ? "Deep Cleaning" : recommendation.serviceKey === "move" ? "Move-In / Move-Out Cleaning" : recommendation.serviceKey === "post" ? "Post-Construction Cleaning" : "Standard Cleaning"} is required.`,
          recommendedService: recommendation.serviceKey
        });
      }
    }

    const arrivalPreference = arrivalPreferenceForKey(body.arrivalPreference || "exact");
    assertArrivalPreferenceEligible(pkg, arrivalPreference);
    const selectedSlot = cleanText(body.schedule, 80);
    const slots = await availableSlotsForPackage(pkg);
    const slot = slots.find((item) => item.value === selectedSlot && slotMatchesArrivalPreference(item, arrivalPreference));
    if (!slot) {
      return json(response, 409, { error: "That arrival option is no longer available. Please choose another time." });
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
    const pausedAddressBorough = temporarilyPausedServiceBorough(zip);
    if (pausedAddressBorough) {
      return json(response, 409, { error: `We’re temporarily not providing service in ${pausedAddressBorough}. We expect to resume service there soon.` });
    }
    if (!isNYCServiceZip(zip)) {
      return json(response, 400, { error: "Enter a service address within our New York City service area." });
    }
    if (zip.replace(/\D/g, "").slice(0, 5) !== eligibilityZip.replace(/\D/g, "").slice(0, 5)) {
      return json(response, 400, { error: "The service-address ZIP code must match the ZIP used for this quote." });
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

    let submittedPromoCode = cleanText(body.promoCode, 40).replace(/\s+/g, "").toUpperCase();
    let recurringDiscount = null;
    if (pkg.serviceKey === "recurring") {
      const recurring = require("./_recurring-discount");
      recurringDiscount = recurring.verifyRecurringDiscount(await listAllBookings(), {
        previousOrderNumber: body.recurringOrderNumber,
        schedule: slot.value,
        customer: {
          email,
          phone,
          address: fullAddress,
          accountUserId: cleanText(accountSession?.user?.id, 120)
        }
      });
      pkg = recurring.applyRecurringDiscount(pkg, recurringDiscount);
      submittedPromoCode = "";
    } else if (!submittedPromoCode) {
      try {
        require('./_promo').promotionForCode('FALL10');
        submittedPromoCode = 'FALL10';
      } catch {
        // The automatic seasonal offer quietly stops after its expiration date.
      }
    }
    if (submittedPromoCode) {
      const promo = require('./_promo');
      const promotion = promo.promotionForCode(submittedPromoCode);
      promo.assertEligibleService(promotion, pkg.serviceKey);
      promo.assertNotRedeemed(await listAllBookings(), {
        email,
        phone,
        address: fullAddress,
        accountUserId: cleanText(accountSession?.user?.id, 120)
      }, promotion);
      pkg = promo.applyPromotion(pkg, promotion);
    }
    pkg = applyArrivalDiscount(pkg, arrivalPreference);

    const agreements = body.agreements || {};
    if (!agreements.laborHours || !agreements.completion || !agreements.condition || !agreements.terms) {
      return json(response, 400, { error: "All required service acknowledgments must be accepted." });
    }
    const agreementAcceptance = buildAgreementAcceptance({
      review: body.agreementReview,
      request,
      secretKey,
      pkg,
      slot
    });

    bookingId = makeBookingId();
    const orderNumber = await makeUniqueOrderNumber();
    const priorities = Array.isArray(body.priorities)
      ? body.priorities.map((item) => cleanText(item, 60)).filter(Boolean).slice(0, 6)
      : [];
    const notes = cleanText(body.notes, 1200);
    const depositAmountCents = depositCents(pkg.priceCents);
    const remainingAmountCents = Math.max(0, pkg.priceCents - depositAmountCents);
    const depositTaxableSubtotalCents = Number.isSafeInteger(pkg.discountedSubtotalCents)
      ? pkg.discountedSubtotalCents
      : pkg.subtotalCents;
    const depositSubtotalCents = Math.min(depositAmountCents, Math.round(depositTaxableSubtotalCents * DEPOSIT_PERCENT / 100));
    const depositTaxCents = depositAmountCents - depositSubtotalCents;
    let unitSummary = timeBasedMode
      ? `${pkg.manHours} total hourly-cleaning work-hours with 2 team members for ${pkg.teamHours} hours, $${pkg.total.toFixed(2)} including tax.`
      : windowMode
      ? [
        `${submittedUnitDetails[0]?.windows?.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 0} selected windows/panels`,
        `${cleanText(submittedUnitDetails[0]?.scope, 20).replace("both", "interior and exterior")}`,
        `$${pkg.subtotal.toFixed(2)} before tax; $${pkg.tax.toFixed(2)} sales tax; $${pkg.total.toFixed(2)} total.`
      ].join(", ")
      : unitDetails
      .map((unit) => residentialFormulaMode
        ? [
          `Unit ${unit.unitNumber}: ${unit.bedrooms} bedroom(s), ${unit.fullBathrooms} full bathroom(s), ${unit.halfBathrooms} half bathroom(s), $${unit.subtotal.toFixed(2)} including tax.`,
          unit.additionalCleaning === "yes"
            ? "Additional cleaning requested; total pricing was reviewed before booking."
            : ""
        ].filter(Boolean).join(" ")
        : `Unit ${unit.unitNumber}: ${unit.tierLabel}, ${unit.squareFootage} sq. ft.`)
      .join(" ");
    if (residentialFormulaMode && pkg.propertyPets) {
      const propertyPetSummary = pkg.propertyPets.hasPets === "yes"
        ? `Whole property pets: ${pkg.propertyPets.petCount}; type: ${pkg.propertyPets.petType === "other"
          ? pkg.propertyPets.otherPetType
          : pkg.propertyPets.petType === "cats-and-dogs" ? "Cats and Dogs" : pkg.propertyPets.petType}; secured during service: ${pkg.propertyPets.petsSecured}.`
        : pkg.propertyPets.previousPetBuildup === "yes"
          ? "Whole property: previous pet-related buildup cleaning requested."
          : "Whole property: no current pets or pet-related buildup reported.";
      unitSummary = `${unitSummary} ${propertyPetSummary}`.trim();
    }
    const customerScheduleDate = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric"
    }).format(new Date(slot.value));
    const customerScheduleLabel = arrivalPreference.flexible
      ? `${customerScheduleDate} · Estimated arrival ${arrivalWindowLabel(arrivalPreference, pkg.teamHours)}`
      : slot.label;
    const booking = {
      id: bookingId,
      status: "New",
      service: pkg.serviceKey,
      service_label: pkg.serviceLabel,
      schedule: slot.value,
      schedule_label: customerScheduleLabel,
      bedrooms_label: pkg.bedroomsLabel,
      bathrooms_label: pkg.bathroomsLabel,
      sqft: bookingSquareFootage,
      addons: priorities,
      client_name: customerName,
      phone,
      email,
      address: fullAddress,
      notes: [
        timeBasedMode
          ? "Service type: Hourly Cleaning Service."
          : windowMode
          ? `Window cleaning: ${unitSummary}`
          : `Property type: ${cleanText(eligibility.propertyType, 40) || "residential"}.`,
        `Package: ${pkg.tierLabel}.`,
        unitSummary,
        timeBasedMode
          ? `Included service: ${pkg.manHours} total work-hours; ${staffingOptions(pkg) || `2 team members for ${pkg.teamHours} hours`}.`
          : windowMode
          ? `Maximum estimated service time: up to ${pkg.teamHours} hours with a two-person team. Service may be completed sooner.`
          : `Maximum labor: ${pkg.manHours} labor-hours; ${staffingOptions(pkg) || `two-person team for up to ${pkg.teamHours} hours`}. Service may be completed sooner.`,
        priorities.length ? `Priorities: ${priorities.join(", ")}.` : "",
        notes ? `Customer notes: ${notes}` : "",
      ].filter(Boolean).join(" "),
      estimate: {
        calendarReservation: (reservation = calendar.newReservation()),
        savedQuoteId,
        manualDiscount: pkg.manualDiscount || null,
        promoCode: pkg.promoCode || "",
        promoDiscount: pkg.promoDiscount || null,
        arrivalPreference: {
          key: arrivalPreference.key,
          label: arrivalPreference.label,
          flexible: arrivalPreference.flexible,
          windowStart: arrivalPreference.start,
          windowEnd: pkg.arrivalDiscount?.windowEnd || arrivalPreference.end,
          windowLabel: arrivalWindowLabel(arrivalPreference, pkg.teamHours),
          provisionalStart: slot.value,
          confirmationStatus: arrivalPreference.flexible ? "pending" : "confirmed"
        },
        arrivalDiscount: pkg.arrivalDiscount || null,
        calendarReservationHours: pkg.teamHours + 1,
        recurringDiscount: pkg.recurringDiscount || null,
        previousOrderNumber: recurringDiscount?.previousOrderNumber || "",
        originalTotalCents: pkg.originalTotalCents || null,
        customQuotePricing: pkg.manualDiscount || null,
        orderNumber,
        low: pkg.price,
        high: pkg.price,
        hours: pkg.teamHours,
        teamHours: pkg.teamHours,
        manHours: pkg.manHours,
        cleanerCount: pkg.cleanerCount,
        manHourRate: pkg.manHourRate,
        baseLaborHours: pkg.baseLaborHours,
        buildupAdjustment: pkg.buildupAdjustment,
        clutterAdjustment: pkg.clutterAdjustment,
        moldAdjustment: pkg.moldAdjustment,
        propertyPets: pkg.propertyPets || null,
        packageId: pkg.id,
        packageIds: pkg.packageIds,
        pricingMode: formulaMode ? pkg.pricingMode : "published_package",
        subtotal: pkg.subtotal,
        discountedSubtotal: pkg.discountedSubtotal,
        tax: pkg.tax,
        taxRate: pkg.taxRate,
        total: pkg.price,
        propertyType: timeBasedMode ? "hourly" : cleanText(eligibility.propertyType, 40),
        eligibility: { ...eligibility, serviceZip: cleanText(eligibility.serviceZip || zip, 15) },
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
        agreementAcceptance,
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
      timeBasedMode
        ? `${pkg.tierLabel}. 2 team members for ${pkg.teamHours} hours (${pkg.manHours} total work-hours).`
        : windowMode
        ? `${pkg.tierLabel}. ${unitSummary}`
        : `${pkg.tierLabel}. ${unitSummary} Two-person team for up to ${pkg.teamHours} hours (${pkg.manHours} maximum labor-hours). Service may be completed sooner.`,
      500
    );
    const conditionFeeDescription = [
      pkg.buildupAdjustment?.amountCents ? "Buildup and grease cleaning fee included." : "",
      pkg.clutterAdjustment?.amountCents ? "Clutter/access cleaning fee included." : "",
      pkg.moldAdjustment?.amountCents ? "Surface mold and mildew cleaning fee included." : ""
    ].filter(Boolean).join(" ");
    const appliedDiscounts = [pkg.promoDiscount, pkg.manualDiscount, pkg.arrivalDiscount]
      .filter((discount) => Number(discount?.amountCents || 0) > 0);
    const visibleDiscount = appliedDiscounts.length ? {
      label: appliedDiscounts.map((discount) => [discount.code, discount.label].filter(Boolean).join(" — ")).join(" + "),
      amountCents: appliedDiscounts.reduce((sum, discount) => sum + Number(discount.amountCents || 0), 0)
    } : null;
    const originalTotalCents = Number(pkg.originalTotalCents || 0) ||
      (visibleDiscount ? pkg.priceCents + Number(visibleDiscount.amountCents || 0) : pkg.priceCents);
    const discountName = visibleDiscount
      ? [visibleDiscount.code, visibleDiscount.label].filter(Boolean).join(" — ") || "Discount"
      : "";
    const discountSummary = visibleDiscount
      ? ` Original total: $${(originalTotalCents / 100).toFixed(2)}. ${discountName}: -$${(visibleDiscount.amountCents / 100).toFixed(2)}. Discounted service total: $${pkg.price.toFixed(2)}.`
      : ` Total service price: $${pkg.price.toFixed(2)}.`;
    const stripeLineItems = {
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": depositSubtotalCents,
      "line_items[0][price_data][product_data][name]": `${pkg.serviceLabel} — 25% booking deposit`,
      "line_items[0][price_data][product_data][description]": `${description} ${conditionFeeDescription}${discountSummary}`.replace(/\s+/g, " ").trim(),
      "line_items[0][quantity]": 1,
      "line_items[1][price_data][currency]": "usd",
      "line_items[1][price_data][unit_amount]": depositTaxCents,
      "line_items[1][price_data][product_data][name]": "Deposit tax portion (NY sales tax included)",
      "line_items[1][quantity]": 1
    };
    if (pkg.manualDiscount?.amountCents) {
      // The owner applies a discount after tax. Charge the exact revised deposit;
      // do not add tax again or invent a reduced tax basis on the Stripe page.
      for (const key of Object.keys(stripeLineItems)) if (key.startsWith('line_items[1]')) delete stripeLineItems[key];
      stripeLineItems['line_items[0][price_data][unit_amount]'] = depositAmountCents;
      stripeLineItems['line_items[0][price_data][product_data][description]'] = `${description} ${conditionFeeDescription}${discountSummary}`.replace(/\s+/g, " ").trim();
    }
    const stripeCheckoutParams = {
      mode: "payment",
      "payment_method_types[0]": "card",
      customer_email: email,
      customer_creation: "always",
      "phone_number_collection[enabled]": "true",
      ...stripeLineItems,
      "payment_intent_data[setup_future_usage]": "off_session",
      "payment_intent_data[description]": visibleDiscount
        ? `${pkg.serviceLabel} for ${customerName} — ${discountName} applied; 25% deposit $${(depositAmountCents / 100).toFixed(2)}`
        : `${pkg.serviceLabel} for ${customerName}`,
      "payment_intent_data[receipt_email]": email,
      "payment_intent_data[metadata][booking_id]": bookingId,
      "payment_intent_data[metadata][order_number]": orderNumber,
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
      "payment_intent_data[metadata][base_labor_hours]": pkg.baseLaborHours || pkg.manHours,
      "payment_intent_data[metadata][buildup_percentage]": pkg.buildupAdjustment?.percentage || 0,
      "payment_intent_data[metadata][buildup_added_labor_hours]": pkg.buildupAdjustment?.addedLaborHours || 0,
      "payment_intent_data[metadata][buildup_charge_cents]": pkg.buildupAdjustment?.amountCents || 0,
      "payment_intent_data[metadata][clutter_percentage]": pkg.clutterAdjustment?.percentage || 0,
      "payment_intent_data[metadata][clutter_added_labor_hours]": pkg.clutterAdjustment?.addedLaborHours || 0,
      "payment_intent_data[metadata][clutter_charge_cents]": pkg.clutterAdjustment?.amountCents || 0,
      "payment_intent_data[metadata][mold_adjustment_percentage]": pkg.moldAdjustment?.percentage || 0,
      "payment_intent_data[metadata][mold_adjustment_cents]": pkg.moldAdjustment?.amountCents || 0,
      "metadata[booking_id]": bookingId,
      "metadata[order_number]": orderNumber,
      "metadata[quote_id]": bookingId,
      "metadata[saved_quote_id]": savedQuoteId,
      "metadata[discount_cents]": pkg.manualDiscount?.amountCents || 0,
      "metadata[discount_label]": pkg.manualDiscount?.label || '',
      "metadata[discount_application]": pkg.manualDiscount ? 'after_tax' : '',
      "metadata[promo_code]": pkg.promoCode || '',
      "metadata[promo_percent]": pkg.promoDiscount?.percent || 0,
      "metadata[promo_discount_cents]": pkg.promoDiscount?.amountCents || 0,
      "metadata[promo_discount_application]": pkg.promoDiscount?.application || '',
      "metadata[arrival_preference]": arrivalPreference.key,
      "metadata[arrival_window]": arrivalWindowLabel(arrivalPreference, pkg.teamHours),
      "metadata[arrival_discount_label]": pkg.arrivalDiscount?.label || '',
      "metadata[arrival_discount_percent]": pkg.arrivalDiscount?.percent || 0,
      "metadata[arrival_discount_cents]": pkg.arrivalDiscount?.amountCents || 0,
      "metadata[arrival_discount_application]": pkg.arrivalDiscount?.application || '',
      "metadata[discounted_subtotal_cents]": pkg.discountedSubtotalCents || '',
      "metadata[promo_expires_at]": pkg.promoDiscount?.expiresAt || '',
      "metadata[original_total_cents]": originalTotalCents,
      "metadata[visible_discount_label]": discountName,
      "metadata[visible_discount_cents]": visibleDiscount?.amountCents || 0,
      "metadata[quote_revision]": body.quoteRevision || '',
      "metadata[customer_name]": customerName,
      "metadata[service_location]": fullAddress,
      "metadata[service]": pkg.serviceLabel,
      "metadata[service_date]": slot.date,
      "metadata[service_time]": slot.time,
      "metadata[schedule_label]": customerScheduleLabel,
      "metadata[package_id]": pkg.id,
      "metadata[package_ids]": pkg.packageIds.join(","),
      "metadata[pricing_mode]": formulaMode ? pkg.pricingMode : "published_package",
      "metadata[subtotal_cents]": pkg.subtotalCents,
      "metadata[tax_cents]": pkg.taxCents,
      "metadata[property_type]": cleanText(eligibility.propertyType, 40),
      "metadata[unit_count]": unitDetails.length,
      "metadata[agreement_accepted]": "true",
      "metadata[agreement_version]": AGREEMENT_VERSION,
      "metadata[agreement_accepted_at]": agreementAcceptance.serverRecordedAt,
      "metadata[agreement_signed_name]": agreementAcceptance.signedName,
      "metadata[agreement_record_hash]": agreementAcceptance.recordHash,
      "metadata[agreement_url]": `${siteUrl}/agreement.html`,
      "metadata[total_amount_cents]": pkg.priceCents,
      "metadata[payment_amount_cents]": depositAmountCents,
      "metadata[remaining_amount_cents]": remainingAmountCents,
      "metadata[payment_type]": "deposit_25",
      "metadata[balance_collection]": "automatic_48h_authorization",
      "metadata[base_labor_hours]": pkg.baseLaborHours || pkg.manHours,
      "metadata[buildup_percentage]": pkg.buildupAdjustment?.percentage || 0,
      "metadata[buildup_added_labor_hours]": pkg.buildupAdjustment?.addedLaborHours || 0,
      "metadata[buildup_charge_cents]": pkg.buildupAdjustment?.amountCents || 0,
      "metadata[clutter_percentage]": pkg.clutterAdjustment?.percentage || 0,
      "metadata[clutter_added_labor_hours]": pkg.clutterAdjustment?.addedLaborHours || 0,
      "metadata[clutter_charge_cents]": pkg.clutterAdjustment?.amountCents || 0,
      "metadata[mold_adjustment_percentage]": pkg.moldAdjustment?.percentage || 0,
      "metadata[mold_adjustment_cents]": pkg.moldAdjustment?.amountCents || 0,
      "metadata[account_user_id]": cleanText(accountSession?.user?.id, 120),
      "consent_collection[terms_of_service]": "required",
      "custom_text[terms_of_service_acceptance][message]": "I agree to the Service Agreement, the 25% deposit, and a temporary authorization hold for the remaining 75% about 48 hours before service. Late rescheduling costs 10%; later cancellation costs 25% less paid rescheduling fees. These fees use the deposit payment method. The balance is charged after completion. If the team cannot work for a customer-caused reason after arriving as scheduled, the total charge is 50%.",
      "custom_text[submit][message]": "The 25% deposit is charged now. A temporary authorization hold for the remaining 75% will be placed about 48 hours before the appointment. It is not a completed charge; the balance is charged after service is completed.",
      "invoice_creation[enabled]": "true",
      "invoice_creation[invoice_data][description]": visibleDiscount
        ? `${discountName} applied. Original service total $${(originalTotalCents / 100).toFixed(2)}; discount -$${(visibleDiscount.amountCents / 100).toFixed(2)}; final service total $${pkg.price.toFixed(2)}. This invoice records the 25% booking deposit.`
        : `25% booking deposit for ${pkg.serviceLabel}. Total service price $${pkg.price.toFixed(2)}.`,
      expires_at: Math.floor(Date.now() / 1000) + HOLD_MINUTES * 60,
      success_url: `${siteUrl}/booking-confirmed.html?session_id={CHECKOUT_SESSION_ID}&order_number=${encodeURIComponent(orderNumber)}`,
      cancel_url: `${siteUrl}/book-now.html?payment=cancelled`
    };
    if (visibleDiscount) {
      Object.assign(stripeCheckoutParams, {
        "invoice_creation[invoice_data][custom_fields][0][name]": "Promotion",
        "invoice_creation[invoice_data][custom_fields][0][value]": discountName.slice(0, 30),
        "invoice_creation[invoice_data][custom_fields][1][name]": "Original service total",
        "invoice_creation[invoice_data][custom_fields][1][value]": `$${(originalTotalCents / 100).toFixed(2)}`,
        "invoice_creation[invoice_data][custom_fields][2][name]": "Discount",
        "invoice_creation[invoice_data][custom_fields][2][value]": `-$${(visibleDiscount.amountCents / 100).toFixed(2)}`,
        "invoice_creation[invoice_data][custom_fields][3][name]": "Final service total",
        "invoice_creation[invoice_data][custom_fields][3][value]": `$${pkg.price.toFixed(2)}`
      });
    }
    checkout = await createStripeCheckout(secretKey, stripeCheckoutParams);

    await calendar.attachCheckout(bookingId, reservation.attempt, checkout);
    await quoteAdmin.checkSavedCheckout(body.savedQuoteToken, checkout, body.quoteRevision || '');
    return json(response, 201, {
      bookingId,
      orderNumber,
      checkoutUrl: checkout.url,
      expiresInMinutes: HOLD_MINUTES
    });
  } catch (error) {
    if (bookingId) {
      try {
        await calendar.cleanupCheckout(bookingId, reservation?.attempt, checkout, error);
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

module.exports._test = {
  AGREEMENT_ACCEPTANCE_TEXT,
  AGREEMENT_VERSION,
  buildAgreementAcceptance
};
