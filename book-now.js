(() => {
  const form = document.querySelector("[data-booking-form]");
  if (!form) return;
  const BOOKING_DRAFT_KEY = "imanBookingDraftV3";
  const BOOKING_DRAFT_VERSION = 3;
  const BOOKING_DRAFT_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  const INSTANT_PRICING_NOTICE_KEY = "imanInstantPricingOpenedNoticeV1";
  const AGREEMENT_VERSION = "2026-10-12-hourly-minimum-v5";
  const AGREEMENT_ACCEPTANCE_TEXT = "I have reviewed and agree to the Service Agreement and payment terms. I authorize the 25% deposit, the remaining-balance authorization described above, and any customer-caused access charge described in the agreement.";
  let persistBookingDraft = () => {};
  let saveBookingDraft = () => {};
  let clearBookingDraft = () => {};
  let instantQuoteStarted = false;
  const track = (name, params = {}) => {
    if (typeof window.gtag === "function") window.gtag("event", name, params);
  };
  form.addEventListener("input", () => {
    if (instantQuoteStarted) return;
    instantQuoteStarted = true;
    track("quote_start", { quote_type: "instant" });
  }, { once: true });

  const serviceArea = window.IMAN_BOOKING_SERVICE_AREA;
  const instantQuotePauseMessage = (zip) => {
    const borough = serviceArea.temporarilyPausedBorough?.(zip);
    return borough ? `We’re temporarily not providing service in ${borough}. We expect to resume service there soon.` : "";
  };
  const canUseInstantQuoteZip = (zip) => serviceArea.isServed(zip) && !instantQuotePauseMessage(zip);
  const zipGate = document.querySelector("[data-zip-gate]");
  const resumeQuoteGate = document.querySelector("[data-resume-quote]");
  const resumeContinueButton = document.querySelector("[data-resume-continue]");
  const resumeNewButton = document.querySelector("[data-resume-new]");
  const bookedQuoteGate = document.querySelector("[data-booked-quote]");
  const quoteLoadGate = document.querySelector("[data-quote-load-gate]");
  const quoteLoadTitle = document.querySelector("[data-quote-load-title]");
  const quoteLoadMessage = document.querySelector("[data-quote-load-message]");
  const quoteLoadHelp = document.querySelector("[data-quote-load-help]");
  const quoteLoadHome = document.querySelector("[data-quote-load-home]");
  const zipForm = document.querySelector("[data-zip-form]");
  const zipInput = document.querySelector("#booking-zip-input");
  const zipStatus = document.querySelector("[data-zip-status]");
  const zipSuccess = document.querySelector("[data-zip-success]");
  const zipSubmit = zipForm?.querySelector("button[type='submit']");
  const bookingWizard = document.querySelector("[data-booking-wizard]");
  const wizardDialog = document.querySelector(".booking-wizard-dialog");
  const checkoutZip = form.elements.zip;
  const confirmedArea = document.querySelector("[data-area-confirmed]");
  const confirmedZip = document.querySelector("[data-confirmed-zip]");
  const serviceZipNote = document.querySelector("[data-service-zip-note]");
  let zipSuccessTimer = 0;

  const instantPricingEntrySource = () => {
    const params = new URLSearchParams(window.location.search);
    const campaignSource = String(params.get("source") || "").trim().slice(0, 80);
    if (campaignSource) return campaignSource;
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin === window.location.origin) return referrer.pathname || "website";
      return referrer.hostname || "direct visit";
    } catch {
      return "direct visit";
    }
  };

  const notifyInstantPricingOpened = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("quote") || params.get("payment") === "cancelled") return;
    try {
      if (window.sessionStorage.getItem(INSTANT_PRICING_NOTICE_KEY)) return;
      window.sessionStorage.setItem(INSTANT_PRICING_NOTICE_KEY, new Date().toISOString());
    } catch {
      // Continue when browser privacy settings disable session storage.
    }
    const payload = JSON.stringify({
      source: "Instant pricing form",
      event: "opened",
      pageUrl: `${window.location.origin}${window.location.pathname}`,
      summaryLines: [`Entry source: ${instantPricingEntrySource()}`]
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/form-notification", new Blob([payload], { type: "application/json" }));
      return;
    }
    fetch("/api/form-notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true
    }).catch(() => {});
  };

  notifyInstantPricingOpened();
  let closeQualificationRedirect = () => {};
  let closeQualificationComplete = () => {};
  let closeAdditionalCleaningNotice = () => {};
  let closeQuoteContact = () => {};
  let closeAccountDialog = () => {};
  let closeAgreementReview = () => {};
  let closeDiscardConfirmation = () => {};
  let closeSameDayDialog = () => {};
  const openWizard = () => {
    if (!bookingWizard) return;
    bookingWizard.hidden = false;
    document.body.classList.add("booking-wizard-open");
    window.setTimeout(() => {
      wizardDialog?.scrollTo({ top: 0 });
      form.querySelector(".is-mobile-current [data-answer-choice], .is-mobile-current input:not([type='hidden']), [data-step]:not([hidden]) button")?.focus();
    }, 50);
  };
  const hideWizard = () => {
    if (!bookingWizard) return;
    bookingWizard.hidden = true;
    document.body.classList.remove("booking-wizard-open");
  };
  const closeWizard = ({ preserveDraft = false } = {}) => {
    if (preserveDraft) {
      persistBookingDraft();
    } else {
      suspendDraftSaving = true;
      clearBookingDraft();
    }
    closeQualificationRedirect();
    closeQualificationComplete();
    closeAdditionalCleaningNotice();
    closeQuoteContact();
    closeAccountDialog();
    closeSameDayDialog();
    closeDiscardConfirmation();
    hideWizard();
    if (document.body.classList.contains("booking-form-only")) {
      window.location.assign("./index.html");
      return;
    }
    if (!preserveDraft) {
      window.location.replace(window.location.pathname);
      return;
    }
    document.querySelector("[data-start-booking]")?.focus();
  };
  const applyServiceZip = (zip) => {
    checkoutZip.value = zip;
    if (confirmedZip) confirmedZip.textContent = zip;
    if (confirmedArea) confirmedArea.hidden = false;
    if (serviceZipNote) serviceZipNote.textContent = "— service area confirmed";
    if (state.eligibility) {
      state.eligibility = { ...state.eligibility, serviceZip: zip };
    }
    if (state.serviceKey === "window" && state.unitDetails[0]) {
      state.unitDetails[0] = { ...state.unitDetails[0], serviceZip: zip };
    }
    persistBookingDraft();
  };
  const openZipGate = () => {
    if (!zipGate) return;
    window.clearTimeout(zipSuccessTimer);
    zipSuccessTimer = 0;
    zipGate.hidden = false;
    document.body.classList.add("zip-gate-open");
    zipInput.value = checkoutZip.value;
    zipStatus.hidden = true;
    if (zipSuccess) zipSuccess.hidden = true;
    zipInput.disabled = false;
    if (zipSubmit) zipSubmit.disabled = false;
    zipForm?.removeAttribute("aria-busy");
    window.setTimeout(() => zipInput.focus(), 50);
  };
  const closeZipGate = () => {
    if (!zipGate) return;
    zipGate.hidden = true;
    document.body.classList.remove("zip-gate-open");
  };
  const showZipError = (message) => {
    zipStatus.hidden = false;
    zipStatus.dataset.type = "error";
    zipStatus.replaceChildren(document.createTextNode(message));
  };
  const showBookedQuoteConfirmation = () => {
    if (quoteLoadGate) quoteLoadGate.hidden = true;
    if (zipGate) zipGate.hidden = true;
    if (bookingWizard) bookingWizard.hidden = true;
    if (bookedQuoteGate) bookedQuoteGate.hidden = false;
    document.body.classList.add("zip-gate-open");
  };
  const showQuoteLoading = () => {
    if (!quoteLoadGate) return;
    quoteLoadTitle.textContent = "Opening your saved quote…";
    quoteLoadMessage.textContent = "Please wait while we securely retrieve your cleaning estimate.";
    quoteLoadHelp.hidden = true;
    quoteLoadHome.hidden = true;
    quoteLoadGate.hidden = false;
    document.body.classList.add("zip-gate-open");
  };
  const hideQuoteLoading = () => {
    if (quoteLoadGate) quoteLoadGate.hidden = true;
  };
  const showQuoteLoadError = (message) => {
    if (!quoteLoadGate) {
      openZipGate();
      showZipError(message);
      return;
    }
    quoteLoadTitle.textContent = "We couldn't open this quote";
    quoteLoadMessage.textContent = message;
    quoteLoadHelp.hidden = false;
    quoteLoadHome.hidden = false;
    quoteLoadGate.hidden = false;
    document.body.classList.add("zip-gate-open");
  };

  zipInput?.addEventListener("input", () => {
    zipInput.value = serviceArea.normalize(zipInput.value);
    zipStatus.hidden = true;
  });
  zipForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (zipSuccess && !zipSuccess.hidden) return;
    const zip = serviceArea.normalize(zipInput.value);
    if (!serviceArea.isValid(zip)) {
      showZipError("Please enter a valid 5-digit ZIP code.");
      zipInput.focus();
      return;
    }
    const pausedMessage = instantQuotePauseMessage(zip);
    if (pausedMessage) {
      showZipError(pausedMessage);
      zipInput.focus();
      return;
    }
    if (!serviceArea.isServed(zip)) {
      showZipError("This ZIP is outside our New York City service area. We currently serve only the five NYC boroughs.");
      zipInput.focus();
      return;
    }
    zipStatus.hidden = true;
    zipInput.disabled = true;
    if (zipSubmit) zipSubmit.disabled = true;
    zipForm.setAttribute("aria-busy", "true");
    if (zipSuccess) zipSuccess.hidden = false;
    applyServiceZip(zip);
    zipSuccessTimer = window.setTimeout(() => {
      zipSuccessTimer = 0;
      if (zipSuccess) zipSuccess.hidden = true;
      zipInput.disabled = false;
      if (zipSubmit) zipSubmit.disabled = false;
      zipForm.removeAttribute("aria-busy");
      closeZipGate();
      openWizard();
    }, 3000);
  });
  document.querySelector("[data-change-zip]")?.addEventListener("click", () => {
    hideWizard();
    openZipGate();
  });
  document.querySelector("[data-start-booking]")?.addEventListener("click", () => {
    const currentZip = serviceArea.normalize(checkoutZip.value);
    if (canUseInstantQuoteZip(currentZip)) openWizard();
    else openZipGate();
  });
  const saveAndCloseWizard = () => {
    saveBookingDraft({ immediate: true });
    closeWizard({ preserveDraft: true });
  };
  document.querySelectorAll("[data-wizard-close]").forEach((control) => {
    control.addEventListener("click", saveAndCloseWizard);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || bookingWizard.hidden || !zipGate.hidden) return;
    if (servicePreviewOverlay && !servicePreviewOverlay.hidden) {
      closeServicePreview();
      return;
    }
    const discardConfirmation = document.querySelector("[data-discard-confirmation]");
    if (discardConfirmation && !discardConfirmation.hidden) {
      closeDiscardConfirmation();
      return;
    }
    const additionalCleaningNotice = document.querySelector("[data-additional-cleaning-notice]");
    if (additionalCleaningNotice && !additionalCleaningNotice.hidden) {
      closeAdditionalCleaningNotice();
      return;
    }
    const quoteContact = document.querySelector("[data-quote-contact]");
    if (quoteContact && !quoteContact.hidden) {
      closeQuoteContact();
      return;
    }
    const accountDialog = document.querySelector("[data-account-dialog]");
    if (accountDialog && !accountDialog.hidden) {
      closeAccountDialog();
      return;
    }
    const sameDayDialog = document.querySelector("[data-same-day-dialog]");
    if (sameDayDialog && !sameDayDialog.hidden) {
      closeSameDayDialog();
      return;
    }
    const agreementReview = document.querySelector("[data-agreement-review]");
    if (agreementReview && !agreementReview.hidden) {
      closeAgreementReview();
      return;
    }
    saveAndCloseWizard();
  });

  const state = {
    step: 1,
    serviceKey: "",
    package: null,
    packageIds: [],
    eligibility: null,
    unitDetails: [],
    currentUnitIndex: 0,
    currentDetailQuestionIndex: 0,
    pricingMode: "",
    availableSlots: [],
    availableDates: [],
    availableMonths: [],
    calendarMonthIndex: 0,
    selectedDate: "",
    savedQuoteUrl: "",
    quoteRevision: '',
    highestStageReached: 1,
    promo: null,
    packageBeforePromo: null,
    arrivalPreference: "",
    arrivalDiscount: null,
    packageBeforeArrivalDiscount: null,
    agreementReview: {
      version: AGREEMENT_VERSION,
      openedAt: "",
      scrolledToEndAt: "",
      acceptedAt: "",
      accepted: false,
      signedName: "",
      contextFingerprint: ""
    }
  };
  const stageMenuButtons = Array.from(document.querySelectorAll("[data-stage-target]"));
  const allMobileQuestions = Array.from(form.querySelectorAll("[data-mobile-question]"));
  const mobileQuestionNav = form.querySelector(".booking-mobile-question-nav");
  const mobileQuestionCount = form.querySelector("[data-question-count]");
  const mobileQuestionTime = form.querySelector("[data-question-time]");
  const eligibilityButtonLabel = form.querySelector("[data-eligibility-button-label]");
  const eligibilityContinue = form.querySelector("[data-check-eligibility]");
  const questionBack = form.querySelector("[data-question-back]");
  const qualificationRedirectOverlay = document.querySelector("[data-qualification-redirect]");
  const qualificationRedirectTitle = document.querySelector("[data-redirect-title]");
  const qualificationRedirectReason = document.querySelector("[data-redirect-reason]");
  const qualificationRedirectContinue = document.querySelector("[data-redirect-continue]");
  const qualificationRedirectBack = document.querySelector("[data-redirect-back]");
  const movingEligibilityOverlay = document.querySelector("[data-moving-eligibility]");
  const movingEligibilityForm = document.querySelector("[data-moving-eligibility-form]");
  const movingEligibilityStatus = document.querySelector("[data-moving-eligibility-status]");
  const postConstructionScreeningOverlay = document.querySelector("[data-post-construction-screening]");
  const postConstructionScreeningForm = document.querySelector("[data-post-construction-screening-form]");
  const servicePreviewOverlay = document.querySelector("[data-service-preview-overlay]");
  const servicePreviewFrame = document.querySelector("[data-service-preview-frame]");
  const servicePreviewTitle = document.querySelector("[data-service-preview-title]");
  const qualificationCompleteOverlay = document.querySelector("[data-qualification-complete]");
  const recurringWelcomeOverlay = document.querySelector("[data-recurring-welcome]");
  const recurringWelcomeName = document.querySelector("[data-recurring-welcome-name]");
  const additionalCleaningNotice = document.querySelector("[data-additional-cleaning-notice]");
  const additionalCleaningNoticeContinue = document.querySelector("[data-additional-cleaning-notice-continue]");
  const quoteContactOverlay = document.querySelector("[data-quote-contact]");
  const quoteContactForm = document.querySelector("[data-quote-contact-form]");
  const quoteContactStatus = document.querySelector("[data-quote-contact-status]");
  const quoteContactSubmit = document.querySelector("[data-quote-contact-submit]");
  const quoteContactBack = document.querySelector("[data-quote-contact-back]");
  const accountDialog = document.querySelector("[data-account-dialog]");
  const accountChoice = document.querySelector("[data-account-choice]");
  const accountState = document.querySelector("[data-account-state]");
  const accountLogout = document.querySelector("[data-account-logout]");
  const accountStateCopy = document.querySelector("[data-account-state-copy]");
  const accountLoginForm = document.querySelector("[data-account-login-form]");
  const accountSignupForm = document.querySelector("[data-account-signup-form]");
  const accountLoginStatus = document.querySelector("[data-account-login-status]");
  const accountSignupStatus = document.querySelector("[data-account-signup-status]");
  const accountTabs = Array.from(document.querySelectorAll("[data-account-tab]"));
  const agreementReviewOverlay = document.querySelector("[data-agreement-review]");
  const agreementScroll = document.querySelector("[data-agreement-scroll]");
  const agreementAccept = document.querySelector("[data-agreement-accept]");
  const agreementSignedName = document.querySelector("[data-agreement-signed-name]");
  const agreementAcceptButton = document.querySelector("[data-accept-agreement]");
  const agreementReviewButton = document.querySelector("[data-open-agreement-review]");
  const agreementReviewButtonCopy = document.querySelector("[data-agreement-review-button-copy]");
  const agreementReviewStatus = document.querySelector("[data-agreement-review-status]");
  const payButton = document.querySelector("[data-pay-button]");
  const promoInput = form.elements.promoCode;
  const promoStatus = document.querySelector("[data-promo-status]");
  const applyPromoButton = document.querySelector("[data-apply-promo]");
  const removePromoButton = document.querySelector("[data-remove-promo]");
  let agreementContentLoaded = false;
  let agreementReturnFocus = null;
  let currentAccount = null;
  const savedQuoteStatus = document.querySelector("[data-saved-quote-status]");
  const organizationForm = form.querySelector("[data-organization-form]");
  const organizationHoursInput = form.elements.organizationHours;
  const hourlyDetailsTitle = form.querySelector("[data-hourly-details-title]");
  const hourlyDetailsHelp = form.querySelector("[data-hourly-details-help]");
  const windowForm = form.querySelector("[data-window-form]");
  const windowCards = Array.from(form.querySelectorAll("[data-window-card]"));
  const serviceChoiceForm = form.querySelector("[data-service-choice-form]");
  const recurringDetailsForm = form.querySelector("[data-recurring-details-form]");
  const recurringOrderNumberInput = form.elements.recurringOrderNumber;
  const serviceChoiceButtons = Array.from(form.querySelectorAll("[data-booking-service]"));
  const propertyTypeForm = form.querySelector("[data-property-type-form]");
  const propertyTypeButtons = Array.from(form.querySelectorAll("[data-booking-property-type]"));
  const unitCountForm = form.querySelector("[data-unit-count-form]");
  const unitCountDecrease = form.querySelector("[data-unit-count-decrease]");
  const unitCountIncrease = form.querySelector("[data-unit-count-increase]");
  const unitCountValue = form.querySelector("[data-unit-count-value]");
  const unitCountLabel = form.querySelector("[data-unit-count-label]");
  const unitPreview = form.querySelector("[data-unit-preview]");
  const quoteDetailsForm = form.querySelector("[data-quote-details-form]");
  const unitDetailsKicker = form.querySelector("[data-unit-details-kicker]");
  const unitDetailsTitle = form.querySelector("[data-unit-details-title]");
  const unitDetailsCopy = form.querySelector("[data-unit-details-copy]");
  const standardDetailQuestion = form.querySelector("[data-standard-detail-question]");
  const standardDetailHelper = form.querySelector("[data-standard-detail-helper]");
  const standardDetailOptions = form.querySelector("[data-standard-detail-options]");
  const standardDetailNumber = form.querySelector("[data-standard-detail-number]");
  const standardDetailNumberLabel = form.querySelector("[data-standard-detail-number-label]");
  const standardDetailNumberInput = standardDetailNumber?.querySelector("input");
  const scheduleSelect = form.querySelector("[data-schedule]");
  const calendarGrid = form.querySelector("[data-calendar-grid]");
  const calendarMonthLabel = form.querySelector("[data-calendar-month]");
  const calendarPrevious = form.querySelector("[data-calendar-prev]");
  const calendarNext = form.querySelector("[data-calendar-next]");
  const selectedDateLabel = form.querySelector("[data-selected-date-label]");
  const timeSlots = form.querySelector("[data-time-slots]");
  const arrivalOptions = form.querySelector("[data-arrival-options]");
  const arrivalNote = form.querySelector("[data-arrival-note]");
  const schedulerStatus = form.querySelector("[data-scheduler-status]");
  const sameDayDialog = document.querySelector("[data-same-day-dialog]");
  const sameDayForm = document.querySelector("[data-same-day-form]");
  const sameDayStatus = document.querySelector("[data-same-day-status]");
  const sameDaySubmit = document.querySelector("[data-submit-same-day]");
  const commercialCallLink = document.querySelector("[data-commercial-call]");
  let pendingQualificationUrl = "";
  let qualificationCompleteTimer = 0;
  let recurringWelcomeTimer = 0;
  let mobileQuestionIndex = 0;
  let organizationMode = false;
  let windowMode = false;
  let serviceChoiceMode = false;
  let recurringDetailsMode = false;
  let propertyTypeMode = false;
  let unitCountMode = false;
  let quoteDetailsMode = false;
  let suspendDraftSaving = false;
  let draftSaveTimer = 0;
  const serviceNames = {
    window: "Window Cleaning",
    standard: "Standard Cleaning",
    deep: "Deep Cleaning",
    move: "Move-In / Move-Out Cleaning",
    hourly: "Hourly Cleaning Service",
    recurring: "Recurring Cleaning Service",
    post: "Post-Construction Cleaning"
  };
  const qualificationRedirects = {
    commercial_service: {
      title: "Commercial Cleaning Requires a Custom Quote",
      description: "Commercial cleaning is customized for each business and may require a brief consultation or walkthrough before we confirm the scope and price.",
      buttonLabel: "Request a Walkthrough",
      category: "commercial"
    },
    window_service: {
      title: "Let’s Prepare Your Window Cleaning Quote",
      description: "Window cleaning is quoted according to the number and type of windows, accessibility, and whether interior or exterior cleaning is needed.",
      buttonLabel: "Request a Window Cleaning Quote",
      service: "window-cleaning"
    },
    window_manual_review: {
      title: "Your Window Cleaning Request Needs a Review",
      description: "Photos and a brief review are required because the window condition, size, access, obstruction, or panel count may affect safe service and accurate pricing.",
      buttonLabel: "Continue with photos",
      service: "window-cleaning"
    },
    window_addon: {
      title: "Window Cleaning Needs a Separate Quote",
      description: "Window pricing depends on the number and type of windows, interior or exterior service, condition, and safe access. Your residential answers will be carried to the window quote form.",
      buttonLabel: "Continue to Window Cleaning Quote",
      service: "window-cleaning"
    },
    water_damage: {
      title: "Service Category Currently Unavailable",
      description: "We’re not currently providing cleaning related to flooding, sewage backup, or significant water damage. No cleaning quote is available for this category at this time.",
      buttonLabel: "",
      ineligible: true
    },
    post_construction: {
      title: "Post-Construction Cleaning Required",
      description: "Recently renovated properties typically require specialized post-construction cleaning due to construction dust, debris, and fine particles.",
      buttonLabel: "Request a Post-Construction Cleaning Quote",
      service: "post-construction"
    },
    excessive_belongings: {
      title: "Additional Information Required",
      description: "Belongings or storage that limit access require a custom assessment so we can estimate the cleaning time, access needs, and staffing.",
      buttonLabel: "Request a Custom Quote"
    },
    utilities_unavailable: {
      title: "No Cleaning Quote Available",
      description: "Cleaning cannot be completed unless both electricity and running water are available at the property. We’re unable to provide or schedule a cleaning quote at this time. Please try again when both utilities are available.",
      buttonLabel: "",
      ineligible: true
    },
    ineligible_unsafe_conditions: {
      title: "Not Eligible for Cleaning",
      description: "For the safety of our cleaning team, we’re unable to provide or schedule cleaning while unsafe or hazardous conditions are present. Please try again after the conditions have been professionally removed or fully resolved.",
      buttonLabel: "",
      ineligible: true
    },
    ineligible_clutter_access: {
      title: "Not Eligible for a Cleaning Quote",
      description: "We’re unable to provide or schedule cleaning when the amount of clutter may prevent safe access for our cleaners. Please try again after clear and safe access has been created throughout the areas that need cleaning.",
      buttonLabel: "",
      ineligible: true
    },
    heavy_buildup: {
      title: "Heavy Buildup Requires a Custom Quote",
      description: "Heavy grease, soap scum, dust, or residue may require additional time and specialized cleaning. Please request a custom quote so we can review the condition accurately.",
      buttonLabel: "Request a Custom Quote"
    },
    moving_not_empty: {
      title: "Not Eligible for Moving Cleaning",
      description: "Moving Cleaning is only available when the property will be completely empty or mostly empty at the time of service. Please choose Standard Cleaning or Deep Cleaning instead.",
      backLabel: "Choose another service",
      ineligible: true
    },
    ineligible_safety: {
      title: "Not Eligible for a Cleaning Quote",
      description: "We’re unable to provide a cleaning quote while active pests or human or significant animal waste are present. Please try again after the condition has been professionally removed or resolved.",
      buttonLabel: "",
      ineligible: true
    },
  };
  const preset = new URLSearchParams(window.location.search);
  const presetService = preset.get("service");
  if (["standard", "deep", "move", "post", "hourly", "recurring"].includes(presetService)) {
    state.unitDetails = [{}];
    form.elements.propertyStatus.value =
      presetService === "move" ? "moving" : "occupied";
    form.elements.requestedService.value = presetService;
  }

  const value = (name) => form.elements[name]?.value || "";
  const agreementContextFingerprint = () => JSON.stringify({
    packageId: state.package?.id || "",
    total: Number(state.package?.price || 0),
    laborHours: Number(state.package?.manHours || 0),
    schedule: value("schedule")
  });
  const syncAgreementControls = () => {
    const accepted = Boolean(state.agreementReview.accepted && state.agreementReview.acceptedAt);
    if (agreementReviewButton) agreementReviewButton.classList.toggle("is-accepted", accepted);
    if (agreementReviewButtonCopy) {
      agreementReviewButtonCopy.textContent = accepted
        ? "✓ Service Agreement accepted"
        : "Review and accept Service Agreement";
    }
    if (agreementReviewStatus) {
      agreementReviewStatus.hidden = accepted;
      agreementReviewStatus.textContent = accepted
        ? ""
        : "Required before payment. You will be asked to scroll through the agreement and accept it.";
    }
    if (payButton) payButton.disabled = !accepted;
  };
  const resetAgreementReview = () => {
    state.agreementReview = {
      version: AGREEMENT_VERSION,
      openedAt: "",
      scrolledToEndAt: "",
      acceptedAt: "",
      accepted: false,
      signedName: "",
      contextFingerprint: ""
    };
    if (agreementAccept) {
      agreementAccept.checked = false;
      agreementAccept.disabled = true;
    }
    if (agreementSignedName) agreementSignedName.value = "";
    if (agreementAcceptButton) agreementAcceptButton.disabled = true;
    syncAgreementControls();
  };
  const markAgreementScrollComplete = () => {
    if (state.agreementReview.scrolledToEndAt) return;
    state.agreementReview.scrolledToEndAt = new Date().toISOString();
    if (agreementAccept) agreementAccept.disabled = false;
  };
  const loadAgreementContent = async () => {
    if (agreementContentLoaded || !agreementScroll) return;
    try {
      const response = await fetch("./agreement.html", { cache: "no-store" });
      if (!response.ok) throw new Error("Agreement unavailable");
      const documentCopy = new DOMParser().parseFromString(await response.text(), "text/html");
      const agreement = documentCopy.querySelector("article.agreement");
      if (!agreement) throw new Error("Agreement unavailable");
      agreementScroll.replaceChildren(...Array.from(agreement.childNodes).map((node) => document.importNode(node, true)));
      agreementContentLoaded = true;
      agreementScroll.scrollTop = 0;
      if (agreementScroll.scrollHeight <= agreementScroll.clientHeight + 4) markAgreementScrollComplete();
    } catch {
      agreementScroll.innerHTML = '<p>The agreement could not be loaded. Please close this window, check your connection, and try again. You can also <a href="./agreement.html" target="_blank" rel="noopener">open the Service Agreement separately</a>.</p>';
    }
  };
  const openAgreementReview = async () => {
    if (!agreementReviewOverlay) return;
    agreementReturnFocus = document.activeElement;
    agreementReviewOverlay.hidden = false;
    document.body.classList.add("booking-agreement-open");
    if (!state.agreementReview.openedAt) state.agreementReview.openedAt = new Date().toISOString();
    await loadAgreementContent();
    agreementScroll?.focus();
  };
  closeAgreementReview = () => {
    if (!agreementReviewOverlay) return;
    agreementReviewOverlay.hidden = true;
    document.body.classList.remove("booking-agreement-open");
    agreementReturnFocus?.focus?.();
  };
  agreementReviewButton?.addEventListener("click", openAgreementReview);
  document.querySelectorAll("[data-close-agreement-review]").forEach((control) => {
    control.addEventListener("click", closeAgreementReview);
  });
  agreementScroll?.addEventListener("scroll", () => {
    const remaining = agreementScroll.scrollHeight - agreementScroll.scrollTop - agreementScroll.clientHeight;
    if (remaining <= 8) markAgreementScrollComplete();
  });
  const validAgreementSignedName = () => {
    const parts = String(agreementSignedName?.value || "").trim().split(/\s+/).filter(Boolean);
    return parts.length >= 2 && parts.join(" ").length >= 3;
  };
  const syncAgreementAcceptButton = () => {
    if (!agreementAcceptButton) return;
    agreementAcceptButton.disabled = !agreementAccept?.checked || !state.agreementReview.scrolledToEndAt || !validAgreementSignedName();
  };
  agreementAccept?.addEventListener("change", syncAgreementAcceptButton);
  agreementSignedName?.addEventListener("input", syncAgreementAcceptButton);
  agreementAcceptButton?.addEventListener("click", () => {
    if (!agreementAccept?.checked || !state.agreementReview.scrolledToEndAt || !validAgreementSignedName()) return;
    state.agreementReview.accepted = true;
    state.agreementReview.acceptedAt = new Date().toISOString();
    state.agreementReview.signedName = agreementSignedName.value.trim().replace(/\s+/g, " ");
    state.agreementReview.contextFingerprint = agreementContextFingerprint();
    syncAgreementControls();
    closeAgreementReview();
  });
  const windowDetailsFromForm = () => ({
    serviceZip: value("zip"),
    propertyType: value("windowPropertyType"),
    scope: value("windowScope"),
    frequency: value("windowFrequency"),
    windows: Array.from(form.querySelectorAll('input[name="windowTypes"]:checked')).map((control) => ({
      type: control.value,
      quantity: Number(form.querySelector(`[data-window-quantity="${control.value}"]`)?.value || 0)
    })),
    screens: Number(value("windowScreens")),
    tracks: Number(value("windowTracks")),
    condition: value("windowCondition"),
    size: value("windowSize"),
    access: value("windowAccess")
  });
  const windowNeedsManualReview = (details) => (
    ["hard_water", "paint_adhesive", "construction", "damaged"].includes(details.condition) ||
    details.size === "very_oversized" ||
    ["third", "leaning_out", "not_sure"].includes(details.access)
  );
  const restoreWindowDetails = (details = {}) => {
    const values = {
      windowPropertyType: details.propertyType,
      windowScope: details.scope,
      windowFrequency: details.frequency,
      windowScreens: details.screens,
      windowTracks: details.tracks,
      windowCondition: details.condition,
      windowSize: details.size,
      windowAccess: details.access
    };
    Object.entries(values).forEach(([name, fieldValue]) => {
      if (form.elements[name] && fieldValue !== undefined) form.elements[name].value = String(fieldValue);
    });
    const selected = new Map((details.windows || []).map((item) => [item.type, item.quantity]));
    windowCards.forEach((card) => {
      const checkbox = card.querySelector('input[type="checkbox"]');
      const quantity = card.querySelector("[data-window-quantity]");
      checkbox.checked = selected.has(checkbox.value);
      card.classList.toggle("is-selected", checkbox.checked);
      if (quantity) {
        quantity.value = String(selected.get(checkbox.value) || 1);
        quantity.disabled = !checkbox.checked;
      }
    });
  };
  const captureFields = (targetForm) => {
    const fields = {};
    const controls = Array.from(targetForm?.elements || []).filter((control) => control.name);
    [...new Set(controls.map((control) => control.name))].forEach((name) => {
      const group = controls.filter((control) => control.name === name);
      const first = group[0];
      if (first.type === "radio") {
        fields[name] = group.find((control) => control.checked)?.value || "";
      } else if (first.type === "checkbox" && group.length > 1) {
        fields[name] = group.filter((control) => control.checked).map((control) => control.value);
      } else if (first.type === "checkbox") {
        fields[name] = Boolean(first.checked);
      } else if (!["button", "submit", "reset", "password"].includes(first.type)) {
        fields[name] = first.value;
      }
    });
    return fields;
  };
  const restoreFields = (targetForm, fields = {}) => {
    const controls = Array.from(targetForm?.elements || []).filter((control) => control.name);
    controls.forEach((control) => {
      if (!Object.prototype.hasOwnProperty.call(fields, control.name)) return;
      const savedValue = fields[control.name];
      if (control.type === "radio") {
        control.checked = control.value === savedValue;
      } else if (control.type === "checkbox") {
        control.checked = Array.isArray(savedValue)
          ? savedValue.includes(control.value)
          : Boolean(savedValue);
      } else if (!["button", "submit", "reset", "password"].includes(control.type)) {
        control.value = String(savedValue ?? "");
      }
    });
  };
  const writeBookingDraft = () => {
    try {
      window.localStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify({
        version: BOOKING_DRAFT_VERSION,
        explicitlySaved: true,
        savedAt: new Date().toISOString(),
        fields: captureFields(form),
        quoteContactFields: captureFields(quoteContactForm),
        state: {
          step: state.step,
          serviceKey: state.serviceKey,
          package: state.package,
          packageIds: state.packageIds,
          eligibility: state.eligibility,
          unitDetails: state.unitDetails,
          currentUnitIndex: state.currentUnitIndex,
          currentDetailQuestionIndex: state.currentDetailQuestionIndex,
          pricingMode: state.pricingMode,
          savedQuoteUrl: state.savedQuoteUrl,
          quoteRevision: state.quoteRevision,
          availableSlots: state.availableSlots,
          calendarMonthIndex: state.calendarMonthIndex,
          selectedDate: state.selectedDate,
          highestStageReached: state.highestStageReached,
          promo: state.promo,
          packageBeforePromo: state.packageBeforePromo,
          arrivalPreference: state.arrivalPreference,
          arrivalDiscount: state.arrivalDiscount,
          packageBeforeArrivalDiscount: state.packageBeforeArrivalDiscount
        },
        view: {
          mobileQuestionIndex,
          organizationMode,
          windowMode,
          serviceChoiceMode,
          recurringDetailsMode,
          propertyTypeMode,
          unitCountMode,
          quoteDetailsMode
        }
      }));
      const saveCopy = document.querySelector("[data-booking-save-copy]");
      if (saveCopy) saveCopy.textContent = "Your progress is saved";
    } catch {
      // The booking still works if browser storage is unavailable.
    }
  };
  saveBookingDraft = ({ immediate = false } = {}) => {
    if (suspendDraftSaving) return;
    window.clearTimeout(draftSaveTimer);
    if (immediate) {
      writeBookingDraft();
      return;
    }
    draftSaveTimer = window.setTimeout(writeBookingDraft, 80);
  };
  persistBookingDraft = saveBookingDraft;
  clearBookingDraft = () => {
    window.clearTimeout(draftSaveTimer);
    try {
      window.localStorage.removeItem(BOOKING_DRAFT_KEY);
      window.sessionStorage.removeItem("imanBookingZip");
      window.sessionStorage.removeItem("imanBookingQualificationDraft");
    } catch {}
  };
  const mobileQuestions = () => allMobileQuestions.filter((question) => (
    (!question.hasAttribute("data-occupied-service-question") || value("propertyStatus") === "occupied") &&
    (!question.hasAttribute("data-mold-cleaning-question") || value("hazards") === "mold")
  ));
  const setStatus = (element, message, type = "error") => {
    if (!element) return;
    element.hidden = !message;
    element.textContent = message;
    element.dataset.type = type;
  };
  const accountMode = () => form.elements.accountMode?.value || "guest";
  const syncAccountState = () => {
    if (!accountState || !accountStateCopy || !accountLogout) return;
    if (currentAccount) {
      accountStateCopy.textContent = `Logged in as ${currentAccount.email}. This booking will appear in your account.`;
      accountState.hidden = false;
      accountLogout.hidden = false;
      const accountRadio = form.querySelector('input[name="accountMode"][value="account"]');
      if (accountRadio) accountRadio.checked = true;
      if (form.elements.email) form.elements.email.value = currentAccount.email;
      return;
    }
    accountStateCopy.textContent = "";
    accountState.hidden = true;
    accountLogout.hidden = true;
  };
  const fillAccountForms = () => {
    const email = value("email") || quoteContactForm?.elements.quoteEmail?.value || "";
    const fullName = [value("firstName"), value("lastName")].filter(Boolean).join(" ");
    const phone = value("phone") || quoteContactForm?.elements.quotePhone?.value || "";
    if (accountLoginForm) accountLoginForm.elements.accountEmail.value = email;
    if (accountSignupForm) {
      accountSignupForm.elements.accountEmail.value = email;
      accountSignupForm.elements.accountFullName.value = fullName;
      accountSignupForm.elements.accountPhone.value = phone;
    }
  };
  const showAccountTab = (tab) => {
    const signup = tab === "signup";
    accountLoginForm.hidden = signup;
    accountSignupForm.hidden = !signup;
    accountTabs.forEach((button) => button.setAttribute("aria-selected", String(button.dataset.accountTab === tab)));
    window.setTimeout(() => {
      (signup ? accountSignupForm : accountLoginForm)?.querySelector("input")?.focus();
    }, 30);
  };
  const openAccountDialog = (tab = "login") => {
    fillAccountForms();
    showAccountTab(tab);
    accountDialog.hidden = false;
  };
  closeAccountDialog = () => {
    if (accountDialog) accountDialog.hidden = true;
    if (!currentAccount) {
      const guestRadio = form.querySelector('input[name="accountMode"][value="guest"]');
      if (guestRadio) guestRadio.checked = true;
    }
  };
  const accountRequest = async (action, body) => {
    const response = await fetch(`/api/account/${action}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Your account request could not be completed.");
    return data;
  };
  accountTabs.forEach((button) => button.addEventListener("click", () => showAccountTab(button.dataset.accountTab)));
  document.querySelectorAll("[data-account-close]").forEach((button) => button.addEventListener("click", closeAccountDialog));
  form.querySelectorAll('input[name="accountMode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.value === "account" && radio.checked && !currentAccount) openAccountDialog("login");
    });
  });
  accountLoginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const invalid = Array.from(accountLoginForm.querySelectorAll("[required]")).find((control) => !control.checkValidity());
    if (invalid) return invalid.reportValidity();
    const button = accountLoginForm.querySelector("button[type='submit']");
    button.disabled = true;
    setStatus(accountLoginStatus, "Logging you in…", "info");
    try {
      const data = await accountRequest("login", {
        email: accountLoginForm.elements.accountEmail.value,
        password: accountLoginForm.elements.accountPassword.value
      });
      currentAccount = data.user;
      syncAccountState();
      closeAccountDialog();
    } catch (error) {
      setStatus(accountLoginStatus, error.message);
    } finally {
      button.disabled = false;
    }
  });
  accountSignupForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const invalid = Array.from(accountSignupForm.querySelectorAll("[required]")).find((control) => !control.checkValidity());
    if (invalid) return invalid.reportValidity();
    const button = accountSignupForm.querySelector("button[type='submit']");
    button.disabled = true;
    setStatus(accountSignupStatus, "Creating your account…", "info");
    try {
      const data = await accountRequest("signup", {
        fullName: accountSignupForm.elements.accountFullName.value,
        email: accountSignupForm.elements.accountEmail.value,
        phone: accountSignupForm.elements.accountPhone.value,
        password: accountSignupForm.elements.accountPassword.value
      });
      if (data.signedIn) {
        currentAccount = data.user;
        syncAccountState();
        closeAccountDialog();
      } else {
        setStatus(
          accountSignupStatus,
          "Your account was created. Check your email to verify it. You can finish this purchase as a guest now, and the booking will connect after verification.",
          "success"
        );
      }
    } catch (error) {
      setStatus(accountSignupStatus, error.message);
    } finally {
      button.disabled = false;
    }
  });
  accountLogout?.addEventListener("click", async () => {
    await accountRequest("logout", {}).catch(() => {});
    currentAccount = null;
    const guestRadio = form.querySelector('input[name="accountMode"][value="guest"]');
    if (guestRadio) guestRadio.checked = true;
    syncAccountState();
  });
  void accountRequest("session").then((data) => {
    if (accountChoice) accountChoice.hidden = !data.available;
    if (!data.available) {
      const guestRadio = form.querySelector('input[name="accountMode"][value="guest"]');
      if (guestRadio) guestRadio.checked = true;
    }
    currentAccount = data.signedIn ? data.user : null;
    syncAccountState();
  }).catch(() => syncAccountState());
  const questionControls = (question) => Array.from(
    question?.querySelectorAll("select, input:not([type='hidden'])") || []
  );
  const questionControl = (question) => questionControls(question)[0];
  const questionControlFocusTarget = (question, control) => (
    question?.querySelector(`[data-answer-for="${control?.name}"]`) || control
  );
  const questionFocusTarget = (question) => (
    question?.querySelector("[data-answer-choice].is-selected") ||
    question?.querySelector("[data-answer-choice]") ||
    questionControl(question)
  );
  const syncAnswerChoices = (question) => {
    questionControls(question).forEach((control) => {
      if (control.tagName !== "SELECT") return;
      question.querySelectorAll(`[data-answer-for="${control.name}"]`).forEach((button) => {
        const selected = button.dataset.answerChoice === control.value;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
    });
  };
  const buildAnswerChoices = () => {
    allMobileQuestions.forEach((question, questionIndex) => {
      question.querySelectorAll("select").forEach((select, selectIndex) => {
        if (question.querySelector(`[data-answer-options-for="${select.name}"]`)) return;
        const questionTitle = select.closest(".booking-condition-question")?.querySelector("h3") || question.querySelector("h2");
        if (questionTitle && !questionTitle.id) {
          questionTitle.id = `booking-question-${questionIndex + 1}-${selectIndex + 1}`;
        }
        select.classList.add("booking-answer-select");
        select.tabIndex = -1;
        select.setAttribute("aria-hidden", "true");
        const options = document.createElement("div");
        options.className = "booking-answer-options";
        options.dataset.answerOptions = "";
        options.dataset.answerOptionsFor = select.name;
        options.setAttribute("role", "group");
        if (questionTitle?.id) options.setAttribute("aria-labelledby", questionTitle.id);
        Array.from(select.options).filter((option) => option.value).forEach((option) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "booking-answer-choice";
          button.dataset.answerChoice = option.value;
          button.dataset.answerFor = select.name;
          button.setAttribute("aria-pressed", "false");
          const label = document.createElement("span");
          label.textContent = option.textContent;
          const check = document.createElement("i");
          check.setAttribute("aria-hidden", "true");
          check.textContent = "✓";
          button.append(label, check);
          button.addEventListener("click", () => {
            select.value = option.value;
            syncAnswerChoices(question);
            select.dispatchEvent(new Event("change", { bubbles: true }));
            setStatus(document.querySelector("[data-eligibility-status]"), "");
            syncStageProgress();
          });
          options.append(button);
        });
        (select.closest(".booking-condition-question") || question).append(options);
        syncAnswerChoices(question);
      });
    });
  };
  const goToStep = (step) => {
    state.step = step;
    if (wizardDialog) wizardDialog.dataset.currentStep = String(step);
    bookingWizard?.classList.toggle("is-quote-page", step === 2);
    document.querySelectorAll("[data-step]").forEach((section) => {
      section.hidden = Number(section.dataset.step) !== step;
    });
    document.querySelectorAll("[data-progress]").forEach((item) => {
      item.classList.toggle("is-active", Number(item.dataset.progress) <= step);
    });
    const stepSummary = document.querySelector("[data-step-summary]");
    if (stepSummary) stepSummary.textContent = `Step ${step} of 4`;
    syncStageProgress();
    wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
    persistBookingDraft();
  };
  const syncServiceChoice = () => {
    const selectedService = value("requestedService");
    serviceChoiceButtons.forEach((button) => {
      const selected = button.dataset.bookingService === selectedService;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (serviceChoiceMode && eligibilityButtonLabel) eligibilityButtonLabel.textContent = "Continue";
  };
  const syncPropertyTypeChoice = () => {
    const selectedType = value("propertyType");
    propertyTypeButtons.forEach((button) => {
      const selected = button.dataset.bookingPropertyType === selectedType;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  };
  const emptyUnitDetails = () => ({
    bedrooms: "",
    fullBathrooms: "",
    halfBathrooms: "",
    kitchens: "",
    livingRooms: "",
    diningRooms: "",
    hasLivingRoom: "",
    hasDiningRoom: "",
    livingDining: "",
    refrigerator: "",
    oven: "",
    cabinets: "",
    cabinetCount: "",
    drawerCount: "",
    cabinetsEmpty: "",
    additionalCleaning: "no",
    excludeKitchenItems: "",
    excludeOven: "",
    excludeRefrigerator: "",
    excludeCabinets: "",
    additionalRooms: 0,
    additionalRoomTypes: {},
    propertyHasPets: "",
    propertyPetCount: "",
    propertyPetType: "",
    propertyOtherPetType: "",
    petsSecured: "",
    previousPetBuildup: "",
    moldAreas: {},
    buildupAreas: {},
    clutterAreas: {},
    constructionAreas: {},
    moldBathrooms: "",
    moldFullBathrooms: "",
    moldHalfBathrooms: "",
    moldKitchen: "",
    moldBedrooms: "",
    moldBedroomCount: "",
    moldLivingRoom: ""
  });
  const pricingDetailQuestions = (unit, serviceKey = value("requestedService")) => {
    const isStandard = serviceKey === "standard" || serviceKey === "recurring";
    const isMove = serviceKey === "move";
    const isPostConstruction = serviceKey === "post";
    const isWholePropertyUnit = state.currentUnitIndex === selectedUnitCount() - 1;
    const affectedRoomTypes = () => [
      { value: "bedrooms", label: "Bedrooms", max: Number(unit.bedrooms) || 0 },
      { value: "fullBathrooms", label: "Full bathrooms", max: Number(unit.fullBathrooms) || 0 },
      { value: "halfBathrooms", label: "Half bathrooms", max: Number(unit.halfBathrooms) || 0 },
      { value: "kitchens", label: "Kitchens", max: Number(unit.kitchens) || 0 },
      ...(unit.livingDining === "combined" ? [{
        value: "combinedLivingDining",
        label: "Combined living & dining areas",
        max: Math.min(Number(unit.livingRooms) || 0, Number(unit.diningRooms) || 0),
        linkedValues: ["livingRooms", "diningRooms"]
      }] : [
        { value: "livingRooms", label: "Living rooms", max: Number(unit.livingRooms) || 0 },
        { value: "diningRooms", label: "Dining rooms", max: Number(unit.diningRooms) || 0 }
      ]),
      { value: "additionalRooms", label: "Additional rooms", max: Number(unit.additionalRooms) || 0 }
    ].filter((area) => area.max > 0);
    const questions = [
    { key: "bedrooms", type: "number", question: "How many bedrooms would you like cleaned?", label: "Number of bedrooms", min: 0, max: 20 },
    { key: "fullBathrooms", type: "number", question: "How many full bathrooms would you like cleaned?", label: "Number of full bathrooms", min: 0, max: 20 },
    { key: "halfBathrooms", type: "number", question: "How many half bathrooms would you like cleaned?", label: "Number of half bathrooms", min: 0, max: 20 },
    { key: "kitchens", type: "number", question: "How many kitchens would you like cleaned?", label: "Number of kitchens", min: 0, max: 20 },
    { key: "livingRooms", type: "number", question: "How many living rooms would you like cleaned?", label: "Number of living rooms", min: 0, max: 20 },
    ...(Number(unit.livingRooms) > 0 ? [{
      key: "livingDining",
      question: "Are the living and dining areas together or separate?",
      options: [
        { value: "combined", label: "Together" },
        { value: "separate", label: "Separate" }
      ]
    }] : []),
    ...(value("hazards") === "mold" && value("moldCleaningRequested") === "yes" ? [{
      key: "moldAreas",
      type: "mold-breakdown",
      question: "Which areas have possible mold or mildew present?",
      helper: "Use the + and − buttons to select every affected area in this unit. If this unit is not affected, leave every area at 0 and continue.",
      roomTypes: affectedRoomTypes()
    }] : []),
    ...(["some", "heavy"].includes(value("buildup")) ? [{
      key: "buildupAreas",
      type: "condition-breakdown",
      question: value("buildup") === "heavy"
        ? "Which areas have heavy grease, soap scum, dust, or residue?"
        : "Which areas have noticeable buildup?",
      helper: "Use the + and − buttons to select every affected area in this unit. If this unit is not affected, leave every area at 0 and continue.",
      roomTypes: affectedRoomTypes()
    }] : []),
    ...(["moderate", "several", "heavy"].includes(value("clutter")) ? [{
      key: "clutterAreas",
      type: "condition-breakdown",
      question: value("clutter") === "heavy"
        ? "Which areas have hoarding conditions or excessive clutter?"
        : value("clutter") === "several"
          ? "Which areas have limited access because of clutter?"
          : "Which areas have items that need to be worked around?",
      helper: "Use the + and − buttons to select every affected area in this unit. If this unit is not affected, leave every area at 0 and continue.",
      roomTypes: affectedRoomTypes()
    }] : []),
    ...(isPostConstruction ? [{
      key: "constructionAreas",
      type: "condition-breakdown",
      question: "Which rooms in this unit have construction dust or debris?",
      helper: "Use the + and − buttons to select every affected room in this unit. If this unit is not affected, leave every room at 0 and continue.",
      roomTypes: affectedRoomTypes()
    }] : []),
    ...([{
      key: "additionalRooms",
      type: "number",
      question: "How many additional separate rooms would you like cleaned?",
      label: "Number of additional rooms",
      helper: "Include offices, storage rooms, guest rooms, playrooms, dens, studies, and any other separate rooms.",
      min: 0,
      max: 30
    }, ...(Number(unit.additionalRooms) > 0 ? [{
      key: "additionalRoomTypes",
      type: "room-breakdown",
      question: "What types of additional rooms would you like cleaned?",
      helper: `Use the + buttons to assign all ${Number(unit.additionalRooms)} additional room${Number(unit.additionalRooms) === 1 ? "" : "s"}. Each room is priced the same as a bedroom.`,
      roomTypes: [
        { value: "office", label: "Office" },
        { value: "storage", label: "Storage room" },
        { value: "pet", label: "Pet room" },
        { value: "guest", label: "Guest room" },
        { value: "playroom", label: "Playroom" },
        { value: "denStudy", label: "Den or study" },
        { value: "other", label: "Other room" }
      ]
    }] : [])]),
    ...(Number(unit.kitchens) > 0 && !isMove ? [{
      key: "refrigerator",
      question: "Would you like the inside of the refrigerator cleaned?",
      options: [
        { value: "empty", label: "Yes — Emptied refrigerator (+$40)" },
        { value: "not-empty", label: "Yes — Not empty refrigerator (+$60)" },
        { value: "no", label: "No" }
      ]
    }, {
      key: "oven",
      question: "Would you like the inside of the oven cleaned?",
      options: [
        { value: "yes", label: "Yes (+$30)" },
        { value: "no", label: "No" }
      ]
    }, {
      key: "cabinets",
      question: "Would you like the inside of your kitchen cabinets cleaned?",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" }
      ]
    }, ...(unit.cabinets === "yes" ? [
      {
        key: "cabinetCount",
        type: "number",
        question: "Approximately how many kitchen cabinets need cleaning inside?",
        label: "Approximate cabinet count",
        helper: "Count each cabinet compartment once.",
        min: 1,
        max: 100
      },
      {
        key: "drawerCount",
        type: "number",
        question: "Approximately how many kitchen drawers need cleaning inside?",
        label: "Approximate drawer count",
        helper: "Enter 0 if there are no kitchen drawers.",
        min: 0,
        max: 100
      },
      {
        key: "cabinetsEmpty",
        question: "Will all cabinets and drawers be completely empty before we arrive?",
        options: [
          { value: "yes", label: "Yes — all cabinets and drawers will be empty" },
          { value: "no", label: "No — items will remain inside" }
        ]
      }
    ] : [])] : []),
    ...(Number(unit.kitchens) > 0 && isMove ? [{
      key: "excludeKitchenItems",
      question: "Would you like to exclude any of the included kitchen items?",
      helper: "Moving Cleaning includes inside the oven, refrigerator, and cabinets. Excluding an item reduces the kitchen price.",
      options: [
        { value: "no", label: "No — keep all three included" },
        { value: "yes", label: "Yes — choose items to exclude" }
      ]
    }, ...(unit.excludeKitchenItems === "yes" ? [{
      key: "excludeOven",
      question: "Exclude inside oven cleaning?",
      options: [
        { value: "no", label: "Keep included" },
        { value: "yes", label: "Exclude (-$30)" }
      ]
    }, {
      key: "excludeRefrigerator",
      question: "Exclude inside refrigerator cleaning?",
      options: [
        { value: "no", label: "Keep included" },
        { value: "yes", label: "Exclude (-$40)" }
      ]
    }, {
      key: "excludeCabinets",
      question: "Exclude inside cabinet cleaning?",
      options: [
        { value: "no", label: "Keep included" },
        { value: "yes", label: "Exclude (-$50)" }
      ]
    }] : [])] : []),
    ...(isWholePropertyUnit ? [{
      key: "propertyHasPets",
      question: isMove ? "Are there currently any pets at the property?" : "Are there any pets at the property?",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" }
      ]
    }, ...(unit.propertyHasPets === "yes" ? [{
      key: "propertyPetCount",
      type: "number",
      question: "How many pets are there in total at the entire property?",
      label: "Total number of pets",
      helper: "Count each pet once, even if it has access to multiple units or floors.",
      min: 1,
      max: 20
    }, {
      key: "propertyPetType",
      question: "What type of pets are they?",
      options: [
        { value: "cats", label: "Cats" },
        { value: "dogs", label: "Dogs" },
        { value: "cats-and-dogs", label: "Cats and Dogs" },
        { value: "other", label: "Other" }
      ]
    }, ...(unit.propertyPetType === "other" ? [{
      key: "propertyOtherPetType",
      type: "text",
      question: "What type of pets are at the property?",
      label: "Please specify the pet type",
      placeholder: "For example: bird, rabbit, or fish",
      maxLength: 80
    }] : []), {
      key: "petsSecured",
      question: "Will all pets be safely secured during the appointment?",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No / Not sure" }
      ]
    }] : isMove ? [{
      key: "previousPetBuildup",
      question: "Did pets previously live at the property, and is there visible pet hair, odor, litter, stains, or other pet-related buildup?",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" }
      ]
    }] : [])] : [])
    ];
    const kitchenAddonKeys = new Set([
      "refrigerator",
      "oven",
      "cabinets",
      "cabinetCount",
      "drawerCount",
      "cabinetsEmpty",
      "excludeKitchenItems",
      "excludeOven",
      "excludeRefrigerator",
      "excludeCabinets"
    ]);
    const kitchenAddons = questions.filter((question) => kitchenAddonKeys.has(question.key));
    const kitchenOrderedQuestions = questions.flatMap((question) => {
      if (kitchenAddonKeys.has(question.key)) return [];
      return question.key === "kitchens" ? [question, ...kitchenAddons] : [question];
    });
    const areaConditionKeys = new Set(["moldAreas", "buildupAreas", "clutterAreas", "constructionAreas"]);
    const areaConditionQuestions = kitchenOrderedQuestions.filter((question) => areaConditionKeys.has(question.key));
    const additionalRoomTarget = kitchenOrderedQuestions.some((question) => question.key === "additionalRoomTypes")
      ? "additionalRoomTypes"
      : "additionalRooms";
    return kitchenOrderedQuestions.flatMap((question) => {
      if (areaConditionKeys.has(question.key)) return [];
      return question.key === additionalRoomTarget ? [question, ...areaConditionQuestions] : [question];
    });
  };
  const HOME_DETAIL_KEYS = new Set([
    "bedrooms",
    "fullBathrooms",
    "halfBathrooms",
    "kitchens",
    "livingRooms",
    "diningRooms",
    "hasLivingRoom",
    "hasDiningRoom",
    "livingDining",
    "moldAreas",
    "buildupAreas",
    "clutterAreas",
    "constructionAreas",
    "additionalRooms",
    "additionalRoomTypes",
    "refrigerator",
    "oven",
    "cabinets",
    "cabinetCount",
    "drawerCount",
    "cabinetsEmpty",
    "excludeKitchenItems",
    "excludeOven",
    "excludeRefrigerator",
    "excludeCabinets"
  ]);
  const PROPERTY_PET_KEYS = new Set([
    "propertyHasPets",
    "propertyPetCount",
    "propertyPetType",
    "propertyOtherPetType",
    "petsSecured",
    "previousPetBuildup"
  ]);
  const CLEANING_STAGES = [
    { label: "Eligibility", start: 5, end: 25 },
    { label: "Service", start: 25, end: 35 },
    { label: "Home details", start: 35, end: 55 },
    { label: "Extras", start: 55, end: 70 },
    { label: "Your quote", start: 70, end: 80 },
    { label: "Appointment", start: 80, end: 93 },
    { label: "Review & book", start: 93, end: 99 }
  ];
  const isOrganizationPath = () => organizationMode || state.serviceKey === "hourly";
  const isWindowPath = () => false;
  const currentStageNumber = () => {
    const organizationPath = isOrganizationPath();
    if (quoteContactOverlay && !quoteContactOverlay.hidden) return 5;
    if (state.step === 2) return 5;
    if (state.step === 3) return 6;
    if (state.step === 4) return 7;
    if (isWindowPath() && windowMode) return 3;
    if (organizationPath) return organizationMode ? 2 : 1;
    if (quoteDetailsMode) {
      const current = state.unitDetails[state.currentUnitIndex] || emptyUnitDetails();
      const questions = pricingDetailQuestions(current, value("requestedService"));
      return HOME_DETAIL_KEYS.has(questions[state.currentDetailQuestionIndex]?.key) ? 3 : 4;
    }
    if (serviceChoiceMode || propertyTypeMode || unitCountMode) return 2;
    return 1;
  };
  const stageIsApplicable = (stageNumber) => (
    !(isOrganizationPath() && (stageNumber === 3 || stageNumber === 4))
  );
  const syncStageMenu = (stageNumber = currentStageNumber()) => {
    const quoteHasBeenDisplayed = Boolean(state.package)
      && state.step >= 2
      && (!quoteContactOverlay || quoteContactOverlay.hidden);
    const hideFutureBookingStages = !quoteHasBeenDisplayed;
    document.querySelectorAll(".booking-stage-nav").forEach((nav) => {
      nav.classList.toggle("is-quote-stage", hideFutureBookingStages);
    });
    stageMenuButtons.forEach((button) => {
      const targetStage = Number(button.dataset.stageTarget);
      const action = button.querySelector("[data-stage-action]");
      const applicable = stageIsApplicable(targetStage);
      const reached = applicable && targetStage <= state.highestStageReached;
      const current = targetStage === stageNumber;
      button.hidden = hideFutureBookingStages && targetStage >= 6;
      button.disabled = !reached;
      button.classList.toggle("is-current", current);
      button.setAttribute("aria-current", current ? "step" : "false");
      if (action) action.textContent = !applicable ? "Not needed" : current ? "Current" : reached ? "Edit" : "Not reached";
    });
  };
  let lastProgressStage = 0;
  let highestProgressInStage = 0;
  const answeredEligibilityQuestions = () => mobileQuestions().filter((question) => {
    const requiredControls = questionControls(question).filter((control) => control.required);
    return requiredControls.length && requiredControls.every((control) => Boolean(control.value));
  }).length;
  const detailStageFraction = (homeDetails) => {
    const count = selectedUnitCount();
    let total = 0;
    let completed = 0;
    for (let unitIndex = 0; unitIndex < count; unitIndex += 1) {
      const questions = pricingDetailQuestions(
        state.unitDetails[unitIndex] || emptyUnitDetails(),
        value("requestedService")
      );
      const stageQuestions = questions.filter((question) => HOME_DETAIL_KEYS.has(question.key) === homeDetails);
      total += stageQuestions.length;
      if (unitIndex < state.currentUnitIndex) {
        completed += stageQuestions.length;
      } else if (unitIndex === state.currentUnitIndex) {
        const currentKey = questions[state.currentDetailQuestionIndex]?.key;
        const localIndex = stageQuestions.findIndex((question) => question.key === currentKey);
        completed += Math.max(0, localIndex + 1);
      }
    }
    return total ? completed / total : 0;
  };
  const rawProgressPercent = (stageNumber) => {
    if (stageNumber === 1) {
      return 8 + (answeredEligibilityQuestions() / Math.max(1, mobileQuestions().length)) * 17;
    }
    if (stageNumber === 2) {
      if (organizationMode) return 30;
      if (unitCountMode) return 35;
      if (propertyTypeMode) return 32;
      return 28;
    }
    if (stageNumber === 3) return 35 + detailStageFraction(true) * 20;
    if (stageNumber === 4) return 55 + detailStageFraction(false) * 15;
    if (stageNumber === 5) return 71;
    if (stageNumber === 6) return value("schedule") ? 92 : 86;
    return 100;
  };
  const syncStageProgress = () => {
    const stages = CLEANING_STAGES;
    const stageNumber = Math.min(stages.length, Math.max(1, currentStageNumber()));
    state.highestStageReached = Math.max(
      1,
      Math.min(stages.length, Number(state.highestStageReached) || 1),
      stageNumber
    );
    const stage = stages[stageNumber - 1];
    const rawPercent = Math.min(stageNumber === 7 ? 100 : 99, Math.max(stage.start, Math.round(rawProgressPercent(stageNumber))));
    if (lastProgressStage !== stageNumber) {
      lastProgressStage = stageNumber;
      highestProgressInStage = rawPercent;
    } else {
      highestProgressInStage = Math.max(highestProgressInStage, rawPercent);
    }
    const percent = highestProgressInStage;
    document.querySelectorAll("[data-stage-progress]").forEach((progress) => {
      const progressSection = progress.closest(".booking-stage-progress");
      const label = progressSection?.querySelector("[data-stage-label]");
      const percentLabel = progressSection?.querySelector("[data-stage-percent]");
      const meter = progress.querySelector("[data-stage-meter]");
      if (label) label.textContent = `Step ${stageNumber} of ${stages.length} · ${stage.label}`;
      if (percentLabel) percentLabel.textContent = stageNumber === 7 ? "Final step" : `${percent}% complete`;
      if (meter) meter.style.width = `${percent}%`;
      progress.setAttribute("aria-valuenow", String(percent));
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuetext", stageNumber === 7
        ? `Final step. Step ${stageNumber} of ${stages.length}: ${stage.label}`
        : `${percent}% complete. Step ${stageNumber} of ${stages.length}: ${stage.label}`);
    });
    syncStageMenu(stageNumber);
  };
  const selectedUnitCount = () => Math.min(10, Math.max(1, Number(value("unitCount")) || 1));
  const syncUnitCount = () => {
    if (!value("unitCount")) {
      if (unitCountValue) unitCountValue.value = "";
      if (unitCountLabel) unitCountLabel.textContent = "units/floors";
      if (unitPreview) {
        unitPreview.replaceChildren();
        unitPreview.hidden = true;
      }
      return;
    }
    const count = selectedUnitCount();
    form.elements.unitCount.value = String(count);
    if (unitCountValue) unitCountValue.value = String(count);
    if (unitCountLabel) unitCountLabel.textContent = count === 1 ? "floor/unit" : "floors/units";
    if (unitCountDecrease) unitCountDecrease.disabled = count <= 1;
    if (unitCountIncrease) unitCountIncrease.disabled = count >= 10;
    if (unitPreview) {
      unitPreview.replaceChildren();
      if (count > 1) {
        Array.from({ length: count }, (_, index) => {
          const unit = document.createElement("span");
          unit.textContent = `Unit ${index + 1}`;
          unitPreview.append(unit);
        });
      }
      unitPreview.hidden = count <= 1;
    }
    state.unitDetails = state.unitDetails.slice(0, count);
    while (state.unitDetails.length < count) {
      state.unitDetails.push(emptyUnitDetails());
    }
    state.unitDetails.forEach((unit) => {
      unit.additionalCleaning = "no";
    });
  };
  const saveCurrentUnitDetails = () => {
    syncUnitCount();
  };
  const loadCurrentUnitDetails = () => {
    syncUnitCount();
    const current = state.unitDetails[state.currentUnitIndex] || emptyUnitDetails();
    if (current.livingRooms !== "" && current.diningRooms === "") {
      current.diningRooms = current.livingRooms;
    }
    const count = selectedUnitCount();
    const questions = pricingDetailQuestions(current);
      state.currentDetailQuestionIndex = Math.max(0, Math.min(state.currentDetailQuestionIndex, questions.length - 1));
      const question = questions[state.currentDetailQuestionIndex];
      if (unitDetailsKicker) {
        const isPropertyPetQuestion = PROPERTY_PET_KEYS.has(question.key);
        unitDetailsKicker.textContent = isPropertyPetQuestion ? "Whole Property" : `Unit ${state.currentUnitIndex + 1} of ${count}`;
        unitDetailsKicker.hidden = !isPropertyPetQuestion && count <= 1;
      }
      if (unitDetailsTitle) unitDetailsTitle.textContent = question.question;
      if (unitDetailsCopy) unitDetailsCopy.hidden = true;
      if (standardDetailHelper) {
        standardDetailHelper.hidden = !question.helper;
        standardDetailHelper.textContent = question.helper || "";
      }
      const isTypedAnswer = question.type === "number" || question.type === "text";
      const isRoomBreakdown = question.type === "room-breakdown";
      const isMoldBreakdown = question.type === "mold-breakdown";
      const isConditionBreakdown = question.type === "condition-breakdown";
      const isAffectedAreaBreakdown = isMoldBreakdown || isConditionBreakdown;
      const isCounterBreakdown = isRoomBreakdown || isAffectedAreaBreakdown;
      if (standardDetailOptions) {
        standardDetailOptions.hidden = isTypedAnswer;
        standardDetailOptions.replaceChildren();
        if (isCounterBreakdown) {
          const breakdown = current[question.key] && typeof current[question.key] === "object"
            ? current[question.key]
            : {};
          current[question.key] = breakdown;
          question.roomTypes.forEach((roomType) => {
            const linkedValues = Array.isArray(roomType.linkedValues) ? roomType.linkedValues : [roomType.value];
            const currentQuantity = () => Math.min(...linkedValues.map((key) => Number(breakdown[key]) || 0));
            const setCurrentQuantity = (amount) => linkedValues.forEach((key) => {
              breakdown[key] = amount;
            });
            const row = document.createElement("div");
            row.className = "booking-room-counter";
            const label = document.createElement("span");
            label.textContent = roomType.label;
            const controls = document.createElement("div");
            controls.className = "booking-room-counter-controls";
            const decrease = document.createElement("button");
            decrease.type = "button";
            decrease.textContent = "−";
            decrease.setAttribute("aria-label", `Remove one ${roomType.label}`);
            const quantity = document.createElement("strong");
            quantity.textContent = String(currentQuantity());
            const increase = document.createElement("button");
            increase.type = "button";
            increase.textContent = "+";
            increase.setAttribute("aria-label", `Add one ${roomType.label}`);
            const totalAssigned = () => Object.values(breakdown).reduce((total, amount) => total + (Number(amount) || 0), 0);
            decrease.disabled = !(currentQuantity() > 0);
            increase.disabled = isAffectedAreaBreakdown
              ? currentQuantity() >= roomType.max
              : totalAssigned() >= Number(current.additionalRooms);
            decrease.addEventListener("click", () => {
              setCurrentQuantity(Math.max(0, currentQuantity() - 1));
              loadCurrentUnitDetails();
            });
            increase.addEventListener("click", () => {
              const canIncrease = isAffectedAreaBreakdown
                ? currentQuantity() < roomType.max
                : totalAssigned() < Number(current.additionalRooms);
              if (canIncrease) {
                setCurrentQuantity(currentQuantity() + 1);
                loadCurrentUnitDetails();
              }
            });
            controls.append(decrease, quantity, increase);
            row.append(label, controls);
            standardDetailOptions.append(row);
          });
        }
        (isCounterBreakdown ? [] : (question.options || [])).forEach((option) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `booking-answer-choice${current[question.key] === option.value ? " is-selected" : ""}`;
          button.dataset.standardDetailAnswer = option.value;
          button.setAttribute("aria-pressed", String(current[question.key] === option.value));
          const label = document.createElement("span");
          label.textContent = option.label;
          const check = document.createElement("i");
          check.setAttribute("aria-hidden", "true");
          check.textContent = "✓";
          button.append(label, check);
          button.addEventListener("click", () => {
            const answeredUnitIndex = state.currentUnitIndex;
            current[question.key] = option.value;
            if (question.key === "cabinets" && option.value === "no") {
              current.cabinetCount = "";
              current.drawerCount = "";
              current.cabinetsEmpty = "";
            }
            if (question.key === "excludeKitchenItems" && option.value === "no") {
              current.excludeOven = "";
              current.excludeRefrigerator = "";
              current.excludeCabinets = "";
            }
            if (question.key === "propertyHasPets" && option.value === "no") {
              current.propertyPetCount = "";
              current.propertyPetType = "";
              current.propertyOtherPetType = "";
              current.petsSecured = "";
            }
            if (question.key === "propertyHasPets" && option.value === "yes") {
              current.previousPetBuildup = "";
            }
            if (question.key === "propertyPetType" && option.value !== "other") {
              current.propertyOtherPetType = "";
            }
            if (question.key === "moldBathrooms" && option.value === "no") {
              current.moldFullBathrooms = "";
              current.moldHalfBathrooms = "";
            }
            if (question.key === "moldBedrooms" && option.value === "no") {
              current.moldBedroomCount = "";
            }
            invalidateDownstreamAfterEdit();
            loadCurrentUnitDetails();
            // The whole-property pet question is the final extras question for
            // many mobile quotes. Advancing directly after the tap avoids an
            // iOS Safari redraw leaving the choice focused but uncommitted.
            if (question.key === "propertyHasPets") {
              const answeredUnit = state.unitDetails[answeredUnitIndex];
              if (answeredUnit) answeredUnit.propertyHasPets = option.value;
              window.setTimeout(() => eligibilityContinue?.click(), 0);
            }
            if (question.key === "additionalCleaning" && option.value === "yes") {
              if (additionalCleaningNotice) additionalCleaningNotice.hidden = false;
              window.setTimeout(() => additionalCleaningNoticeContinue?.focus(), 40);
            }
            setStatus(document.querySelector("[data-eligibility-status]"), "");
          });
          standardDetailOptions.append(button);
        });
      }
      if (standardDetailNumber) standardDetailNumber.hidden = !isTypedAnswer;
      if (isTypedAnswer && standardDetailNumberInput) {
        standardDetailNumberLabel.textContent = question.label;
        standardDetailNumberInput.type = question.type;
        standardDetailNumberInput.inputMode = question.type === "number" ? "numeric" : "text";
        standardDetailNumberInput.min = question.type === "number" ? String(question.min) : "";
        standardDetailNumberInput.max = question.type === "number" ? String(question.max) : "";
        standardDetailNumberInput.step = question.type === "number" ? "1" : "";
        if (question.type === "text") {
          standardDetailNumberInput.maxLength = question.maxLength;
        } else {
          standardDetailNumberInput.removeAttribute("maxlength");
        }
        standardDetailNumberInput.placeholder = question.placeholder || "";
        standardDetailNumberInput.value = current[question.key];
        standardDetailNumberInput.oninput = () => {
          current[question.key] = standardDetailNumberInput.value;
          if (question.key === "livingRooms") {
            current.diningRooms = standardDetailNumberInput.value;
          }
          if ((question.key === "livingRooms" || question.key === "diningRooms") && Number(standardDetailNumberInput.value) === 0) {
            current.livingDining = "";
          }
          if (question.key === "kitchens" && Number(standardDetailNumberInput.value) === 0) {
            current.refrigerator = "";
            current.oven = "";
            current.cabinets = "";
            current.cabinetCount = "";
            current.drawerCount = "";
            current.cabinetsEmpty = "";
            current.excludeKitchenItems = "";
            current.excludeOven = "";
            current.excludeRefrigerator = "";
            current.excludeCabinets = "";
            current.moldKitchen = "";
          }
          setStatus(document.querySelector("[data-eligibility-status]"), "");
        };
      }
      return;
  };
  const setQuestionMeta = (text, time) => {
    if (mobileQuestionCount) mobileQuestionCount.textContent = text;
    if (mobileQuestionTime) mobileQuestionTime.textContent = time;
  };
  const syncMobileQuestion = () => {
    const activeQuestions = mobileQuestions();
    mobileQuestionIndex = Math.min(mobileQuestionIndex, Math.max(0, activeQuestions.length - 1));
    syncStageProgress();
    if (eligibilityContinue) {
      eligibilityContinue.hidden = false;
      eligibilityContinue.style.display = "";
    }
    if (questionBack) {
      questionBack.className = "booking-primary booking-next";
    }
    if (organizationForm) {
      Array.from(organizationForm.querySelectorAll("input,select,textarea")).forEach((control) => {
        control.disabled = !organizationMode;
      });
    }
    if (recurringDetailsForm) {
      Array.from(recurringDetailsForm.querySelectorAll("input,select,textarea")).forEach((control) => {
        control.disabled = !recurringDetailsMode;
      });
    }
    if (windowMode) {
      allMobileQuestions.forEach((question) => {
        question.classList.remove("is-mobile-current");
        questionControls(question).forEach((control) => { control.disabled = true; });
      });
      if (organizationForm) organizationForm.hidden = true;
      if (serviceChoiceForm) serviceChoiceForm.hidden = true;
      if (recurringDetailsForm) recurringDetailsForm.hidden = true;
      if (propertyTypeForm) propertyTypeForm.hidden = true;
      if (unitCountForm) unitCountForm.hidden = true;
      if (quoteDetailsForm) quoteDetailsForm.hidden = true;
      if (windowForm) {
        windowForm.hidden = false;
        Array.from(windowForm.elements || windowForm.querySelectorAll("input,select,textarea")).forEach((control) => {
          if (!control.hasAttribute("data-window-quantity")) control.disabled = false;
        });
        windowCards.forEach((card) => {
          const checkbox = card.querySelector('input[type="checkbox"]');
          const quantity = card.querySelector("[data-window-quantity]");
          if (quantity) quantity.disabled = !checkbox?.checked;
        });
      }
      if (mobileQuestionNav) mobileQuestionNav.hidden = false;
      setQuestionMeta("Window details · Next: Your quote", "About 3 min left");
      if (eligibilityButtonLabel) eligibilityButtonLabel.textContent = "See my instant price";
      return;
    }
    if (windowForm) {
      windowForm.hidden = true;
      Array.from(windowForm.querySelectorAll("input,select,textarea")).forEach((control) => { control.disabled = true; });
    }
    allMobileQuestions.forEach((question) => {
      questionControls(question).forEach((control) => { control.disabled = false; });
    });
    if (organizationMode) {
      allMobileQuestions.forEach((question) => question.classList.remove("is-mobile-current"));
      if (serviceChoiceForm) serviceChoiceForm.hidden = true;
      if (recurringDetailsForm) recurringDetailsForm.hidden = true;
      if (propertyTypeForm) propertyTypeForm.hidden = true;
      if (unitCountForm) unitCountForm.hidden = true;
      if (quoteDetailsForm) quoteDetailsForm.hidden = true;
      if (organizationForm) organizationForm.hidden = false;
      if (mobileQuestionNav) mobileQuestionNav.hidden = false;
      setQuestionMeta("Hourly cleaning details · Next: Your quote", "About 1 min left");
      if (eligibilityButtonLabel) eligibilityButtonLabel.textContent = "See my price";
      return;
    }
    if (recurringDetailsMode) {
      allMobileQuestions.forEach((question) => question.classList.remove("is-mobile-current"));
      if (organizationForm) organizationForm.hidden = true;
      if (serviceChoiceForm) serviceChoiceForm.hidden = true;
      if (propertyTypeForm) propertyTypeForm.hidden = true;
      if (unitCountForm) unitCountForm.hidden = true;
      if (quoteDetailsForm) quoteDetailsForm.hidden = true;
      if (recurringDetailsForm) recurringDetailsForm.hidden = false;
      if (mobileQuestionNav) mobileQuestionNav.hidden = false;
      setQuestionMeta("Recurring cleaning verification · Next: Home details", "About 4 min left");
      if (eligibilityButtonLabel) eligibilityButtonLabel.textContent = "Continue";
      return;
    }
    if (quoteDetailsMode) {
      allMobileQuestions.forEach((question) => question.classList.remove("is-mobile-current"));
      if (organizationForm) organizationForm.hidden = true;
      if (recurringDetailsForm) recurringDetailsForm.hidden = true;
      if (serviceChoiceForm) serviceChoiceForm.hidden = true;
      if (propertyTypeForm) propertyTypeForm.hidden = true;
      if (unitCountForm) unitCountForm.hidden = true;
      if (quoteDetailsForm) quoteDetailsForm.hidden = false;
      loadCurrentUnitDetails();
      if (mobileQuestionNav) mobileQuestionNav.hidden = false;
      const count = selectedUnitCount();
      const detailQuestions = pricingDetailQuestions(
        state.unitDetails[state.currentUnitIndex] || emptyUnitDetails(),
        value("requestedService")
      );
      const currentDetail = detailQuestions[state.currentDetailQuestionIndex];
      const inHomeDetails = HOME_DETAIL_KEYS.has(currentDetail?.key);
      if (questionBack && inHomeDetails) questionBack.className = "booking-secondary";
      const stageKeys = HOME_DETAIL_KEYS.has(currentDetail?.key)
        ? detailQuestions.filter((question) => HOME_DETAIL_KEYS.has(question.key))
        : detailQuestions.filter((question) => !HOME_DETAIL_KEYS.has(question.key));
      const localQuestionIndex = Math.max(0, stageKeys.findIndex((question) => question.key === currentDetail?.key));
      const stageName = HOME_DETAIL_KEYS.has(currentDetail?.key) ? "Home details" : "Extras";
      const unitPrefix = count > 1 ? `Unit ${state.currentUnitIndex + 1} of ${count} · ` : "";
      const nextStage = stageName === "Home details" ? "Extras" : "Your quote";
      setQuestionMeta(
        `${unitPrefix}Question ${localQuestionIndex + 1} of ${stageKeys.length} · Next: ${nextStage}`,
        stageName === "Home details" ? "About 3 min left" : "About 2 min left"
      );
      if (eligibilityButtonLabel) {
        const isLastQuestion = state.currentDetailQuestionIndex >= detailQuestions.length - 1;
        eligibilityButtonLabel.textContent = !isLastQuestion
          ? "Continue"
          : state.currentUnitIndex < count - 1 ? "Next unit" : "See my instant price";
      }
      return;
    }
    if (unitCountMode) {
      allMobileQuestions.forEach((question) => question.classList.remove("is-mobile-current"));
      if (organizationForm) organizationForm.hidden = true;
      if (recurringDetailsForm) recurringDetailsForm.hidden = true;
      if (serviceChoiceForm) serviceChoiceForm.hidden = true;
      if (propertyTypeForm) propertyTypeForm.hidden = true;
      if (quoteDetailsForm) quoteDetailsForm.hidden = true;
      if (unitCountForm) unitCountForm.hidden = false;
      syncUnitCount();
      if (mobileQuestionNav) mobileQuestionNav.hidden = false;
      setQuestionMeta("Question 3 of 3 · Next: Home details", "About 4 min left");
      if (eligibilityButtonLabel) eligibilityButtonLabel.textContent = "Continue";
      return;
    }
    if (propertyTypeMode) {
      allMobileQuestions.forEach((question) => question.classList.remove("is-mobile-current"));
      if (organizationForm) organizationForm.hidden = true;
      if (recurringDetailsForm) recurringDetailsForm.hidden = true;
      if (serviceChoiceForm) serviceChoiceForm.hidden = true;
      if (unitCountForm) unitCountForm.hidden = true;
      if (quoteDetailsForm) quoteDetailsForm.hidden = true;
      if (propertyTypeForm) propertyTypeForm.hidden = false;
      syncPropertyTypeChoice();
      if (mobileQuestionNav) mobileQuestionNav.hidden = false;
      setQuestionMeta("Question 2 of 3 · Next: Home details", "About 4 min left");
      if (eligibilityButtonLabel) eligibilityButtonLabel.textContent = "Continue";
      return;
    }
    if (serviceChoiceMode) {
      allMobileQuestions.forEach((question) => question.classList.remove("is-mobile-current"));
      if (organizationForm) organizationForm.hidden = true;
      if (propertyTypeForm) propertyTypeForm.hidden = true;
      if (unitCountForm) unitCountForm.hidden = true;
      if (quoteDetailsForm) quoteDetailsForm.hidden = true;
      if (serviceChoiceForm) serviceChoiceForm.hidden = false;
      syncServiceChoice();
      if (mobileQuestionNav) mobileQuestionNav.hidden = false;
      setQuestionMeta("Question 1 of 3 · Next: Home details", "About 4 min left");
      if (eligibilityButtonLabel) eligibilityButtonLabel.textContent = "Continue";
      return;
    }
    if (organizationForm) organizationForm.hidden = true;
    if (recurringDetailsForm) recurringDetailsForm.hidden = true;
    if (serviceChoiceForm) serviceChoiceForm.hidden = true;
    if (propertyTypeForm) propertyTypeForm.hidden = true;
    if (unitCountForm) unitCountForm.hidden = true;
    if (quoteDetailsForm) quoteDetailsForm.hidden = true;
    allMobileQuestions.forEach((question) => {
      const activeIndex = activeQuestions.indexOf(question);
      const isActive = activeIndex !== -1;
      question.classList.toggle("is-mobile-current", isActive && activeIndex === mobileQuestionIndex);
      if (
        question.hasAttribute("data-occupied-service-question") ||
        question.hasAttribute("data-large-property-question") ||
        question.hasAttribute("data-mold-cleaning-question")
      ) {
        questionControls(question).forEach((control) => {
          control.disabled = !isActive;
        });
      }
      syncAnswerChoices(question);
    });
    if (mobileQuestionNav) mobileQuestionNav.hidden = false;
    setQuestionMeta(
      `Question ${mobileQuestionIndex + 1} of ${activeQuestions.length} · Next: Service`,
      "About 5 min left"
    );
    if (eligibilityButtonLabel) {
      eligibilityButtonLabel.textContent = "Continue";
    }
  };
  const eligibilityFromForm = () => ({
    propertyStatus: value("propertyStatus"),
    lastCleaned: value("lastCleaned"),
    condition: value("condition"),
    requestedService: value("requestedService"),
    movingDirection: value("movingDirection"),
    constructionFinished: value("constructionFinished"),
    contractorItemsRemoved: value("contractorItemsRemoved"),
    serviceIntent: value("serviceIntent"),
    cleaningCategory: value("cleaningCategory"),
    propertyOver2000: "",
    squareFootage: "",
    waterDamage: value("waterDamage"),
    recentRenovation: "",
    excessiveBelongings: value("excessiveBelongings"),
    utilitiesAvailable: value("utilitiesAvailable"),
    unsafeConditions: value("unsafeConditions"),
    clutter: value("clutter"),
    buildup: value("buildup"),
    hazards: value("hazards"),
    moldCleaningRequested: value("moldCleaningRequested"),
    propertyType: value("propertyType"),
    unitCount: selectedUnitCount(),
    units: state.unitDetails.map((unit, index) => ({
      unitNumber: index + 1,
      ...unit
    })),
    serviceZip: value("zip")
  });
  const qualificationReasonFromAnswers = (answers) => {
    if (answers.cleaningCategory === "commercial") return "commercial_service";
    if (answers.waterDamage === "yes") return "water_damage";
    if (answers.recentRenovation === "yes") return "post_construction";
    if (answers.excessiveBelongings && answers.excessiveBelongings !== "no") return "excessive_belongings";
    if (answers.utilitiesAvailable === "no") return "utilities_unavailable";
    if (answers.unsafeConditions === "yes") return "ineligible_unsafe_conditions";
    if (answers.clutter === "unsafe") return "ineligible_clutter_access";
    if (["pests", "waste"].includes(answers.hazards)) return "ineligible_safety";
    return "";
  };
  const recommend = (answers) => {
    const qualificationReason = qualificationReasonFromAnswers(answers);
    if (qualificationReason) {
      const redirect = qualificationRedirects[qualificationReason];
      return {
        type: redirect.ineligible ? "ineligible" : "review",
        internalReason: qualificationReason,
        reason: redirect.description,
        service: redirect.service || ""
      };
    }
    if (answers.condition === "severe") return { type: "review", reason: "The reported property condition requires a custom quote so we can review the scope accurately." };
    if (answers.propertyStatus === "renovated") return { type: "instant", serviceKey: "post", reason: "Because the property was recently renovated or constructed, we recommend Post-Construction Cleaning." };
    if (answers.propertyStatus === "moving") return { type: "instant", serviceKey: "move", reason: "Because the property is vacant for a move, we recommend Move-In / Move-Out Cleaning." };
    if (["heavy", "average"].includes(answers.condition) || ["three_to_six_months", "over_six_months", "never"].includes(answers.lastCleaned)) {
      return { type: "instant", serviceKey: "deep", reason: "Based on the cleaning history or buildup, Deep Cleaning is the appropriate starting service." };
    }
    if (answers.requestedService === "deep") {
      return { type: "instant", serviceKey: "deep", reason: "You selected Deep Cleaning for a more thorough top-to-bottom service." };
    }
    if (answers.requestedService === "standard") {
      return { type: "instant", serviceKey: "standard", reason: "You selected Standard Cleaning, and the property condition appears eligible for it." };
    }
    if (answers.requestedService === "recurring") {
      return { type: "instant", serviceKey: "recurring", reason: "You selected Recurring Cleaning Service, and the property condition appears eligible for it." };
    }
    return { type: "instant", serviceKey: "standard", reason: "The property appears regularly maintained and eligible for Standard Cleaning." };
  };
  const quoteUrlFor = (recommendation, answers) => {
    const params = new URLSearchParams({
      category: recommendation.category || "residential",
      source: "package-check",
      reason: recommendation.reason
    });
    if (recommendation.internalReason) {
      params.set("qualification_reason", recommendation.internalReason);
    }
    const selectedService = recommendation.service || (
      answers.recentRenovation === "yes" ? "post-construction" :
      answers.propertyStatus === "moving" ? "move-in-move-out" :
      answers.requestedService === "deep" ? "deep-cleaning" :
      ["standard", "recurring"].includes(answers.requestedService) ? "standard-cleaning" : ""
    );
    if (selectedService) params.set("service", selectedService);
    const preservedAnswers = {
      propertyStatus: answers.propertyStatus,
      requestedService: answers.requestedService,
      serviceIntent: answers.serviceIntent,
      cleaningCategory: answers.cleaningCategory,
      propertyOver2000: answers.propertyOver2000,
      squareFootage: answers.squareFootage,
      waterDamage: answers.waterDamage,
      recentRenovation: answers.recentRenovation,
      excessiveBelongings: answers.excessiveBelongings,
      utilitiesAvailable: answers.utilitiesAvailable,
      unsafeConditions: answers.unsafeConditions,
      clutter: answers.clutter,
      buildup: answers.buildup,
      hazards: answers.hazards,
      moldCleaningRequested: answers.moldCleaningRequested,
      propertyType: answers.propertyType,
      unitCount: answers.unitCount,
      serviceZip: answers.serviceZip
    };
    Object.entries(preservedAnswers).forEach(([key, answer]) => {
      if (answer !== "" && answer !== 0 && answer !== undefined && answer !== null) {
        params.set(`booking_${key}`, String(answer));
      }
    });
    if (Array.isArray(answers.units) && answers.units.length) {
      params.set("booking_units", JSON.stringify(answers.units));
    }
    if (answers.clutter && answers.clutter !== "low") params.set("clutter", answers.clutter);
    if (answers.buildup === "heavy") params.set("buildup", "heavy");
    if (answers.hazards && answers.hazards !== "none") params.set("hazard", answers.hazards);
    return `./contact.html?${params.toString()}`;
  };
  const walkthroughUrlFor = (answers) => {
    const params = new URLSearchParams({ source: "instant-quote" });
    const serviceZip = serviceArea.normalize(answers.serviceZip || "");
    if (serviceZip) params.set("zip", serviceZip);
    return `./walkthrough.html?${params.toString()}`;
  };
  const showQualificationRedirect = (internalReason) => {
    const redirect = qualificationRedirects[internalReason];
    if (!redirect) return;
    const answers = eligibilityFromForm();
    state.eligibility = answers;
    pendingQualificationUrl = redirect.ineligible
      ? ""
      : internalReason === "commercial_service"
        ? walkthroughUrlFor(answers)
        : quoteUrlFor({
          type: "review",
          internalReason,
          reason: redirect.description,
          service: redirect.service || "",
          category: redirect.category || "residential"
        }, answers);
    if (qualificationRedirectTitle) qualificationRedirectTitle.textContent = redirect.ineligible
      ? redirect.title
      : "Contact us for assistance";
    if (qualificationRedirectReason) qualificationRedirectReason.textContent = redirect.description;
    if (qualificationRedirectBack) qualificationRedirectBack.textContent = redirect.backLabel || "Review my answer";
    if (qualificationRedirectContinue) {
      qualificationRedirectContinue.hidden = Boolean(redirect.ineligible);
      qualificationRedirectContinue.textContent = `${redirect.buttonLabel || "Contact Us"} →`;
    }
    if (commercialCallLink) commercialCallLink.hidden = internalReason !== "commercial_service";
    persistBookingDraft();
    if (qualificationRedirectOverlay) qualificationRedirectOverlay.hidden = false;
    window.setTimeout(() => qualificationRedirectContinue?.focus(), 40);
  };
  const showQualificationComplete = () => {
    if (!qualificationCompleteOverlay) return;
    window.clearTimeout(qualificationCompleteTimer);
    qualificationCompleteOverlay.hidden = false;
    window.setTimeout(() => qualificationCompleteOverlay.querySelector(".booking-complete-dialog")?.focus(), 40);
    qualificationCompleteTimer = window.setTimeout(() => {
      qualificationCompleteTimer = 0;
      if (value("requestedService")) enterPropertyTypeChoice();
      else enterServiceChoice();
    }, 3000);
  };
  const showQuoteContact = () => {
    if (!quoteContactOverlay) return;
    quoteContactOverlay.hidden = false;
    syncStageProgress();
    setStatus(quoteContactStatus, "");
    window.setTimeout(() => {
      quoteContactForm?.elements.quoteFirstName?.focus();
    }, 40);
  };
  const enterOrganizationDetails = () => {
    windowMode = false;
    organizationMode = true;
    serviceChoiceMode = false;
    recurringDetailsMode = false;
    propertyTypeMode = false;
    unitCountMode = false;
    quoteDetailsMode = false;
    if (hourlyDetailsTitle) {
      hourlyDetailsTitle.textContent = "How many work-hours do you need to hire us for?";
    }
    if (hourlyDetailsHelp) {
      hourlyDetailsHelp.innerHTML = "<strong>4-work-hour minimum.</strong> Your total price will be shown before booking.";
    }
    syncMobileQuestion();
    wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => organizationHoursInput?.focus(), 40);
  };
  const enterServiceChoice = () => {
    windowMode = false;
    organizationMode = false;
    serviceChoiceMode = true;
    recurringDetailsMode = false;
    propertyTypeMode = false;
    unitCountMode = false;
    quoteDetailsMode = false;
    closeQualificationComplete();
    syncMobileQuestion();
    wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => {
      const selected = serviceChoiceButtons.find((button) => button.classList.contains("is-selected"));
      (selected || serviceChoiceButtons[0])?.focus();
    }, 40);
  };
  const enterRecurringDetails = () => {
    windowMode = false;
    organizationMode = false;
    serviceChoiceMode = false;
    recurringDetailsMode = true;
    propertyTypeMode = false;
    unitCountMode = false;
    quoteDetailsMode = false;
    syncMobileQuestion();
    wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => recurringOrderNumberInput?.focus(), 40);
  };
  const enterPropertyTypeChoice = () => {
    windowMode = false;
    organizationMode = false;
    serviceChoiceMode = false;
    recurringDetailsMode = false;
    propertyTypeMode = true;
    unitCountMode = false;
    quoteDetailsMode = false;
    closeQualificationComplete();
    syncMobileQuestion();
    wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => {
      const selected = propertyTypeButtons.find((button) => button.classList.contains("is-selected"));
      (selected || propertyTypeButtons[0])?.focus();
    }, 40);
  };
  const enterUnitCountChoice = () => {
    windowMode = false;
    organizationMode = false;
    serviceChoiceMode = false;
    propertyTypeMode = false;
    unitCountMode = true;
    quoteDetailsMode = false;
    syncMobileQuestion();
    wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => unitCountIncrease?.focus(), 40);
  };
  const enterQuoteDetailsAtStage = (homeDetails = true) => {
    windowMode = false;
    organizationMode = false;
    serviceChoiceMode = false;
    propertyTypeMode = false;
    unitCountMode = false;
    quoteDetailsMode = true;
    state.currentUnitIndex = 0;
    syncUnitCount();
    const questions = pricingDetailQuestions(
      state.unitDetails[0] || emptyUnitDetails(),
      value("requestedService")
    );
    const firstQuestionIndex = questions.findIndex((question) => HOME_DETAIL_KEYS.has(question.key) === homeDetails);
    state.currentDetailQuestionIndex = Math.max(0, firstQuestionIndex);
    closeQualificationComplete();
    syncMobileQuestion();
    wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => {
      standardDetailOptions?.querySelector("button")?.focus();
      if (!standardDetailOptions?.querySelector("button")) standardDetailNumberInput?.focus();
    }, 40);
  };
  const enterQuoteDetails = () => enterQuoteDetailsAtStage(true);
  const enterWindowDetails = () => {
    organizationMode = false;
    serviceChoiceMode = false;
    propertyTypeMode = false;
    unitCountMode = false;
    quoteDetailsMode = false;
    windowMode = true;
    form.elements.requestedService.value = "window";
    form.elements.propertyStatus.value = "window";
    syncMobileQuestion();
    wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => form.elements.windowPropertyType?.focus(), 40);
  };
  const navigateToStage = (targetStage) => {
    const stageNumber = Number(targetStage);
    if (!stageIsApplicable(stageNumber) || stageNumber > state.highestStageReached) return;
    closeQualificationRedirect();
    closeQualificationComplete();
    closeAdditionalCleaningNotice();
    closeQuoteContact();
    closeAccountDialog();

    if (stageNumber === 1) {
      goToStep(1);
      organizationMode = false;
      serviceChoiceMode = false;
      propertyTypeMode = false;
      unitCountMode = false;
      quoteDetailsMode = false;
      mobileQuestionIndex = 0;
      syncMobileQuestion();
      window.setTimeout(() => questionFocusTarget(mobileQuestions()[0])?.focus(), 40);
      return;
    }
    if (stageNumber === 2) {
      goToStep(1);
      if (isWindowPath()) enterWindowDetails();
      else if (isOrganizationPath()) enterOrganizationDetails();
      else enterServiceChoice();
      return;
    }
    if (stageNumber === 3 || stageNumber === 4) {
      goToStep(1);
      if (isWindowPath()) enterWindowDetails();
      else enterQuoteDetailsAtStage(stageNumber === 3);
      return;
    }
    if (stageNumber === 5) {
      if (state.package) {
        goToStep(2);
        window.setTimeout(() => document.querySelector('[data-step="2"] h2')?.focus(), 40);
      } else {
        goToStep(1);
        showQuoteContact();
      }
      return;
    }
    if (stageNumber === 6) {
      goToStep(3);
      renderCalendar();
      renderTimeSlots();
      window.setTimeout(() => calendarGrid?.querySelector("button.is-available")?.focus(), 40);
      return;
    }
    if (stageNumber === 7) {
      if (value("schedule")) syncCheckoutReview();
      goToStep(4);
      window.setTimeout(() => form.elements.address?.focus(), 40);
    }
  };
  stageMenuButtons.forEach((button) => {
    button.addEventListener("click", () => navigateToStage(button.dataset.stageTarget));
  });
  const exitQuoteDetails = () => {
    quoteDetailsMode = false;
    enterUnitCountChoice();
  };
  const exitUnitCountChoice = () => {
    unitCountMode = false;
    enterPropertyTypeChoice();
  };
  const exitPropertyTypeChoice = () => {
    propertyTypeMode = false;
    if (value("requestedService") === "recurring") enterRecurringDetails();
    else enterServiceChoice();
  };
  const exitServiceChoice = () => {
    windowMode = false;
    organizationMode = false;
    serviceChoiceMode = false;
    recurringDetailsMode = false;
    propertyTypeMode = false;
    unitCountMode = false;
    mobileQuestionIndex = 0;
    syncMobileQuestion();
    window.setTimeout(() => questionFocusTarget(mobileQuestions()[mobileQuestionIndex])?.focus(), 40);
  };
  const money = (amount) => new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number(amount) % 1 ? 2 : 0,
    maximumFractionDigits: 2
  }).format(amount);
  const bookingDeposit = (amount) => Math.round(Number(amount || 0) * 25) / 100;
  const hours = (amount) => Number(amount).toLocaleString("en-US", { maximumFractionDigits: 3 });
  const teamTime = (amount) => {
    const totalMinutes = Math.round(Number(amount) * 60);
    const wholeHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const hourLabel = wholeHours === 1 ? "hour" : "hours";
    if (!minutes) return `${wholeHours} ${hourLabel}`;
    if (!wholeHours) return `${minutes} minutes`;
    return `${wholeHours} ${hourLabel} ${minutes} minutes`;
  };
  const compactTeamTime = (amount) => {
    const totalMinutes = Math.round(Number(amount) * 60);
    const wholeHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (minutes === 30) return `${wholeHours || ""}½ ${wholeHours ? "hours" : "hour"}`.trim();
    return teamTime(amount);
  };
  const staffingSummary = (pkg, { compact = false } = {}) => {
    const laborHours = Number(pkg?.manHours || 0);
    const formatTime = compact ? compactTeamTime : teamTime;
    if (laborHours > 6) {
      return `2 team members for up to ${formatTime(laborHours / 2)}`;
    }
    if (laborHours > 0) {
      return `1 team member for up to ${formatTime(laborHours)}, or 2 team members for up to ${formatTime(laborHours / 2)}`;
    }
    return `${pkg?.cleanerCount || 2} cleaners${compact ? " · Up to" : " for up to"} ${formatTime(pkg?.teamHours || 0)}`;
  };
  const availabilityRequest = async () => {
    if (/_formula$/.test(state.pricingMode)) {
      return fetch("/api/booking/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricingMode: state.pricingMode,
          serviceKey: state.serviceKey,
          unitDetails: state.unitDetails,
          eligibility: state.eligibility,
          serviceZip: value("zip")
        })
      });
    }
    return fetch(`/api/booking/availability?packageIds=${encodeURIComponent(state.packageIds.join(","))}`);
  };
  const showSavedQuoteDelivery = (message, type = "info", quoteUrl = "") => {
    if (!savedQuoteStatus) return;
    savedQuoteStatus.hidden = false;
    savedQuoteStatus.dataset.type = type;
    savedQuoteStatus.replaceChildren(document.createTextNode(message));
    if (quoteUrl) {
      savedQuoteStatus.append(
        document.createTextNode(" "),
        Object.assign(document.createElement("a"), {
          href: quoteUrl,
          textContent: "Open my saved quote"
        })
      );
    }
  };
  const sendSavedQuote = async () => {
    const wantsQuoteText = Boolean(quoteContactForm?.elements.quoteCommunicationConsent?.checked);
    const wantsMarketingTexts = Boolean(quoteContactForm?.elements.smsMarketingConsent?.checked);
    showSavedQuoteDelivery(`Your price is ready. Sending your secure quote link by email${wantsQuoteText ? " and text" : ""}…`);
    try {
      const response = await fetch("/api/booking/saved-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricingMode: state.pricingMode,
          eligibility: state.eligibility,
          unitDetails: state.unitDetails,
          promoCode: state.promo?.code || "FALL10",
          customer: {
            firstName: value("firstName"),
            lastName: value("lastName"),
            email: value("email"),
            phone: value("phone")
          },
          smsConsent: wantsQuoteText,
          smsMarketingConsent: wantsMarketingTexts,
          website: quoteContactForm?.elements.website?.value || ""
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Your secure quote link could not be sent.");
      state.savedQuoteUrl = data.quoteUrl || state.savedQuoteUrl;
      state.quoteRevision = '';
      const emailSent = ["sent", "already_sent"].includes(data.delivery?.email);
      const smsSent = ["sent", "already_sent"].includes(data.delivery?.sms);
      if (emailSent && smsSent) {
        showSavedQuoteDelivery("Your secure quote link was sent to your email and phone.", "success");
      } else if (emailSent && data.delivery?.sms === "not_requested") {
        showSavedQuoteDelivery("Your secure quote link was sent to your email.", "success");
      } else if (emailSent || smsSent) {
        showSavedQuoteDelivery(
          `Your secure quote link was sent by ${emailSent ? "email" : "text"}. You can also save it here:`,
          "info",
          data.quoteUrl
        );
      } else {
        showSavedQuoteDelivery(
          "Your price is ready, but the message could not be delivered. Save this secure link:",
          "error",
          data.quoteUrl
        );
      }
      return state.savedQuoteUrl;
    } catch (error) {
      showSavedQuoteDelivery(error.message || "Your price is ready, but the secure quote link could not be sent.", "error");
      return "";
    }
  };
  const openSameDayDialog = () => {
    if (!sameDayDialog || !sameDayForm) return;
    sameDayDialog.hidden = false;
    sameDaySubmit.hidden = false;
    sameDaySubmit.textContent = "Send same-day request →";
    setStatus(sameDayStatus, "");
    window.setTimeout(() => sameDayForm.elements.serviceAddress?.focus(), 0);
  };
  closeSameDayDialog = () => {
    if (!sameDayDialog) return;
    sameDayDialog.hidden = true;
  };
  document.querySelectorAll("[data-open-same-day]").forEach((button) => {
    button.addEventListener("click", openSameDayDialog);
  });
  document.querySelectorAll("[data-close-same-day]").forEach((button) => {
    button.addEventListener("click", closeSameDayDialog);
  });
  sameDayForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const invalid = Array.from(sameDayForm.querySelectorAll("[required]")).find((control) => !control.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return;
    }
    sameDaySubmit.disabled = true;
    sameDaySubmit.textContent = "Sending request…";
    setStatus(sameDayStatus, "Saving your quote and notifying our team…", "info");
    try {
      const savedQuoteUrl = state.savedQuoteUrl || await sendSavedQuote();
      if (!savedQuoteUrl) throw new Error("We could not save your quote. Please try again.");
      const response = await fetch("/api/booking/same-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricingMode: state.pricingMode,
          eligibility: state.eligibility,
          unitDetails: state.unitDetails,
          customer: {
            firstName: value("firstName"),
            lastName: value("lastName"),
            email: value("email"),
            phone: value("phone")
          },
          serviceAddress: sameDayForm.elements.serviceAddress.value,
          preferredTime: sameDayForm.elements.preferredTime.value,
          flexibility: sameDayForm.elements.flexibility.value,
          notes: sameDayForm.elements.requestNotes.value,
          rushFeeAccepted: sameDayForm.elements.rushFeeAccepted.checked,
          savedQuoteUrl,
          quoteRevision: state.quoteRevision || ''
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Your same-day request could not be sent.");
      sameDayForm.reset();
      setStatus(sameDayStatus, "Request received. Our team has been notified and will contact you as soon as possible.", "success");
      sameDaySubmit.hidden = true;
    } catch (error) {
      setStatus(sameDayStatus, error.message || "Your same-day request could not be sent.", "error");
    } finally {
      sameDaySubmit.disabled = false;
      if (!sameDaySubmit.hidden) sameDaySubmit.textContent = "Send same-day request →";
    }
  });
  const syncQuotedServiceCopy = () => {
    const isHourly = state.serviceKey === "hourly";
    const isTimeBased = isHourly;
    const isWindow = state.serviceKey === "window";
    const priceNotice = document.querySelector("[data-price-notice]");
    if (priceNotice) priceNotice.hidden = isTimeBased || isWindow;
    const completionCopy = document.querySelector("[data-completion-agreement-copy]");
    if (completionCopy) {
      completionCopy.textContent = isTimeBased
        ? `I understand that this booking includes ${hours(state.package?.manHours || 0)} total labor-hours. ${staffingSummary(state.package)}.`
        : "I understand that this estimate provides a maximum number of labor-hours and is based on the information I provided. The service may be completed sooner.";
    }
    document.querySelectorAll("[data-cleaning-schedule-details]").forEach((element) => {
      element.hidden = isTimeBased || isWindow;
    });
  };
  const renderQuoteOverview = (pkg) => {
    const serviceLabel = serviceNames[state.serviceKey] || pkg.serviceLabel;
    const deposit = bookingDeposit(pkg.price);
    const balance = Math.round((Number(pkg.price || 0) - deposit) * 100) / 100;
    document.querySelector("[data-recommendation-title]").textContent = `Your ${serviceLabel} Estimate`;
    document.querySelector("[data-package-price]").textContent = money(pkg.price);
    document.querySelector("[data-mobile-package-price]").textContent = money(deposit);
    document.querySelector("[data-man-hours]").textContent = `${hours(pkg.manHours)} labor-hours maximum`;
    document.querySelector("[data-quote-deposit]").textContent = money(deposit);
    document.querySelector("[data-quote-balance]").textContent = money(balance);
    document.querySelector("[data-team-time-summary]").textContent = staffingSummary(pkg);
    document.querySelector("[data-total-due]").textContent = money(deposit);
    document.querySelector("[data-checkout-total]").textContent = money(pkg.price);
    document.querySelector("[data-checkout-balance]").textContent = money(balance);
    const finalLaborHours = document.querySelector("[data-final-labor-hours]");
    if (finalLaborHours) finalLaborHours.textContent = hours(pkg.manHours);
    document.querySelector("[data-pay-button]").textContent = `Pay ${money(deposit)} & confirm booking`;
    resetAgreementReview();
  };
  const calculateAndShowQuote = async ({ sendLink = true } = {}) => {
    const status = document.querySelector("[data-eligibility-status]");
    setStatus(status, "Calculating your itemized price…", "info");
    const response = await availabilityRequest();
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The package could not be loaded.");
    state.package = data.package;
    state.promo = null;
    state.packageBeforePromo = null;
    state.initialSlots = data.slots || [];
    renderQuoteOverview(state.package);
    syncQuotedServiceCopy();
    renderPriceBreakdown(state.package);
    closeQuoteContact();
    setStatus(status, "");
    goToStep(2);
    if (sendLink) void sendSavedQuote();
    return state.package;
  };
  const localDate = (dateString) => {
    const [year, month, day] = String(dateString || "").split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  };
  const monthKeyForDate = (dateString) => String(dateString || "").slice(0, 7);
  const longDate = (dateString) => new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(localDate(dateString));
  const calendarDateLabel = (dateString, count) => {
    const date = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(localDate(dateString));
    return `${date}, ${count} available ${count === 1 ? "time" : "times"}`;
  };
  const displayTime = (timeString) => {
    const [hourValue, minute = "00"] = String(timeString || "").split(":");
    const hour = Number(hourValue);
    const suffix = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minute} ${suffix}`;
  };
  const slotsForDate = (dateString) => state.availableSlots.filter((slot) => slot.date === dateString);
  const ARRIVAL_OPTIONS = [
    { key: "any_day", title: "Anytime that day", detail: "Estimated arrival 8:00 AM–4:00 PM", percent: 5, start: "08:00", end: "16:00", flexible: true },
    { key: "morning", title: "Morning", detail: "Estimated arrival 8:00 AM–12:00 PM", percent: 2, start: "08:00", end: "12:00", flexible: true },
    { key: "afternoon", title: "Afternoon", detail: "Estimated arrival 12:00 PM–4:00 PM", percent: 2, start: "12:00", end: "16:00", flexible: true },
    { key: "exact", title: "Choose an exact arrival time", detail: "Select a specific available time", percent: 0, start: "08:00", end: "20:30", flexible: false }
  ];
  const arrivalOption = (key) => ARRIVAL_OPTIONS.find((option) => option.key === key) || null;
  const timeMinutes = (time) => {
    const [hour, minute] = String(time || "").split(":").map(Number);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : NaN;
  };
  const slotsForArrivalOption = (option) => slotsForDate(state.selectedDate).filter((slot) => {
    if (slot.flexibleEligible !== true) return false;
    if (!option?.flexible) return true;
    const value = timeMinutes(slot.time);
    return value >= timeMinutes(option.start)
      && value <= timeMinutes(option.end);
  });
  const hasExtendedLabor = () => Number(state.package?.manHours || 0) > 8;
  const visibleArrivalOptions = () => hasExtendedLabor()
    ? ARRIVAL_OPTIONS.filter((option) => option.key === "any_day" || option.key === "exact")
    : ARRIVAL_OPTIONS;
  const arrivalWindowText = (option) => {
    if (!option?.flexible) return option?.detail || "";
    const serviceHours = Number(state.package?.teamHours);
    const reservedMinutes = (serviceHours + 1) * 60;
    const latestStart = Number.isFinite(reservedMinutes) ? timeMinutes("20:30") - reservedMinutes : timeMinutes(option.end);
    const effectiveEnd = Math.min(timeMinutes(option.end), latestStart);
    const endTime = `${String(Math.floor(effectiveEnd / 60)).padStart(2, "0")}:${String(effectiveEnd % 60).padStart(2, "0")}`;
    return `Estimated arrival ${displayTime(option.start)}–${displayTime(endTime)}`;
  };
  const clearArrivalDiscount = () => {
    if (state.packageBeforeArrivalDiscount) state.package = state.packageBeforeArrivalDiscount;
    state.packageBeforeArrivalDiscount = null;
    state.arrivalDiscount = null;
  };
  const applyArrivalDiscount = (option) => {
    clearArrivalDiscount();
    if (!option?.percent || !state.package) return;
    const original = state.package;
    const originalSubtotalCents = Math.max(0, Math.round(Number(original.originalSubtotalCents ?? original.subtotalCents) || 0));
    const promo = original.promoDiscount?.amountCents ? original.promoDiscount : null;
    const manual = original.manualDiscount?.amountCents ? original.manualDiscount : null;
    const pretaxPromoCents = promo?.application === "before_tax" ? Number(promo.amountCents || 0) : 0;
    const afterTaxDiscountCents = (promo && promo.application !== "before_tax" ? Number(promo.amountCents || 0) : 0)
      + Number(manual?.amountCents || 0);
    const amountCents = Math.round(originalSubtotalCents * option.percent / 100);
    const discountedSubtotalCents = Math.max(0, originalSubtotalCents - pretaxPromoCents - amountCents);
    const taxRate = Number(original.taxRate) || 0.08875;
    const taxCents = Math.round(discountedSubtotalCents * taxRate);
    const totalCents = Math.max(0, discountedSubtotalCents + taxCents - afterTaxDiscountCents);
    state.packageBeforeArrivalDiscount = original;
    state.arrivalDiscount = {
      code: option.key.toUpperCase(),
      label: `${option.title} arrival discount`,
      percent: option.percent,
      amountCents,
      application: "before_tax",
      windowStart: option.start,
      windowEnd: option.end,
      windowLabel: arrivalWindowText(option).replace("Estimated arrival ", "")
    };
    state.package = {
      ...original,
      discountedSubtotalCents,
      discountedSubtotal: discountedSubtotalCents / 100,
      taxCents,
      tax: taxCents / 100,
      priceCents: totalCents,
      price: totalCents / 100,
      totalCents,
      total: totalCents / 100,
      arrivalDiscount: state.arrivalDiscount
    };
  };
  const setSchedulerStatus = (message = "", type = "") => {
    if (!schedulerStatus) return;
    schedulerStatus.textContent = message;
    schedulerStatus.dataset.type = type;
  };
  const renderTimeSlots = () => {
    if (!timeSlots || !selectedDateLabel) return;
    timeSlots.replaceChildren();
    if (!state.selectedDate) {
      if (arrivalOptions) arrivalOptions.hidden = true;
      if (arrivalNote) arrivalNote.hidden = true;
      timeSlots.hidden = false;
      selectedDateLabel.textContent = "Select a date to see arrival options.";
      const message = document.createElement("p");
      message.className = "booking-time-empty";
      message.textContent = "Choose a highlighted date from the calendar.";
      timeSlots.append(message);
      return;
    }

    selectedDateLabel.textContent = longDate(state.selectedDate);
    if (arrivalOptions) {
      arrivalOptions.hidden = false;
      arrivalOptions.replaceChildren();
      if (hasExtendedLabor() && (state.arrivalPreference === "morning" || state.arrivalPreference === "afternoon")) {
        state.arrivalPreference = "";
        clearArrivalDiscount();
        if (scheduleSelect) scheduleSelect.value = "";
      }
      visibleArrivalOptions().forEach((option) => {
        const optionSlots = slotsForArrivalOption(option);
        const button = document.createElement("button");
        button.type = "button";
        button.className = `booking-arrival-option${state.arrivalPreference === option.key ? " is-selected" : ""}`;
        button.disabled = !optionSlots.length;
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(state.arrivalPreference === option.key));
        const title = document.createElement("strong");
        title.textContent = option.title;
        const detail = document.createElement("span");
        detail.textContent = optionSlots.length ? arrivalWindowText(option) : "Unavailable for this date and service duration";
        const saving = document.createElement("em");
        saving.textContent = option.percent ? `Save ${option.percent}%` : "No added discount";
        button.append(title, detail, saving);
        button.addEventListener("click", () => {
          state.arrivalPreference = option.key;
          applyArrivalDiscount(option);
          if (scheduleSelect) {
            scheduleSelect.value = option.flexible ? optionSlots[0]?.value || "" : "";
            scheduleSelect.dispatchEvent(new Event("change", { bubbles: true }));
          }
          renderQuoteOverview(state.package);
          renderPriceBreakdown(state.package);
          resetAgreementReview();
          setSchedulerStatus(option.flexible
            ? `${option.title} selected for ${longDate(state.selectedDate)}. We’ll confirm a more precise arrival time before the appointment.`
            : "Choose an exact arrival time below.", "success");
          renderTimeSlots();
          persistBookingDraft();
        });
        arrivalOptions.append(button);
      });
    }
    if (arrivalNote) arrivalNote.hidden = !state.arrivalPreference;
    if (state.arrivalPreference !== "exact") {
      timeSlots.hidden = true;
      return;
    }
    timeSlots.hidden = false;
    const slots = slotsForDate(state.selectedDate);
    slots.forEach((slot) => {
      const button = document.createElement("button");
      const selected = scheduleSelect?.value === slot.value;
      button.type = "button";
      button.className = `booking-time-slot${selected ? " is-selected" : ""}`;
      button.dataset.scheduleValue = slot.value;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(selected));
      button.setAttribute("aria-label", `${displayTime(slot.time)} on ${longDate(slot.date)}`);
      const time = document.createElement("strong");
      time.textContent = displayTime(slot.time);
      const availability = document.createElement("span");
      availability.textContent = selected ? "Selected" : "Available";
      button.append(time, availability);
      button.addEventListener("click", () => {
        if (scheduleSelect) {
          scheduleSelect.value = slot.value;
          scheduleSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        setSchedulerStatus(`${displayTime(slot.time)} on ${longDate(slot.date)} selected.`, "success");
        renderTimeSlots();
      });
      timeSlots.append(button);
    });
  };
  const renderCalendar = () => {
    if (!calendarGrid || !calendarMonthLabel) return;
    calendarGrid.replaceChildren();
    const monthKey = state.availableMonths[state.calendarMonthIndex];
    if (!monthKey) {
      calendarMonthLabel.textContent = "No dates available";
      return;
    }

    const [year, monthNumber] = monthKey.split("-").map(Number);
    const monthIndex = monthNumber - 1;
    const firstDay = new Date(year, monthIndex, 1).getDay();
    const dayCount = new Date(year, monthIndex + 1, 0).getDate();
    calendarMonthLabel.textContent = new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric"
    }).format(new Date(year, monthIndex, 1, 12));

    for (let index = 0; index < firstDay; index += 1) {
      const spacer = document.createElement("span");
      spacer.className = "booking-calendar-empty";
      spacer.setAttribute("aria-hidden", "true");
      calendarGrid.append(spacer);
    }

    for (let day = 1; day <= dayCount; day += 1) {
      const dateString = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const slotCount = slotsForDate(dateString).length;
      const selected = state.selectedDate === dateString;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(day);
      button.dataset.calendarDate = dateString;
      button.disabled = !slotCount;
      button.className = `${slotCount ? "is-available" : "is-unavailable"}${selected ? " is-selected" : ""}`;
      button.setAttribute("aria-pressed", String(selected));
      if (slotCount) {
        button.setAttribute("aria-label", calendarDateLabel(dateString, slotCount));
        button.addEventListener("click", () => {
          if (state.selectedDate !== dateString && scheduleSelect) scheduleSelect.value = "";
          state.selectedDate = dateString;
          if (state.arrivalPreference && state.arrivalPreference !== "exact" && scheduleSelect) {
            const matchingSlots = slotsForArrivalOption(arrivalOption(state.arrivalPreference));
            scheduleSelect.value = matchingSlots[0]?.value || "";
          }
          setSchedulerStatus("");
          renderCalendar();
          renderTimeSlots();
          window.setTimeout(() => timeSlots?.querySelector("button")?.focus(), 40);
        });
      } else {
        button.setAttribute("aria-label", `${day}, unavailable`);
      }
      calendarGrid.append(button);
    }

    const filledCells = firstDay + dayCount;
    const trailingCells = (7 - (filledCells % 7)) % 7;
    for (let index = 0; index < trailingCells; index += 1) {
      const spacer = document.createElement("span");
      spacer.className = "booking-calendar-empty";
      spacer.setAttribute("aria-hidden", "true");
      calendarGrid.append(spacer);
    }

    if (calendarPrevious) calendarPrevious.disabled = state.calendarMonthIndex === 0;
    if (calendarNext) calendarNext.disabled = state.calendarMonthIndex >= state.availableMonths.length - 1;
  };
  const loadSchedulerSlots = (slots = []) => {
    state.availableSlots = slots.slice();
    state.availableDates = [...new Set(state.availableSlots.map((slot) => slot.date))].sort();
    state.availableMonths = [...new Set(state.availableDates.map(monthKeyForDate))];
    state.calendarMonthIndex = 0;
    state.selectedDate = "";
    state.arrivalPreference = "";
    clearArrivalDiscount();
    setSchedulerStatus("");

    if (scheduleSelect) {
      scheduleSelect.replaceChildren(new Option("Select an appointment", ""));
      state.availableSlots.forEach((slot) => scheduleSelect.add(new Option(slot.label, slot.value)));
    }
    renderCalendar();
    renderTimeSlots();
    persistBookingDraft();
  };
  calendarPrevious?.addEventListener("click", () => {
    if (state.calendarMonthIndex <= 0) return;
    state.calendarMonthIndex -= 1;
    renderCalendar();
  });
  calendarNext?.addEventListener("click", () => {
    if (state.calendarMonthIndex >= state.availableMonths.length - 1) return;
    state.calendarMonthIndex += 1;
    renderCalendar();
  });
  const customerFacingExtras = (pkg) => {
    const rawExtras = (pkg.units || []).flatMap((unit) => unit.addOns || [])
      .filter((item) => item.amount > 0 || item.included);
    const isPetFee = (item) => ["property_pet_fee", "pet_fee"].includes(item.key);
    const isBuildupFee = (item) => item.key === "buildup_adjustment";
    const isClutterFee = (item) => item.key === "clutter_adjustment";
    const isMoldFee = (item) => String(item.key || "").startsWith("mold_adjustment_");
    const isConditionFee = (item) => isPetFee(item) || isBuildupFee(item) || isClutterFee(item) || isMoldFee(item);
    const combinedFee = (items, label) => {
      if (!items.length) return null;
      return {
        key: `customer_${items[0].key}`,
        label,
        amount: items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
        preTaxAmount: items.reduce((sum, item) => sum + (Number(item.preTaxAmount ?? item.amount) || 0), 0)
      };
    };
    const clutterLabel = pkg.clutterAdjustment?.condition === "heavy"
      ? "Hoarding/excessive clutter cleaning fee"
      : pkg.clutterAdjustment?.condition === "several"
        ? "Moderate clutter/access cleaning fee"
        : "Light clutter/access cleaning fee";
    const buildupLabel = pkg.buildupAdjustment?.condition === "heavy"
      ? "Heavy buildup and grease cleaning fee"
      : "Noticeable buildup and grease cleaning fee";
    return [
      ...rawExtras.filter((item) => !isConditionFee(item)).map((item) => ({ ...item, description: "" })),
      combinedFee(rawExtras.filter(isPetFee), "Pet-related cleaning fee"),
      combinedFee(rawExtras.filter(isClutterFee), clutterLabel),
      combinedFee(rawExtras.filter(isBuildupFee), buildupLabel),
      combinedFee(rawExtras.filter(isMoldFee), "Surface mold and mildew cleaning fee")
    ].filter(Boolean);
  };

  const renderPriceBreakdown = (pkg) => {
    // Repair promo totals restored from drafts created before FALL10 was
    // consistently applied to the pretax subtotal.
    if (state.promo && state.packageBeforePromo && pkg === state.package) {
      const original = state.packageBeforePromo;
      const originalSubtotalCents = Math.round(Number(original.subtotalCents) || 0);
      const originalTotalCents = Math.round(Number(original.priceCents || original.totalCents) || 0);
      const percent = Number(state.promo.percent) || 0;
      const amountCents = Math.round(originalSubtotalCents * percent / 100);
      const discountedSubtotalCents = Math.max(0, originalSubtotalCents - amountCents);
      const taxRate = Number(original.taxRate) || 0.08875;
      const taxCents = Math.round(discountedSubtotalCents * taxRate);
      const totalCents = discountedSubtotalCents + taxCents;
      state.promo = {
        ...state.promo,
        label: state.promo.label || "First-time customer fall discount",
        amountCents,
        discountedSubtotalCents,
        originalTotalCents,
        application: "before_tax"
      };
      state.package = Object.assign(pkg, {
        ...original,
        promoCode: state.promo.code,
        promoDiscount: state.promo,
        discountedSubtotalCents,
        discountedSubtotal: discountedSubtotalCents / 100,
        taxCents,
        tax: taxCents / 100,
        priceCents: totalCents,
        price: totalCents / 100,
        totalCents,
        total: totalCents / 100
      });
    }
    const breakdown = document.querySelector("[data-price-breakdown]");
    const priceLabel = document.querySelector("[data-package-price-label]");
    const isFormula = /_formula$/.test(pkg?.pricingMode || "");
    if (breakdown) {
      breakdown.hidden = !isFormula;
      breakdown.open = false;
    }
    if (priceLabel) priceLabel.textContent = "Estimated total";

    const packageSummary = document.querySelector("[data-quote-package-summary]");
    if (packageSummary) {
      packageSummary.replaceChildren();
      (pkg.units || []).forEach((unit) => {
        const section = document.createElement("section");
        if ((pkg.units || []).length > 1) {
          const heading = document.createElement("h4");
          heading.textContent = `Unit ${unit.unitNumber}`;
          section.append(heading);
        }
        const list = document.createElement("ul");
        (unit.baseItems || [])
          .filter((item) => item.amount > 0 || item.included)
          .forEach((item) => {
            const row = document.createElement("li");
            row.textContent = item.label;
            list.append(row);
          });
        section.append(list);
        packageSummary.append(section);
      });
    }

    const extrasSummary = document.querySelector("[data-quote-extras-summary]");
    const extrasSection = document.querySelector("[data-quote-extras-section]");
    const extras = customerFacingExtras(pkg);
    if (extrasSection) extrasSection.hidden = extras.length === 0;
    if (extrasSummary) {
      const list = document.createElement("ul");
      extras.forEach((item) => {
        const row = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = item.label;
        row.append(label);
        const amount = document.createElement("strong");
        amount.textContent = item.included ? "Included" : money(item.preTaxAmount ?? item.amount);
        row.append(amount);
        list.append(row);
      });
      extrasSummary.replaceChildren(list);
    }

    if (!isFormula) return;
    const unitContainer = document.querySelector("[data-price-breakdown-units]");
    if (unitContainer) {
      unitContainer.replaceChildren();
      const section = document.createElement("section");
      const heading = document.createElement("h4");
      heading.textContent = "Price summary";
      const list = document.createElement("ul");
      const serviceLabel = pkg.units.length === 1
        ? `${pkg.serviceLabel} service`
        : `${pkg.serviceLabel} service (${pkg.units.length} units/floors)`;
      const visibleItems = [
        { label: serviceLabel, preTaxAmount: pkg.baseSubtotal },
        ...extras
      ];
      visibleItems.forEach((item) => {
          const row = document.createElement("li");
          const label = document.createElement("span");
          label.textContent = item.label;
          const amount = document.createElement("strong");
          amount.textContent = item.included ? "Included" : money(item.preTaxAmount);
          row.append(label, amount);
          list.append(row);
      });
      section.append(heading, list);
      unitContainer.append(section);
    }
    document.querySelector("[data-standard-base-price]").textContent = money(pkg.baseSubtotal);
    document.querySelector("[data-addon-total]").textContent = money(pkg.addOnSubtotal);
    document.querySelector("[data-addon-total-row]").hidden = !pkg.addOnTotal;
    document.querySelector("[data-quote-subtotal]").textContent = money(pkg.subtotal);
    const taxLabel = document.querySelector("[data-quote-tax-label]");
    if (taxLabel) taxLabel.textContent = `NY sales tax (${(Number(pkg.taxRate || 0.08875) * 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%)`;
    document.querySelector("[data-quote-tax]").textContent = money(pkg.tax);
    const discountRow = document.querySelector('[data-quote-discount-row]');
    if (discountRow) {
      const promoDiscount = pkg.promoDiscount?.amountCents
        ? pkg.promoDiscount
        : state.promo?.amountCents
          ? state.promo
          : null;
      const displayedDiscount = promoDiscount
        ? promoDiscount
        : pkg.manualDiscount;
      discountRow.hidden = !displayedDiscount?.amountCents;
      document.querySelector('[data-quote-discount-label]').textContent = promoDiscount
        ? `${promoDiscount.code} promo discount`
        : `${displayedDiscount?.label || 'Discount'} (after tax)`;
      const discountDescription = document.querySelector('[data-quote-discount-description]');
      if (discountDescription) {
        discountDescription.textContent = promoDiscount
          ? `${promoDiscount.label || 'Seasonal cleaning offer'} — ${promoDiscount.percent}% off before tax`
          : "Applied after tax";
      }
      document.querySelector('[data-quote-discount]').textContent = `−${money((displayedDiscount?.amountCents || 0) / 100)}`;
    }
    const discountedSubtotalRow = document.querySelector('[data-quote-discounted-subtotal-row]');
    const arrivalDiscountRow = document.querySelector('[data-quote-arrival-discount-row]');
    if (arrivalDiscountRow) {
      arrivalDiscountRow.hidden = !state.arrivalDiscount?.amountCents;
      if (!arrivalDiscountRow.hidden) {
        document.querySelector('[data-quote-arrival-discount-label]').textContent = `${state.arrivalDiscount.label} (${state.arrivalDiscount.percent}%)`;
        document.querySelector('[data-quote-arrival-discount]').textContent = `−${money(state.arrivalDiscount.amountCents / 100)}`;
      }
    }
    if (discountedSubtotalRow) {
      const discountedSubtotalCents = Number(state.arrivalDiscount?.amountCents
        ? pkg.discountedSubtotalCents
        : pkg.promoDiscount?.discountedSubtotalCents ?? pkg.discountedSubtotalCents);
      discountedSubtotalRow.hidden = !(pkg.promoDiscount?.amountCents || state.arrivalDiscount?.amountCents) || !Number.isFinite(discountedSubtotalCents);
      if (!discountedSubtotalRow.hidden) {
        document.querySelector('[data-quote-discounted-subtotal]').textContent = money(discountedSubtotalCents / 100);
      }
    }
    document.querySelector("[data-quote-total]").textContent = money(pkg.total);
  };

  buildAnswerChoices();
  windowCards.forEach((card) => {
    const checkbox = card.querySelector('input[type="checkbox"]');
    const quantity = card.querySelector("[data-window-quantity]");
    checkbox?.addEventListener("change", () => {
      card.classList.toggle("is-selected", checkbox.checked);
      if (quantity) quantity.disabled = !checkbox.checked;
      invalidateDownstreamAfterEdit();
      setStatus(document.querySelector("[data-eligibility-status]"), "");
      persistBookingDraft();
    });
  });
  serviceChoiceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selectedService = button.dataset.bookingService;
      if (selectedService === "move") {
        if (movingEligibilityStatus) setStatus(movingEligibilityStatus, "");
        if (movingEligibilityOverlay) movingEligibilityOverlay.hidden = false;
        window.setTimeout(() => movingEligibilityForm?.elements.movingDirection?.focus(), 40);
        return;
      }
      if (selectedService === "post") {
        if (postConstructionScreeningOverlay) postConstructionScreeningOverlay.hidden = false;
        window.setTimeout(() => postConstructionScreeningForm?.elements.constructionFinished?.focus(), 40);
        return;
      }
      form.elements.requestedService.value = selectedService;
      form.elements.propertyStatus.value = selectedService === "move" ? "moving" : "occupied";
      invalidateDownstreamAfterEdit();
      syncServiceChoice();
      syncStageProgress();
      setStatus(document.querySelector("[data-eligibility-status]"), "");
    });
  });
  let servicePreviewReturnFocus = null;
  const closeServicePreview = () => {
    if (!servicePreviewOverlay) return;
    servicePreviewOverlay.hidden = true;
    document.body.classList.remove("booking-service-preview-open");
    if (servicePreviewFrame) servicePreviewFrame.src = "about:blank";
    servicePreviewReturnFocus?.focus?.();
  };
  document.querySelectorAll("[data-service-preview-url]").forEach((control) => {
    control.addEventListener("click", () => {
      servicePreviewReturnFocus = control;
      if (servicePreviewTitle) servicePreviewTitle.textContent = control.dataset.servicePreviewName || "Service details";
      if (servicePreviewFrame) servicePreviewFrame.src = control.dataset.servicePreviewUrl;
      if (servicePreviewOverlay) servicePreviewOverlay.hidden = false;
      document.body.classList.add("booking-service-preview-open");
      window.setTimeout(() => servicePreviewOverlay?.querySelector("[data-close-service-preview]")?.focus(), 40);
    });
  });
  document.querySelectorAll("[data-close-service-preview]").forEach((control) => {
    control.addEventListener("click", closeServicePreview);
  });
  const closeMovingEligibility = () => {
    if (movingEligibilityOverlay) movingEligibilityOverlay.hidden = true;
    serviceChoiceButtons.find((button) => button.dataset.bookingService === "move")?.focus();
  };
  document.querySelectorAll("[data-moving-eligibility-back]").forEach((control) => {
    control.addEventListener("click", closeMovingEligibility);
  });
  movingEligibilityForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!movingEligibilityForm.reportValidity()) return;
    const direction = movingEligibilityForm.elements.movingDirection.value;
    const isEmpty = movingEligibilityForm.elements.movingEmpty.value;
    if (isEmpty !== "yes") {
      form.elements.requestedService.value = "";
      form.elements.propertyStatus.value = "occupied";
      closeMovingEligibility();
      showQualificationRedirect("moving_not_empty");
      return;
    }
    form.elements.requestedService.value = "move";
    form.elements.propertyStatus.value = "moving";
    form.elements.movingDirection.value = direction;
    form.dataset.movingDirection = direction;
    invalidateDownstreamAfterEdit();
    syncServiceChoice();
    syncStageProgress();
    setStatus(document.querySelector("[data-eligibility-status]"), "");
    closeMovingEligibility();
    persistBookingDraft();
    enterPropertyTypeChoice();
  });
  const closePostConstructionScreening = () => {
    if (postConstructionScreeningOverlay) postConstructionScreeningOverlay.hidden = true;
    serviceChoiceButtons.find((button) => button.dataset.bookingService === "post")?.focus();
  };
  document.querySelectorAll("[data-post-construction-screening-back]").forEach((control) => {
    control.addEventListener("click", closePostConstructionScreening);
  });
  postConstructionScreeningForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!postConstructionScreeningForm.reportValidity()) return;
    const constructionFinished = postConstructionScreeningForm.elements.constructionFinished.value;
    const contractorItemsRemoved = postConstructionScreeningForm.elements.contractorItemsRemoved.value;
    if (constructionFinished !== "yes" || contractorItemsRemoved !== "yes") {
      const status = document.querySelector("[data-post-construction-screening-status]");
      setStatus(status, "We cannot provide post-construction cleaning unless all construction work is finished and all contractor tools, unused materials, and equipment will be removed before the appointment.");
      return;
    }
    form.elements.requestedService.value = "post";
    form.elements.propertyStatus.value = "renovated";
    form.elements.constructionFinished.value = constructionFinished;
    form.elements.contractorItemsRemoved.value = contractorItemsRemoved;
    invalidateDownstreamAfterEdit();
    syncServiceChoice();
    syncStageProgress();
    setStatus(document.querySelector("[data-eligibility-status]"), "");
    closePostConstructionScreening();
    persistBookingDraft();
    enterPropertyTypeChoice();
  });
  syncServiceChoice();
  propertyTypeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selectedPropertyType = button.dataset.bookingPropertyType;
      form.elements.propertyType.value = selectedPropertyType;
      invalidateDownstreamAfterEdit();
      syncPropertyTypeChoice();
      syncStageProgress();
      setStatus(document.querySelector("[data-eligibility-status]"), "");
    });
  });
  unitCountDecrease?.addEventListener("click", () => {
    form.elements.unitCount.value = String(selectedUnitCount() - 1);
    invalidateDownstreamAfterEdit();
    syncUnitCount();
    syncStageProgress();
  });
  unitCountIncrease?.addEventListener("click", () => {
    form.elements.unitCount.value = String(selectedUnitCount() + 1);
    invalidateDownstreamAfterEdit();
    syncUnitCount();
    syncStageProgress();
  });
  unitCountValue?.addEventListener("input", () => {
    const rawValue = unitCountValue.value.trim();
    if (!rawValue) {
      form.elements.unitCount.value = "";
      syncStageProgress();
      return;
    }
    const enteredCount = Number(rawValue);
    if (!Number.isInteger(enteredCount) || enteredCount < 1 || enteredCount > 10) {
      return;
    }
    form.elements.unitCount.value = String(enteredCount);
    invalidateDownstreamAfterEdit();
    syncUnitCount();
    syncStageProgress();
  });
  syncPropertyTypeChoice();
  syncUnitCount();
  form.querySelector("[data-question-back]")?.addEventListener("click", () => {
    if (windowMode) {
      windowMode = false;
      form.elements.requestedService.value = "";
      form.elements.propertyStatus.value = "occupied";
      mobileQuestionIndex = 1;
      syncMobileQuestion();
      questionFocusTarget(mobileQuestions()[mobileQuestionIndex])?.focus();
      return;
    }
    if (organizationMode) {
      organizationMode = false;
      mobileQuestionIndex = 0;
      syncMobileQuestion();
      questionFocusTarget(mobileQuestions()[0])?.focus();
      return;
    }
    if (recurringDetailsMode) {
      recurringDetailsMode = false;
      enterServiceChoice();
      return;
    }
    if (quoteDetailsMode) {
      const currentQuestions = pricingDetailQuestions(
        state.unitDetails[state.currentUnitIndex] || emptyUnitDetails(),
        value("requestedService")
      );
      const currentKey = currentQuestions[state.currentDetailQuestionIndex]?.key;
      const inHomeDetails = HOME_DETAIL_KEYS.has(currentKey);
      const currentStageIndexes = currentQuestions
        .map((question, index) => ({ question, index }))
        .filter(({ question }) => HOME_DETAIL_KEYS.has(question.key) === inHomeDetails)
        .map(({ index }) => index);
      const localIndex = currentStageIndexes.indexOf(state.currentDetailQuestionIndex);
      if (localIndex > 0) {
        state.currentDetailQuestionIndex = currentStageIndexes[localIndex - 1];
        syncMobileQuestion();
        return;
      }
      if (state.currentUnitIndex > 0) {
        saveCurrentUnitDetails();
        state.currentUnitIndex -= 1;
        const previousQuestions = pricingDetailQuestions(
          state.unitDetails[state.currentUnitIndex] || emptyUnitDetails(),
          value("requestedService")
        );
        const previousStageIndexes = previousQuestions
          .map((question, index) => ({ question, index }))
          .filter(({ question }) => HOME_DETAIL_KEYS.has(question.key) === inHomeDetails)
          .map(({ index }) => index);
        state.currentDetailQuestionIndex = previousStageIndexes[previousStageIndexes.length - 1];
        syncMobileQuestion();
        return;
      }
      if (!inHomeDetails) {
        state.currentUnitIndex = selectedUnitCount() - 1;
        const previousQuestions = pricingDetailQuestions(
          state.unitDetails[state.currentUnitIndex] || emptyUnitDetails(),
          value("requestedService")
        );
        const homeIndexes = previousQuestions
          .map((question, index) => ({ question, index }))
          .filter(({ question }) => HOME_DETAIL_KEYS.has(question.key))
          .map(({ index }) => index);
        state.currentDetailQuestionIndex = homeIndexes[homeIndexes.length - 1];
        syncMobileQuestion();
        return;
      }
      exitQuoteDetails();
      return;
    }
    if (unitCountMode) {
      exitUnitCountChoice();
      return;
    }
    if (propertyTypeMode) {
      exitPropertyTypeChoice();
      return;
    }
    if (serviceChoiceMode) {
      exitServiceChoice();
      return;
    }
    if (mobileQuestionIndex === 0) {
      hideWizard();
      openZipGate();
      return;
    }
    mobileQuestionIndex = Math.max(0, mobileQuestionIndex - 1);
    syncMobileQuestion();
    questionFocusTarget(mobileQuestions()[mobileQuestionIndex])?.focus();
  });
  closeQualificationRedirect = () => {
    if (qualificationRedirectOverlay) qualificationRedirectOverlay.hidden = true;
    pendingQualificationUrl = "";
  };
  qualificationRedirectBack?.addEventListener("click", () => {
    closeQualificationRedirect();
    if (quoteDetailsMode) {
      standardDetailOptions?.querySelector("button")?.focus();
      if (!standardDetailOptions?.querySelector("button")) standardDetailNumberInput?.focus();
    } else {
      questionFocusTarget(mobileQuestions()[mobileQuestionIndex])?.focus();
    }
  });
  qualificationRedirectContinue?.addEventListener("click", () => {
    if (!pendingQualificationUrl) return;
    if (pendingQualificationUrl.startsWith("./walkthrough.html")) {
      suspendDraftSaving = true;
      clearBookingDraft();
    }
    window.location.assign(pendingQualificationUrl);
  });
  closeQualificationComplete = () => {
    window.clearTimeout(qualificationCompleteTimer);
    qualificationCompleteTimer = 0;
    if (qualificationCompleteOverlay) qualificationCompleteOverlay.hidden = true;
  };
  closeAdditionalCleaningNotice = () => {
    if (additionalCleaningNotice) additionalCleaningNotice.hidden = true;
    standardDetailOptions
      ?.querySelector('[data-standard-detail-answer="yes"]')
      ?.focus();
  };
  closeQuoteContact = () => {
    if (quoteContactOverlay) quoteContactOverlay.hidden = true;
    syncStageProgress();
  };
  additionalCleaningNoticeContinue?.addEventListener("click", closeAdditionalCleaningNotice);
  quoteContactBack?.addEventListener("click", () => {
    closeQuoteContact();
    if (isWindowPath()) {
      enterWindowDetails();
      return;
    }
    if (organizationMode) {
      organizationHoursInput?.focus();
      return;
    }
    standardDetailOptions?.querySelector("button")?.focus();
    if (!standardDetailOptions?.querySelector("button")) standardDetailNumberInput?.focus();
  });
  ["cleaningCategory", "waterDamage", "utilitiesAvailable", "unsafeConditions", "clutter", "buildup", "hazards", "moldCleaningRequested"].forEach((fieldName) => {
    form.elements[fieldName]?.addEventListener("change", () => {
      if (fieldName === "hazards" && value("hazards") !== "mold" && form.elements.moldCleaningRequested) {
        form.elements.moldCleaningRequested.value = "";
      }
      const internalReason = qualificationReasonFromAnswers(eligibilityFromForm());
      if (internalReason) showQualificationRedirect(internalReason);
      syncMobileQuestion();
    });
  });
  syncMobileQuestion();

  document.querySelector("[data-check-eligibility]").addEventListener("click", async () => {
    const status = document.querySelector("[data-eligibility-status]");
    const activeQuestions = mobileQuestions();
    if (windowMode) {
      const invalidControl = Array.from(windowForm?.querySelectorAll("input:not(:disabled),select:not(:disabled)") || [])
        .find((control) => !control.checkValidity());
      if (invalidControl) {
        invalidControl.reportValidity();
        invalidControl.focus();
        return;
      }
      const details = windowDetailsFromForm();
      if (!details.windows.length) {
        setStatus(status, "Choose at least one window type and enter its quantity.");
        windowCards[0]?.querySelector('input[type="checkbox"]')?.focus();
        return;
      }
      if (details.windows.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)) {
        setStatus(status, "Enter a valid whole-number quantity for every selected window type.");
        return;
      }
      state.serviceKey = "window";
      state.pricingMode = "window_formula";
      state.packageIds = [];
      state.unitDetails = [details];
      state.eligibility = {
        serviceIntent: "cleaning",
        requestedService: "window",
        cleaningCategory: "window",
        propertyStatus: "window",
        propertyType: details.propertyType,
        serviceZip: value("zip"),
        unitCount: 1
      };
      if (windowNeedsManualReview(details)) {
        persistBookingDraft();
        showQualificationRedirect("window_manual_review");
        return;
      }
      setStatus(status, "");
      showQuoteContact();
      return;
    }
    if (organizationMode) {
      const selectedHours = Number(organizationHoursInput?.value);
      if (!Number.isInteger(selectedHours)) {
        setStatus(status, "Please enter a whole number of hours.");
        organizationHoursInput?.focus();
        return;
      }
      if (selectedHours < 4) {
        setStatus(status, "The minimum is 4 hours.");
        organizationHoursInput?.focus();
        return;
      }
      if (selectedHours > 24) {
        setStatus(status, "The maximum is 24 hours.");
        organizationHoursInput?.focus();
        return;
      }
      state.serviceKey = "hourly";
      state.pricingMode = "hourly_formula";
      state.packageIds = [];
      state.unitDetails = [{
        hours: selectedHours,
        notes: ""
      }];
      form.elements.requestedService.value = state.serviceKey;
      form.elements.propertyStatus.value = "hourly";
      state.eligibility = {
        serviceIntent: "cleaning",
        requestedService: state.serviceKey,
        propertyStatus: "hourly",
        serviceZip: value("zip"),
        unitCount: 1,
        units: state.unitDetails.map((unit) => ({ unitNumber: 1, ...unit }))
      };
      setStatus(status, "");
      showQuoteContact();
      return;
    }
    if (serviceChoiceMode) {
      const selectedService = value("requestedService");
      if (!selectedService) {
        setStatus(status, "Please choose a cleaning service to continue.");
        serviceChoiceButtons[0]?.focus();
        return;
      }
      if (selectedService === "hourly") {
        setStatus(status, "");
        enterOrganizationDetails();
        return;
      }
      if (selectedService === "recurring") {
        setStatus(status, "");
        enterRecurringDetails();
        return;
      }
      setStatus(status, "");
      enterPropertyTypeChoice();
      return;
    }
    if (recurringDetailsMode) {
      const previousOrderNumber = String(recurringOrderNumberInput?.value || "").trim();
      if (!previousOrderNumber) {
        setStatus(status, "Enter your previous appointment or order number.");
        recurringOrderNumberInput?.focus();
        return;
      }
      const continueButton = document.querySelector("[data-check-eligibility]");
      continueButton.disabled = true;
      setStatus(status, "Verifying your previous completed cleaning…", "info");
      try {
        const response = await fetch("/api/booking/recurring-discount", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ previousOrderNumber, lookupOnly: true })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "We could not verify that completed cleaning.");
        setStatus(status, "");
        if (recurringWelcomeName) recurringWelcomeName.textContent = data.firstName || "customer";
        if (recurringWelcomeOverlay) {
          window.clearTimeout(recurringWelcomeTimer);
          recurringWelcomeOverlay.hidden = false;
          window.setTimeout(() => recurringWelcomeOverlay.querySelector(".booking-complete-dialog")?.focus(), 40);
          recurringWelcomeTimer = window.setTimeout(() => {
            recurringWelcomeTimer = 0;
            recurringWelcomeOverlay.hidden = true;
            enterPropertyTypeChoice();
          }, 3000);
        } else {
          enterPropertyTypeChoice();
        }
      } catch (error) {
        setStatus(status, error.message || "We could not verify that completed cleaning.", "error");
        recurringOrderNumberInput?.focus();
      } finally {
        continueButton.disabled = false;
      }
      return;
    }
    if (propertyTypeMode) {
      if (!value("propertyType")) {
        setStatus(status, "Please choose the property type to continue.");
        propertyTypeButtons[0]?.focus();
        return;
      }
      setStatus(status, "");
      enterUnitCountChoice();
      return;
    }
    if (unitCountMode) {
      syncUnitCount();
      state.currentUnitIndex = 0;
      setStatus(status, "✓ Service details completed. Now tell us about your home.", "success");
      enterQuoteDetails();
      return;
    }
    if (!quoteDetailsMode) {
      const currentQuestion = activeQuestions[mobileQuestionIndex];
      const invalidControl = questionControls(currentQuestion).find((control) => !control.checkValidity());
      if (invalidControl) {
        setStatus(status, invalidControl.required
          ? "Please answer every part of this question to continue."
          : "Enter a valid square footage above 2,000, or leave this optional field blank.");
        invalidControl.reportValidity();
        questionControlFocusTarget(currentQuestion, invalidControl)?.focus();
        return;
      }
      if (mobileQuestionIndex === 0 && value("cleaningCategory") === "window") {
        setStatus(status, "");
        enterWindowDetails();
        return;
      }
      const internalReason = qualificationReasonFromAnswers(eligibilityFromForm());
      if (internalReason) {
        showQualificationRedirect(internalReason);
        return;
      }
      setStatus(status, "");
      if (mobileQuestionIndex < activeQuestions.length - 1) {
        mobileQuestionIndex += 1;
        syncMobileQuestion();
        questionFocusTarget(mobileQuestions()[mobileQuestionIndex])?.focus();
      } else {
        showQualificationComplete();
      }
      return;
    }
    const currentUnit = state.unitDetails[state.currentUnitIndex] || emptyUnitDetails();
    const detailQuestions = pricingDetailQuestions(currentUnit, value("requestedService"));
    const detailQuestion = detailQuestions[state.currentDetailQuestionIndex];
    let detailValue = currentUnit[detailQuestion.key];
    if (["number", "text"].includes(detailQuestion.type) && standardDetailNumberInput) {
      detailValue = standardDetailNumberInput.value;
      currentUnit[detailQuestion.key] = detailValue;
    }
    const numericValue = Number(detailValue);
    if (detailQuestion.type === "number") {
      if (detailValue === "" || !Number.isInteger(numericValue) || numericValue < detailQuestion.min || numericValue > detailQuestion.max) {
        setStatus(status, `Enter a whole number from ${detailQuestion.min} to ${detailQuestion.max}.`);
        standardDetailNumberInput?.focus();
        return;
      }
    } else if (detailQuestion.type === "text") {
      if (!String(detailValue || "").trim()) {
        setStatus(status, "Please specify the type of pet to continue.");
        standardDetailNumberInput?.focus();
        return;
      }
      currentUnit[detailQuestion.key] = String(detailValue).trim();
    } else if (detailQuestion.type === "room-breakdown") {
      const assignedRooms = Object.values(detailValue || {}).reduce((total, amount) => total + (Number(amount) || 0), 0);
      if (assignedRooms !== Number(currentUnit.additionalRooms)) {
        setStatus(status, `Please assign all ${Number(currentUnit.additionalRooms)} additional room${Number(currentUnit.additionalRooms) === 1 ? "" : "s"} using the + buttons.`);
        standardDetailOptions?.querySelector("button:not(:disabled)")?.focus();
        return;
      }
    } else if (["mold-breakdown", "condition-breakdown"].includes(detailQuestion.type)) {
      const affectedAreas = Object.values(detailValue || {}).reduce((total, amount) => total + (Number(amount) || 0), 0);
      const affectedAreasAcrossProperty = state.unitDetails.reduce((total, unit) => (
        total + Object.values(unit?.[detailQuestion.key] || {}).reduce((unitTotal, amount) => unitTotal + (Number(amount) || 0), 0)
      ), 0);
      const isLastUnit = state.currentUnitIndex === selectedUnitCount() - 1;
      if (affectedAreas < 1 && selectedUnitCount() === 1) {
        const areaMessage = detailQuestion.key === "moldAreas"
          ? "possible mold or mildew"
          : detailQuestion.key === "buildupAreas"
            ? "buildup"
            : detailQuestion.key === "constructionAreas"
              ? "construction dust or debris"
              : "clutter or limited access";
        setStatus(status, `Select at least one area affected by ${areaMessage} using the + buttons.`);
        standardDetailOptions?.querySelector("button:not(:disabled)")?.focus();
        return;
      }
      if (isLastUnit && affectedAreasAcrossProperty < 1) {
        const areaMessage = detailQuestion.key === "moldAreas"
          ? "possible mold or mildew"
          : detailQuestion.key === "buildupAreas"
            ? "buildup"
            : detailQuestion.key === "constructionAreas"
              ? "construction dust or debris"
              : "clutter or limited access";
        setStatus(status, `Select at least one area affected by ${areaMessage} in any unit. Units without this condition can remain at 0.`);
        standardDetailOptions?.querySelector("button:not(:disabled)")?.focus();
        return;
      }
    } else if (!detailValue) {
      setStatus(status, "Please choose an option to continue.");
      standardDetailOptions?.querySelector("button")?.focus();
      return;
    }
    const inHomeDetails = HOME_DETAIL_KEYS.has(detailQuestion.key);
    const stageIndexes = detailQuestions
      .map((question, index) => ({ question, index }))
      .filter(({ question }) => HOME_DETAIL_KEYS.has(question.key) === inHomeDetails)
      .map(({ index }) => index);
    const localDetailIndex = stageIndexes.indexOf(state.currentDetailQuestionIndex);
    if (localDetailIndex < stageIndexes.length - 1) {
      state.currentDetailQuestionIndex = stageIndexes[localDetailIndex + 1];
      setStatus(status, "");
      syncMobileQuestion();
      return;
    }
    if (inHomeDetails && state.currentUnitIndex < selectedUnitCount() - 1) {
      const completedUnit = state.currentUnitIndex + 1;
      state.currentUnitIndex += 1;
      const nextUnitQuestions = pricingDetailQuestions(
        state.unitDetails[state.currentUnitIndex] || emptyUnitDetails(),
        value("requestedService")
      );
      state.currentDetailQuestionIndex = nextUnitQuestions.findIndex((question) => HOME_DETAIL_KEYS.has(question.key));
      setStatus(status, `✓ Unit ${completedUnit} home details completed. Now tell us about Unit ${completedUnit + 1}.`, "success");
      syncMobileQuestion();
      wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (inHomeDetails) {
      let nextExtras = null;
      for (let unitIndex = 0; unitIndex < selectedUnitCount(); unitIndex += 1) {
        state.currentUnitIndex = unitIndex;
        const unitQuestions = pricingDetailQuestions(
          state.unitDetails[unitIndex] || emptyUnitDetails(),
          value("requestedService")
        );
        const questionIndex = unitQuestions.findIndex((question) => !HOME_DETAIL_KEYS.has(question.key));
        if (questionIndex >= 0) {
          nextExtras = { unitIndex, questionIndex };
          break;
        }
      }
      if (nextExtras) {
        state.currentUnitIndex = nextExtras.unitIndex;
        state.currentDetailQuestionIndex = nextExtras.questionIndex;
        setStatus(status, "✓ Home details completed. Now choose any extras.", "success");
        syncMobileQuestion();
        wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      // Some quotes have no applicable extra questions. Continue directly to
      // the quote instead of leaving the wizard on the previous home question.
      state.currentUnitIndex = selectedUnitCount() - 1;
    }
    if (!inHomeDetails && state.currentUnitIndex < selectedUnitCount() - 1) {
      const completedUnit = state.currentUnitIndex + 1;
      let nextExtras = null;
      for (let unitIndex = state.currentUnitIndex + 1; unitIndex < selectedUnitCount(); unitIndex += 1) {
        state.currentUnitIndex = unitIndex;
        const unitQuestions = pricingDetailQuestions(
          state.unitDetails[unitIndex] || emptyUnitDetails(),
          value("requestedService")
        );
        const questionIndex = unitQuestions.findIndex((question) => !HOME_DETAIL_KEYS.has(question.key));
        if (questionIndex >= 0) {
          nextExtras = { unitIndex, questionIndex };
          break;
        }
      }
      if (nextExtras) {
        state.currentUnitIndex = nextExtras.unitIndex;
        state.currentDetailQuestionIndex = nextExtras.questionIndex;
        setStatus(status, `✓ Unit ${completedUnit} completed. Now choose extras for Unit ${nextExtras.unitIndex + 1}.`, "success");
        syncMobileQuestion();
        wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      state.currentUnitIndex = selectedUnitCount() - 1;
    }

    if (value("hazards") === "mold" && value("moldCleaningRequested") === "yes") {
      const hasAffectedArea = state.unitDetails.some((unit) => (
        Object.values(unit.moldAreas || {}).some((amount) => Number(amount) > 0)
      ));
      if (!hasAffectedArea) {
        state.currentUnitIndex = 0;
        const moldQuestions = pricingDetailQuestions(state.unitDetails[state.currentUnitIndex], value("requestedService"));
        state.currentDetailQuestionIndex = Math.max(0, moldQuestions.findIndex((question) => question.key === "moldAreas"));
        setStatus(status, "Select at least one room with possible mold or mildew.");
        syncMobileQuestion();
        return;
      }
    }

    const required = ["propertyStatus", "requestedService", "serviceIntent", "cleaningCategory", "waterDamage", "excessiveBelongings", "utilitiesAvailable", "unsafeConditions", "clutter", "buildup", "hazards", "propertyType", "unitCount"];
    if (value("hazards") === "mold") required.push("moldCleaningRequested");
    const blank = required.find((name) => !value(name));
    if (blank) {
      setStatus(status, "Please answer every required eligibility question.");
      form.elements[blank].focus();
      return;
    }

    const wholePropertyDetails = state.unitDetails[selectedUnitCount() - 1] || {};
    state.eligibility = {
      ...eligibilityFromForm(),
      propertyHasPets: wholePropertyDetails.propertyHasPets || "no",
      propertyPetCount: wholePropertyDetails.propertyPetCount || "",
      propertyPetType: wholePropertyDetails.propertyPetType || "",
      propertyOtherPetType: wholePropertyDetails.propertyOtherPetType || "",
      petsSecured: wholePropertyDetails.petsSecured || "",
      previousPetBuildup: wholePropertyDetails.previousPetBuildup || ""
    };
    const recommendation = recommend(state.eligibility);
    if (["review", "ineligible"].includes(recommendation.type)) {
      if (recommendation.internalReason) {
        showQualificationRedirect(recommendation.internalReason);
        return;
      }
      status.hidden = false;
      status.dataset.type = "quote";
      status.replaceChildren(
        document.createTextNode(`${recommendation.reason} `),
        Object.assign(document.createElement("a"), {
          href: quoteUrlFor(recommendation, state.eligibility),
          className: "booking-status-action",
          textContent: "Continue to my quote form →"
        })
      );
      return;
    }

    state.serviceKey = recommendation.serviceKey;
    state.pricingMode = `${state.serviceKey}_formula`;
    state.packageIds = [];
    showQuoteContact();
  });

  quoteContactForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const invalid = Array.from(quoteContactForm.querySelectorAll("[required]"))
      .find((control) => !control.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return;
    }
    form.elements.firstName.value = quoteContactForm.elements.quoteFirstName.value.trim();
    form.elements.lastName.value = quoteContactForm.elements.quoteLastName.value.trim();
    form.elements.email.value = quoteContactForm.elements.quoteEmail.value.trim();
    form.elements.phone.value = quoteContactForm.elements.quotePhone.value.trim();
    quoteContactSubmit.disabled = true;
    quoteContactSubmit.textContent = "Preparing your quote…";
    setStatus(quoteContactStatus, "Calculating your price…", "info");
    try {
      const quotePromoCode = "FALL10";
      let promoData = null;
      try {
        if (state.serviceKey === "recurring") throw new Error("Recurring discounts are calculated from the previous order and new appointment date.");
        const promoResponse = await fetch("/api/booking/promo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            promoCode: quotePromoCode,
            serviceKey: state.serviceKey,
            customer: {
              email: value("email"),
              phone: value("phone"),
              address: ""
            }
          })
        });
        promoData = await promoResponse.json().catch(() => ({}));
        if (!promoResponse.ok) promoData = null;
      } catch {
        // Promo availability must never prevent a customer from receiving a quote.
        promoData = null;
      }
      await calculateAndShowQuote({ sendLink: false });
      if (promoData) applyPromoData(promoData);
      void sendSavedQuote();
      track("quote_complete", { quote_type: "instant", service: state.serviceKey || "" });
    } catch (error) {
      setStatus(quoteContactStatus, error.message || "Your quote could not be prepared.");
    } finally {
      quoteContactSubmit.disabled = false;
      quoteContactSubmit.textContent = "View my quote →";
    }
  });

  const availabilityButtons = Array.from(document.querySelectorAll("[data-load-availability]"));
  availabilityButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      availabilityButtons.forEach((control) => {
        control.disabled = true;
        control.textContent = "Loading availability…";
      });
      try {
        const response = await availabilityRequest();
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Availability could not be loaded.");
        if (!(data.slots || []).length) throw new Error("No online appointments are currently available. Please call or request a quote.");
        loadSchedulerSlots(data.slots);
        goToStep(3);
      } catch (error) {
        window.alert(error.message);
      } finally {
        availabilityButtons.forEach((control) => {
          control.disabled = false;
          control.textContent = control.closest(".booking-mobile-quote-bar")
            ? "Choose appointment →"
            : "Choose an appointment →";
        });
      }
    });
  });

  const syncCheckoutReview = () => {
    document.querySelector("[data-checkout-package]").textContent = state.package.serviceLabel;
    const checkoutTeamDescription = document.querySelector("[data-checkout-team-description]");
    if (checkoutTeamDescription) {
      checkoutTeamDescription.textContent = staffingSummary(state.package, { compact: true });
    }
    const selectedSlot = state.availableSlots.find((slot) => slot.value === value("schedule"));
    const selectedArrivalOption = arrivalOption(state.arrivalPreference);
    document.querySelector("[data-checkout-schedule]").textContent = selectedSlot
      ? selectedArrivalOption?.flexible
        ? `${longDate(selectedSlot.date)} · ${arrivalWindowText(selectedArrivalOption)}`
        : `${longDate(selectedSlot.date)} at ${displayTime(selectedSlot.time)}`
      : form.elements.schedule.options[form.elements.schedule.selectedIndex].textContent;
    const deposit = bookingDeposit(state.package.price);
    const balance = Math.round((Number(state.package.price || 0) - deposit) * 100) / 100;
    document.querySelector("[data-total-due]").textContent = money(deposit);
    document.querySelector("[data-checkout-total]").textContent = money(state.package.price);
    document.querySelector("[data-checkout-balance]").textContent = money(balance);
    const promoRow = document.querySelector("[data-checkout-promo-row]");
    const arrivalDiscountRow = document.querySelector("[data-checkout-arrival-discount-row]");
    const originalRow = document.querySelector("[data-checkout-original-total-row]");
    const discountedSubtotalRow = document.querySelector("[data-checkout-discounted-subtotal-row]");
    const taxRow = document.querySelector("[data-checkout-tax-row]");
    if (promoRow) promoRow.hidden = !state.promo;
    if (arrivalDiscountRow) arrivalDiscountRow.hidden = !state.arrivalDiscount;
    if (originalRow) originalRow.hidden = !state.promo;
    if (discountedSubtotalRow) discountedSubtotalRow.hidden = !state.promo;
    if (taxRow) taxRow.hidden = !state.promo;
    if (state.promo) {
      const originalSubtotalCents = Math.round(Number(state.packageBeforePromo?.subtotalCents ?? state.package.subtotalCents) || 0);
      const discountedSubtotalCents = Math.round(Number(state.promo.discountedSubtotalCents ?? state.package.discountedSubtotalCents) || 0);
      document.querySelector("[data-checkout-original-total]").textContent = money(originalSubtotalCents / 100);
      document.querySelector("[data-checkout-promo-label]").textContent = `${state.promo.code} — ${state.promo.percent}% off before tax`;
      document.querySelector("[data-checkout-promo-discount]").textContent = `−${money(state.promo.amountCents / 100)}`;
      document.querySelector("[data-checkout-discounted-subtotal]").textContent = money(discountedSubtotalCents / 100);
      document.querySelector("[data-checkout-tax]").textContent = money(Number(state.package.taxCents || 0) / 100);
    }
    if (state.arrivalDiscount) {
      document.querySelector("[data-checkout-arrival-discount-label]").textContent = `${state.arrivalDiscount.label} (${state.arrivalDiscount.percent}% before tax)`;
      document.querySelector("[data-checkout-arrival-discount]").textContent = `−${money(state.arrivalDiscount.amountCents / 100)}`;
      const discountedSubtotalCents = Math.round(Number(state.package.discountedSubtotalCents) || 0);
      document.querySelector("[data-checkout-discounted-subtotal]").textContent = money(discountedSubtotalCents / 100);
      document.querySelector("[data-checkout-tax]").textContent = money(Number(state.package.taxCents || 0) / 100);
      if (discountedSubtotalRow) discountedSubtotalRow.hidden = false;
      if (taxRow) taxRow.hidden = false;
      if (originalRow) originalRow.hidden = false;
      const originalSubtotalCents = Math.round(Number(state.package.originalSubtotalCents ?? state.packageBeforePromo?.subtotalCents ?? state.package.subtotalCents) || 0);
      document.querySelector("[data-checkout-original-total]").textContent = money(originalSubtotalCents / 100);
    }
    if (promoInput) {
      promoInput.value = state.promo?.code || promoInput.value;
      promoInput.disabled = Boolean(state.promo);
    }
    if (removePromoButton) removePromoButton.hidden = !state.promo;
    if (applyPromoButton) applyPromoButton.disabled = Boolean(state.promo);
    const finalLaborHours = document.querySelector("[data-final-labor-hours]");
    if (finalLaborHours) finalLaborHours.textContent = hours(state.package.manHours);
    document.querySelector("[data-pay-button]").textContent = `Pay ${money(deposit)} & confirm booking`;
    if (state.agreementReview.accepted && state.agreementReview.contextFingerprint !== agreementContextFingerprint()) {
      resetAgreementReview();
    } else {
      syncAgreementControls();
    }
  };

  const removePromo = ({ announce = true, preserveArrival = true } = {}) => {
    const selectedArrival = preserveArrival ? arrivalOption(state.arrivalPreference) : null;
    clearArrivalDiscount();
    if (state.packageBeforePromo) state.package = state.packageBeforePromo;
    state.packageBeforePromo = null;
    state.promo = null;
    if (promoInput) {
      promoInput.value = "";
      promoInput.disabled = false;
    }
    if (removePromoButton) removePromoButton.hidden = true;
    if (applyPromoButton) applyPromoButton.disabled = false;
    if (selectedArrival) applyArrivalDiscount(selectedArrival);
    renderQuoteOverview(state.package);
    renderPriceBreakdown(state.package);
    resetAgreementReview();
    syncCheckoutReview();
    if (announce) setStatus(promoStatus, "Promo code removed.", "info");
    persistBookingDraft();
  };

  const applyPromoData = (data) => {
    const selectedArrival = arrivalOption(state.arrivalPreference);
    clearArrivalDiscount();
    if (state.promo) removePromo({ announce: false, preserveArrival: false });
    const original = state.package;
    const originalSubtotalCents = Math.round(Number(original.subtotalCents) || 0);
    const originalTotalCents = Math.round(Number(original.priceCents || original.totalCents) || 0);
    const amountCents = Math.round(originalSubtotalCents * Number(data.percent) / 100);
    const discountedSubtotalCents = Math.max(0, originalSubtotalCents - amountCents);
    const taxRate = Number(original.taxRate) || 0.08875;
    const taxCents = Math.round(discountedSubtotalCents * taxRate);
    const totalCents = discountedSubtotalCents + taxCents;
    state.packageBeforePromo = original;
    state.promo = {
      code: data.code,
      label: data.label,
      percent: data.percent,
      amountCents,
      discountedSubtotalCents,
      originalTotalCents,
      expiresAt: data.expiresAt,
      application: "before_tax"
    };
    state.package = {
      ...original,
      promoCode: data.code,
      promoDiscount: state.promo,
      discountedSubtotalCents,
      discountedSubtotal: discountedSubtotalCents / 100,
      taxCents,
      tax: taxCents / 100,
      priceCents: totalCents,
      price: totalCents / 100,
      totalCents,
      total: totalCents / 100
    };
    if (selectedArrival) applyArrivalDiscount(selectedArrival);
    if (promoInput) {
      promoInput.value = data.code;
      promoInput.disabled = true;
    }
    if (removePromoButton) removePromoButton.hidden = false;
    renderQuoteOverview(state.package);
    renderPriceBreakdown(state.package);
    resetAgreementReview();
    syncCheckoutReview();
    persistBookingDraft();
  };

  const applyPromo = async () => {
    const code = String(promoInput?.value || "").replace(/\s+/g, "").toUpperCase();
    if (!code) {
      setStatus(promoStatus, "Enter a promo code.");
      promoInput?.focus();
      return;
    }
    applyPromoButton.disabled = true;
    applyPromoButton.textContent = "Checking…";
    setStatus(promoStatus, "Checking promo code…", "info");
    try {
      const address = [value("address"), value("address2"), value("city"), value("state"), value("zip")]
        .filter(Boolean).join(", ");
      const response = await fetch("/api/booking/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promoCode: code,
          serviceKey: state.package?.serviceKey,
          customer: { email: value("email"), phone: value("phone"), address }
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The promo code could not be applied.");
      applyPromoData(data);
      setStatus(promoStatus, `✓ ${data.code} applied — ${data.percent}% off.`, "success");
    } catch (error) {
      setStatus(promoStatus, error.message || "The promo code could not be applied.");
    } finally {
      applyPromoButton.disabled = Boolean(state.promo);
      applyPromoButton.textContent = "Apply";
    }
  };

  applyPromoButton?.addEventListener("click", applyPromo);
  promoInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyPromo();
    }
  });
  removePromoButton?.addEventListener("click", () => removePromo());

  document.querySelector("[data-continue-contact]").addEventListener("click", async () => {
    if (!state.arrivalPreference || !value("schedule")) {
      setSchedulerStatus(
        state.selectedDate
          ? "Please choose an arrival-time option to continue."
          : "Please choose an available date, then select a time.",
        "error"
      );
      const focusTarget = state.selectedDate
        ? timeSlots?.querySelector("button")
        : calendarGrid?.querySelector("button.is-available");
      focusTarget?.focus();
      return;
    }
    if (state.serviceKey === "recurring") {
      const continueButton = document.querySelector("[data-continue-contact]");
      continueButton.disabled = true;
      setSchedulerStatus("Verifying your recurring-cleaning discount…", "info");
      try {
        const response = await fetch("/api/booking/recurring-discount", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            previousOrderNumber: value("recurringOrderNumber"),
            schedule: value("schedule"),
            customer: { email: value("email"), phone: value("phone"), address: "" }
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "The recurring discount could not be verified.");
        applyPromoData(data);
        setSchedulerStatus(`✓ ${data.label} applied — ${data.percent}% off.`, "success");
      } catch (error) {
        setSchedulerStatus(error.message || "The recurring discount could not be verified.", "error");
        continueButton.disabled = false;
        return;
      }
      continueButton.disabled = false;
    }
    syncCheckoutReview();
    goToStep(4);
  });

  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetStep = Number(button.dataset.back);
      if (targetStep === 1) {
        if (state.serviceKey === "window") {
          enterWindowDetails();
          goToStep(targetStep);
          return;
        }
        if (state.serviceKey === "hourly") {
          enterOrganizationDetails();
          goToStep(targetStep);
          return;
        }
        organizationMode = false;
        serviceChoiceMode = false;
        propertyTypeMode = false;
        unitCountMode = false;
        quoteDetailsMode = true;
        state.currentUnitIndex = 0;
        mobileQuestionIndex = Math.max(0, mobileQuestions().length - 1);
        syncMobileQuestion();
      }
      goToStep(targetStep);
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("[data-checkout-status]");
    if (!state.agreementReview.accepted || state.agreementReview.contextFingerprint !== agreementContextFingerprint()) {
      resetAgreementReview();
      setStatus(status, "Please review and accept the Service Agreement before payment.");
      agreementReviewButton?.focus();
      return;
    }
    const visibleStep = document.querySelector('[data-step="4"]');
    const invalid = Array.from(visibleStep.querySelectorAll("input[required]")).find((control) => !control.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return;
    }
    const finalZip = serviceArea.normalize(value("zip"));
    if (!canUseInstantQuoteZip(finalZip)) {
      setStatus(status, instantQuotePauseMessage(finalZip) || "Please enter a ZIP code within our New York City service area.");
      checkoutZip.focus();
      return;
    }
    checkoutZip.value = finalZip;
    applyServiceZip(finalZip);

    payButton.disabled = true;
    payButton.textContent = "Starting secure payment…";
    setStatus(status, "Holding your appointment and opening Stripe…", "info");

    const priorities = Array.from(form.querySelectorAll('input[name="priorities"]:checked')).map((input) => input.value);
    const payload = {
      accountMode: accountMode(),
      savedQuoteToken: state.savedQuoteUrl ? new URL(state.savedQuoteUrl, window.location.origin).searchParams.get("quote") || "" : "",
      quoteRevision: state.quoteRevision || '',
      packageId: state.package.id,
      packageIds: state.packageIds,
      pricingMode: state.pricingMode,
      eligibility: state.eligibility,
      unitDetails: state.unitDetails.map((unit, index) => ({
        unitNumber: index + 1,
        ...unit
      })),
      schedule: value("schedule"),
      arrivalPreference: state.arrivalPreference || "exact",
      priorities,
      notes: value("notes"),
      promoCode: state.promo?.code || "",
      recurringOrderNumber: value("recurringOrderNumber"),
      customer: {
        firstName: value("firstName"),
        lastName: value("lastName"),
        email: value("email"),
        phone: value("phone"),
        address: value("address"),
        address2: value("address2"),
        city: value("city"),
        state: value("state"),
        zip: value("zip")
      },
      agreements: {
        laborHours: true,
        completion: true,
        condition: true,
        terms: true
      },
      agreementReview: {
        version: state.agreementReview.version,
        openedAt: state.agreementReview.openedAt,
        scrolledToEndAt: state.agreementReview.scrolledToEndAt,
        acceptedAt: state.agreementReview.acceptedAt,
        accepted: state.agreementReview.accepted,
        signedName: state.agreementReview.signedName,
        acceptanceText: AGREEMENT_ACCEPTANCE_TEXT,
        contextFingerprint: state.agreementReview.contextFingerprint
      }
    };

    try {
      const response = await fetch("/api/booking/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Secure checkout could not be started.");
      track("begin_checkout", {
        currency: "USD",
        value: Number(state.package?.price || 0),
        items: [{ item_id: String(state.package?.id || "cleaning-service"), item_name: String(state.package?.serviceLabel || "Cleaning service") }]
      });
      if (typeof window.imanMetaTrackInitiateCheckout === "function") {
        window.imanMetaTrackInitiateCheckout({
          checkoutId: String(data.bookingId || data.orderNumber || ""),
          value: Number(state.package?.price || 0),
          currency: "USD",
          contentName: String(state.package?.serviceLabel || "Cleaning service")
        });
      }
      window.location.href = data.checkoutUrl;
    } catch (error) {
      setStatus(status, error.message || "Secure checkout could not be started.");
      payButton.textContent = `Pay ${money(bookingDeposit(state.package.price))} & confirm booking`;
      syncAgreementControls();
    }
  });

  const restoreSavedQuote = async (token) => {
    if (!token) return;
    showQuoteLoading();
    if (zipStatus) {
      zipStatus.hidden = false;
      zipStatus.dataset.type = "success";
      zipStatus.textContent = "Opening your saved quote…";
    }
    try {
      const response = await fetch(`/api/booking/saved-quote?token=${encodeURIComponent(token)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || "This saved quote could not be opened.");
        error.code = data.code || "";
        throw error;
      }
      if (data.redirectUrl && /^\/q\/[\w-]{12}$/.test(data.redirectUrl)) {
        window.location.assign(data.redirectUrl);
        return;
      }
      Object.entries(data.eligibility || {}).forEach(([name, fieldValue]) => {
        if (form.elements[name] && typeof fieldValue !== "object") {
          form.elements[name].value = String(fieldValue ?? "");
        }
      });
      state.eligibility = data.eligibility;
      state.unitDetails = Array.isArray(data.unitDetails) ? data.unitDetails : [];
      state.serviceKey = data.eligibility?.requestedService || data.package?.serviceKey || "";
      state.pricingMode = data.package?.pricingMode || `${state.serviceKey}_formula`;
      state.packageIds = [];
      state.package = data.package;
      state.promo = data.package?.promoDiscount?.amountCents ? data.package.promoDiscount : null;
      state.packageBeforePromo = state.promo ? {
        ...data.package,
        promoCode: "",
        promoDiscount: null,
        priceCents: data.package.originalTotalCents,
        price: data.package.originalTotalCents / 100,
        totalCents: data.package.originalTotalCents,
        total: data.package.originalTotalCents / 100
      } : null;
      state.savedQuoteUrl = window.location.href;
      state.quoteRevision = data.quoteRevision || '';
      state.initialSlots = [];
      if (state.serviceKey === "hourly") {
        organizationHoursInput.value = String(state.unitDetails[0]?.hours || 4);
      }
      if (state.serviceKey === "window") restoreWindowDetails(state.unitDetails[0]);
      ["firstName", "lastName", "email", "phone"].forEach((name) => {
        form.elements[name].value = data.customer?.[name] || "";
      });
      if (quoteContactForm) {
        quoteContactForm.elements.quoteFirstName.value = data.customer?.firstName || "";
        quoteContactForm.elements.quoteLastName.value = data.customer?.lastName || "";
        quoteContactForm.elements.quoteEmail.value = data.customer?.email || "";
        quoteContactForm.elements.quotePhone.value = data.customer?.phone || "";
      }
      const restoredZip = serviceArea.normalize(data.eligibility?.serviceZip || "");
      if (canUseInstantQuoteZip(restoredZip)) applyServiceZip(restoredZip);
      syncServiceChoice();
      syncPropertyTypeChoice();
      allMobileQuestions.forEach(syncAnswerChoices);
      syncUnitCount();
      renderQuoteOverview(state.package);
      syncQuotedServiceCopy();
      renderPriceBreakdown(state.package);
      showSavedQuoteDelivery("Your saved quote is open. You can choose an appointment and pay when you’re ready.", "success");
      hideQuoteLoading();
      closeZipGate();
      openWizard();
      goToStep(2);
    } catch (error) {
      if (error.code === "QUOTE_ALREADY_BOOKED") {
        showBookedQuoteConfirmation();
        return;
      }
      showQuoteLoadError(error.message || "This saved quote could not be opened. Please contact us for assistance.");
    }
  };

  const savedQuoteToken = new URLSearchParams(window.location.search).get("quote");
  const readBookingDraft = () => {
    let draft = null;
    try {
      draft = JSON.parse(window.localStorage.getItem(BOOKING_DRAFT_KEY) || "null");
    } catch {
      clearBookingDraft();
      return null;
    }
    if (!draft || draft.version !== BOOKING_DRAFT_VERSION || !draft.explicitlySaved || !draft.fields) {
      clearBookingDraft();
      return null;
    }
    const savedAt = Date.parse(draft.savedAt || "");
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > BOOKING_DRAFT_MAX_AGE) {
      clearBookingDraft();
      return null;
    }
    if (
      draft.state?.serviceKey === "window" ||
      draft.state?.serviceKey === "organization" ||
      draft.fields.serviceIntent === "organization" ||
      draft.fields.cleaningCategory === "window" ||
      draft.fields.requestedService === "details"
    ) {
      clearBookingDraft();
      return null;
    }
    return draft;
  };

  const restoreBookingDraft = (draft = readBookingDraft()) => {
    if (!draft) return false;

    suspendDraftSaving = true;
    try {
      restoreFields(form, draft.fields);
      restoreFields(quoteContactForm, draft.quoteContactFields);
      const savedState = draft.state || {};
      [
        "step",
        "serviceKey",
        "package",
        "packageIds",
        "eligibility",
        "unitDetails",
        "currentUnitIndex",
        "currentDetailQuestionIndex",
        "pricingMode",
        "savedQuoteUrl",
        "quoteRevision",
        "availableSlots",
        "calendarMonthIndex",
        "selectedDate",
        "highestStageReached",
        "promo",
        "packageBeforePromo",
        "arrivalPreference",
        "arrivalDiscount",
        "packageBeforeArrivalDiscount"
      ].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(savedState, key)) state[key] = savedState[key];
      });
      const savedView = draft.view || {};
      mobileQuestionIndex = Math.max(0, Number(savedView.mobileQuestionIndex) || 0);
      organizationMode = Boolean(savedView.organizationMode);
      windowMode = Boolean(savedView.windowMode) || state.serviceKey === "window";
      serviceChoiceMode = Boolean(savedView.serviceChoiceMode);
      recurringDetailsMode = Boolean(savedView.recurringDetailsMode);
      propertyTypeMode = Boolean(savedView.propertyTypeMode);
      unitCountMode = Boolean(savedView.unitCountMode);
      quoteDetailsMode = Boolean(savedView.quoteDetailsMode);

      // Drafts saved by the former empty-Extras transition can contain -1.
      // Recover them at the first real extra question instead of restarting.
      if (quoteDetailsMode && Number(state.currentDetailQuestionIndex) < 0) {
        for (let unitIndex = 0; unitIndex < selectedUnitCount(); unitIndex += 1) {
          state.currentUnitIndex = unitIndex;
          const unitQuestions = pricingDetailQuestions(
            state.unitDetails[unitIndex] || emptyUnitDetails(),
            value("requestedService")
          );
          const questionIndex = unitQuestions.findIndex((question) => !HOME_DETAIL_KEYS.has(question.key));
          if (questionIndex >= 0) {
            state.currentDetailQuestionIndex = questionIndex;
            break;
          }
        }
      }

      // Reopen the wizard before rebuilding its restored view. If an older draft
      // needs normalization, the customer must never be left on a blank page.
      openWizard();
      const restoredZip = serviceArea.normalize(value("zip"));
      if (canUseInstantQuoteZip(restoredZip)) applyServiceZip(restoredZip);
      syncServiceChoice();
      syncPropertyTypeChoice();
      syncUnitCount();
      allMobileQuestions.forEach(syncAnswerChoices);
      syncMobileQuestion();

      if (state.package) {
        renderQuoteOverview(state.package);
        syncQuotedServiceCopy();
        renderPriceBreakdown(state.package);

        const savedSchedule = String(draft.fields.schedule || "");
        const savedSelectedDate = state.selectedDate;
        const savedCalendarMonthIndex = state.calendarMonthIndex;
        if (Array.isArray(state.availableSlots) && state.availableSlots.length) {
          loadSchedulerSlots(state.availableSlots);
          state.selectedDate = savedSelectedDate;
          state.calendarMonthIndex = Math.min(
            savedCalendarMonthIndex,
            Math.max(0, state.availableMonths.length - 1)
          );
          if (scheduleSelect && savedSchedule) scheduleSelect.value = savedSchedule;
          renderCalendar();
          renderTimeSlots();
        }
      }

      const restoredStep = state.package ? Math.min(4, Math.max(1, Number(state.step) || 1)) : 1;
      if (restoredStep === 4 && value("schedule")) syncCheckoutReview();
      goToStep(restoredStep);
      closeZipGate();
      const saveCopy = document.querySelector("[data-booking-save-copy]");
      if (saveCopy) saveCopy.textContent = "Saved progress restored";
      suspendDraftSaving = false;
      window.setTimeout(persistBookingDraft, 500);
      return true;
    } catch (error) {
      console.error("Could not restore the saved booking view", error);
      suspendDraftSaving = false;
      closeZipGate();
      openWizard();
      goToStep(1);
      setStatus(
        document.querySelector("[data-eligibility-status]"),
        "Your saved answers were reopened. Please continue from this step."
      );
      return true;
    }
  };

  const showResumeQuotePrompt = (draft) => {
    if (!resumeQuoteGate) return restoreBookingDraft(draft);
    resumeQuoteGate.hidden = false;
    document.body.classList.add("zip-gate-open");
    window.setTimeout(() => resumeContinueButton?.focus(), 50);
    resumeContinueButton?.addEventListener("click", () => {
      resumeQuoteGate.hidden = true;
      document.body.classList.remove("zip-gate-open");
      restoreBookingDraft(draft);
    }, { once: true });
    resumeNewButton?.addEventListener("click", () => {
      suspendDraftSaving = true;
      clearBookingDraft();
      suspendDraftSaving = false;
      resumeQuoteGate.hidden = true;
      document.body.classList.remove("zip-gate-open");
      openZipGate();
    }, { once: true });
    return true;
  };

  const invalidateDownstreamAfterEdit = () => {
    const editedStage = currentStageNumber();
    if (editedStage >= state.highestStageReached) return;
    if (editedStage <= 4) {
      state.highestStageReached = editedStage;
      state.package = null;
      state.promo = null;
      state.packageBeforePromo = null;
      state.arrivalPreference = "";
      state.arrivalDiscount = null;
      state.packageBeforeArrivalDiscount = null;
      state.initialSlots = [];
      state.availableSlots = [];
      state.availableDates = [];
      state.availableMonths = [];
      state.selectedDate = "";
      if (scheduleSelect) {
        scheduleSelect.replaceChildren(new Option("Select an appointment", ""));
      }
      resetAgreementReview();
    } else if (editedStage === 6) {
      state.highestStageReached = 6;
      resetAgreementReview();
    }
    syncStageProgress();
    persistBookingDraft();
  };

  form.addEventListener("input", invalidateDownstreamAfterEdit);
  form.addEventListener("change", invalidateDownstreamAfterEdit);
  form.addEventListener("input", persistBookingDraft);
  form.addEventListener("change", persistBookingDraft);
  form.addEventListener("input", syncStageProgress);
  form.addEventListener("change", syncStageProgress);
  quoteContactForm?.addEventListener("input", persistBookingDraft);
  quoteContactForm?.addEventListener("change", persistBookingDraft);
  quoteContactForm?.addEventListener("input", syncStageProgress);
  quoteContactForm?.addEventListener("change", syncStageProgress);
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-booking-cancel], [data-booking-discard]")) return;
    window.setTimeout(persistBookingDraft, 0);
  });
  document.querySelectorAll("[data-booking-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      saveBookingDraft({ immediate: true });
      closeWizard({ preserveDraft: true });
    });
  });
  window.addEventListener("pagehide", () => {
    if (!suspendDraftSaving && !bookingWizard.hidden) saveBookingDraft({ immediate: true });
  });
  const discardConfirmation = document.querySelector("[data-discard-confirmation]");
  const discardKeepButton = discardConfirmation?.querySelector("[data-discard-keep]:not(.booking-redirect-backdrop)");
  const openDiscardConfirmation = () => {
    if (!discardConfirmation) return;
    discardConfirmation.hidden = false;
    window.setTimeout(() => discardKeepButton?.focus(), 0);
  };
  closeDiscardConfirmation = () => {
    if (!discardConfirmation) return;
    discardConfirmation.hidden = true;
  };
  document.querySelectorAll("[data-booking-discard]").forEach((button) => {
    button.addEventListener("click", openDiscardConfirmation);
  });
  discardConfirmation?.querySelectorAll("[data-discard-keep]").forEach((button) => {
    button.addEventListener("click", closeDiscardConfirmation);
  });
  discardConfirmation?.querySelector("[data-discard-confirm]")?.addEventListener("click", () => {
    suspendDraftSaving = true;
    clearBookingDraft();
    window.location.replace(window.location.pathname);
  });

  if (savedQuoteToken) {
    clearBookingDraft();
    void restoreSavedQuote(savedQuoteToken);
  } else {
    const savedDraft = readBookingDraft();
    if (savedDraft) showResumeQuotePrompt(savedDraft);
    else openZipGate();
  }

  if (new URLSearchParams(window.location.search).get("payment") === "cancelled") {
    setStatus(document.querySelector("[data-eligibility-status]"), "Payment was cancelled. No appointment was confirmed.", "info");
  }
})();
