(() => {
  const form = document.querySelector("[data-booking-form]");
  if (!form) return;
  const BOOKING_DRAFT_KEY = "imanBookingDraftV2";
  const BOOKING_DRAFT_VERSION = 2;
  const INSTANT_PRICING_NOTICE_KEY = "imanInstantPricingOpenedNoticeV1";
  let persistBookingDraft = () => {};
  let clearBookingDraft = () => {};

  const serviceArea = window.IMAN_BOOKING_SERVICE_AREA;
  const zipGate = document.querySelector("[data-zip-gate]");
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
  const closeWizard = () => {
    persistBookingDraft();
    closeQualificationRedirect();
    closeQualificationComplete();
    closeAdditionalCleaningNotice();
    closeQuoteContact();
    closeAccountDialog();
    hideWizard();
    if (document.body.classList.contains("booking-form-only")) {
      window.location.assign("./index.html");
      return;
    }
    document.querySelector("[data-start-booking]")?.focus();
  };
  const applyServiceZip = (zip) => {
    checkoutZip.value = zip;
    if (confirmedZip) confirmedZip.textContent = zip;
    if (confirmedArea) confirmedArea.hidden = false;
    if (serviceZipNote) serviceZipNote.textContent = "— service area confirmed";
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
  const showZipError = (message, includeQuoteLink = false) => {
    zipStatus.hidden = false;
    zipStatus.dataset.type = "error";
    zipStatus.replaceChildren(document.createTextNode(message));
    if (includeQuoteLink) {
      zipStatus.append(
        document.createTextNode(" "),
        Object.assign(document.createElement("a"), {
          href: "./quote.html",
          textContent: "Request a custom quote instead."
        })
      );
    }
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
    if (!serviceArea.isServed(zip)) {
      showZipError("This ZIP is outside our regular NYC and Long Island online booking area.", true);
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
    }, 5000);
  });
  document.querySelector("[data-change-zip]")?.addEventListener("click", () => {
    hideWizard();
    openZipGate();
  });
  document.querySelector("[data-start-booking]")?.addEventListener("click", () => {
    const currentZip = serviceArea.normalize(checkoutZip.value);
    if (serviceArea.isServed(currentZip)) openWizard();
    else openZipGate();
  });
  document.querySelectorAll("[data-wizard-close]").forEach((control) => {
    control.addEventListener("click", closeWizard);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || bookingWizard.hidden || !zipGate.hidden) return;
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
    closeWizard();
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
    selectedDate: ""
  };
  const allMobileQuestions = Array.from(form.querySelectorAll("[data-mobile-question]"));
  const mobileQuestionNav = form.querySelector(".booking-mobile-question-nav");
  const mobileQuestionCount = form.querySelector("[data-question-count]");
  const mobileQuestionTime = form.querySelector("[data-question-time]");
  const eligibilityButtonLabel = form.querySelector("[data-eligibility-button-label]");
  const qualificationRedirectOverlay = document.querySelector("[data-qualification-redirect]");
  const qualificationRedirectTitle = document.querySelector("[data-redirect-title]");
  const qualificationRedirectDescription = document.querySelector("[data-redirect-description]");
  const qualificationRedirectReason = document.querySelector("[data-redirect-reason]");
  const qualificationRedirectContinue = document.querySelector("[data-redirect-continue]");
  const qualificationRedirectBack = document.querySelector("[data-redirect-back]");
  const qualificationCompleteOverlay = document.querySelector("[data-qualification-complete]");
  const qualificationCompleteContinue = document.querySelector("[data-qualification-complete-continue]");
  const qualificationCompleteBack = document.querySelector("[data-qualification-complete-back]");
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
  let currentAccount = null;
  const savedQuoteStatus = document.querySelector("[data-saved-quote-status]");
  const organizationForm = form.querySelector("[data-organization-form]");
  const organizationHoursInput = form.elements.organizationHours;
  const organizationNotesInput = form.elements.organizationNotes;
  const serviceChoiceForm = form.querySelector("[data-service-choice-form]");
  const serviceChoiceButtons = Array.from(form.querySelectorAll("[data-booking-service]"));
  const propertyTypeForm = form.querySelector("[data-property-type-form]");
  const propertyTypeButtons = Array.from(form.querySelectorAll("[data-booking-property-type]"));
  const unitCountForm = form.querySelector("[data-unit-count-form]");
  const unitCountDecrease = form.querySelector("[data-unit-count-decrease]");
  const unitCountIncrease = form.querySelector("[data-unit-count-increase]");
  const unitCountValue = form.querySelector("[data-unit-count-value]");
  const unitCountLabel = form.querySelector("[data-unit-count-label]");
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
  const schedulerStatus = form.querySelector("[data-scheduler-status]");
  let pendingQualificationUrl = "";
  let mobileQuestionIndex = 0;
  let organizationMode = false;
  let serviceChoiceMode = false;
  let propertyTypeMode = false;
  let unitCountMode = false;
  let quoteDetailsMode = false;
  let suspendDraftSaving = false;
  let draftSaveTimer = 0;
  const serviceNames = {
    organization: "Organization / Decluttering",
    standard: "Standard Cleaning",
    deep: "Deep Cleaning",
    move: "Move-In / Move-Out Cleaning",
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
    window_addon: {
      title: "Window Cleaning Needs a Separate Quote",
      description: "Window pricing depends on the number and type of windows, interior or exterior service, condition, and safe access. Your residential answers will be carried to the window quote form.",
      buttonLabel: "Continue to Window Cleaning Quote",
      service: "window-cleaning"
    },
    water_damage: {
      title: "Water Damage Requires a Custom Quote",
      description: "Properties affected by flooding or water damage require additional information before we can provide an accurate estimate.",
      buttonLabel: "Request a Custom Quote"
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
      title: "Utilities Are Required",
      description: "Electricity and running water are required to perform most cleaning services. Please request a custom quote so we can review your situation and determine whether we can accommodate your request.",
      buttonLabel: "Request a Custom Quote"
    },
    limited_property_access: {
      title: "Additional Assessment Required",
      description: "Some access limitations may require additional time, equipment, or a walkthrough before we can confirm your booking. Please request a custom quote so we can review your property and provide an accurate estimate.",
      buttonLabel: "Request a Custom Quote"
    },
    heavy_clutter: {
      title: "Clutter Requires a Custom Quote",
      description: "Any clutter that requires our team to work around belongings needs a custom assessment so we can estimate the cleaning time, access, and staffing.",
      buttonLabel: "Request a Custom Quote"
    },
    heavy_buildup: {
      title: "Heavy Buildup Requires a Custom Quote",
      description: "Heavy grease, soap scum, dust, or residue may require additional time and specialized cleaning. Please request a custom quote so we can review the condition accurately.",
      buttonLabel: "Request a Custom Quote"
    },
    safety_concern: {
      title: "Safety Review Required",
      description: "Possible mold, active pests, or human or animal waste must be reviewed before we can confirm a cleaning appointment.",
      buttonLabel: "Request a Custom Quote"
    },
    large_property: {
      title: "Large Property Requires a Custom Quote",
      description: "Properties larger than 2,000 square feet need a custom quote so we can confirm the cleaning scope, time, and staffing.",
      buttonLabel: "Request a Custom Quote"
    }
  };
  const preset = new URLSearchParams(window.location.search);
  const presetService = preset.get("service");
  if (["standard", "deep", "move"].includes(presetService)) {
    state.unitDetails = [{}];
    form.elements.propertyStatus.value =
      presetService === "move" ? "moving" : "occupied";
    form.elements.requestedService.value = presetService;
  }

  const value = (name) => form.elements[name]?.value || "";
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
  persistBookingDraft = () => {
    if (suspendDraftSaving) return;
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify({
          version: BOOKING_DRAFT_VERSION,
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
            availableSlots: state.availableSlots,
            calendarMonthIndex: state.calendarMonthIndex,
            selectedDate: state.selectedDate
          },
          view: {
            mobileQuestionIndex,
            organizationMode,
            serviceChoiceMode,
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
    }, 80);
  };
  clearBookingDraft = () => {
    window.clearTimeout(draftSaveTimer);
    try {
      window.localStorage.removeItem(BOOKING_DRAFT_KEY);
      window.sessionStorage.removeItem("imanBookingZip");
      window.sessionStorage.removeItem("imanBookingQualificationDraft");
    } catch {}
  };
  const mobileQuestions = () => allMobileQuestions.filter((question) => (
    !question.hasAttribute("data-occupied-service-question") || value("propertyStatus") === "occupied"
  ));
  const setStatus = (element, message, type = "error") => {
    if (!element) return;
    element.hidden = !message;
    element.textContent = message;
    element.dataset.type = type;
  };
  const accountMode = () => form.elements.accountMode?.value || "guest";
  const syncAccountState = () => {
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
    livingDining: "",
    refrigerator: "",
    oven: "",
    cabinets: "",
    cabinetCount: "",
    drawerCount: "",
    cabinetsEmpty: "",
    additionalCleaning: "",
    excludeKitchenItems: "",
    excludeOven: "",
    excludeRefrigerator: "",
    excludeCabinets: "",
    additionalRooms: ""
  });
  const pricingDetailQuestions = (unit, serviceKey = value("requestedService")) => {
    const isStandard = serviceKey === "standard";
    const isMove = serviceKey === "move";
    return [
    { key: "bedrooms", type: "number", question: "How many bedrooms?", label: "Number of bedrooms", min: 0, max: 20 },
    { key: "fullBathrooms", type: "number", question: "How many full bathrooms?", label: "Number of full bathrooms", min: 0, max: 20 },
    { key: "halfBathrooms", type: "number", question: "How many half bathrooms?", label: "Number of half bathrooms", min: 0, max: 20 },
    {
      key: "livingDining",
      question: "Is the living room and dining room combined or separate?",
      options: [
        { value: "combined", label: "Combined" },
        { value: "separate", label: "Separate" }
      ]
    },
    ...(!isStandard ? [{
      key: "additionalRooms",
      type: "number",
      question: "How many additional separate rooms need cleaning?",
      label: "Number of additional rooms",
      helper: "Include offices, storage rooms, guest rooms, playrooms, dens, studies, and any other separate rooms.",
      min: 0,
      max: 30
    }] : []),
    ...(!isMove ? [{
      key: "refrigerator",
      question: "Would you like the inside of the refrigerator cleaned?",
      options: [
        { value: "yes", label: "Yes (+$40)" },
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
    {
      key: "additionalCleaning",
      question: "Is there anything else you would like us to clean?",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" }
      ]
    },
    ...(isMove ? [{
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
    }] : [])] : [])
  ];
  };
  const HOME_DETAIL_KEYS = new Set([
    "bedrooms",
    "fullBathrooms",
    "halfBathrooms",
    "livingDining",
    "additionalRooms"
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
  const isOrganizationPath = () => (
    organizationMode || state.serviceKey === "organization" || value("serviceIntent") === "organization"
  );
  const currentStageNumber = () => {
    const organizationPath = isOrganizationPath();
    if (quoteContactOverlay && !quoteContactOverlay.hidden) return 5;
    if (state.step === 2) return 5;
    if (state.step === 3) return 6;
    if (state.step === 4) return 7;
    if (organizationPath) return organizationMode ? 2 : 1;
    if (quoteDetailsMode) {
      const current = state.unitDetails[state.currentUnitIndex] || emptyUnitDetails();
      const questions = pricingDetailQuestions(current, value("requestedService"));
      return HOME_DETAIL_KEYS.has(questions[state.currentDetailQuestionIndex]?.key) ? 3 : 4;
    }
    if (serviceChoiceMode || propertyTypeMode || unitCountMode) return 2;
    return 1;
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
    if (stageNumber === 5) {
      if (quoteContactOverlay && !quoteContactOverlay.hidden) {
        const required = Array.from(quoteContactForm?.querySelectorAll("[required]") || []);
        const completed = required.filter((control) => control.type === "checkbox" ? control.checked : Boolean(control.value)).length;
        return 70 + (completed / Math.max(1, required.length)) * 7;
      }
      return 78;
    }
    if (stageNumber === 6) return value("schedule") ? 92 : 86;
    const confirmations = ["completionAgreement", "conditionAgreement", "termsAgreement"]
      .filter((name) => form.elements[name]?.checked).length;
    return 96 + confirmations;
  };
  const syncStageProgress = () => {
    const stages = CLEANING_STAGES;
    const stageNumber = Math.min(stages.length, Math.max(1, currentStageNumber()));
    const stage = stages[stageNumber - 1];
    const rawPercent = Math.min(99, Math.max(stage.start, Math.round(rawProgressPercent(stageNumber))));
    if (lastProgressStage !== stageNumber) {
      lastProgressStage = stageNumber;
      highestProgressInStage = rawPercent;
    } else {
      highestProgressInStage = Math.max(highestProgressInStage, rawPercent);
    }
    const percent = highestProgressInStage;
    document.querySelectorAll("[data-stage-progress]").forEach((progress) => {
      const label = progress.querySelector("[data-stage-label]");
      const percentLabel = progress.querySelector("[data-stage-percent]");
      const meter = progress.querySelector("[data-stage-meter]");
      if (label) label.textContent = `Step ${stageNumber} of ${stages.length} · ${stage.label}`;
      if (percentLabel) percentLabel.textContent = `${percent}% complete`;
      if (meter) meter.style.width = `${percent}%`;
      progress.setAttribute("aria-valuenow", String(percent));
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuetext", `${percent}% complete. Step ${stageNumber} of ${stages.length}: ${stage.label}`);
    });
  };
  const selectedUnitCount = () => Math.min(10, Math.max(1, Number(value("unitCount")) || 1));
  const syncUnitCount = () => {
    const count = selectedUnitCount();
    form.elements.unitCount.value = String(count);
    if (unitCountValue) unitCountValue.textContent = String(count);
    if (unitCountLabel) unitCountLabel.textContent = count === 1 ? "unit" : "units";
    if (unitCountDecrease) unitCountDecrease.disabled = count <= 1;
    if (unitCountIncrease) unitCountIncrease.disabled = count >= 10;
    state.unitDetails = state.unitDetails.slice(0, count);
    while (state.unitDetails.length < count) {
      state.unitDetails.push(emptyUnitDetails());
    }
  };
  const saveCurrentUnitDetails = () => {
    syncUnitCount();
  };
  const loadCurrentUnitDetails = () => {
    syncUnitCount();
    const current = state.unitDetails[state.currentUnitIndex] || emptyUnitDetails();
    const count = selectedUnitCount();
    const questions = pricingDetailQuestions(current);
      state.currentDetailQuestionIndex = Math.min(state.currentDetailQuestionIndex, questions.length - 1);
      const question = questions[state.currentDetailQuestionIndex];
      if (unitDetailsKicker) {
        unitDetailsKicker.textContent = count === 1
          ? `Pricing question ${state.currentDetailQuestionIndex + 1} of ${questions.length}`
          : `Unit ${state.currentUnitIndex + 1} of ${count} · Question ${state.currentDetailQuestionIndex + 1} of ${questions.length}`;
      }
      if (unitDetailsTitle) unitDetailsTitle.textContent = question.question;
      if (unitDetailsCopy) unitDetailsCopy.hidden = true;
      if (standardDetailHelper) {
        standardDetailHelper.hidden = !question.helper;
        standardDetailHelper.textContent = question.helper || "";
      }
      if (standardDetailOptions) {
        standardDetailOptions.hidden = question.type === "number";
        standardDetailOptions.replaceChildren();
        (question.options || []).forEach((option) => {
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
            loadCurrentUnitDetails();
            if (question.key === "additionalCleaning" && option.value === "yes") {
              if (additionalCleaningNotice) additionalCleaningNotice.hidden = false;
              window.setTimeout(() => additionalCleaningNoticeContinue?.focus(), 40);
            }
            setStatus(document.querySelector("[data-eligibility-status]"), "");
          });
          standardDetailOptions.append(button);
        });
      }
      if (standardDetailNumber) standardDetailNumber.hidden = question.type !== "number";
      if (question.type === "number" && standardDetailNumberInput) {
        standardDetailNumberLabel.textContent = question.label;
        standardDetailNumberInput.min = String(question.min);
        standardDetailNumberInput.max = String(question.max);
        standardDetailNumberInput.value = current[question.key];
        standardDetailNumberInput.oninput = () => {
          current[question.key] = standardDetailNumberInput.value;
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
    if (organizationMode) {
      allMobileQuestions.forEach((question) => question.classList.remove("is-mobile-current"));
      if (serviceChoiceForm) serviceChoiceForm.hidden = true;
      if (propertyTypeForm) propertyTypeForm.hidden = true;
      if (unitCountForm) unitCountForm.hidden = true;
      if (quoteDetailsForm) quoteDetailsForm.hidden = true;
      if (organizationForm) organizationForm.hidden = false;
      if (mobileQuestionNav) mobileQuestionNav.hidden = false;
      setQuestionMeta("Question 1 of 1 · Next: Your quote", "About 3 min left");
      if (eligibilityButtonLabel) eligibilityButtonLabel.textContent = "See my price";
      return;
    }
    if (quoteDetailsMode) {
      allMobileQuestions.forEach((question) => question.classList.remove("is-mobile-current"));
      if (organizationForm) organizationForm.hidden = true;
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
    if (serviceChoiceForm) serviceChoiceForm.hidden = true;
    if (propertyTypeForm) propertyTypeForm.hidden = true;
    if (unitCountForm) unitCountForm.hidden = true;
    if (quoteDetailsForm) quoteDetailsForm.hidden = true;
    allMobileQuestions.forEach((question) => {
      const activeIndex = activeQuestions.indexOf(question);
      const isActive = activeIndex !== -1;
      question.classList.toggle("is-mobile-current", isActive && activeIndex === mobileQuestionIndex);
      if (question.hasAttribute("data-occupied-service-question")) {
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
    serviceIntent: value("serviceIntent"),
    cleaningCategory: value("cleaningCategory"),
    propertyOver2000: value("propertyOver2000"),
    waterDamage: value("waterDamage"),
    recentRenovation: value("recentRenovation"),
    excessiveBelongings: value("excessiveBelongings"),
    utilitiesAvailable: value("utilitiesAvailable"),
    propertyAccess: value("propertyAccess"),
    clutter: value("clutter"),
    buildup: value("buildup"),
    hazards: value("hazards"),
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
    if (answers.cleaningCategory === "window") return "window_service";
    if (answers.propertyOver2000 === "yes") return "large_property";
    if (answers.waterDamage === "yes") return "water_damage";
    if (answers.recentRenovation === "yes") return "post_construction";
    if (answers.excessiveBelongings && answers.excessiveBelongings !== "no") return "excessive_belongings";
    if (answers.utilitiesAvailable === "no") return "utilities_unavailable";
    if (answers.propertyAccess === "no") return "limited_property_access";
    if (answers.clutter && answers.clutter !== "low") return "heavy_clutter";
    if (answers.buildup === "heavy") return "heavy_buildup";
    if (answers.hazards && answers.hazards !== "none") return "safety_concern";
    return "";
  };
  const recommend = (answers) => {
    const qualificationReason = qualificationReasonFromAnswers(answers);
    if (qualificationReason) {
      const redirect = qualificationRedirects[qualificationReason];
      return {
        type: "review",
        internalReason: qualificationReason,
        reason: redirect.description,
        service: redirect.service || ""
      };
    }
    if (answers.condition === "severe") return { type: "review", reason: "The reported property condition requires a custom quote so we can review the scope accurately." };
    if (answers.propertyStatus === "renovated") return { type: "instant", serviceKey: "post", reason: "Because the property was recently renovated or constructed, we recommend Post-Construction Cleaning." };
    if (answers.propertyStatus === "moving") return { type: "instant", serviceKey: "move", reason: "Because the property is vacant for a move, we recommend Move-In / Move-Out Cleaning." };
    if (answers.requestedService === "details") {
      return { type: "review", reason: "Detail Cleaning is customized around specific rooms, surfaces, appliances, and priority tasks.", reviewUrl: "./quote.html?service=details-cleaning" };
    }
    if (["heavy", "average"].includes(answers.condition) || ["three_to_six_months", "over_six_months", "never"].includes(answers.lastCleaned)) {
      return { type: "instant", serviceKey: "deep", reason: "Based on the cleaning history or buildup, Deep Cleaning is the appropriate starting service." };
    }
    if (answers.requestedService === "deep") {
      return { type: "instant", serviceKey: "deep", reason: "You selected Deep Cleaning for a more thorough top-to-bottom service." };
    }
    if (answers.requestedService === "standard") {
      return { type: "instant", serviceKey: "standard", reason: "You selected Standard Cleaning, and the property condition appears eligible for it." };
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
      answers.requestedService === "standard" ? "standard-cleaning" :
      answers.requestedService === "details" ? "details-cleaning" : ""
    );
    if (selectedService) params.set("service", selectedService);
    const preservedAnswers = {
      propertyStatus: answers.propertyStatus,
      requestedService: answers.requestedService,
      serviceIntent: answers.serviceIntent,
      cleaningCategory: answers.cleaningCategory,
      propertyOver2000: answers.propertyOver2000,
      waterDamage: answers.waterDamage,
      recentRenovation: answers.recentRenovation,
      excessiveBelongings: answers.excessiveBelongings,
      utilitiesAvailable: answers.utilitiesAvailable,
      propertyAccess: answers.propertyAccess,
      clutter: answers.clutter,
      buildup: answers.buildup,
      hazards: answers.hazards,
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
    return `./quote.html?${params.toString()}`;
  };
  const showQualificationRedirect = (internalReason) => {
    const redirect = qualificationRedirects[internalReason];
    if (!redirect) return;
    const answers = eligibilityFromForm();
    state.eligibility = answers;
    pendingQualificationUrl = quoteUrlFor({
      type: "review",
      internalReason,
      reason: redirect.description,
      service: redirect.service || "",
      category: redirect.category || "residential"
    }, answers);
    if (qualificationRedirectTitle) qualificationRedirectTitle.textContent = "This service needs a custom quote";
    if (qualificationRedirectDescription) {
      qualificationRedirectDescription.textContent = "Based on your answers, we need a few additional details to provide an accurate price. Your information has been saved.";
    }
    if (qualificationRedirectReason) qualificationRedirectReason.textContent = redirect.description;
    if (qualificationRedirectContinue) qualificationRedirectContinue.textContent = "Request a custom quote →";
    persistBookingDraft();
    if (qualificationRedirectOverlay) qualificationRedirectOverlay.hidden = false;
    window.setTimeout(() => qualificationRedirectContinue?.focus(), 40);
  };
  const showQualificationComplete = () => {
    if (!qualificationCompleteOverlay) return;
    qualificationCompleteOverlay.hidden = false;
    window.setTimeout(() => qualificationCompleteContinue?.focus(), 40);
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
    organizationMode = true;
    serviceChoiceMode = false;
    propertyTypeMode = false;
    unitCountMode = false;
    quoteDetailsMode = false;
    syncMobileQuestion();
    wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => organizationHoursInput?.focus(), 40);
  };
  const enterServiceChoice = () => {
    organizationMode = false;
    serviceChoiceMode = true;
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
  const enterPropertyTypeChoice = () => {
    organizationMode = false;
    serviceChoiceMode = false;
    propertyTypeMode = true;
    unitCountMode = false;
    quoteDetailsMode = false;
    syncMobileQuestion();
    wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => {
      const selected = propertyTypeButtons.find((button) => button.classList.contains("is-selected"));
      (selected || propertyTypeButtons[0])?.focus();
    }, 40);
  };
  const enterUnitCountChoice = () => {
    organizationMode = false;
    serviceChoiceMode = false;
    propertyTypeMode = false;
    unitCountMode = true;
    quoteDetailsMode = false;
    syncMobileQuestion();
    wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => unitCountIncrease?.focus(), 40);
  };
  const enterQuoteDetails = () => {
    organizationMode = false;
    serviceChoiceMode = false;
    propertyTypeMode = false;
    unitCountMode = false;
    quoteDetailsMode = true;
    state.currentUnitIndex = 0;
    state.currentDetailQuestionIndex = 0;
    syncUnitCount();
    closeQualificationComplete();
    syncMobileQuestion();
    wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => {
      standardDetailOptions?.querySelector("button")?.focus();
      if (!standardDetailOptions?.querySelector("button")) standardDetailNumberInput?.focus();
    }, 40);
  };
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
    enterServiceChoice();
  };
  const exitServiceChoice = () => {
    organizationMode = false;
    serviceChoiceMode = false;
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
  const availabilityRequest = async () => {
    if (/_formula$/.test(state.pricingMode)) {
      return fetch("/api/booking/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricingMode: state.pricingMode,
          serviceKey: state.serviceKey,
          unitDetails: state.unitDetails
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
    showSavedQuoteDelivery("Your price is ready. Sending your secure quote link by email and text…");
    try {
      const response = await fetch("/api/booking/saved-quote", {
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
          smsConsent: Boolean(quoteContactForm?.elements.quoteSmsConsent?.checked),
          website: quoteContactForm?.elements.website?.value || ""
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Your secure quote link could not be sent.");
      const emailSent = ["sent", "already_sent"].includes(data.delivery?.email);
      const smsSent = ["sent", "already_sent"].includes(data.delivery?.sms);
      if (emailSent && smsSent) {
        showSavedQuoteDelivery("Your secure quote link was sent to your email and phone.", "success");
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
    } catch (error) {
      showSavedQuoteDelivery(error.message || "Your price is ready, but the secure quote link could not be sent.", "error");
    }
  };
  const syncQuotedServiceCopy = () => {
    const isOrganization = state.serviceKey === "organization";
    const priceNotice = document.querySelector("[data-price-notice]");
    if (priceNotice) priceNotice.hidden = isOrganization;
    const completionCopy = document.querySelector("[data-completion-agreement-copy]");
    if (completionCopy) {
      completionCopy.textContent = isOrganization
        ? `I understand that this booking includes ${hours(state.package?.manHours || 0)} hours with one professional organizer at $60 per hour.`
        : "I understand that this package includes a fixed number of labor-hours and may not cover every listed or requested task. Completion depends on the home’s actual condition, clutter, buildup, size, access, and the accuracy of my answers.";
    }
    document.querySelectorAll("[data-cleaning-schedule-details]").forEach((element) => {
      element.hidden = isOrganization;
    });
  };
  const calculateAndShowQuote = async ({ sendLink = true } = {}) => {
    const status = document.querySelector("[data-eligibility-status]");
    setStatus(status, "Calculating your itemized price…", "info");
    const response = await availabilityRequest();
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The package could not be loaded.");
    state.package = data.package;
    state.initialSlots = data.slots || [];
    document.querySelector("[data-recommendation-title]").textContent =
      `${serviceNames[state.serviceKey]} — ${state.package.tierLabel}`;
    document.querySelector("[data-recommendation-reason]").textContent =
      state.serviceKey === "organization"
        ? "Your estimate is based on the number of organization and decluttering hours you selected."
        : "Your personalized estimate is based on the cleaning details you provided.";
    document.querySelector("[data-package-price]").textContent = money(state.package.price);
    document.querySelector("[data-man-hours]").textContent = `${hours(state.package.manHours)} labor-hours`;
    document.querySelector("[data-total-due]").textContent = money(bookingDeposit(state.package.price));
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
  const setSchedulerStatus = (message = "", type = "") => {
    if (!schedulerStatus) return;
    schedulerStatus.textContent = message;
    schedulerStatus.dataset.type = type;
  };
  const renderTimeSlots = () => {
    if (!timeSlots || !selectedDateLabel) return;
    timeSlots.replaceChildren();
    if (!state.selectedDate) {
      selectedDateLabel.textContent = "Select a date to see available times.";
      const message = document.createElement("p");
      message.className = "booking-time-empty";
      message.textContent = "Choose a highlighted date from the calendar.";
      timeSlots.append(message);
      return;
    }

    selectedDateLabel.textContent = longDate(state.selectedDate);
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
  const renderPriceBreakdown = (pkg) => {
    const breakdown = document.querySelector("[data-price-breakdown]");
    const priceLabel = document.querySelector("[data-package-price-label]");
    const isFormula = /_formula$/.test(pkg?.pricingMode || "");
    if (breakdown) breakdown.hidden = !isFormula;
    if (priceLabel) priceLabel.textContent = isFormula ? "Total estimated price" : "Your personalized price";
    if (!isFormula) return;
    const unitContainer = document.querySelector("[data-price-breakdown-units]");
    if (unitContainer) {
      unitContainer.replaceChildren();
      (pkg.units || []).forEach((unit) => {
        const section = document.createElement("section");
        const heading = document.createElement("h4");
        heading.textContent = pkg.units.length === 1 ? pkg.serviceLabel : `Unit ${unit.unitNumber} — ${pkg.serviceLabel}`;
        const list = document.createElement("ul");
        [...(unit.baseItems || []), ...(unit.addOns || [])]
          .filter((item) => item.amount > 0 || item.included)
          .forEach((item) => {
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
      });
    }
    document.querySelector("[data-standard-base-price]").textContent = money(pkg.baseSubtotal);
    document.querySelector("[data-addon-total]").textContent = money(pkg.addOnSubtotal);
    document.querySelector("[data-addon-total-row]").hidden = !pkg.addOnTotal;
    document.querySelector("[data-quote-subtotal]").textContent = money(pkg.subtotal);
    document.querySelector("[data-quote-tax]").textContent = money(pkg.tax);
    document.querySelector("[data-quote-total]").textContent = money(pkg.total);
  };

  buildAnswerChoices();
  serviceChoiceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selectedService = button.dataset.bookingService;
      form.elements.requestedService.value = selectedService;
      form.elements.propertyStatus.value = selectedService === "move" ? "moving" : "occupied";
      syncServiceChoice();
      syncStageProgress();
      setStatus(document.querySelector("[data-eligibility-status]"), "");
    });
  });
  syncServiceChoice();
  propertyTypeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selectedPropertyType = button.dataset.bookingPropertyType;
      form.elements.propertyType.value = selectedPropertyType;
      syncPropertyTypeChoice();
      syncStageProgress();
      setStatus(document.querySelector("[data-eligibility-status]"), "");
    });
  });
  unitCountDecrease?.addEventListener("click", () => {
    form.elements.unitCount.value = String(selectedUnitCount() - 1);
    syncUnitCount();
    syncStageProgress();
  });
  unitCountIncrease?.addEventListener("click", () => {
    form.elements.unitCount.value = String(selectedUnitCount() + 1);
    syncUnitCount();
    syncStageProgress();
  });
  syncPropertyTypeChoice();
  syncUnitCount();
  form.querySelector("[data-question-back]")?.addEventListener("click", () => {
    if (organizationMode) {
      organizationMode = false;
      mobileQuestionIndex = 0;
      syncMobileQuestion();
      questionFocusTarget(mobileQuestions()[0])?.focus();
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
    if (pendingQualificationUrl) window.location.assign(pendingQualificationUrl);
  });
  closeQualificationComplete = () => {
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
    if (organizationMode) {
      organizationHoursInput?.focus();
      return;
    }
    standardDetailOptions?.querySelector("button")?.focus();
    if (!standardDetailOptions?.querySelector("button")) standardDetailNumberInput?.focus();
  });
  qualificationCompleteBack?.addEventListener("click", () => {
    closeQualificationComplete();
    questionFocusTarget(mobileQuestions()[mobileQuestionIndex])?.focus();
  });
  qualificationCompleteContinue?.addEventListener("click", enterServiceChoice);
  ["cleaningCategory", "propertyOver2000", "waterDamage", "recentRenovation", "utilitiesAvailable", "propertyAccess", "clutter", "buildup", "hazards"].forEach((fieldName) => {
    form.elements[fieldName]?.addEventListener("change", () => {
      const internalReason = qualificationReasonFromAnswers(eligibilityFromForm());
      if (internalReason) showQualificationRedirect(internalReason);
    });
  });
  syncMobileQuestion();

  document.querySelector("[data-check-eligibility]").addEventListener("click", async () => {
    const status = document.querySelector("[data-eligibility-status]");
    const activeQuestions = mobileQuestions();
    if (organizationMode) {
      const selectedHours = Number(organizationHoursInput?.value);
      if (!Number.isInteger(selectedHours) || selectedHours < 4 || selectedHours > 24) {
        setStatus(status, "Please enter a whole number from 4 to 24 hours.");
        organizationHoursInput?.focus();
        return;
      }
      state.serviceKey = "organization";
      state.pricingMode = "organization_formula";
      state.packageIds = [];
      state.unitDetails = [{
        hours: selectedHours,
        notes: organizationNotesInput?.value.trim() || ""
      }];
      form.elements.requestedService.value = "organization";
      form.elements.propertyStatus.value = "organization";
      state.eligibility = {
        serviceIntent: "organization",
        requestedService: "organization",
        propertyStatus: "organization",
        serviceZip: value("zip"),
        unitCount: 1,
        units: state.unitDetails.map((unit) => ({ unitNumber: 1, ...unit }))
      };
      setStatus(status, "");
      showQuoteContact();
      return;
    }
    if (serviceChoiceMode) {
      if (!value("requestedService")) {
        setStatus(status, "Please choose a cleaning service to continue.");
        serviceChoiceButtons[0]?.focus();
        return;
      }
      setStatus(status, "");
      enterPropertyTypeChoice();
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
      const invalidControl = questionControls(currentQuestion).find((control) => control.required && !control.value);
      if (invalidControl) {
        setStatus(status, "Please answer every part of this question to continue.");
        questionControlFocusTarget(currentQuestion, invalidControl)?.focus();
        return;
      }
      if (mobileQuestionIndex === 0 && value("serviceIntent") === "organization") {
        setStatus(status, "");
        enterOrganizationDetails();
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
    const detailValue = currentUnit[detailQuestion.key];
    const numericValue = Number(detailValue);
    if (detailQuestion.type === "number") {
      if (detailValue === "" || !Number.isInteger(numericValue) || numericValue < detailQuestion.min || numericValue > detailQuestion.max) {
        setStatus(status, `Enter a whole number from ${detailQuestion.min} to ${detailQuestion.max}.`);
        standardDetailNumberInput?.focus();
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
      state.currentUnitIndex = 0;
      const firstUnitQuestions = pricingDetailQuestions(
        state.unitDetails[0] || emptyUnitDetails(),
        value("requestedService")
      );
      state.currentDetailQuestionIndex = firstUnitQuestions.findIndex((question) => !HOME_DETAIL_KEYS.has(question.key));
      setStatus(status, "✓ Home details completed. Now choose any extras.", "success");
      syncMobileQuestion();
      wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (state.currentUnitIndex < selectedUnitCount() - 1) {
      const completedUnit = state.currentUnitIndex + 1;
      state.currentUnitIndex += 1;
      const nextUnitQuestions = pricingDetailQuestions(
        state.unitDetails[state.currentUnitIndex] || emptyUnitDetails(),
        value("requestedService")
      );
      state.currentDetailQuestionIndex = nextUnitQuestions.findIndex((question) => !HOME_DETAIL_KEYS.has(question.key));
      setStatus(status, `✓ Unit ${completedUnit} completed. Now choose extras for Unit ${completedUnit + 1}.`, "success");
      syncMobileQuestion();
      wizardDialog?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const required = ["propertyStatus", "requestedService", "serviceIntent", "cleaningCategory", "propertyOver2000", "waterDamage", "recentRenovation", "excessiveBelongings", "utilitiesAvailable", "propertyAccess", "clutter", "buildup", "hazards", "propertyType", "unitCount"];
    const blank = required.find((name) => !value(name));
    if (blank) {
      setStatus(status, "Please answer every required eligibility question.");
      form.elements[blank].focus();
      return;
    }

    state.eligibility = eligibilityFromForm();
    const recommendation = recommend(state.eligibility);
    if (recommendation.type === "review") {
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
      await calculateAndShowQuote();
    } catch (error) {
      setStatus(quoteContactStatus, error.message || "Your quote could not be prepared.");
    } finally {
      quoteContactSubmit.disabled = false;
      quoteContactSubmit.textContent = "View my quote →";
    }
  });

  document.querySelector("[data-load-availability]").addEventListener("click", async () => {
    if (!form.elements.completionAgreement.checked) {
      form.elements.completionAgreement.reportValidity();
      form.elements.completionAgreement.focus();
      return;
    }
    const button = document.querySelector("[data-load-availability]");
    button.disabled = true;
    button.textContent = "Loading availability…";
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
      button.disabled = false;
      button.textContent = "Choose my appointment →";
    }
  });

  const syncCheckoutReview = () => {
    document.querySelector("[data-checkout-package]").textContent =
      `${state.package.serviceLabel} — ${state.package.tierLabel}`;
    const checkoutTeamDescription = document.querySelector("[data-checkout-team-description]");
    if (checkoutTeamDescription) {
      checkoutTeamDescription.textContent = state.serviceKey === "organization"
        ? `${hours(state.package.manHours)} hours will be provided by one professional organizer at $60 per hour.`
        : `${hours(state.package.manHours)} total labor-hours will be provided by a professional two-person cleaning team for approximately ${teamTime(state.package.teamHours)} at the property.`;
    }
    document.querySelector("[data-checkout-schedule]").textContent =
      form.elements.schedule.options[form.elements.schedule.selectedIndex].textContent;
    document.querySelector("[data-labor-agreement]").textContent =
      state.serviceKey === "organization"
        ? `I understand that this booking includes ${hours(state.package.manHours)} hours with one professional organizer at $60 per hour.`
        : `I understand that this package includes ${hours(state.package.manHours)} total labor-hours, provided by a professional two-person cleaning team for approximately ${teamTime(state.package.teamHours)} at the property.`;
    const conditionAgreementCopy = document.querySelector("[data-condition-agreement-copy]");
    if (conditionAgreementCopy) {
      conditionAgreementCopy.textContent = state.serviceKey === "organization"
        ? "I confirm that the selected hours and appointment note accurately describe the organization or decluttering service I need."
        : "I confirm that my answers accurately represent the property’s current condition. No additional time or charges will be added without my approval.";
    }
    document.querySelector("[data-total-due]").textContent = money(bookingDeposit(state.package.price));
  };

  document.querySelector("[data-continue-contact]").addEventListener("click", () => {
    if (!value("schedule")) {
      setSchedulerStatus(
        state.selectedDate
          ? "Please choose an available time to continue."
          : "Please choose an available date, then select a time.",
        "error"
      );
      const focusTarget = state.selectedDate
        ? timeSlots?.querySelector("button")
        : calendarGrid?.querySelector("button.is-available");
      focusTarget?.focus();
      return;
    }
    syncCheckoutReview();
    goToStep(4);
  });

  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetStep = Number(button.dataset.back);
      if (targetStep === 1) {
        if (state.serviceKey === "organization") {
          organizationMode = true;
          serviceChoiceMode = false;
          propertyTypeMode = false;
          unitCountMode = false;
          quoteDetailsMode = false;
          syncMobileQuestion();
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
    if (accountMode() === "account" && !currentAccount) {
      setStatus(status, "Log in or create an account, or choose Book as a guest.", "info");
      openAccountDialog("login");
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
    if (!serviceArea.isServed(finalZip)) {
      setStatus(status, "Please enter a ZIP code within our NYC and Long Island service area.");
      checkoutZip.focus();
      return;
    }
    checkoutZip.value = finalZip;
    applyServiceZip(finalZip);

    const payButton = document.querySelector("[data-pay-button]");
    payButton.disabled = true;
    payButton.textContent = "Starting secure payment…";
    setStatus(status, "Holding your appointment and opening Stripe…", "info");

    const priorities = Array.from(form.querySelectorAll('input[name="priorities"]:checked')).map((input) => input.value);
    const payload = {
      accountMode: accountMode(),
      packageId: state.package.id,
      packageIds: state.packageIds,
      pricingMode: state.pricingMode,
      eligibility: state.eligibility,
      unitDetails: state.unitDetails.map((unit, index) => ({
        unitNumber: index + 1,
        ...unit
      })),
      schedule: value("schedule"),
      priorities,
      notes: state.serviceKey === "organization"
        ? (organizationNotesInput?.value.trim() || state.unitDetails[0]?.notes || "")
        : value("notes"),
      customer: {
        firstName: value("firstName"),
        lastName: value("lastName"),
        email: value("email"),
        phone: value("phone"),
        address: value("address"),
        city: value("city"),
        state: value("state"),
        zip: value("zip")
      },
      agreements: {
        laborHours: form.elements.laborHoursAgreement.checked,
        completion: form.elements.completionAgreement.checked,
        condition: form.elements.conditionAgreement.checked,
        terms: form.elements.termsAgreement.checked
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
      window.location.href = data.checkoutUrl;
    } catch (error) {
      setStatus(status, error.message || "Secure checkout could not be started.");
      payButton.disabled = false;
      payButton.textContent = "Pay 25% deposit & confirm booking";
    }
  });

  const restoreSavedQuote = async (token) => {
    if (!token) return;
    if (zipStatus) {
      zipStatus.hidden = false;
      zipStatus.dataset.type = "success";
      zipStatus.textContent = "Opening your saved quote…";
    }
    try {
      const response = await fetch(`/api/booking/saved-quote?token=${encodeURIComponent(token)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "This saved quote could not be opened.");
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
      state.initialSlots = [];
      if (state.serviceKey === "organization") {
        organizationHoursInput.value = String(state.unitDetails[0]?.hours || 4);
        organizationNotesInput.value = state.unitDetails[0]?.notes || "";
      }
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
      if (serviceArea.isServed(restoredZip)) applyServiceZip(restoredZip);
      syncServiceChoice();
      syncPropertyTypeChoice();
      allMobileQuestions.forEach(syncAnswerChoices);
      syncUnitCount();
      document.querySelector("[data-recommendation-title]").textContent =
        `${serviceNames[state.serviceKey]} — ${state.package.tierLabel}`;
      document.querySelector("[data-recommendation-reason]").textContent =
        "Your saved personalized estimate is ready. Choose an appointment whenever you’re ready to book.";
      document.querySelector("[data-package-price]").textContent = money(state.package.price);
      document.querySelector("[data-man-hours]").textContent = `${hours(state.package.manHours)} labor-hours`;
      document.querySelector("[data-total-due]").textContent = money(bookingDeposit(state.package.price));
      syncQuotedServiceCopy();
      renderPriceBreakdown(state.package);
      showSavedQuoteDelivery("Your saved quote is open. You can choose an appointment and pay when you’re ready.", "success");
      closeZipGate();
      openWizard();
      goToStep(2);
    } catch (error) {
      showZipError(error.message || "This saved quote could not be opened.");
    }
  };

  const savedQuoteToken = new URLSearchParams(window.location.search).get("quote");
  const restoreBookingDraft = () => {
    let draft;
    try {
      draft = JSON.parse(window.localStorage.getItem(BOOKING_DRAFT_KEY) || "null");
    } catch {
      return false;
    }
    if (!draft || draft.version !== BOOKING_DRAFT_VERSION || !draft.fields) return false;

    suspendDraftSaving = true;
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
      "availableSlots",
      "calendarMonthIndex",
      "selectedDate"
    ].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(savedState, key)) state[key] = savedState[key];
    });
    const savedView = draft.view || {};
    mobileQuestionIndex = Math.max(0, Number(savedView.mobileQuestionIndex) || 0);
    organizationMode = Boolean(savedView.organizationMode);
    serviceChoiceMode = Boolean(savedView.serviceChoiceMode);
    propertyTypeMode = Boolean(savedView.propertyTypeMode);
    unitCountMode = Boolean(savedView.unitCountMode);
    quoteDetailsMode = Boolean(savedView.quoteDetailsMode);

    const restoredZip = serviceArea.normalize(value("zip"));
    if (serviceArea.isServed(restoredZip)) applyServiceZip(restoredZip);
    syncServiceChoice();
    syncPropertyTypeChoice();
    syncUnitCount();
    allMobileQuestions.forEach(syncAnswerChoices);
    syncMobileQuestion();

    if (state.package) {
      document.querySelector("[data-recommendation-title]").textContent =
        `${serviceNames[state.serviceKey] || state.package.serviceLabel} — ${state.package.tierLabel}`;
      document.querySelector("[data-recommendation-reason]").textContent =
        state.serviceKey === "organization"
          ? "Your estimate is based on the number of organization and decluttering hours you selected."
          : "Your personalized estimate is based on the cleaning details you provided.";
      document.querySelector("[data-package-price]").textContent = money(state.package.price);
      document.querySelector("[data-man-hours]").textContent = `${hours(state.package.manHours)} labor-hours`;
      document.querySelector("[data-total-due]").textContent = money(bookingDeposit(state.package.price));
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
    openWizard();
    const saveCopy = document.querySelector("[data-booking-save-copy]");
    if (saveCopy) saveCopy.textContent = "Saved progress restored";
    suspendDraftSaving = false;
    window.setTimeout(persistBookingDraft, 500);
    return true;
  };

  form.addEventListener("input", persistBookingDraft);
  form.addEventListener("change", persistBookingDraft);
  form.addEventListener("input", syncStageProgress);
  form.addEventListener("change", syncStageProgress);
  quoteContactForm?.addEventListener("input", persistBookingDraft);
  quoteContactForm?.addEventListener("change", persistBookingDraft);
  quoteContactForm?.addEventListener("input", syncStageProgress);
  quoteContactForm?.addEventListener("change", syncStageProgress);
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-booking-cancel]")) return;
    window.setTimeout(persistBookingDraft, 0);
  });
  document.querySelector("[data-booking-cancel]")?.addEventListener("click", () => {
    persistBookingDraft();
    const saveCopy = document.querySelector("[data-booking-save-copy]");
    if (saveCopy) saveCopy.textContent = "Progress saved";
    window.setTimeout(closeWizard, 120);
  });

  if (savedQuoteToken) {
    clearBookingDraft();
    void restoreSavedQuote(savedQuoteToken);
  } else if (!restoreBookingDraft()) {
    openZipGate();
  }

  if (new URLSearchParams(window.location.search).get("payment") === "cancelled") {
    setStatus(document.querySelector("[data-eligibility-status]"), "Payment was cancelled. No appointment was confirmed.", "info");
  }
})();
