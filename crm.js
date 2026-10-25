(() => {
  "use strict";

  const STATUS_OPTIONS = ["New", "Confirmed", "Cleaner assigned", "In progress", "Completed", "Cancelled"];
  const ACTIVE_STATUSES = new Set(["New", "Confirmed", "Cleaner assigned", "In progress"]);
  const CONCERN_STATUSES = ["Submitted", "In review", "Waiting on customer", "Resolved"];
  const state = {
    token: sessionStorage.getItem("imanCrmAdminToken") || "",
    bookings: [],
    quotes: [],
    manualContacts: [],
    emailSuppressions: [],
    calls: [],
    callbacks: [],
    sameDayRequests: [],
    conversations: [],
    conversationsError: "",
    concerns: [],
    concernsError: "",
    concernStatus: "All",
    view: "overview",
    status: "All",
    quoteType: "All",
    quoteSort: "newest",
    marketingSegment: "All",
    callbackStatus: "Pending",
    sort: "soonest",
    search: "",
    selectedId: ""
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const loginView = $("[data-login-view]");
  const iosInstall = $("[data-ios-install]");
  const app = $("[data-crm-app]");
  const dialog = $("[data-booking-dialog]");
  const deleteQuoteDialog = $("[data-delete-quote-dialog]");
  const dialerDialog = $("[data-dialer-dialog]");
  const messageDialog = $("[data-message-dialog]");
  const loading = $("[data-loading]");
  const quoteFormSnapshots = new WeakMap();
  let toastTimer;
  let voiceDevice = null;
  let activeCall = null;
  let callConnecting = false;
  let activeCallRecord = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cents(value) {
    return Math.max(0, Math.round(Number(value || 0)));
  }

  function paymentFor(booking) {
    const estimate = booking.estimate || {};
    const payment = estimate.payment || {};
    const total = cents(payment.totalCents || Number(estimate.total || estimate.high || estimate.low || 0) * 100);
    const deposit = cents(payment.depositCents || payment.paidCents || total * .25);
    const paid = cents(payment.paidCents || (payment.status === "deposit_paid" ? deposit : 0));
    const remaining = cents(payment.remainingCents ?? Math.max(0, total - paid));
    return { ...payment, totalCents: total, depositCents: deposit, paidCents: paid, remainingCents: remaining };
  }

  function hasPaidDeposit(booking) {
    const rawPayment = booking.estimate?.payment || {};
    const payment = paymentFor(booking);
    const paidStatuses = new Set(["deposit_paid", "paid", "captured", "fully_paid"]);
    return payment.paidCents > 0 && (
      paidStatuses.has(String(rawPayment.status || "").toLowerCase()) ||
      (payment.depositCents > 0 && payment.paidCents >= payment.depositCents)
    );
  }

  function money(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents(value) / 100);
  }

  function dateObject(value) {
    const date = new Date(value || "");
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function appointmentDate(booking, mode = "full") {
    if (booking.estimate?.awaitingSchedule || booking.estimate?.managedQuote?.awaitingSchedule) return booking.scheduleLabel || "To be scheduled";
    const date = dateObject(booking.schedule);
    if (!date) return booking.scheduleLabel || "Not scheduled";
    const options = mode === "short"
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "America/New_York" }).format(date);
  }

  function appointmentInputValue(booking) {
    if (booking.estimate?.awaitingSchedule || booking.estimate?.managedQuote?.awaitingSchedule) return "";
    const date = dateObject(booking.schedule);
    if (!date) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  }

  function bookingHours(booking) {
    const estimate = booking.estimate || {};
    const cleaners = Math.max(1, Number(estimate.cleanerCount || 1));
    const laborHours = Math.max(.25, Number(estimate.laborHours || estimate.manHours || 1));
    const teamHours = Math.max(.25, Number(estimate.teamHours || estimate.hours || laborHours / cleaners));
    return { cleaners, laborHours, teamHours };
  }

  function timeTrackingFor(booking) {
    const tracking = booking.estimate?.timeTracking || {};
    const entries = Array.isArray(tracking.entries) ? tracking.entries : [];
    const activeEntry = entries.find((entry) => entry.clockInAt && !entry.clockOutAt);
    return { ...tracking, entries, activeEntry };
  }

  function qualityPhotosFor(booking) {
    const saved = booking.estimate?.qualityPhotos || {};
    return {
      ...saved,
      before: Array.isArray(saved.before) ? saved.before : [],
      after: Array.isArray(saved.after) ? saved.after : []
    };
  }

  function cleanerAssignmentFor(booking) {
    const assignment = booking.estimate?.assignment || {};
    return {
      ...assignment,
      cleanerNames: Array.isArray(assignment.cleanerNames) ? assignment.cleanerNames : []
    };
  }

  function qualityPhotoList(photos) {
    if (!photos.length) return '<p class="crm-photo-empty">No pictures uploaded yet.</p>';
    return `<div class="crm-photo-list">${photos.map((photo, index) => `
      <a href="${escapeHtml(photo.webViewLink || "#")}"${photo.webViewLink ? ' target="_blank" rel="noopener"' : ""}>
        <span>${index + 1}</span><strong>${escapeHtml(photo.name || `Picture ${index + 1}`)}</strong><small>${escapeHtml(clockTime(photo.uploadedAt))}</small>
      </a>`).join("")}</div>`;
  }

  function clockTime(value) {
    const date = dateObject(value);
    if (!date) return "Not recorded";
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York"
    }).format(date);
  }

  function durationLabel(minutes) {
    const total = Math.max(0, Math.round(Number(minutes || 0)));
    const hours = Math.floor(total / 60);
    const remainder = total % 60;
    if (!hours) return `${remainder} min`;
    return `${hours} hr${hours === 1 ? "" : "s"} ${remainder} min`;
  }

  function shortDay(booking) {
    const date = dateObject(booking.schedule);
    if (!date) return { day: "—", month: "TBD" };
    return {
      day: new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "America/New_York" }).format(date),
      month: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "America/New_York" }).format(date)
    };
  }

  function statusKey(status) {
    return String(status || "New").toLowerCase().replace(/\s+/g, "-");
  }

  function statusBadge(status) {
    const safe = escapeHtml(status || "New");
    return `<span class="crm-status" data-status="${statusKey(status)}">${safe}</span>`;
  }

  function showLoading(show, message = "Updating your CRM…") {
    $("p", loading).textContent = message;
    loading.hidden = !show;
  }

  function toast(message, type = "success") {
    const element = $("[data-toast]");
    clearTimeout(toastTimer);
    element.textContent = message;
    element.className = `crm-toast is-visible${type === "error" ? " is-error" : ""}`;
    toastTimer = setTimeout(() => { element.className = "crm-toast"; }, 4200);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": state.token,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "The CRM request could not be completed.");
      error.status = response.status;
      error.details = data;
      throw error;
    }
    return data;
  }

  function normalizeDialNumber(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    throw new Error("Enter a valid 10-digit U.S. or Canadian phone number.");
  }

  function phoneKey(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length >= 10 ? digits.slice(-10) : digits;
  }

  function communicationButtons({ phone, customerName, sourceId, sourceType }) {
    if (!phoneKey(phone)) return '<span class="crm-history-empty">Customer phone number unavailable.</span>';
    const attributes = `data-customer-phone="${escapeHtml(phone)}" data-customer-name="${escapeHtml(customerName || "Customer")}" data-source-id="${escapeHtml(sourceId || "")}" data-source-type="${escapeHtml(sourceType || "")}"`;
    return `<div class="crm-contact-actions">
      <button class="crm-primary" type="button" data-call-customer ${attributes}>☎ Call</button>
      <button class="crm-row-button" type="button" data-text-customer ${attributes}>✉ Text</button>
    </div>`;
  }

  function customerHistoryMarkup(phone) {
    const key = phoneKey(phone);
    if (!key) return "";
    const calls = state.calls.filter((call) => phoneKey(call.phone) === key).slice(0, 8);
    const conversations = state.conversations.filter((conversation) => phoneKey(conversation.customerContact) === key).slice(0, 8);
    return `<section class="crm-detail-section">
      <div class="crm-section-heading"><div><h3>Customer communication history</h3><p>Calls and text conversations connected to this phone number.</p></div></div>
      <div class="crm-history-grid">
        <div class="crm-history-panel"><h4>Call history</h4>${calls.length ? `<div class="crm-history-list">${calls.map((call) => `<div><button class="crm-history-item" type="button" data-open-call="${escapeHtml(call.id)}"><strong>${escapeHtml(submittedDate(call.calledAt))} · ${escapeHtml(callDuration(call.durationSeconds))}</strong><span>${escapeHtml(String(call.status || "Completed").replace(/_/g, " "))} · ${escapeHtml(call.callType || "Call")}</span></button>${callBackButton(call)}</div>`).join("")}</div>` : '<p class="crm-history-empty">No calls recorded for this customer yet.</p>'}</div>
        <div class="crm-history-panel"><h4>Text history</h4>${conversations.length ? `<div class="crm-history-list">${conversations.map((conversation) => `<button class="crm-history-item" type="button" data-open-conversation="${escapeHtml(conversation.id)}"><strong>${escapeHtml(submittedDate(conversation.updatedAt))} · ${escapeHtml(conversation.messageCount || 0)} messages</strong><span>${escapeHtml(conversationPreview(conversation.lastMessage) || "Conversation")}</span></button>`).join("")}</div>` : '<p class="crm-history-empty">No texts recorded for this customer yet.</p>'}</div>
      </div>
    </section>`;
  }

  function setDialerStatus(message, type = "") {
    const status = $("[data-dialer-status]");
    status.textContent = message;
    status.className = `crm-dialer-status${type ? ` is-${type}` : ""}`;
  }

  function setDialerActive(active) {
    $("[data-start-call]").disabled = active;
    $("[data-dialer-number]").disabled = active;
    $("[data-end-call]").disabled = !active;
  }

  function finishCall(message = "Call ended.", status = "completed") {
    const callRecord = activeCallRecord;
    activeCallRecord = null;
    activeCall = null;
    setDialerActive(false);
    setDialerStatus(message);
    if (callRecord?.id) {
      const durationSeconds = Math.max(0, Math.round((Date.now() - callRecord.startedAt) / 1000));
      api("/api/crm/customer-call", {
        method: "PATCH",
        body: JSON.stringify({ callId: callRecord.id, durationSeconds, status })
      }).then(() => loadBookings({ quiet: true })).catch(() => toast("The call ended, but its history could not be updated.", "error"));
    }
  }

  async function refreshVoiceToken() {
    const data = await api("/api/crm/voice-token");
    if (voiceDevice) voiceDevice.updateToken(data.token);
    return data.token;
  }

  async function ensureVoiceDevice() {
    if (voiceDevice) return voiceDevice;
    if (!window.ImanTwilioVoice?.Device) throw new Error("The browser calling service did not load. Refresh the CRM and try again.");
    const token = await refreshVoiceToken();
    voiceDevice = new window.ImanTwilioVoice.Device(token, { logLevel: 1 });
    voiceDevice.on("tokenWillExpire", () => refreshVoiceToken().catch(() => setDialerStatus("Your call session expired. End the call and try again.", "error")));
    voiceDevice.on("error", (error) => {
      if (!activeCall) setDialerStatus(error.message || "The calling service encountered an error.", "error");
    });
    return voiceDevice;
  }

  function openDialer(number = "", customerName = "", sourceId = "", sourceType = "") {
    if (activeCall || callConnecting) {
      toast("End the current call before starting another call.", "error");
      return;
    }
    const numberInput = $("[data-dialer-number]");
    const customerCall = Boolean(sourceId && number);
    numberInput.value = number;
    numberInput.readOnly = customerCall;
    $("[data-dialer-help]").textContent = customerCall
      ? `This call is locked to ${customerName || "this customer"} at ${number}. The customer will see your business number as caller ID.`
      : "Enter any U.S. or Canadian number. The recipient will see your business number as the caller ID.";
    dialerDialog.dataset.customerName = customerName;
    dialerDialog.dataset.sourceId = sourceId;
    dialerDialog.dataset.sourceType = sourceType;
    setDialerStatus("Ready to call.");
    setDialerActive(Boolean(activeCall));
    if (!dialerDialog.open) dialerDialog.showModal();
    if (!activeCall) $("[data-dialer-number]").focus();
  }

  function openMessageComposer(phone, customerName = "Customer") {
    $("[data-message-phone]").value = phone;
    $("[data-message-customer-name]").value = customerName === "Customer" ? "" : customerName;
    $("[data-message-body]").value = "";
    const status = $("[data-message-status]");
    status.className = "crm-dialer-status";
    status.textContent = "Ready to send.";
    if (!messageDialog.open) messageDialog.showModal();
    (phone ? $("[data-message-body]") : $("[data-message-phone]")).focus();
  }

  async function sendCustomerText(form) {
    const button = $("[data-send-message]", form);
    const status = $("[data-message-status]", form);
    const conversationId = form.dataset.conversationId || "";
    button.disabled = true;
    status.className = "crm-dialer-status";
    status.textContent = "Sending text…";
    try {
      await api("/api/crm/customer-message", {
        method: "POST",
        body: JSON.stringify({
          phone: form.elements.phone.value,
          customerName: form.elements.customerName.value || "Customer",
          message: form.elements.message.value
        })
      });
      status.className = "crm-dialer-status is-connected";
      status.textContent = "Text sent and saved to this customer’s history.";
      form.elements.message.value = "";
      await loadBookings({ quiet: true });
      if (conversationId) openConversation(conversationId);
      toast("Customer text sent.");
    } catch (error) {
      status.className = "crm-dialer-status is-error";
      status.textContent = error.message;
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function startOutboundCall(form) {
    if (activeCall || callConnecting) return;
    let destination;
    try {
      destination = normalizeDialNumber(form.elements.phoneNumber.value);
    } catch (error) {
      setDialerStatus(error.message, "error");
      return;
    }
    callConnecting = true;
    setDialerActive(true);
    setDialerStatus("Connecting to the calling service…");
    try {
      const device = await ensureVoiceDevice();
      const logData = await api("/api/crm/customer-call", {
        method: "POST",
        body: JSON.stringify({
          phone: destination,
          customerName: dialerDialog.dataset.customerName || "Customer",
          sourceId: dialerDialog.dataset.sourceId || "",
          sourceType: dialerDialog.dataset.sourceType || "",
          sourceLabel: dialerDialog.dataset.sourceId ? `${dialerDialog.dataset.sourceType || "Customer record"} ${dialerDialog.dataset.sourceId}` : "CRM manual outbound call"
        })
      });
      activeCallRecord = { id: logData.call.conversation_id, startedAt: Date.now() };
      setDialerStatus("Calling…");
      activeCall = await device.connect({ params: { To: destination } });
      activeCall.on("accept", () => setDialerStatus("Connected — speak through your computer.", "connected"));
      activeCall.on("disconnect", () => finishCall());
      activeCall.on("cancel", () => finishCall("Call cancelled.", "cancelled"));
      activeCall.on("reject", () => finishCall("The call was not answered.", "no_answer"));
      activeCall.on("error", (error) => finishCall(error.message || "The call could not be completed.", "failed"));
    } catch (error) {
      finishCall(error.message || "The call could not be started.", "failed");
      setDialerStatus(error.message || "The call could not be started.", "error");
    } finally {
      callConnecting = false;
    }
  }

  function endOutboundCall() {
    if (activeCall) activeCall.disconnect();
    else if (voiceDevice) voiceDevice.disconnectAll();
    finishCall();
  }

  async function loadBookings({ quiet = false } = {}) {
    if (!quiet) showLoading(true, "Loading your CRM…");
    try {
      const bookingRequest = api("/api/crm/bookings");
      const quoteRequest = quiet ? Promise.resolve(null) : api("/api/crm/quotes");
      const contactRequest = quiet ? Promise.resolve(null) : api("/api/crm/contacts");
      const suppressionRequest = quiet ? Promise.resolve(null) : api("/api/crm/email-suppressions");
      const callRequest = api("/api/crm/calls");
      const callbackRequest = api("/api/crm/callbacks");
      const sameDayRequest = api("/api/crm/same-day");
      const conversationRequest = api("/api/crm/conversations").catch((error) => {
        if (error.status === 401) throw error;
        return { error: "AI conversations could not be refreshed. Please try Refresh again." };
      });
      const concernRequest = api("/api/crm/concerns").catch((error) => {
        if (error.status === 401) throw error;
        return { error: "Complaints and concerns could not be refreshed. Please try Refresh again." };
      });
      const [data, quoteData, contactData, suppressionData, callData, callbackData, sameDayData, conversationData, concernData] = await Promise.all([bookingRequest, quoteRequest, contactRequest, suppressionRequest, callRequest, callbackRequest, sameDayRequest, conversationRequest, concernRequest]);
      state.bookings = Array.isArray(data.bookings) ? data.bookings : [];
      if (quoteData) state.quotes = Array.isArray(quoteData.quotes) ? quoteData.quotes : [];
      if (contactData) state.manualContacts = Array.isArray(contactData.contacts) ? contactData.contacts : [];
      if (suppressionData) state.emailSuppressions = Array.isArray(suppressionData.suppressions) ? suppressionData.suppressions : [];
      state.calls = Array.isArray(callData.calls) ? callData.calls : [];
      state.callbacks = Array.isArray(callbackData.callbacks) ? callbackData.callbacks : [];
      state.sameDayRequests = Array.isArray(sameDayData.requests) ? sameDayData.requests : [];
      state.conversationsError = conversationData.error || "";
      if (!state.conversationsError) state.conversations = Array.isArray(conversationData.conversations) ? conversationData.conversations : [];
      state.concernsError = concernData.error || "";
      if (!state.concernsError) state.concerns = Array.isArray(concernData.concerns) ? concernData.concerns : [];
      renderAll();
      return true;
    } finally {
      if (!quiet) showLoading(false);
    }
  }

  function customerKey(booking) {
    return String(booking.email || booking.phone || booking.clientName || booking.id).trim().toLowerCase();
  }

  function customers() {
    const grouped = new Map();
    state.bookings.filter(hasPaidDeposit).forEach((booking) => {
      const key = customerKey(booking);
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          name: booking.clientName || "Customer",
          email: booking.email || "",
          phone: booking.phone || "",
          address: booking.address || "",
          bookings: []
        });
      }
      const customer = grouped.get(key);
      customer.bookings.push(booking);
      if (!customer.email && booking.email) customer.email = booking.email;
      if (!customer.phone && booking.phone) customer.phone = booking.phone;
      if (!customer.address && booking.address) customer.address = booking.address;
    });
    state.manualContacts.forEach((contact) => {
      const key = String(contact.email || contact.phone || contact.id).trim().toLowerCase();
      const existing = grouped.get(key);
      if (existing) {
        existing.manualContact = contact;
        if (!existing.email && contact.email) existing.email = contact.email;
        if (!existing.phone && contact.phone) existing.phone = contact.phone;
        if (!existing.address && contact.address) existing.address = contact.address;
        return;
      }
      grouped.set(key, {
        key,
        name: contact.name || "Customer",
        email: contact.email || "",
        phone: contact.phone || "",
        address: contact.address || "",
        bookings: [],
        manualContact: contact
      });
    });
    return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  function matchesSearch(booking) {
    const query = state.search.trim().toLowerCase();
    if (!query) return true;
    return [booking.id, booking.clientName, booking.email, booking.phone, booking.address, booking.serviceLabel, booking.service]
      .some((value) => String(value || "").toLowerCase().includes(query));
  }

  function filteredBookings() {
    const list = state.bookings.filter((booking) => {
      const statusMatch = state.status === "All" || booking.status === state.status;
      return hasPaidDeposit(booking) && statusMatch && matchesSearch(booking);
    });
    return list.sort((a, b) => {
      if (state.sort === "newest") return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      if (state.sort === "highest") return paymentFor(b).totalCents - paymentFor(a).totalCents;
      const aTime = dateObject(a.schedule)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = dateObject(b.schedule)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }

  function quoteMatchesSearch(quote) {
    const query = state.search.trim().toLowerCase();
    if (!query) return true;
    return [quote.id, quote.customerName, quote.email, quote.phone, quote.address, quote.service, quote.type, quote.status]
      .some((value) => String(value || "").toLowerCase().includes(query));
  }

  function filteredQuotes() {
    return state.quotes.filter((quote) => (
      !quote.walkthrough && !quote.deletedAt && (state.quoteType === "All" || quote.type === state.quoteType) && quoteMatchesSearch(quote)
    )).sort((left, right) => {
      if (state.quoteSort === "oldest") return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
      if (state.quoteSort === "highest") return cents(right.amountCents) - cents(left.amountCents);
      return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
    });
  }

  function marketingContacts() {
    const grouped = new Map();
    const emailOptOuts = new Set(state.emailSuppressions.map((record) => String(record.email || "").trim().toLowerCase()).filter(Boolean));
    const smsOptOuts = new Set(state.conversations
      .filter((conversation) => (
        /opt(?:ed)?[ _-]?out|unsubscribed|blocked/i.test(String(conversation.status || ""))
        || /^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(String(conversation.lastMessage || "").trim())
      ))
      .map((conversation) => phoneKey(conversation.customerContact))
      .filter(Boolean));
    state.quotes.forEach((quote) => {
      if (quote.deletedAt) return;
      const consent = quote.communicationConsent || {};
      if (!consent.marketingSms && !consent.marketingEmail) return;
      const key = phoneKey(quote.phone) || String(quote.email || quote.id).trim().toLowerCase();
      const existing = grouped.get(key) || {
        key,
        name: quote.customerName || "Customer",
        email: quote.email || "",
        phone: quote.phone || "",
        marketingSms: false,
        marketingEmail: false,
        capturedAt: "",
        source: quote.source || "Online quote",
        disclosureVersion: ""
      };
      existing.marketingSms = existing.marketingSms || Boolean(consent.marketingSms);
      existing.marketingEmail = existing.marketingEmail || Boolean(consent.marketingEmail);
      if (String(consent.capturedAt || "") > String(existing.capturedAt || "")) {
        existing.capturedAt = consent.capturedAt;
        existing.source = quote.source || existing.source;
        existing.disclosureVersion = consent.disclosureVersion || existing.disclosureVersion;
      }
      if (!existing.email && quote.email) existing.email = quote.email;
      if (!existing.phone && quote.phone) existing.phone = quote.phone;
      grouped.set(key, existing);
    });
    state.manualContacts.forEach((contact) => {
      if (!contact.emailMarketingEligible && !contact.smsMarketingConsent) return;
      const key = phoneKey(contact.phone) || String(contact.email || contact.id).trim().toLowerCase();
      const existing = grouped.get(key) || {
        key,
        name: contact.name || "Customer",
        email: contact.email || "",
        phone: contact.phone || "",
        marketingSms: false,
        marketingEmail: false,
        capturedAt: "",
        source: "Manually added existing customer",
        disclosureVersion: "",
        segment: contact.customerType
      };
      existing.marketingEmail = existing.marketingEmail || Boolean(contact.emailMarketingEligible);
      existing.marketingSms = existing.marketingSms || Boolean(contact.smsMarketingConsent);
      existing.capturedAt = contact.smsConsentCapturedAt || contact.updatedAt || contact.createdAt || existing.capturedAt;
      existing.segment = contact.customerType || existing.segment;
      existing.source = "Manually added existing customer";
      grouped.set(key, existing);
    });
    grouped.forEach((contact) => {
      if (smsOptOuts.has(phoneKey(contact.phone))) contact.marketingSms = false;
      if (emailOptOuts.has(String(contact.email || "").trim().toLowerCase())) contact.marketingEmail = false;
    });
    const query = state.search.trim().toLowerCase();
    return Array.from(grouped.values())
      .filter((contact) => {
        if (state.marketingSegment === "Past email") return contact.segment === "past_inactive" && contact.marketingEmail;
        if (state.marketingSegment === "Recurring SMS") return contact.segment === "monthly_recurring" && contact.marketingSms;
        return true;
      })
      .filter((contact) => !query || [contact.name, contact.email, contact.phone, contact.source]
        .some((value) => String(value || "").toLowerCase().includes(query)))
      .sort((left, right) => String(right.capturedAt || "").localeCompare(String(left.capturedAt || "")));
  }

  function submittedDate(value) {
    const date = dateObject(value);
    if (!date) return "Date unavailable";
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York"
    }).format(date);
  }

  function renderStats() {
    const now = new Date();
    const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
    const paidBookings = state.bookings.filter(hasPaidDeposit);
    const activeBookings = paidBookings.filter((booking) => ACTIVE_STATUSES.has(booking.status));
    const upcoming = activeBookings.filter((booking) => (dateObject(booking.schedule)?.getTime() || 0) >= now.getTime());
    const today = upcoming.filter((booking) => {
      const date = dateObject(booking.schedule);
      return date && new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(date) === todayKey;
    });
    const collected = paidBookings.reduce((sum, booking) => sum + paymentFor(booking).paidCents, 0);
    const outstanding = state.bookings
      .filter((booking) => hasPaidDeposit(booking) && booking.status !== "Cancelled")
      .reduce((sum, booking) => sum + paymentFor(booking).remainingCents, 0);
    const stats = [
      ["Today’s appointments", String(today.length), `${upcoming.length} upcoming`, "▣"],
      ["Active bookings", String(activeBookings.length), `${paidBookings.length} deposit-paid booking${paidBookings.length === 1 ? "" : "s"}`, "▦"],
      ["Payments collected", money(collected), "Deposits and completed balances", "$"],
      ["Outstanding balance", money(outstanding), "Deposit-paid bookings only", "◷"]
    ];
    $("[data-stat-grid]").innerHTML = stats.map(([label, value, note, icon]) => `
      <article class="crm-stat">
        <div class="crm-stat-top"><span class="crm-stat-label">${escapeHtml(label)}</span><span class="crm-stat-icon">${icon}</span></div>
        <strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small>
      </article>`).join("");
  }

  function renderUpcoming() {
    const now = Date.now();
    const upcoming = state.bookings
      .filter((booking) => hasPaidDeposit(booking) && ACTIVE_STATUSES.has(booking.status) && (dateObject(booking.schedule)?.getTime() || 0) >= now)
      .sort((a, b) => dateObject(a.schedule) - dateObject(b.schedule))
      .slice(0, 6);
    const target = $("[data-upcoming-list]");
    if (!upcoming.length) {
      target.innerHTML = '<div class="crm-panel-empty">No upcoming appointments.</div>';
      return;
    }
    target.innerHTML = upcoming.map((booking) => {
      const day = shortDay(booking);
      return `<button class="crm-upcoming crm-open-row" type="button" data-open-booking="${escapeHtml(booking.id)}" style="width:100%;border-inline:0;border-bottom:0;background:transparent;text-align:left;cursor:pointer">
        <span class="crm-upcoming-date"><strong>${day.day}</strong><small>${day.month}</small></span>
        <span><h3>${escapeHtml(booking.clientName || "Customer")}</h3><p>${escapeHtml(booking.serviceLabel || booking.service || "Cleaning service")} · ${escapeHtml(appointmentDate(booking, "short"))}</p></span>
        <strong>${money(paymentFor(booking).totalCents)}</strong>
      </button>`;
    }).join("");
  }

  function renderPaymentAttention() {
    const target = $("[data-payment-attention]");
    const attention = state.bookings.filter((booking) => {
      const payment = paymentFor(booking);
      return hasPaidDeposit(booking) && ["requires_action", "setup_missing", "authorization_failed", "attempts_exhausted", "capture_failed"].includes(payment.remaining?.status);
    });
    const readyToComplete = state.bookings.filter((booking) => hasPaidDeposit(booking) && booking.status === "In progress").length;
    const pendingAuth = state.bookings.filter((booking) => hasPaidDeposit(booking) && paymentFor(booking).remaining?.status === "pending" && booking.status !== "Cancelled").length;
    const cards = [];
    if (attention.length) cards.push([`${attention.length} payment${attention.length === 1 ? "" : "s"} need attention`, "Review declined or incomplete remaining-balance authorizations."]);
    if (readyToComplete) cards.push([`${readyToComplete} booking${readyToComplete === 1 ? " is" : "s are"} in progress`, "Mark complete only after the cleaning is finished to capture the balance."]);
    if (pendingAuth) cards.push([`${pendingAuth} balance authorization${pendingAuth === 1 ? "" : "s"} pending`, "The system will attempt authorization about 48 hours before service."]);
    if (!cards.length) {
      target.innerHTML = '<div class="crm-panel-empty">No payment issues need attention.</div>';
      return;
    }
    target.innerHTML = cards.map(([title, copy]) => `<div class="crm-attention-card"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p></div>`).join("");
  }

  function renderStatusFilters() {
    const target = $("[data-status-filters]");
    const options = ["All", ...STATUS_OPTIONS];
    const paidBookings = state.bookings.filter(hasPaidDeposit);
    target.innerHTML = options.map((status) => {
      const count = status === "All" ? paidBookings.length : paidBookings.filter((booking) => booking.status === status).length;
      return `<button type="button" data-status-filter="${escapeHtml(status)}" class="${state.status === status ? "is-active" : ""}">${escapeHtml(status)} <b>${count}</b></button>`;
    }).join("");
  }

  function bookingRow(booking) {
    const payment = paymentFor(booking);
    const contact = { phone: booking.phone, customerName: booking.clientName, sourceId: booking.id, sourceType: "Booking" };
    return `<tr>
      <td class="crm-customer-cell"><strong>${escapeHtml(booking.clientName || "Customer")}</strong><span>Order ${escapeHtml(booking.orderNumber || booking.id)}</span></td>
      <td class="crm-service-cell"><strong>${escapeHtml(booking.serviceLabel || booking.service || "Cleaning service")}</strong><span>${escapeHtml(booking.address || "")}</span></td>
      <td class="crm-date-cell">${escapeHtml(appointmentDate(booking))}</td>
      <td class="crm-payment-cell"><strong>${money(payment.paidCents)} paid</strong><span>${money(payment.remainingCents)} remaining</span></td>
      <td>${statusBadge(booking.status)}</td>
      <td><div class="crm-table-actions"><button class="crm-row-button" type="button" data-open-booking="${escapeHtml(booking.id)}">Manage</button>${booking.phone ? communicationButtons(contact) : ""}</div></td>
    </tr>`;
  }

  function mobileBooking(booking) {
    const payment = paymentFor(booking);
    const contact = { phone: booking.phone, customerName: booking.clientName, sourceId: booking.id, sourceType: "Booking" };
    return `<article class="crm-mobile-booking">
      <div class="crm-mobile-booking-head"><div><h3>${escapeHtml(booking.clientName || "Customer")}</h3><p>${escapeHtml(booking.serviceLabel || booking.service || "Cleaning service")}</p></div>${statusBadge(booking.status)}</div>
      <p>${escapeHtml(appointmentDate(booking))}</p>
      <div class="crm-mobile-booking-bottom"><strong>${money(payment.paidCents)} paid</strong><div class="crm-mobile-actions"><button class="crm-row-button" type="button" data-open-booking="${escapeHtml(booking.id)}">Manage</button>${booking.phone ? communicationButtons(contact) : ""}</div></div>
    </article>`;
  }

  function renderBookings() {
    renderStatusFilters();
    const list = filteredBookings();
    $("[data-bookings-table]").innerHTML = list.map(bookingRow).join("");
    $("[data-mobile-bookings]").innerHTML = list.map(mobileBooking).join("");
    $("[data-bookings-empty]").hidden = list.length > 0;
    $(".crm-table-wrap").hidden = list.length === 0;
  }

  function initials(name) {
    return String(name || "C").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  function renderCustomers() {
    const query = state.search.trim().toLowerCase();
    const list = customers().filter((customer) => !query || [customer.name, customer.email, customer.phone, customer.address].some((value) => String(value || "").toLowerCase().includes(query)));
    $("[data-customer-grid]").innerHTML = list.map((customer) => {
      const lifetime = customer.bookings.reduce((sum, booking) => sum + paymentFor(booking).totalCents, 0);
      const paid = customer.bookings.reduce((sum, booking) => sum + paymentFor(booking).paidCents, 0);
      const upcoming = customer.bookings.filter((booking) => hasPaidDeposit(booking) && ACTIVE_STATUSES.has(booking.status) && (dateObject(booking.schedule)?.getTime() || 0) >= Date.now()).length;
      return `<article class="crm-customer-card">
      <div class="crm-customer-head"><span class="crm-avatar">${escapeHtml(initials(customer.name))}</span><div><h3>${escapeHtml(customer.name)}</h3><p>${escapeHtml(customer.address || "No address")}</p>${customer.manualContact ? `<small>${customer.manualContact.customerType === "monthly_recurring" ? "Monthly/recurring client" : "Past client who did not return"}</small>` : ""}</div></div>
        <div class="crm-customer-contact">${customer.email ? `<a href="mailto:${escapeHtml(customer.email)}">${escapeHtml(customer.email)}</a>` : "<span>No email</span>"}${customer.phone ? `<a href="tel:${escapeHtml(customer.phone)}">${escapeHtml(customer.phone)}</a>` : "<span>No phone</span>"}</div>
        <div class="crm-customer-metrics"><div><strong>${customer.bookings.length}</strong><span>Bookings</span></div><div><strong>${money(paid)}</strong><span>Paid</span></div><div><strong>${upcoming}</strong><span>Upcoming</span></div></div>
        ${customer.bookings.length ? `<button class="crm-row-button" type="button" data-customer-bookings="${escapeHtml(customer.email || customer.phone || customer.name)}">View booking history · ${money(lifetime)}</button>` : '<span class="crm-row-button">Existing customer added manually</span>'}
        ${customer.manualContact ? `<button class="crm-row-button is-danger" type="button" data-delete-manual-contact="${escapeHtml(customer.manualContact.id)}" data-contact-name="${escapeHtml(customer.name)}">Delete customer</button>` : ""}
      </article>`;
    }).join("");
    $("[data-customers-empty]").hidden = list.length > 0;
  }

  function renderCounts() {
    $("[data-nav-booking-count]").textContent = state.bookings.filter(hasPaidDeposit).length;
    $("[data-nav-quote-count]").textContent = state.quotes.filter(quote => !quote.walkthrough && !quote.deletedAt).length;
    $("[data-nav-walkthrough-count]").textContent = state.quotes.filter(quote => quote.walkthrough && !quote.deletedAt).length;
    $("[data-nav-trash-count]").textContent = state.quotes.filter(quote => quote.deletedAt).length;
    $("[data-nav-customer-count]").textContent = customers().length;
    $("[data-nav-call-count]").textContent = state.calls.length;
    $("[data-nav-conversation-count]").textContent = state.conversationsError ? "!" : state.conversations.length;
    $("[data-nav-callback-count]").textContent = state.callbacks.filter((item) => item.status === "Pending").length;
    $("[data-nav-same-day-count]").textContent = state.sameDayRequests.filter((item) => ["New request", "Payment pending"].includes(item.status)).length;
    $("[data-nav-concern-count]").textContent = state.concernsError ? "!" : state.concerns.length;
    $("[data-nav-marketing-count]").textContent = marketingContacts().length;
  }

  function renderQuoteFilters() {
    const options = ["All", "Instant quote", "Customized quote"];
    $("[data-quote-filters]").innerHTML = options.map((type) => {
      const count = state.quotes.filter(quote => !quote.walkthrough && !quote.deletedAt && (type === "All" || quote.type === type)).length;
      const label = type === "All" ? "All" : type === "Instant quote" ? "Instant quotes" : "Customized quotes";
      return `<button type="button" data-quote-filter="${escapeHtml(type)}" class="${state.quoteType === type ? "is-active" : ""}">${label} <b>${count}</b></button>`;
    }).join("");
  }

  function quoteRow(quote) {
    const value = cents(quote.amountCents) ? money(quote.amountCents) : "Pending review";
    const contact = { phone: quote.phone, customerName: quote.customerName, sourceId: quote.id, sourceType: quote.type };
    return `<tr>
      <td class="crm-customer-cell"><strong>${escapeHtml(quote.customerName || "Customer")}</strong><span>${escapeHtml(quote.email || quote.phone || quote.id)}</span></td>
      <td><span class="crm-quote-type" data-type="${quote.type === "Customized quote" ? "custom" : "instant"}">${escapeHtml(quote.type)}</span></td>
      <td class="crm-service-cell"><strong>${escapeHtml(quote.service || "Cleaning service")}</strong><span>${escapeHtml(quote.address || "Address not available")}</span></td>
      <td class="crm-date-cell">${escapeHtml(submittedDate(quote.createdAt))}</td>
      <td class="crm-payment-cell"><strong>${escapeHtml(value)}</strong></td>
      <td>${statusBadge(quote.status)}</td>
      <td><div class="crm-table-actions"><button class="crm-row-button" type="button" data-open-quote="${escapeHtml(quote.id)}">View</button>${customPaymentButton(quote)}${quote.phone ? communicationButtons(contact) : ""}</div></td>
    </tr>`;
  }

  function mobileQuote(quote) {
    const value = cents(quote.amountCents) ? money(quote.amountCents) : "Pending review";
    const contact = { phone: quote.phone, customerName: quote.customerName, sourceId: quote.id, sourceType: quote.type };
    return `<article class="crm-mobile-booking">
      <div class="crm-mobile-booking-head"><div><h3>${escapeHtml(quote.customerName || "Customer")}</h3><p>${escapeHtml(quote.type)} · ${escapeHtml(quote.service || "Cleaning service")}</p></div>${statusBadge(quote.status)}</div>
      <p>${escapeHtml(submittedDate(quote.createdAt))}</p>
      <div class="crm-mobile-booking-bottom"><strong>${escapeHtml(value)}</strong><div class="crm-mobile-actions"><button class="crm-row-button" type="button" data-open-quote="${escapeHtml(quote.id)}">View</button>${customPaymentButton(quote)}${quote.phone ? communicationButtons(contact) : ""}</div></div>
    </article>`;
  }

  function renderQuotes() {
    renderQuoteFilters();
    const quotes = filteredQuotes();
    $("[data-quotes-table]").innerHTML = quotes.map(quoteRow).join("");
    $("[data-mobile-quotes]").innerHTML = quotes.map(mobileQuote).join("");
    $("[data-quotes-empty]").hidden = quotes.length > 0;
    $("[data-quotes-wrap]").hidden = quotes.length === 0;
  }

  function walkthroughVisit(date, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return 'Not provided';
    const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
    if (!time) return `${day} · Time not specified`;
    const [hours, minutes] = time.split(':').map(Number);
    return `${day} · ${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'} (New York)`;
  }

  function renderWalkthroughs() {
    const requests = state.quotes.filter(q => q.walkthrough && !q.deletedAt && quoteMatchesSearch(q));
    const button = q => `<button type="button" class="crm-row-button" data-open-quote="${escapeHtml(q.id)}">${q.walkthrough.confirmation ? 'View confirmation' : 'Confirm walkthrough'}</button>`;
    $('[data-walkthroughs-table]').innerHTML = requests.map(q => `<tr>
      <td class="crm-customer-cell"><strong>${escapeHtml(q.businessName || q.customerName)}</strong>${q.businessName ? `<span>${escapeHtml(q.customerName)}</span>` : ''}<span>${escapeHtml(q.email)}</span><span>${escapeHtml(q.phone)}</span></td>
      <td class="crm-service-cell">${escapeHtml(q.address)}</td><td>${escapeHtml(walkthroughVisit(q.walkthrough.preferredDate, q.walkthrough.preferredTime))}</td>
      <td>${statusBadge(q.status)}</td><td>${button(q)}</td></tr>`).join('');
    $('[data-mobile-walkthroughs]').innerHTML = requests.map(q => `<article class="crm-mobile-booking"><div class="crm-mobile-booking-head"><h3>${escapeHtml(q.businessName || q.customerName)}</h3>${statusBadge(q.status)}</div>${q.businessName ? `<p>${escapeHtml(q.customerName)}</p>` : ''}<p>${escapeHtml(q.address)}</p><p>${escapeHtml(walkthroughVisit(q.walkthrough.preferredDate, q.walkthrough.preferredTime))}</p>${button(q)}</article>`).join('');
    $('[data-walkthroughs-empty]').hidden = requests.length > 0;
    $('[data-walkthroughs-wrap]').hidden = !requests.length;
  }

  function walkthroughDetailMarkup(quote) {
    const visit = quote.walkthrough;
    const confirmed = visit.confirmation;
    const labels = { pending: 'Not sent', sending: 'Sending / check status before retrying', sent: 'Sent to provider', failed: 'Not sent — needs attention', unknown: 'Unverified — check before sending again' };
    const pending = confirmed && ['sms', 'email'].some(channel => confirmed[channel]?.status === 'pending');
    const attention = confirmed && ['sms', 'email'].some(channel => ['failed', 'unknown', 'sending'].includes(confirmed[channel]?.status));
    const date = confirmed?.date || visit.preferredDate || '';
    const time = confirmed?.time || visit.preferredTime || '';
    return `<div class="crm-dialog-head"><div><p class="crm-eyebrow">Walkthrough request</p><h2>${escapeHtml(quote.businessName || quote.customerName)}</h2>${quote.businessName ? `<p>${escapeHtml(quote.customerName)}</p>` : ''}</div><button class="crm-dialog-close" type="button" data-close-dialog aria-label="Close">×</button></div>
      <div class="crm-dialog-body">
        <div class="crm-detail-grid">
          <div class="crm-detail crm-detail-wide"><span>Commercial address</span><strong>${escapeHtml(quote.address)}</strong></div>
          <div class="crm-detail"><span>Email</span><strong>${escapeHtml(quote.email)}</strong></div><div class="crm-detail"><span>Phone</span><strong>${escapeHtml(quote.phone)}</strong></div>
          <div class="crm-detail crm-detail-wide"><span>Preferred visit</span><strong>${escapeHtml(walkthroughVisit(visit.preferredDate, visit.preferredTime))}</strong></div>
          ${visit.alternativeDate ? `<div class="crm-detail crm-detail-wide"><span>Alternative visit</span><strong>${escapeHtml(walkthroughVisit(visit.alternativeDate, visit.alternativeTime))}</strong></div>` : ''}
          <div class="crm-detail"><span>Submitted</span><strong>${escapeHtml(submittedDate(quote.createdAt))}</strong></div><div class="crm-detail"><span>Request reference</span><strong>${escapeHtml(quote.id)}</strong></div>
        </div>
        ${visit.details?.length ? `<section class="crm-detail-section"><h3>Property and cleaning needs</h3><div class="crm-detail-grid">${visit.details.map(item => `<div class="crm-detail"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</div></section>` : ''}
        ${visit.uploadedFileCount ? `<section class="crm-detail-section"><h3>Customer files</h3><p class="crm-quote-details">${escapeHtml(visit.uploadedFileCount)} file${visit.uploadedFileCount === 1 ? '' : 's'} uploaded. Use the quote folder to review the photos, floor plans, or building documents.</p></section>` : ''}
        ${visit.notes ? `<section class="crm-detail-section"><h3>Customer notes</h3><p class="crm-quote-details">${escapeHtml(visit.notes)}</p></section>` : ''}
        <section class="crm-detail-section"><h3>${confirmed ? 'Confirmed walkthrough' : 'Confirm walkthrough'}</h3>
          ${visit.error ? `<p class="crm-walkthrough-notice is-warning">${escapeHtml(visit.error)} Refresh before confirming.</p>` : ''}
          ${confirmed ? `<p class="crm-walkthrough-notice"><strong>${escapeHtml(walkthroughVisit(confirmed.date, confirmed.time))}</strong><br>Confirmed by your team ${escapeHtml(submittedDate(confirmed.confirmedAt))}.</p>
          <div class="crm-walkthrough-deliveries">${['sms', 'email'].map(channel => `<p><strong>${channel === 'sms' ? 'Text message' : 'Email'}</strong>${escapeHtml(labels[confirmed[channel]?.status] || 'Check status')}${confirmed[channel]?.sentAt ? `<br>${escapeHtml(submittedDate(confirmed[channel].sentAt))}` : ''}</p>`).join('')}</div>
          ${attention ? '<p class="crm-walkthrough-notice is-warning">One or more messages need attention. Check the sending history before contacting the customer manually; this action will not resend an attempted message.</p>' : ''}` : ''}
          ${!confirmed || pending ? `<form class="crm-walkthrough-form" data-walkthrough-confirm-form data-quote-id="${escapeHtml(quote.id)}">
            <div class="crm-walkthrough-fields"><label>Confirmed date<input name="date" type="date" value="${escapeHtml(date)}" required${confirmed ? ' readonly' : ''}></label><label>Confirmed time (New York)<input name="time" type="time" value="${escapeHtml(time)}" required${confirmed ? ' readonly' : ''}></label></div>
            <p class="crm-walkthrough-notice">${confirmed ? 'Send only messages that have not been attempted.' : 'Confirm team availability first. This sends the final visit date, time and address to this customer by text and email. It does not book or charge for cleaning.'}</p>
            <button type="submit" class="crm-primary"${visit.error || !visit.canConfirm ? ' disabled' : ''}>${confirmed ? 'Send remaining confirmation' : 'Confirm & send text and email'}</button>
            <p class="crm-action-status" data-walkthrough-status role="status"></p>
          </form>` : ''}
          ${!visit.canConfirm && !visit.error && !confirmed ? '<p>This older request needs a manual confirmation from your team.</p>' : ''}
        </section>
        <section class="crm-detail-section"><h3>Contact customer</h3>${communicationButtons({phone:quote.phone,customerName:quote.customerName,sourceId:quote.id,sourceType:'Walkthrough request'})}</section>${customerHistoryMarkup(quote.phone)}
      </div>`;
  }

  async function confirmWalkthrough(form) {
    if (form.dataset.sending === 'true' || !form.reportValidity()) return;
    const quote = quoteFormSnapshots.get(form);
    if (!quote) return;
    const status = $('[data-walkthrough-status]', form), button = $('button[type=submit]', form);
    form.dataset.sending = 'true'; button.disabled = true;
    status.textContent = 'Saving confirmation and sending messages…';
    try {
      const result = await api('/api/crm/walkthroughs', { method: 'POST', body: JSON.stringify({ id: quote.id, version: quote.editVersion, date: form.elements.date.value, time: form.elements.time.value }) });
      state.quotes = state.quotes.map(q => q.id === result.request.id ? result.request : q);
      renderCounts(); renderWalkthroughs();
      openQuote(result.request.id);
      const done = ['sms', 'email'].every(c => result.request.walkthrough.confirmation?.[c]?.status === 'sent');
      toast(done ? 'Walkthrough confirmed. Text and email sent.' : 'Walkthrough confirmed. Check the message statuses.', done ? 'success' : 'error');
    } catch (error) {
      status.textContent = `${error.message} Refresh to check the latest status before trying again.`;
      status.style.color = '#b42318';
    } finally {
      form.dataset.sending = 'false'; button.disabled = false;
    }
  }

  function trashedQuotes() {
    return state.quotes.filter(quote => quote.deletedAt && quoteMatchesSearch(quote))
      .sort((left, right) => String(right.deletedAt).localeCompare(String(left.deletedAt)));
  }

  function renderTrash() {
    const quotes = trashedQuotes();
    $("[data-trash-list]").innerHTML = quotes.map(quote => `<article class="crm-trash-item" data-quote-action-scope>
      <h3>${escapeHtml(quote.customerName || "Customer")}</h3>
      <p>${escapeHtml(quote.type)} · ${escapeHtml(quote.service || "Cleaning service")}</p>
      <p>${escapeHtml(quote.email || quote.phone || "")}</p>
      <p class="crm-trash-meta">${escapeHtml(quote.id)}<br>Deleted ${escapeHtml(submittedDate(quote.deletedAt))}</p>
      <div class="crm-trash-actions"><button class="crm-row-button" type="button" data-open-quote="${escapeHtml(quote.id)}">View quote</button><button class="crm-primary" type="button" data-restore-quote="${escapeHtml(quote.id)}">Restore quote</button></div>
      <p class="crm-action-status" data-quote-edit-status role="status"></p>
    </article>`).join("");
    $("[data-trash-empty]").hidden = quotes.length > 0;
    $("[data-trash-empty-title]").textContent = state.search.trim() ? "No deleted quotes found" : "Trash is empty";
    $("[data-trash-empty-copy]").textContent = state.search.trim() ? "Try another name, email, phone number or quote reference." : "Deleted quotes will appear here.";
  }

  function consentStatus(enabled, channel) {
    return enabled
      ? `<span class="crm-status" data-status="confirmed">✓ ${escapeHtml(channel)} subscribed</span>`
      : `<span class="crm-status" data-status="cancelled">Not subscribed</span>`;
  }

  function renderMarketing() {
    const filterTarget = $("[data-marketing-filters]");
    const filterOptions = ["All", "Past email", "Recurring SMS"];
    filterTarget.innerHTML = filterOptions.map((option) => `<button type="button" data-marketing-filter="${escapeHtml(option)}" class="${state.marketingSegment === option ? "is-active" : ""}">${escapeHtml(option === "Past email" ? "Past clients · Email" : option === "Recurring SMS" ? "Recurring clients · SMS" : "All eligible")}</button>`).join("");
    const contacts = marketingContacts();
    $("[data-marketing-table]").innerHTML = contacts.map((contact) => `<tr>
      <td class="crm-customer-cell"><strong>${escapeHtml(contact.name)}</strong><span>${escapeHtml(contact.email || contact.phone)}</span></td>
      <td>${escapeHtml(contact.segment === "monthly_recurring" ? "Monthly/recurring" : contact.segment === "past_inactive" ? "Past/inactive" : "Online lead")}</td>
      <td>${consentStatus(contact.marketingEmail, "Email eligible")}</td>
      <td>${consentStatus(contact.marketingSms, "SMS")}</td>
      <td class="crm-date-cell">${escapeHtml(submittedDate(contact.capturedAt))}</td>
      <td>${escapeHtml(contact.source)}</td>
    </tr>`).join("");
    $("[data-mobile-marketing]").innerHTML = contacts.map((contact) => `<article class="crm-mobile-booking">
      <div class="crm-mobile-booking-head"><div><h3>${escapeHtml(contact.name)}</h3><p>${escapeHtml(contact.email || contact.phone)} · ${escapeHtml(contact.segment === "monthly_recurring" ? "Monthly/recurring" : contact.segment === "past_inactive" ? "Past/inactive" : "Online lead")}</p></div></div>
      <p>${escapeHtml(submittedDate(contact.capturedAt))}</p>
      <div class="crm-consent-badges">${consentStatus(contact.marketingEmail, "Email eligible")} ${consentStatus(contact.marketingSms, "SMS")}</div>
    </article>`).join("");
    $("[data-marketing-empty]").hidden = contacts.length > 0;
    $("[data-marketing-wrap]").hidden = contacts.length === 0;
  }

  async function refreshMarketingCampaign() {
    const status = $("[data-marketing-campaign-status]");
    const buttons = $$('[data-send-marketing-channel]');
    status.className = "crm-action-status";
    status.textContent = "Checking eligible recipients and prior deliveries…";
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const preview = await api("/api/crm/marketing-campaign");
      status.textContent = `${preview.remaining.email} email${preview.remaining.email === 1 ? "" : "s"} and ${preview.remaining.sms} SMS message${preview.remaining.sms === 1 ? "" : "s"} remain. Already sent: ${preview.sent.email} email, ${preview.sent.sms} SMS.`;
      buttons.forEach((button) => {
        const channel = button.dataset.sendMarketingChannel;
        button.disabled = Number(preview.remaining[channel] || 0) < 1;
      });
      return preview;
    } catch (error) {
      status.className = "crm-action-status is-error";
      status.textContent = error.message;
      return null;
    }
  }

  async function sendMarketingCampaign(channel, button) {
    const label = channel === "email" ? "emails" : "SMS messages";
    const preview = await refreshMarketingCampaign();
    if (!preview || !preview.remaining[channel]) return;
    if (!window.confirm(`Send the FALL10 campaign to ${preview.remaining[channel]} eligible ${label}? Opt-outs and prior deliveries will be suppressed.`)) return;
    const status = $("[data-marketing-campaign-status]");
    $$('[data-send-marketing-channel]').forEach((item) => { item.disabled = true; });
    let totalSent = 0;
    let totalFailed = 0;
    try {
      while (true) {
        status.textContent = `Sending ${label}… ${totalSent} delivered so far.`;
        const result = await api("/api/crm/marketing-campaign", {
          method: "POST",
          body: JSON.stringify({ channel, confirmation: `SEND FALL10-2026 ${channel.toUpperCase()}`, batchSize: 10 })
        });
        totalSent += Number(result.sent || 0);
        totalFailed += Array.isArray(result.failures) ? result.failures.length : 0;
        if (Array.isArray(result.failures) && result.failures.length) break;
        if (!result.preview.remaining[channel] || !result.attempted) break;
      }
      status.className = totalFailed ? "crm-action-status is-error" : "crm-action-status is-success";
      status.textContent = `${totalSent} ${label} sent.${totalFailed ? ` ${totalFailed} failed and were logged for review.` : ""}`;
      toast(`${totalSent} ${label} sent${totalFailed ? `; ${totalFailed} failed` : ""}.`, totalFailed ? "error" : "success");
      await refreshMarketingCampaign();
    } catch (error) {
      status.className = "crm-action-status is-error";
      status.textContent = `${totalSent} sent before the process stopped. ${error.message}`;
      button.disabled = false;
    }
  }

  function callbackMatchesSearch(callback) {
    const query = state.search.trim().toLowerCase();
    return !query || [callback.customerName, callback.phone, callback.reason, callback.summary, callback.notes]
      .some((value) => String(value || "").toLowerCase().includes(query));
  }

  function callDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds || 0)));
    if (!total) return "Not recorded";
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
  }

  function filteredCalls() {
    const query = state.search.trim().toLowerCase();
    return state.calls.filter((call) => !query || [call.customerName, call.phone, call.callType, call.summary, call.transcript, call.status]
      .some((value) => String(value || "").toLowerCase().includes(query)));
  }

  function callBackButton(call) {
    if (!call.id || !call.callbackPhone) return '<span class="crm-history-empty">Callback unavailable</span>';
    return `<button class="crm-row-button" type="button" data-call-back="${escapeHtml(call.id)}" aria-label="Call back ${escapeHtml(call.customerName || "Caller")} at ${escapeHtml(call.callbackPhone)}">☎ Call back</button>`;
  }

  function callBack(id) {
    const call = state.calls.find(item => item.id === id);
    if (!call?.callbackPhone) return toast("A callback number is not available for this call.", "error");
    openDialer(call.callbackPhone, call.customerName || "Caller", call.id, "Call history");
  }

  function renderCalls() {
    const calls = filteredCalls();
    $("[data-calls-table]").innerHTML = calls.map((call) => `<tr>
      <td class="crm-customer-cell"><strong>${escapeHtml(call.customerName || "Caller")}</strong><span>${escapeHtml(call.phone || "Number unavailable")}</span></td>
      <td class="crm-date-cell">${escapeHtml(submittedDate(call.calledAt))}</td>
      <td>${escapeHtml(call.callType || "Other")}</td>
      <td>${escapeHtml(callDuration(call.durationSeconds))}</td>
      <td>${statusBadge(String(call.status || "Completed").replace(/_/g, " "))}</td>
      <td><div class="crm-contact-actions">${callBackButton(call)}<button class="crm-row-button" type="button" data-open-call="${escapeHtml(call.id)}">View</button></div></td>
    </tr>`).join("");
    $("[data-mobile-calls]").innerHTML = calls.map((call) => `<article class="crm-mobile-booking">
      <div class="crm-mobile-booking-head"><div><h3>${escapeHtml(call.customerName || "Caller")}</h3><p>${escapeHtml(call.phone || "Number unavailable")} · ${escapeHtml(call.callType || "Other")}</p></div></div>
      <p>${escapeHtml(submittedDate(call.calledAt))} · ${escapeHtml(callDuration(call.durationSeconds))}</p>
      <div class="crm-mobile-booking-bottom">${statusBadge(String(call.status || "Completed").replace(/_/g, " "))}<div class="crm-contact-actions">${callBackButton(call)}<button class="crm-row-button" type="button" data-open-call="${escapeHtml(call.id)}">View</button></div></div>
    </article>`).join("");
    $("[data-calls-empty]").hidden = calls.length > 0;
    $("[data-calls-wrap]").hidden = calls.length === 0;
  }

  function openCall(id) {
    const call = state.calls.find((item) => item.id === id);
    if (!call) return;
    state.selectedId = "";
    $("[data-booking-detail]").innerHTML = `<div class="crm-dialog-head">
      <div><p class="crm-eyebrow">CALL RECORD</p><h2>${escapeHtml(call.customerName || "Caller")}</h2></div>
      <button class="crm-dialog-close" type="button" data-close-dialog aria-label="Close">×</button>
    </div><div class="crm-dialog-body">
      <div class="crm-contact-actions">${callBackButton(call)}</div>
      <div class="crm-detail-grid">
        <div class="crm-detail"><span>Phone</span>${call.phone ? `<a href="tel:${escapeHtml(call.phone)}">${escapeHtml(call.phone)}</a>` : "<strong>Not available</strong>"}</div>
        <div class="crm-detail"><span>Call time</span><strong>${escapeHtml(submittedDate(call.calledAt))}</strong></div>
        <div class="crm-detail"><span>Duration</span><strong>${escapeHtml(callDuration(call.durationSeconds))}</strong></div>
        <div class="crm-detail"><span>Outcome</span><strong>${escapeHtml(String(call.status || "Completed").replace(/_/g, " "))}</strong></div>
        <div class="crm-detail"><span>Reason</span><strong>${escapeHtml(call.callType || "Other")}</strong></div>
        <div class="crm-detail"><span>Callback</span><strong>${escapeHtml(call.callbackStatus || (call.transferRequested ? "Transfer requested" : "Not requested"))}</strong></div>
      </div>
      ${call.summary ? `<section class="crm-detail-section"><h3>Call summary</h3><p>${escapeHtml(call.summary)}</p></section>` : ""}
      <section class="crm-detail-section"><h3>Full transcription</h3>${call.transcript ? `<pre class="crm-quote-details crm-call-transcript">${escapeHtml(call.transcript)}</pre>` : '<p class="crm-additional-copy">A transcription was not available for this call.</p>'}</section>
      ${call.recordingLink ? `<section class="crm-detail-section"><a class="crm-primary" href="${escapeHtml(call.recordingLink)}" target="_blank" rel="noopener">Open call recording</a></section>` : ""}
    </div>`;
    dialog.showModal();
  }

  function filteredConversations() {
    const query = state.search.trim().toLowerCase();
    return state.conversations.filter((conversation) => !query || [
      conversation.customerName,
      conversation.customerContact,
      conversation.source,
      conversation.status,
      conversation.lastMessage,
      ...(conversation.messages || []).map((message) => message.body)
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }

  function conversationPreview(value, maximum = 92) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > maximum ? `${text.slice(0, maximum - 1).trim()}…` : text;
  }

  function conversationTextButton(conversation) {
    const phone = String(conversation.customerContact || "");
    if (!phoneKey(phone)) return '<button class="crm-row-button" type="button" disabled title="Phone number unavailable">✉ Text</button>';
    const optedOut = /opt(?:ed)?[ _-]?out|unsubscribed|blocked/i.test(String(conversation.status || ""))
      || /^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(String(conversation.lastMessage || "").trim());
    if (optedOut) return '<button class="crm-row-button" type="button" disabled title="This customer opted out of text messages">Text opted out</button>';
    return `<button class="crm-row-button" type="button" data-text-customer data-customer-phone="${escapeHtml(phone)}" data-customer-name="${escapeHtml(conversation.customerName || "Customer")}" data-source-id="${escapeHtml(conversation.id || "")}" data-source-type="conversation">✉ Text</button>`;
  }

  function renderConversations() {
    const conversations = filteredConversations();
    $("[data-conversations-table]").innerHTML = conversations.map((conversation) => `<tr>
      <td class="crm-customer-cell"><strong>${escapeHtml(conversation.customerName || "Customer")}</strong><span>${escapeHtml(conversation.customerContact || conversation.shortCode || "Contact unavailable")}</span></td>
      <td class="crm-date-cell">${escapeHtml(submittedDate(conversation.updatedAt))}</td>
      <td>${escapeHtml(conversation.source || "AI text message")}</td>
      <td><strong>${escapeHtml(conversation.messageCount || 0)}</strong></td>
      <td class="crm-conversation-preview">${escapeHtml(conversationPreview(conversation.lastMessage) || "No messages recorded")}</td>
      <td><div class="crm-contact-actions"><button class="crm-row-button" type="button" data-open-conversation="${escapeHtml(conversation.id)}">View</button>${conversationTextButton(conversation)}</div></td>
    </tr>`).join("");
    $("[data-mobile-conversations]").innerHTML = conversations.map((conversation) => `<article class="crm-mobile-booking">
      <div class="crm-mobile-booking-head"><div><h3>${escapeHtml(conversation.customerName || "Customer")}</h3><p>${escapeHtml(conversation.customerContact || "Contact unavailable")} · ${escapeHtml(conversation.source || "AI text message")}</p></div></div>
      <p>${escapeHtml(conversationPreview(conversation.lastMessage, 130) || "No messages recorded")}</p>
      <div class="crm-mobile-booking-bottom"><span>${escapeHtml(conversation.messageCount || 0)} messages · ${escapeHtml(submittedDate(conversation.updatedAt))}</span><div class="crm-contact-actions"><button class="crm-row-button" type="button" data-open-conversation="${escapeHtml(conversation.id)}">View</button>${conversationTextButton(conversation)}</div></div>
    </article>`).join("");
    $("[data-conversations-error]").hidden = !state.conversationsError;
    $("[data-conversations-error]").textContent = state.conversationsError;
    $("[data-conversations-empty]").hidden = conversations.length > 0 || Boolean(state.conversationsError);
    $("[data-conversations-wrap]").hidden = conversations.length === 0;
  }

  function openConversation(id) {
    const conversation = state.conversations.find((item) => item.id === id);
    if (!conversation) return;
    state.selectedId = "";
    const contact = String(conversation.customerContact || "");
    const optedOut = /opt(?:ed)?[ _-]?out|unsubscribed|blocked/i.test(String(conversation.status || ""))
      || /^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(String(conversation.lastMessage || "").trim());
    const canReply = Boolean(phoneKey(contact)) && !optedOut;
    const phoneLink = /^\+?[\d\s().-]{7,}$/.test(contact)
      ? `<a href="tel:${escapeHtml(contact)}">${escapeHtml(contact)}</a>`
      : `<strong>${escapeHtml(contact || "Not available")}</strong>`;
    $("[data-booking-detail]").innerHTML = `<div class="crm-dialog-head">
      <div><p class="crm-eyebrow">AI CONVERSATION</p><h2>${escapeHtml(conversation.customerName || "Customer")}</h2></div>
      <div class="crm-dialog-head-actions">
        ${phoneKey(contact) ? `<button class="crm-primary" type="button" data-call-customer data-customer-phone="${escapeHtml(contact)}" data-customer-name="${escapeHtml(conversation.customerName || "Customer")}" data-source-id="${escapeHtml(conversation.id)}" data-source-type="conversation">☎ Call</button>` : ""}
        <button class="crm-dialog-close" type="button" data-close-dialog aria-label="Close">×</button>
      </div>
    </div><div class="crm-dialog-body">
      <div class="crm-detail-grid">
        <div class="crm-detail"><span>Customer contact</span>${phoneLink}</div>
        <div class="crm-detail"><span>Channel</span><strong>${escapeHtml(conversation.source || "AI text message")}</strong></div>
        <div class="crm-detail"><span>Started</span><strong>${escapeHtml(submittedDate(conversation.createdAt))}</strong></div>
        <div class="crm-detail"><span>Last activity</span><strong>${escapeHtml(submittedDate(conversation.updatedAt))}</strong></div>
        <div class="crm-detail"><span>Status</span><strong>${escapeHtml(conversation.status || "Active")}</strong></div>
        <div class="crm-detail"><span>Messages</span><strong>${escapeHtml(conversation.messageCount || 0)}</strong></div>
      </div>
      <section class="crm-detail-section"><h3>Full conversation</h3>
        <div class="crm-conversation-thread">${(conversation.messages || []).map((message) => `<article class="crm-conversation-message" data-sender="${escapeHtml(message.sender)}">
          <header><strong>${escapeHtml(message.senderLabel)}</strong><time>${escapeHtml(submittedDate(message.createdAt))}</time></header>
          <p>${escapeHtml(message.body)}</p>
        </article>`).join("") || '<p class="crm-additional-copy">No messages were recorded for this conversation.</p>'}</div>
      </section>
      ${canReply ? `<form class="crm-inline-reply crm-message-form" data-message-form data-conversation-id="${escapeHtml(conversation.id)}">
        <input type="hidden" name="phone" value="${escapeHtml(contact)}">
        <input type="hidden" name="customerName" value="${escapeHtml(conversation.customerName || "Customer")}">
        <label for="crm-conversation-reply-${escapeHtml(conversation.id)}">Reply to ${escapeHtml(conversation.customerName || "customer")}</label>
        <textarea id="crm-conversation-reply-${escapeHtml(conversation.id)}" name="message" rows="3" maxlength="1600" placeholder="Type your reply…" required></textarea>
        <div class="crm-inline-reply-actions"><p class="crm-dialer-status" data-message-status role="status">Ready to send.</p><button class="crm-primary" type="submit" data-send-message>Send reply</button></div>
      </form>` : `<p class="crm-dialer-status is-error">${optedOut ? "This customer opted out of text messages." : "A valid phone number is required to reply."}</p>`}
    </div>`;
    if (!dialog.open) dialog.showModal();
    const thread = $(".crm-conversation-thread", dialog);
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  function renderCallbacks() {
    const options = ["All", "Pending", "Called", "Completed"];
    $("[data-callback-filters]").innerHTML = options.map((status) => {
      const count = status === "All" ? state.callbacks.length : state.callbacks.filter((item) => item.status === status).length;
      return `<button type="button" data-callback-filter="${status}" class="${state.callbackStatus === status ? "is-active" : ""}">${status} <b>${count}</b></button>`;
    }).join("");
    const callbacks = state.callbacks
      .filter((item) => state.callbackStatus === "All" || item.status === state.callbackStatus)
      .filter(callbackMatchesSearch)
      .sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
    $("[data-callback-list]").innerHTML = callbacks.map((item) => `<article class="crm-callback-card" data-callback-card="${escapeHtml(item.id)}">
      <div class="crm-callback-main">
        <div class="crm-callback-heading"><div><p class="crm-eyebrow">CALLBACK REQUEST</p><h3>${escapeHtml(item.customerName || "Caller")}</h3></div>${statusBadge(item.status)}</div>
        <p class="crm-callback-time">Requested ${escapeHtml(submittedDate(item.requestedAt))}</p>
        <p>${escapeHtml(item.summary || "Customer requested a team member, but no representative answered.")}</p>
        <label>Callback notes<textarea rows="2" maxlength="2000" data-callback-notes placeholder="Add notes about the callback…">${escapeHtml(item.notes || "")}</textarea></label>
      </div>
      <div class="crm-callback-actions">
        ${item.phone ? `<a class="crm-primary" href="tel:${escapeHtml(item.phone)}">Call ${escapeHtml(item.phone)}</a>` : '<span class="crm-callback-missing">Phone number unavailable</span>'}
        ${item.status !== "Called" ? `<button class="crm-row-button" type="button" data-callback-status="Called" data-callback-id="${escapeHtml(item.id)}">Mark called</button>` : ""}
        ${item.status !== "Completed" ? `<button class="crm-row-button" type="button" data-callback-status="Completed" data-callback-id="${escapeHtml(item.id)}">Complete</button>` : `<button class="crm-row-button" type="button" data-callback-status="Pending" data-callback-id="${escapeHtml(item.id)}">Reopen</button>`}
        <p class="crm-action-status" data-callback-action-status></p>
      </div>
    </article>`).join("");
    $("[data-callbacks-empty]").hidden = callbacks.length > 0;
  }

  function renderSameDayRequests() {
    const query = state.search.trim().toLowerCase();
    const requests = state.sameDayRequests.filter((item) => !query || [item.id, item.customer?.firstName, item.customer?.lastName, item.customer?.phone, item.customer?.email, item.serviceAddress, item.quote?.serviceLabel, item.status]
      .some((value) => String(value || "").toLowerCase().includes(query)));
    $("[data-same-day-list]").innerHTML = requests.map((item) => {
      const customer = `${item.customer?.firstName || ""} ${item.customer?.lastName || ""}`.trim() || "Customer";
      const actionable = item.status === "New request";
      return `<article class="crm-callback-card" data-same-day-card="${escapeHtml(item.id)}">
        <div class="crm-callback-main">
          <div class="crm-callback-heading"><div><p class="crm-eyebrow">SAME-DAY REQUEST</p><h3>${escapeHtml(customer)}</h3></div>${statusBadge(item.status)}</div>
          <p class="crm-callback-time">Submitted ${escapeHtml(submittedDate(item.createdAt))}</p>
          <p><strong>${escapeHtml(item.quote?.serviceLabel || "Cleaning service")}</strong> · ${escapeHtml(money(item.quote?.priceCents || 0))} base price + $100 rush fee</p>
          ${item.quote?.manualDiscount?.amountCents ? `<p>${escapeHtml(item.quote.manualDiscount.label)}: −${money(item.quote.manualDiscount.amountCents)} included in the base price.</p>` : ''}
          <p>${escapeHtml(item.serviceAddress || "Address unavailable")}<br>Preferred: ${escapeHtml(item.preferredTime || "Not provided")} · ${escapeHtml(item.flexibility || "")}</p>
          ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
          ${item.approvalExpiresAt ? `<p class="crm-callback-time">Payment link expires ${escapeHtml(submittedDate(item.approvalExpiresAt))}</p>` : ""}
        </div>
        <div class="crm-callback-actions">
          ${item.customer?.phone ? `<a class="crm-primary" href="tel:${escapeHtml(item.customer.phone)}">Call customer</a>` : ""}
          ${actionable ? `<label>Confirmed start time<input type="time" data-same-day-time value="${escapeHtml(item.preferredTime || "")}"></label>
            <label>Discount amount ($)<input type="number" min="0" step="0.01" data-same-day-discount value="${((item.quote?.manualDiscount?.amountCents || 0) / 100).toFixed(2)}"></label>
            <label>Discount name (optional)<input maxlength="160" data-same-day-discount-label value="${escapeHtml(item.quote?.manualDiscount?.label || '')}" placeholder="First-time customer discount"></label>
            <button class="crm-row-button" type="button" data-same-day-action="discount" data-same-day-id="${escapeHtml(item.id)}">Save discount</button>
            <button class="crm-primary" type="button" data-same-day-action="approve" data-same-day-id="${escapeHtml(item.id)}">Approve &amp; send payment link</button>
            <button class="crm-row-button" type="button" data-same-day-action="unavailable" data-same-day-id="${escapeHtml(item.id)}">Unavailable today</button>` : ""}
          ${item.savedQuoteUrl ? `<a class="crm-row-button" href="${escapeHtml(item.savedQuoteUrl)}" target="_blank" rel="noopener">Open saved quote</a>` : ""}
          ${item.bookingId ? `<button class="crm-row-button" type="button" data-open-quote="${escapeHtml(item.bookingId)}">Open quote / discount</button>` : ''}
          <p class="crm-action-status" data-same-day-status></p>
        </div>
      </article>`;
    }).join("");
    $("[data-same-day-empty]").hidden = requests.length > 0;
  }

  async function updateSameDay(id, action, button) {
    const card = button.closest("[data-same-day-card]");
    const target = $("[data-same-day-status]", card);
    const serviceTime = $("[data-same-day-time]", card)?.value || "";
    if (action === "approve" && !serviceTime) {
      target.textContent = "Choose the confirmed start time first.";
      target.className = "crm-action-status is-error";
      return;
    }
    button.disabled = true;
    target.textContent = action === 'discount' ? 'Saving discount without sending a message…' : action === "approve" ? "Creating and texting payment link…" : "Texting saved quote link…";
    try {
      const item = state.sameDayRequests.find(item => item.id === id);
      const discount = action === 'discount' ? { discountCents: Math.round(Number($('[data-same-day-discount]', card).value) * 100),
        discountLabel: $('[data-same-day-discount-label]', card).value, updatedAt: item?.updatedAt } : {};
      const data = await api("/api/crm/same-day", { method: "PATCH", body: JSON.stringify({ id, action, serviceTime, ...discount }) });
      const index = state.sameDayRequests.findIndex((item) => item.id === id);
      if (index >= 0) state.sameDayRequests[index] = data.request;
      renderCounts();
      renderSameDayRequests();
      toast(action === 'discount' ? 'Discount saved for this same-day request. No message was sent.' : action === "approve" ? "Payment link sent to the customer." : "Unavailable notice and saved quote link sent.");
    } catch (error) {
      target.textContent = error.message;
      target.className = "crm-action-status is-error";
      button.disabled = false;
    }
  }

  async function updateCallbackStatus(id, status, button) {
    const card = button.closest("[data-callback-card]");
    const statusTarget = $("[data-callback-action-status]", card);
    const notes = $("[data-callback-notes]", card)?.value || "";
    button.disabled = true;
    statusTarget.textContent = "Saving…";
    try {
      const data = await api("/api/crm/callbacks", { method: "PATCH", body: JSON.stringify({ id, status, notes }) });
      const index = state.callbacks.findIndex((item) => item.id === id);
      if (index >= 0) state.callbacks[index] = data.callback;
      renderCounts();
      renderCallbacks();
      toast(status === "Completed" ? "Callback completed." : status === "Called" ? "Callback marked called." : "Callback reopened.");
    } catch (error) {
      statusTarget.className = "crm-action-status is-error";
      statusTarget.textContent = error.message;
      button.disabled = false;
      toast(error.message, "error");
    }
  }

  function renderConcerns() {
    $("[data-concern-filters]").innerHTML = ["All", ...CONCERN_STATUSES].map((status) => {
      const count = status === "All" ? state.concerns.length : state.concerns.filter((item) => item.status === status).length;
      return `<button type="button" data-concern-filter="${status}" class="${state.concernStatus === status ? "is-active" : ""}">${status} <b>${count}</b></button>`;
    }).join("");
    const query = state.search.trim().toLowerCase();
    const concerns = state.concerns.filter((item) => (state.concernStatus === "All" || item.status === state.concernStatus)
      && (!query || [item.caseNumber, item.customerName, item.email, item.phone, item.address, item.concernType, item.service, item.explanation, item.internalNotes, ...Object.values(item.fields || {})]
        .some((value) => String(value || "").toLowerCase().includes(query))));
    $("[data-concerns-table]").innerHTML = concerns.map((item) => `<tr>
      <td class="crm-customer-cell"><strong>${escapeHtml(item.customerName)}</strong><span>${escapeHtml(item.caseNumber)}</span><span>${escapeHtml(item.phone || item.email)}</span></td>
      <td class="crm-service-cell"><strong>${escapeHtml(item.concernType)}</strong><span>${item.uploads.length} evidence file${item.uploads.length === 1 ? "" : "s"}</span></td>
      <td class="crm-service-cell"><strong>${escapeHtml(item.service)}</strong><span>${escapeHtml(item.serviceDate || "Date not provided")}</span></td>
      <td class="crm-date-cell">${escapeHtml(submittedDate(item.createdAt))}</td>
      <td>${statusBadge(item.status)}</td>
      <td><button class="crm-row-button" type="button" data-open-concern="${escapeHtml(item.id)}">View</button></td>
    </tr>`).join("");
    $("[data-mobile-concerns]").innerHTML = concerns.map((item) => `<article class="crm-mobile-booking">
      <div class="crm-mobile-booking-head"><div><h3>${escapeHtml(item.customerName)}</h3><p>${escapeHtml(item.caseNumber)}</p></div></div>
      <p>${escapeHtml(item.concernType)}</p><p>${escapeHtml(submittedDate(item.createdAt))}</p>
      <div class="crm-mobile-booking-bottom">${statusBadge(item.status)}<button class="crm-row-button" type="button" data-open-concern="${escapeHtml(item.id)}">View</button></div>
    </article>`).join("");
    $("[data-concerns-error]").hidden = !state.concernsError;
    $("[data-concerns-error]").textContent = state.concernsError;
    $("[data-concerns-empty]").hidden = concerns.length > 0 || Boolean(state.concernsError);
    $("[data-concerns-wrap]").hidden = concerns.length === 0;
  }

  function concernDriveLink(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "drive.google.com" ? url.href : "";
    } catch { return ""; }
  }

  function openConcern(id) {
    const item = state.concerns.find((concern) => concern.id === id);
    if (!item) return;
    state.selectedId = "";
    const folderLink = concernDriveLink(item.folderLink);
    $("[data-booking-detail]").innerHTML = `<div class="crm-dialog-head">
      <div><p class="crm-eyebrow">${escapeHtml(item.caseNumber)}</p><h2>${escapeHtml(item.customerName)}</h2></div>
      <button class="crm-dialog-close" type="button" data-close-dialog aria-label="Close">×</button>
    </div><div class="crm-dialog-body">
      <div class="crm-detail-grid">
        <div class="crm-detail"><span>Status</span><strong>${escapeHtml(item.status)}</strong></div>
        <div class="crm-detail"><span>Submitted</span><strong>${escapeHtml(submittedDate(item.createdAt))}</strong></div>
        <div class="crm-detail"><span>Phone</span><strong>${escapeHtml(item.phone || "Not provided")}</strong></div>
        <div class="crm-detail"><span>Email</span><strong>${escapeHtml(item.email || "Not provided")}</strong></div>
        <div class="crm-detail"><span>Service</span><strong>${escapeHtml(item.service)}</strong></div>
        <div class="crm-detail"><span>Service date</span><strong>${escapeHtml(item.serviceDate || "Not provided")}</strong></div>
        <div class="crm-detail crm-detail-wide"><span>Service address</span><strong>${escapeHtml(item.address || "Not provided")}</strong></div>
      </div>
      <section class="crm-detail-section"><h3>${escapeHtml(item.concernType)}</h3><p class="crm-concern-explanation">${escapeHtml(item.explanation || "No explanation provided.")}</p></section>
      <section class="crm-detail-section"><h3>Photos and evidence</h3>
        ${item.uploads.length ? `<ul class="crm-concern-evidence">${item.uploads.map((upload) => {
          const url = concernDriveLink(upload.url);
          return `<li>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(upload.name)}</a>` : escapeHtml(upload.name)}</li>`;
        }).join("")}</ul>` : '<p>No evidence files were submitted.</p>'}
        ${folderLink ? `<a class="crm-text-button" href="${escapeHtml(folderLink)}" target="_blank" rel="noopener noreferrer">Open evidence folder ↗</a>` : ""}
      </section>
      <details class="crm-detail-section"><summary>Full customer submission</summary><dl class="crm-concern-fields">${Object.entries(item.fields || {}).map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value || "Not provided")}</dd>`).join("")}</dl></details>
      <section class="crm-detail-section"><h3>Follow-up</h3>
        <form class="crm-concern-form" data-concern-form data-concern-id="${escapeHtml(item.id)}" data-updated-at="${escapeHtml(item.updatedAt)}">
          <label>Case status<select name="status">${CONCERN_STATUSES.map((status) => `<option${item.status === status ? " selected" : ""}>${status}</option>`).join("")}</select></label>
          <label>Internal notes<textarea name="internalNotes" rows="4" maxlength="5000" placeholder="Record your review, follow-up, or resolution…">${escapeHtml(item.internalNotes)}</textarea></label>
          <p>Only visible in the CRM. Saving does not notify the customer or issue a refund.</p>
          <button class="crm-primary" type="submit">Save update</button>
          <p class="crm-action-status" data-concern-save-status role="status"></p>
        </form>
      </section>
      ${item.history.length ? `<details class="crm-detail-section"><summary>Update history (${item.history.length})</summary><ol class="crm-concern-history">${[...item.history].reverse().map((entry) => `<li><strong>${escapeHtml(entry.status)} · ${escapeHtml(submittedDate(entry.at))}</strong><p>${escapeHtml(entry.notes || "No notes recorded.")}</p></li>`).join("")}</ol></details>` : ""}
    </div>`;
    if (!dialog.open) dialog.showModal();
  }

  async function saveConcern(form) {
    const button = $("button[type='submit']", form);
    const target = $("[data-concern-save-status]", form);
    button.disabled = true;
    target.className = "crm-action-status";
    target.textContent = "Saving…";
    try {
      const data = await api("/api/crm/concerns", { method: "PATCH", body: JSON.stringify({
        id: form.dataset.concernId, updatedAt: form.dataset.updatedAt,
        status: form.elements.status.value, internalNotes: form.elements.internalNotes.value
      }) });
      const index = state.concerns.findIndex((item) => item.id === data.concern.id);
      if (index >= 0) state.concerns[index] = data.concern;
      renderCounts();
      renderConcerns();
      if (form.isConnected) openConcern(data.concern.id);
      toast("Concern update saved.");
    } catch (error) {
      target.textContent = error.message;
      target.className = "crm-action-status is-error";
      button.disabled = false;
    }
  }

  function renderAll() {
    renderCounts();
    renderStats();
    renderUpcoming();
    renderPaymentAttention();
    renderBookings();
    renderQuotes();
    renderWalkthroughs();
    renderTrash();
    renderCustomers();
    renderMarketing();
    renderCalls();
    renderConversations();
    renderCallbacks();
    renderSameDayRequests();
    renderConcerns();
  }

  function photoReminderSummary(photoUpload = {}) {
    return Array.isArray(photoUpload.scheduledReminders)
      ? photoUpload.scheduledReminders.map((item) => {
          const label = item.stage === "12_hours" ? "12-hour" : "24-hour final";
          const error = item.error ? ` — ${item.error}` : "";
          const emailFallback = item.fallbackEmail?.status === "sent" ? " · email fallback sent" : "";
          return `${label}: ${String(item.status || "unknown").replaceAll("_", " ")}${error}${emailFallback}`;
        }).join(" · ")
      : "";
  }

  function quoteDetailMarkup(quote) {
    const value = cents(quote.amountCents) ? money(quote.amountCents) : "Pending custom review";
    const photoUpload = quote.photoUpload || {};
    const photoRequested = Boolean(photoUpload.requestedAt || photoUpload.uploadUrl || photoUpload.status === "Awaiting photos" || photoUpload.status === "Photos received");
    const reminderSummary = photoReminderSummary(photoUpload);
    return `<div class="crm-dialog-head">
      <div><p class="crm-eyebrow">${escapeHtml(quote.type)}</p><h2>${escapeHtml(quote.customerName || "Quote details")}</h2></div>
      <button class="crm-dialog-close" type="button" data-close-dialog aria-label="Close">×</button>
    </div>
    <div class="crm-dialog-body">
      ${customQuotePaymentMarkup(quote)}
      ${quoteEditorMarkup(quote)}
      <div class="crm-detail-grid">
        <div class="crm-detail"><span>Quote reference</span><strong>${escapeHtml(quote.id)}</strong></div>
        <div class="crm-detail"><span>Status</span><strong>${escapeHtml(quote.status || "Submitted")}</strong></div>
        <div class="crm-detail"><span>Service</span><strong>${escapeHtml(quote.service || "Cleaning service")}</strong></div>
        <div class="crm-detail"><span>Quote value</span><strong>${escapeHtml(value)}</strong></div>
        <div class="crm-detail"><span>Email</span>${quote.email ? `<a href="mailto:${escapeHtml(quote.email)}">${escapeHtml(quote.email)}</a>` : "<strong>Not available</strong>"}</div>
        <div class="crm-detail"><span>Phone</span>${quote.phone ? `<a href="tel:${escapeHtml(quote.phone)}">${escapeHtml(quote.phone)}</a>` : "<strong>Not available</strong>"}</div>
        <div class="crm-detail crm-detail-wide"><span>Address</span><strong>${escapeHtml(quote.address || "Not available")}</strong></div>
        <div class="crm-detail"><span>Submitted</span><strong>${escapeHtml(submittedDate(quote.createdAt))}</strong></div>
        <div class="crm-detail"><span>Source</span><strong>${escapeHtml(quote.source || "Online")}</strong></div>
        <div class="crm-detail"><span>Email marketing</span><strong>${quote.communicationConsent?.marketingEmail ? "Eligible (unsubscribe required)" : "Not eligible"}</strong></div>
        <div class="crm-detail"><span>SMS marketing</span><strong>${quote.communicationConsent?.marketingSms ? "Subscribed" : "Not subscribed"}</strong></div>
        ${quote.communicationConsent?.capturedAt ? `<div class="crm-detail"><span>Consent recorded</span><strong>${escapeHtml(submittedDate(quote.communicationConsent.capturedAt))}</strong></div>` : ""}
      </div>
      <section class="crm-detail-section"><h3>Contact customer</h3>${communicationButtons({ phone: quote.phone, customerName: quote.customerName, sourceId: quote.id, sourceType: quote.type })}</section>
      ${customerHistoryMarkup(quote.phone)}
      ${quote.details ? `<section class="crm-detail-section"><h3>Submitted information</h3><pre class="crm-quote-details">${escapeHtml(quote.details)}</pre></section>` : ""}
      ${photoRequested && !quote.deletedAt ? `<section class="crm-detail-section">
        <h3>Customer quote photos</h3>
        <div class="crm-detail-grid">
          <div class="crm-detail"><span>Photo status</span><strong>${escapeHtml(photoUpload.status || quote.status || "Awaiting photos")}</strong></div>
          <div class="crm-detail"><span>Photos received</span><strong>${escapeHtml(String(photoUpload.photoCount || quote.photoCount || 0))} of 100</strong></div>
          <div class="crm-detail"><span>Link last sent</span><strong>${photoUpload.lastSentAt ? escapeHtml(submittedDate(photoUpload.lastSentAt)) : "Not recorded"}</strong></div>
          <div class="crm-detail"><span>Customer SMS</span><strong>${escapeHtml(photoUpload.smsStatus || "Not recorded")}</strong></div>
          <div class="crm-detail"><span>Customer email</span><strong>${escapeHtml(photoUpload.emailStatus || "Not recorded")}</strong></div>
          <div class="crm-detail"><span>Reminders</span><strong data-quote-reminder-summary>${escapeHtml(reminderSummary || "Not scheduled")}</strong></div>
        </div>
        <div class="crm-inline-actions">
          <button class="crm-primary" type="button" data-resend-quote-photos="${escapeHtml(quote.id)}">Resend upload link</button>
          ${photoUpload.status !== "Photos received" ? `<button class="crm-row-button" type="button" data-retry-quote-photo-reminders="${escapeHtml(quote.id)}">Retry reminders only</button>` : ""}
          ${photoUpload.uploadUrl ? `<button class="crm-row-button" type="button" data-copy-quote-photo-link="${escapeHtml(photoUpload.uploadUrl)}">Copy link</button>` : ""}
        </div>
        <p class="crm-action-status" data-quote-photo-status aria-live="polite"></p>
      </section>` : ""}
      ${quote.folderLink ? `<section class="crm-detail-section"><a class="crm-primary" href="${escapeHtml(quote.folderLink)}" target="_blank" rel="noopener">Open quote folder</a></section>` : ""}
    </div>`;
  }

  function openQuote(id) {
    const quote = state.quotes.find((item) => item.id === id);
    if (!quote) return;
    state.selectedId = "";
    dialog.dataset.openQuoteId = id;
    $("[data-booking-detail]").innerHTML = quote.walkthrough && !quote.deletedAt ? walkthroughDetailMarkup(quote) : quoteDetailMarkup(quote);
    // Bind each form to the version the owner actually opened, not a later background refresh.
    for (const form of $$("[data-custom-payment-form], [data-quote-edit-form], [data-quote-discount-form], [data-walkthrough-confirm-form]", dialog)) {
      quoteFormSnapshots.set(form, JSON.parse(JSON.stringify(quote)));
    }
    if (!dialog.open) dialog.showModal();
    if (!quote.walkthrough && Array.isArray(quote.photoUpload?.scheduledReminders) && quote.photoUpload.scheduledReminders.length) {
      refreshQuotePhotoReminderStatus(quote);
    }
  }

  async function refreshQuotePhotoReminderStatus(quote) {
    const status = $("[data-quote-photo-status]", dialog);
    if (status) status.textContent = "Checking reminder delivery…";
    try {
      const data = await api("/api/crm/quote-photo-reminder-status", {
        method: "PATCH",
        body: JSON.stringify({ quoteId: quote.id })
      });
      quote.photoUpload = data.photoUpload || quote.photoUpload;
      if (dialog.dataset.openQuoteId === quote.id && dialog.open) {
        const summary = $("[data-quote-reminder-summary]", dialog);
        if (summary) summary.textContent = photoReminderSummary(quote.photoUpload) || "Not scheduled";
        const refreshedStatus = $("[data-quote-photo-status]", dialog);
        if (refreshedStatus) {
          refreshedStatus.className = "crm-action-status is-success";
          refreshedStatus.textContent = "Reminder delivery statuses updated from Twilio.";
        }
      }
    } catch (error) {
      if (status) {
        status.className = "crm-action-status is-error";
        status.textContent = `Reminder status could not be refreshed: ${error.message}`;
      }
    }
  }

  async function createStandalonePaymentLink(button) {
    if (!state.token || button.disabled) return;
    const originalLabel = button.innerHTML;
    button.disabled = true;
    button.textContent = "Creating…";
    showLoading(true, "Creating your custom payment link…");
    try {
      const data = await api("/api/crm/quotes", { method: "POST", body: "{}" });
      if (!data.quote?.id) throw new Error("The custom payment link draft could not be created.");
      state.quotes = [data.quote, ...state.quotes.filter((quote) => quote.id !== data.quote.id)];
      renderAll();
      setView("quotes");
      openQuote(data.quote.id);
      const form = $("[data-custom-payment-form]", dialog);
      if (form) {
        form.hidden = false;
        updatePaymentPreview(form);
        form.elements.service.focus();
      }
      toast("Blank custom payment link ready to complete.");
    } catch (error) {
      toast(error.message || "The custom payment link draft could not be created.", "error");
    } finally {
      showLoading(false);
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  }

  function isCustomPaymentQuote(quote) {
    return quote.type === "Customized quote" && ["custom", "legacy"].includes(quote.editSource);
  }

  function customPaymentButton(quote) {
    return isCustomPaymentQuote(quote) && !quote.deletedAt && !quote.editLocked
      ? `<button class="crm-row-button" type="button" data-prepare-custom-payment="${escapeHtml(quote.id)}">Payment link</button>` : "";
  }

  function quoteUnitItemMarkup(item = {}) {
    return `<div class="crm-unit-item" data-unit-item data-kind="${item.kind === "addon" ? "addon" : "room"}">
      <label>Room / add-on<input data-item-name type="text" maxlength="160" value="${escapeHtml(item.name || "")}" placeholder="e.g. Inside refrigerator"></label>
      <label>Quantity (optional)<input data-item-quantity type="number" min="0" max="100" step="1" value="${item.quantity ?? 0}"></label>
      <label>Price each, before tax ($) (optional)<input data-item-price type="number" min="0" max="100000" step="0.01" value="${((item.unitPriceCents || 0) / 100).toFixed(2)}"></label>
      <div class="crm-unit-line-total"><span>Line total</span><strong data-item-total>${money((item.quantity || 0) * (item.unitPriceCents || 0))}</strong><button type="button" class="crm-row-button" data-remove-unit-item aria-label="Remove this room or add-on">Remove</button></div>
    </div>`;
  }

  function quoteUnitMarkup(unit = {}, index = 0) {
    const items = unit.items?.length ? unit.items : ["Bedrooms", "Full bathrooms", "Half bathrooms", "Living rooms", "Dining rooms", "Kitchens"].map(name => ({ name, quantity: 0, unitPriceCents: 0, kind: "room" }));
    return `<div class="crm-quote-unit" data-quote-unit>
      <div class="crm-unit-heading"><label>Unit name (optional)<input data-unit-name type="text" maxlength="160" value="${escapeHtml(unit.name || `Unit ${index + 1}`)}"></label><button class="crm-row-button crm-danger-button" type="button" data-remove-quote-unit>Remove unit</button></div>
      <div data-unit-items>${items.map(quoteUnitItemMarkup).join("")}</div>
      <div class="crm-unit-footer"><button class="crm-row-button" type="button" data-add-unit-item>Add room / add-on</button><strong>Unit subtotal: <span data-unit-subtotal>${money(unit.subtotalCents || 0)}</span></strong></div>
    </div>`;
  }

  function collectPaymentUnits(form) {
    return $$("[data-quote-unit]", form).map(unit => ({
      name: $("[data-unit-name]", unit).value.trim(),
      items: $$("[data-unit-item]", unit).map(row => ({
        name: $("[data-item-name]", row).value.trim(), quantity: Number($("[data-item-quantity]", row).value),
        unitPriceCents: Math.round(Number($("[data-item-price]", row).value) * 100), kind: row.dataset.kind
      })).filter(item => item.quantity !== 0)
    })).filter(unit => unit.items.length);
  }

  function customQuotePaymentMarkup(quote) {
    if (!isCustomPaymentQuote(quote) || quote.deletedAt || quote.editLocked) return "";
    const f = quote.editFields || {};
    const input = (name, label, type = "text", extra = "") => `<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(f[name] || "")}" required ${extra}></label>`;
    const ready = quote.paymentReady && quote.approvalUrl;
    const units = f.units?.length ? f.units : [{ name: "Unit 1", items: [] }];
    return `<section class="crm-quote-editor crm-custom-payment">
      <h3>Customer estimate &amp; payment link</h3>
      <p>Add each unit, its rooms and add-ons. Set each item’s price, then choose your workers and hours. The customer will review your itemized estimate, sign the service agreement and pay securely.</p>
      <button class="crm-primary" type="button" data-toggle-custom-payment>${ready ? "Update" : "Create"} payment link</button>
      ${ready ? `<div class="crm-revised-link"><a href="${escapeHtml(quote.approvalUrl)}" target="_blank" rel="noopener">Preview customer estimate ↗</a><button class="crm-row-button" type="button" data-copy-quote-photo-link="${escapeHtml(quote.approvalUrl)}">Copy payment link</button><button class="crm-row-button" type="button" data-email-payment-link="${escapeHtml(quote.id)}"${quote.email ? "" : " disabled"}>Email payment link</button><button class="crm-row-button" type="button" data-text-payment-link="${escapeHtml(quote.id)}"${quote.phone ? "" : " disabled"}>Text payment link</button></div>` : ""}
      <form data-custom-payment-form data-quote-id="${escapeHtml(quote.id)}" hidden>
        <h3>Cleaning package</h3>
        ${input("service", "Type of cleaning / estimate title", "text", 'maxlength="160"')}
        <label>Service description link (optional)<input name="serviceDescriptionUrl" type="url" inputmode="url" maxlength="500" value="${escapeHtml(f.serviceDescriptionUrl || "")}" placeholder="https://www.example.com/service-description"></label>
        <p>Unit and room details are optional. You can leave every quantity at 0 and enter only the cleaning price below. If you itemize units, the total adds 8.875% tax, then subtracts your dollar discount. Up to 20 units.</p>
        ${!f.units?.length && f.amountCents ? `<p>Previous cleaning price: ${money(f.amountCents)}. Enter its itemized breakdown below to replace it. Your existing quote will not change until you save.</p>` : ""}
        <div data-quote-units>${units.map(quoteUnitMarkup).join("")}</div>
        <button class="crm-row-button" type="button" data-add-quote-unit>+ Add another unit</button>
        <label>Additional included tasks / package notes<textarea name="packageItems" rows="3" maxlength="8000">${escapeHtml(f.packageItems || "")}</textarea></label>
        <label>Service details / customer-facing notes<textarea name="details" rows="4" maxlength="10000" placeholder="Describe the agreed cleaning scope and any exclusions.">${escapeHtml(f.details || "")}</textarea></label>
        <h3>Price and team</h3>
        <div class="crm-edit-grid">
          <input name="amount" type="hidden" value="${f.amountCents ? (f.amountCents / 100).toFixed(2) : ""}">
          <label>Cleaning price before tax and discount ($)<input name="cleaningSubtotal" type="number" min="2" max="100000" step="0.01" value="${f.pricing?.subtotalCents != null ? (f.pricing.subtotalCents / 100).toFixed(2) : f.amountCents ? (Math.round((f.amountCents + (f.discountCents || 0)) / 1.08875) / 100).toFixed(2) : ""}" required></label>
          <label>Sales tax (8.875%)<input name="taxDisplay" type="text" value="$0.00" readonly aria-label="Calculated sales tax"></label>
          <label>Same-day rush fee<select name="rushFeeCents"><option value="0"${!f.rushFeeCents ? " selected" : ""}>No rush fee</option><option value="10000"${f.rushFeeCents ? " selected" : ""}>$100 rush fee</option></select></label>
          <label>Discount from total, after tax ($)<input name="discount" type="number" min="0" max="100000" step="0.01" required value="${((f.discountCents || 0) / 100).toFixed(2)}"></label>
          <label>Discount name (optional)<input name="discountLabel" type="text" maxlength="160" value="${escapeHtml(f.discountLabel || "")}" placeholder="First-time customer discount"></label>
          ${input("cleanerCount", "Number of workers", "number", 'min="1" max="20" step="1"')}
          <label>Hours per worker (time on site)<input name="teamHours" type="number" min="0.25" max="200" step="0.01" value="${f.cleanerCount && f.laborHours ? Number((f.laborHours / f.cleanerCount).toFixed(2)) : ""}" required></label>
        </div>
        <div class="crm-payment-totals" data-payment-totals aria-live="polite"></div>
        <div class="crm-payment-preview" data-payment-preview role="status" aria-live="polite"></div>
        <p>The cleaning total adds up your item prices; hours do not change it. For standard service, the customer pays a 25% deposit, with a remaining-balance hold about 48 hours before service and collection after completion. Any same-day rush fee is collected in full with the deposit; its remaining service balance is due after cleaning.</p>
        <h3>Appointment and customer</h3>
        <p>Date and time are optional. If you enter them, they are locked for the customer. Leave both blank when the appointment will be scheduled later.</p>
        <div class="crm-edit-grid">
          <label>Service date (optional)<input name="serviceDate" type="date" value="${escapeHtml(f.serviceDate || "")}"></label><label>Start time (optional)<input name="serviceTime" type="time" value="${escapeHtml(f.serviceTime || "")}"></label>
          ${input("customerName", "Customer name", "text", 'maxlength="160"')}${input("email", "Customer email", "email", 'maxlength="180"')}
          ${input("phone", "Customer phone", "tel", 'maxlength="40"')}${input("address", "Full service address", "text", 'maxlength="400"')}
        </div>
        <div class="crm-payment-preview" data-schedule-preview role="status" aria-live="polite"></div>
        <p>Creating a link does not send a message, charge a card or confirm a booking. After saving, preview it, copy it or prepare a text to this customer.</p>
        <div class="crm-inline-actions"><button class="crm-primary" type="submit">${ready ? "Update" : "Create"} payment link</button><button class="crm-row-button" type="button" data-toggle-custom-payment>Cancel</button></div>
      </form>
      <p class="crm-action-status" data-custom-payment-status role="status"></p>
    </section>`;
  }

  function updatePaymentPreview(form) {
    const f = form.elements;
    let total = 0;
    for (const unit of $$("[data-quote-unit]", form)) {
      let subtotal = 0;
      for (const row of $$("[data-unit-item]", unit)) {
        const line = Number($("[data-item-quantity]", row).value) * Math.round(Number($("[data-item-price]", row).value) * 100);
        subtotal += Number.isFinite(line) ? line : 0;
        $("[data-item-total]", row).textContent = money(Number.isFinite(line) ? line : 0);
      }
      $("[data-unit-subtotal]", unit).textContent = money(subtotal);
      total += subtotal;
    }
    const rush = Number(f.rushFeeCents.value), discount = Math.round(Number(f.discount.value) * 100);
    const itemized = total > 0;
    const taxableSubtotal = itemized ? total : Math.round(Number(f.cleaningSubtotal.value) * 100);
    if (itemized) f.cleaningSubtotal.value = (taxableSubtotal / 100).toFixed(2);
    const tax = Math.round((taxableSubtotal + rush) * 8875 / 100000);
    const finalTotal = taxableSubtotal + rush + tax - discount;
    f.amount.value = ((finalTotal - rush) / 100).toFixed(2);
    f.taxDisplay.value = money(tax);
    const amount = Math.round(Number(f.amount.value) * 100);
    $("[data-payment-totals]", form).innerHTML = `<div><span>${itemized ? "All units" : "Cleaning price"}, before tax</span><strong>${money(taxableSubtotal)}</strong></div>${rush ? `<div><span>Rush fee</span><strong>${money(rush)}</strong></div>` : ""}<div><span>Sales tax (8.875%)</span><strong>${money(tax)}</strong></div><div><span>${escapeHtml(f.discountLabel.value.trim() || "Discount")} (after tax)</span><strong>−${money(discount)}</strong></div><div><span>Final total</span><strong>${money(amount + rush)}</strong></div>`;
    const workers = Number(f.cleanerCount.value), hours = Number(f.teamHours.value);
    const schedulePreview = $("[data-schedule-preview]", form);
    if (schedulePreview) {
      const date = f.serviceDate.value, time = f.serviceTime.value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) && hours > 0) {
        // Match the server's New York start time, then add elapsed hours so
        // overnight work crossing daylight saving time still has a true duration.
        const zone = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',timeZoneName:'longOffset',hour:'2-digit'})
          .formatToParts(new Date(`${date}T${time}:00Z`)).find(part => part.type === 'timeZoneName').value.replace('GMT','');
        const start = Date.parse(`${date}T${time}:00${zone}`);
        const format = elapsed => new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})
          .format(new Date(start + elapsed * 3600000));
        schedulePreview.textContent = `${date} · ${hours} hours on site · Estimated finish: ${format(hours)} · 3-hour gap · Next possible start: ${format(hours + 3)} (New York time). Availability is checked again at payment; creating this link does not reserve the time.`;
      } else if (!date && !time) schedulePreview.textContent = 'No appointment selected. The customer will choose an available date and time from the live calendar before payment.';
      else schedulePreview.textContent = 'Enter both the service date and start time, or leave both blank.';
    }
    const deposit = Math.round(amount * .25) + rush;
    const labor = Number((workers * hours).toFixed(2));
    $("[data-payment-preview]", form).textContent = amount > 0 && workers > 0 && hours > 0
      ? `${workers} worker${workers === 1 ? "" : "s"} × ${hours} hours = ${labor} total labor-hours. Total: ${money(amount + rush)} · Due now: ${money(deposit)} · Remaining: ${money(amount + rush - deposit)}`
      : "Enter the price, number of workers and hours to preview the payment breakdown.";
  }

  function saveCustomPayment(form) {
    const quote = quoteFormSnapshots.get(form) || state.quotes.find(item => item.id === form.dataset.quoteId);
    if (!quote || !isCustomPaymentQuote(quote) || quote.deletedAt || quote.editLocked || $("button[type=submit]", form).disabled || !form.reportValidity()) return;
    const fields = { ...quote.editFields };
    updatePaymentPreview(form);
    fields.units = collectPaymentUnits(form);
    fields.discountCents = Math.round(Number(form.elements.discount.value) * 100);
    fields.discountLabel = form.elements.discountLabel.value;
    for (const key of ["customerName", "email", "phone", "address", "service", "serviceDescriptionUrl", "serviceDate", "serviceTime", "details", "packageItems"]) fields[key] = form.elements[key]?.value ?? fields[key] ?? "";
    fields.amountCents = Math.round(Number(form.elements.amount.value) * 100);
    fields.baseAmountCents = fields.amountCents + fields.discountCents;
    fields.pricing = { ...(fields.pricing || {}), taxCents: Math.round(Number(form.elements.taxDisplay.value.replace(/[^0-9.-]/g, "")) * 100) };
    fields.rushFeeCents = Number(form.elements.rushFeeCents.value);
    fields.cleanerCount = Number(form.elements.cleanerCount.value);
    fields.laborHours = Number((fields.cleanerCount * Number(form.elements.teamHours.value)).toFixed(2));
    if (quote.approvalUrl && !window.confirm("Update the customer’s estimate and payment link? Previous unpaid checkout pages will expire. No message or charge will be sent automatically.")) return;
    return quoteMutation(quote, { operation: "payment_link", fields }, "PATCH", $("[data-custom-payment-status]", form.closest("section")), $("button[type=submit]", form));
  }

  function quoteEditorMarkup(quote) {
    if (!quote.editSource) return '<p class="crm-additional-copy">Open the quote folder to view this older record.</p>';
    if (quote.deletedAt) return `<section class="crm-quote-editor"><h3>Quote in Trash</h3><p>This quote is hidden from the active list. Its files and payment history are retained.</p><div class="crm-inline-actions"><button class="crm-primary" type="button" data-restore-quote="${escapeHtml(quote.id)}">Restore quote</button><button class="crm-row-button" type="button" data-view-shortcut="trash">Open Trash</button></div><p data-quote-edit-status role="status"></p></section>`;
    const f = quote.editFields || {};
    const locked = quote.editLocked ? " disabled" : "";
    const input = (name, label, type = "text", extra = "") => `<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(f[name] ?? "")}" ${extra}></label>`;
    return `<section class="crm-quote-editor">
      <div class="crm-inline-actions"><button type="button" class="crm-primary" data-toggle-quote-editor${locked}>Edit quote</button><button type="button" class="crm-row-button" data-toggle-quote-discount${locked}>Add / edit discount</button><button type="button" class="crm-row-button crm-danger-button" data-delete-quote="${escapeHtml(quote.id)}">Delete quote</button></div>
      ${quote.editLocked ? '<p>Payment has already been received. This quote is protected. Use the booking’s additional-work, rescheduling or refund controls for changes.</p>' : ""}
      ${!quote.editLocked ? `<form data-quote-discount-form data-quote-id="${escapeHtml(quote.id)}" hidden>
        <h3>Quote discount</h3>
        <p>Enter a dollar amount to subtract from the total after tax. Prices for rooms, add-ons, hours and workers stay unchanged. Enter 0 to remove the discount.</p>
        ${!f.amountCents ? '<p>Set the quote price first using the quote editor or payment-link setup.</p>' : ''}
        <div class="crm-edit-grid">
          <label>Discount amount ($)<input name="discount" type="number" min="0" max="${Math.max(0, (Number(f.amountCents || 0) + Number(f.discountCents || 0) - 200) / 100).toFixed(2)}" step="0.01" required value="${((f.discountCents || 0) / 100).toFixed(2)}"></label>
          <label>Discount name (optional)<input name="discountLabel" maxlength="160" value="${escapeHtml(f.discountLabel || '')}" placeholder="First-time customer discount"></label>
        </div>
        <div class="crm-payment-totals" data-discount-preview role="status" aria-live="polite"></div>
        <p>The customer’s existing quote link will show the revised price when reopened. Any old unpaid Stripe checkout will expire. Saving does not send a message or charge a card.</p>
        <div class="crm-inline-actions"><button class="crm-primary" type="submit"${!f.amountCents ? ' disabled' : ''}>Save discount & update link</button><button class="crm-row-button" type="button" data-toggle-quote-discount>Cancel</button></div>
        <p class="crm-action-status" data-discount-status role="status"></p>
      </form>` : ''}
      ${quote.approvalUrl && !isCustomPaymentQuote(quote) ? `<div class="crm-revised-link"><a href="${escapeHtml(quote.approvalUrl)}" target="_blank" rel="noopener">Open current payment link ↗</a><button class="crm-row-button" type="button" data-copy-quote-photo-link="${escapeHtml(quote.approvalUrl)}">Copy payment link</button></div>` : ""}
      <form data-quote-edit-form data-quote-id="${escapeHtml(quote.id)}" hidden>
        <h3>Edit quote details</h3>
        <p>The customer’s payment link will use these saved details. Saving does not send a message, charge a card, or confirm an appointment.</p>
        <div class="crm-edit-grid">
          ${input("customerName", "Customer name", "text", 'required maxlength="160"')}
          ${input("email", "Email", "email", 'maxlength="180"')}
          ${input("phone", "Phone", "tel", 'maxlength="40"')}
          ${input("address", "Service address", "text", 'maxlength="400"')}
          ${input("service", "Service", "text", `required maxlength="160"${locked}`)}
          <label>Cleaning price, including tax${!f.units?.length ? ', before discount' : ''} ($)<input name="amount" type="number" min="0" max="100000" step="0.01" value="${((Number(f.amountCents || 0) + (!f.units?.length ? Number(f.discountCents || 0) : 0)) / 100).toFixed(2)}" required${locked}${f.units?.length ? " readonly" : ""}>${f.discountCents ? `${money(f.discountCents)} discount saved. Use Add / edit discount to change it.` : ""}</label>
          <label>Same-day rush fee<select name="rushFeeCents"${locked}><option value="0"${!f.rushFeeCents ? " selected" : ""}>No rush fee</option><option value="10000"${f.rushFeeCents ? " selected" : ""}>$100 rush fee</option></select></label>
          ${input("serviceDate", "Service date (New York)", "date", locked)}
          ${input("serviceTime", "Start time (New York)", "time", locked)}
          ${input("cleanerCount", "Team members", "number", `required min="1" max="20" step="1"${locked}`)}
          ${input("laborHours", "Total labor-hours", "number", `required min="0.5" max="200" step="0.01"${locked}`)}
        </div>
        <label>Cleaning package — one area or task per line<textarea name="packageItems" rows="4" maxlength="8000">${escapeHtml(f.packageItems || "")}</textarea></label>
        <label>Service description / customer-facing notes<textarea name="details" rows="5" maxlength="10000">${escapeHtml(f.details || "")}</textarea></label>
        <label>Internal notes (CRM only)<textarea name="internalNotes" rows="3" maxlength="5000">${escapeHtml(f.internalNotes || "")}</textarea></label>
        ${(f.submittedFields || []).length ? `<details><summary>Edit submitted information</summary><p>Original submitted values remain in the quote’s history.</p>${f.submittedFields.map((item, index) => `<label>${escapeHtml(item.name)}<textarea data-edit-submitted="${index}" rows="2" maxlength="5000">${escapeHtml(item.value)}</textarea></label>`).join("")}</details>` : ""}
        <p>To enable a payment link, include the price, email, phone, address, service date and start time. The deposit is 25% of the cleaning price, plus any $100 rush fee.</p>
        <div class="crm-inline-actions"><button class="crm-primary" type="submit">Save changes</button><button class="crm-row-button" type="button" data-toggle-quote-editor>Cancel</button></div>
      </form><p class="crm-action-status" data-quote-edit-status role="status"></p>
      ${quote.editHistory?.length ? `<details><summary>Change history</summary><ul>${quote.editHistory.map(item => `<li>${escapeHtml(submittedDate(item.at))} · ${escapeHtml(item.action)}</li>`).join("")}</ul></details>` : ""}
    </section>`;
  }

  async function requestQuoteDeletion(quote, status, button) {
    if (button.disabled || deleteQuoteDialog.open) return;
    button.disabled = true;
    deleteQuoteDialog.returnValue = "";
    try {
      const confirmed = await new Promise((resolve, reject) => {
        const onClose = () => resolve(deleteQuoteDialog.returnValue === "yes");
        deleteQuoteDialog.addEventListener("close", onClose, { once: true });
        try { deleteQuoteDialog.showModal(); }
        catch (error) { deleteQuoteDialog.removeEventListener("close", onClose); reject(error); }
      });
      if (confirmed && state.token && button.isConnected) {
        await quoteMutation(quote, { confirmation: quote.id }, "DELETE", status, button);
      }
    } catch (error) {
      status.textContent = "Could not open the confirmation. Please try again.";
      status.className = "crm-action-status is-error";
    } finally {
      button.disabled = false;
    }
  }

  function updateDiscountPreview(form) {
    const quote = quoteFormSnapshots.get(form);
    if (!quote) return;
    const fields = quote.editFields;
    const before = Number(fields.amountCents || 0) + Number(fields.discountCents || 0);
    const entered = Number(form.elements.discount.value);
    const cents = Math.round(entered * 100), rush = Number(fields.rushFeeCents || 0);
    const preview = $('[data-discount-preview]', form);
    if (!Number.isFinite(entered) || cents < 0 || before - cents < 200) {
      preview.textContent = 'At least $2 of cleaning charges must remain, plus any rush fee.'; return;
    }
    const total = before + rush - cents, deposit = Math.round((before - cents) * .25) + rush;
    preview.innerHTML = `<div><span>Original total, including tax</span><strong>${money(before + rush)}</strong></div><div><span>${escapeHtml(form.elements.discountLabel.value.trim() || 'Discount')}</span><strong>−${money(cents)}</strong></div><div><span>Revised total</span><strong>${money(total)}</strong></div><div><span>Deposit due</span><strong>${money(deposit)}</strong></div><div><span>Remaining balance</span><strong>${money(total - deposit)}</strong></div>`;
  }

  function saveQuoteDiscount(form) {
    const quote = quoteFormSnapshots.get(form);
    const button = $('button[type=submit]', form);
    if (!quote || quote.editLocked || quote.deletedAt || button.disabled || !form.reportValidity()) return;
    if (!window.confirm('Save this discount and update the customer’s quote link? Old unpaid checkout pages will expire. No message or charge will be sent.')) return;
    return quoteMutation(quote, { operation: 'discount', discountCents: Math.round(Number(form.elements.discount.value) * 100),
      discountLabel: form.elements.discountLabel.value }, 'PATCH', $('[data-discount-status]', form), button);
  }

  function quoteEditFingerprint(quote) {
    const ordered = value => Array.isArray(value) ? value.map(ordered)
      : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
    return JSON.stringify(ordered({
      id: quote.id, source: quote.editSource, fields: quote.editFields,
      history: quote.editHistory || [], deletedAt: quote.deletedAt || "", locked: Boolean(quote.editLocked),
      approvalUrl: quote.approvalUrl || "", paymentReady: Boolean(quote.paymentReady), checkoutFlow: quote.checkoutFlow || "", discountRevision: quote.discountRevision || ''
    }));
  }

  async function submitQuoteChange(quote, body, method, status) {
    const send = version => api("/api/crm/quotes", { method, body: JSON.stringify({ ...body, source: quote.editSource, id: quote.id, version }) });
    try {
      return await send(quote.editVersion);
    } catch (error) {
      // The server versions the whole record, including reminder delivery metadata.
      // Retry only this exact pre-write conflict, once, and only if all editable details
      // and payment/edit protections still match. Never weaken the server's version check.
      if (method !== "PATCH" || (!body.fields && body.operation !== 'discount') || body.operation === "restore" || error.status !== 409
        || error.message !== "This quote was updated elsewhere. Refresh before saving.") throw error;
      status.textContent = "Checking the latest quote without changing your entries…";
      const refreshed = await api("/api/crm/quotes");
      const latest = refreshed.quotes?.find(item => item.id === quote.id && item.editSource === quote.editSource);
      if (!latest || !quote.editFields || !latest.editFields || !latest.editVersion || latest.editVersion === quote.editVersion
        || latest.deletedAt || latest.editLocked || quoteEditFingerprint(quote) !== quoteEditFingerprint(latest)) {
        throw new Error("The saved quote details have changed. Your entries are still in this form. Copy them before closing it and reopening the latest quote.");
      }
      status.textContent = "Quote details are unchanged. Saving your entries…";
      return await send(latest.editVersion);
    }
  }

  async function quoteMutation(quote, body, method, status, button) {
    button.disabled = true;
    status.textContent = "Saving…";
    status.className = "crm-action-status";
    try {
      const result = await submitQuoteChange(quote, body, method, status);
      const refreshed = await api("/api/crm/quotes");
      state.quotes = refreshed.quotes || [];
      renderCounts(); renderQuotes(); renderTrash(); renderMarketing();
      openQuote(quote.id);
      toast(method === "DELETE" ? "Quote moved to Trash. You can restore it there." : body.operation === "restore" ? "Quote restored. No messages sent." : body.operation === 'discount' ? 'Discount saved. The quote link now uses the revised price. No message was sent.' : body.operation === "payment_link" ? "Payment link ready. Preview, copy or text it below. No message has been sent." : result.paymentReady ? "Quote saved. The payment link now uses the updated details." : "Quote saved. No customer message was sent.");
    } catch (error) {
      status.textContent = error.message;
      status.className = "crm-action-status is-error";
      button.disabled = false;
    }
  }

  function saveQuoteEdit(form) {
    const quote = quoteFormSnapshots.get(form) || state.quotes.find(item => item.id === form.dataset.quoteId);
    if (!quote) return;
    const fields = { ...quote.editFields };
    for (const key of ["customerName", "email", "phone", "address", "service", "serviceDate", "serviceTime", "details", "packageItems", "internalNotes"]) fields[key] = form.elements[key].value;
    fields.amountCents = Math.round(Number(form.elements.amount.value) * 100);
    if (!fields.units?.length && (fields.discountCents || fields.baseAmountCents != null)) {
      fields.baseAmountCents = fields.amountCents;
      fields.amountCents -= fields.discountCents || 0;
    }
    fields.rushFeeCents = Number(form.elements.rushFeeCents.value);
    fields.cleanerCount = Number(form.elements.cleanerCount.value);
    fields.laborHours = Number(form.elements.laborHours.value);
    fields.submittedFields = (fields.submittedFields || []).map((item, index) => ({ ...item, value: $(`[data-edit-submitted="${index}"]`, form).value }));
    if (!window.confirm("Save these quote changes? Existing unpaid checkout pages will expire and the payment link will show the new details. No text or charge will be sent automatically.")) return;
    quoteMutation(quote, { fields }, "PATCH", $("[data-quote-edit-status]", form.closest("section")), $("button[type=submit]", form));
  }

  function detailMarkup(booking) {
    const payment = paymentFor(booking);
    const hours = bookingHours(booking);
    const paymentStatus = payment.remaining?.status || payment.status || "Pending";
    const tracking = timeTrackingFor(booking);
    const canClockIn = !tracking.activeEntry && !["Completed", "Cancelled"].includes(booking.status);
    const canClockOut = Boolean(tracking.activeEntry);
    const additionalWork = booking.estimate?.additionalWork || {};
    const offerSentAt = additionalWork.lastOfferSentAt || additionalWork.offerSentAt || "";
    const offerStatus = offerSentAt
      ? `Sent ${clockTime(offerSentAt)}${additionalWork.offerSendCount > 1 ? ` · ${additionalWork.offerSendCount} times` : ""}`
      : additionalWork.pendingUntilBalancePaid ? "Waiting for successful balance payment" : "Not sent";
    const additionalOrders = Array.isArray(additionalWork.orders) ? additionalWork.orders : [];
    const assignment = cleanerAssignmentFor(booking);
    const qualityPhotos = qualityPhotosFor(booking);
    const qualityTotal = qualityPhotos.before.length + qualityPhotos.after.length;
    const orderMarkup = additionalOrders.length ? `<div class="crm-additional-orders">${additionalOrders.map((order) => `<div><span>${escapeHtml(order.orderId || "Additional work")}</span><strong>${escapeHtml(String(order.laborHours || 0))} labor-hours · ${money(order.amountCents || 0)} · ${escapeHtml(String(order.status || "pending").replace(/_/g, " "))}</strong></div>`).join("")}</div>` : "";
    return `<div class="crm-dialog-head">
      <div><p class="crm-eyebrow">Order ${escapeHtml(booking.orderNumber || booking.id)}</p><h2>${escapeHtml(booking.clientName || "Booking details")}</h2></div>
      <button class="crm-dialog-close" type="button" data-close-dialog aria-label="Close">×</button>
    </div>
    <div class="crm-dialog-body">
      <div class="crm-detail-grid">
        <div class="crm-detail"><span>Service</span><strong>${escapeHtml(booking.serviceLabel || booking.service || "Cleaning service")}</strong></div>
        <div class="crm-detail"><span>Appointment</span><strong>${escapeHtml(appointmentDate(booking))}</strong></div>
        <div class="crm-detail"><span>Phone</span>${booking.phone ? `<a href="tel:${escapeHtml(booking.phone)}">${escapeHtml(booking.phone)}</a>` : "<strong>Not provided</strong>"}</div>
        <div class="crm-detail"><span>Email</span>${booking.email ? `<a href="mailto:${escapeHtml(booking.email)}">${escapeHtml(booking.email)}</a>` : "<strong>Not provided</strong>"}</div>
        <div class="crm-detail crm-detail-wide"><span>Address</span><strong>${escapeHtml(booking.address || "Not provided")}</strong></div>
        ${booking.notes ? `<div class="crm-detail crm-detail-wide"><span>Notes</span><strong>${escapeHtml(booking.notes)}</strong></div>` : ""}
      </div>
      <section class="crm-detail-section"><h3>Contact customer</h3>${communicationButtons({ phone: booking.phone, customerName: booking.clientName, sourceId: booking.id, sourceType: "Booking" })}</section>
      ${customerHistoryMarkup(booking.phone)}
      <section class="crm-detail-section crm-booking-editor-section">
        <div class="crm-section-heading"><div><h3>Edit all booking details</h3><p>Change the customer, appointment, service, price, scope or internal notes.</p></div><button class="crm-row-button" type="button" data-toggle-booking-editor aria-expanded="false">Edit booking</button></div>
        <form class="crm-booking-edit-form" data-booking-edit-form hidden>
          <div class="crm-booking-edit-grid">
            <label>Customer name<input name="clientName" required maxlength="200" value="${escapeHtml(booking.clientName || "")}"></label>
            <label>Email address<input name="email" type="email" maxlength="320" value="${escapeHtml(booking.email || "")}"></label>
            <label>Phone number<input name="phone" type="tel" maxlength="80" value="${escapeHtml(booking.phone || "")}"></label>
            <label>Service name<input name="serviceLabel" required maxlength="240" value="${escapeHtml(booking.serviceLabel || booking.service || "")}"></label>
            <label>Service date and time<input name="scheduleLocal" type="datetime-local" required value="${escapeHtml(appointmentInputValue(booking))}"></label>
            <label>Total price, including tax<input name="total" type="number" required min="0" max="1000000" step="0.01" value="${(payment.totalCents / 100).toFixed(2)}"></label>
            <label>Included labor-hours<input name="laborHours" type="number" required min="0.25" max="1000" step="0.25" value="${hours.laborHours}"></label>
            <label>On-site duration in hours<input name="teamHours" type="number" required min="0.25" max="200" step="0.25" value="${hours.teamHours}"><small>Used to reserve time on the booking calendar.</small></label>
            <label>Number of cleaners<input name="cleanerCount" type="number" required min="1" max="50" step="1" value="${hours.cleaners}"></label>
            <label>Square footage<input name="sqft" type="number" min="0" max="10000000" step="1" value="${Math.max(0, Number(booking.sqft || 0))}"></label>
            <label>Bedrooms / rooms label<input name="bedroomsLabel" maxlength="200" value="${escapeHtml(booking.bedroomsLabel || "")}"></label>
            <label>Bathrooms label<input name="bathroomsLabel" maxlength="200" value="${escapeHtml(booking.bathroomsLabel || "")}"></label>
            <label class="crm-booking-edit-wide">Service address<textarea name="address" rows="2" maxlength="700">${escapeHtml(booking.address || "")}</textarea></label>
            <label class="crm-booking-edit-wide">Add-ons or priorities<textarea name="addons" rows="2" maxlength="5000" placeholder="Separate items with commas or new lines">${escapeHtml((booking.addons || []).join(", "))}</textarea></label>
            <label class="crm-booking-edit-wide">Booking notes<textarea name="notes" rows="3" maxlength="10000">${escapeHtml(booking.notes || "")}</textarea></label>
          </div>
          <p class="crm-editor-warning">Changing the appointment date or time automatically texts the customer with the new schedule. Other edits do not send a message. Saving never refunds or recharges money already paid.</p>
          <div class="crm-booking-edit-actions"><button class="crm-primary" type="submit">Save booking details</button><button class="crm-row-button" type="button" data-cancel-booking-edit>Cancel</button></div>
          <p class="crm-action-status" data-booking-edit-status role="status"></p>
        </form>
      </section>
      <section class="crm-detail-section crm-assignment-section">
        <div class="crm-section-heading"><div><h3>Assigned cleaners</h3><p>Add the cleaner or team members scheduled for this customer.</p></div>${assignment.cleanerNames.length ? `<span class="crm-assignment-count">${assignment.cleanerNames.length} assigned</span>` : ""}</div>
        ${assignment.cleanerNames.length ? `<div class="crm-cleaner-chips">${assignment.cleanerNames.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>` : '<p class="crm-additional-copy">No cleaners have been assigned yet.</p>'}
        <form class="crm-assignment-form" data-assignment-form>
          <label>Cleaner names<textarea name="cleanerNames" rows="2" maxlength="1700" placeholder="Example: Fatimah, Aisha">${escapeHtml(assignment.cleanerNames.join(", "))}</textarea><small>Separate multiple names with commas or put each name on a new line.</small></label>
          <button class="crm-primary" type="submit">Save cleaners</button>
        </form>
        <p class="crm-action-status" data-assignment-status role="status"></p>
      </section>
      <section class="crm-detail-section crm-time-section">
        <div class="crm-section-heading"><div><h3>Work time</h3><p>Use the actual arrival and departure times.</p></div><span class="crm-clock-state${tracking.activeEntry ? " is-active" : ""}">${tracking.activeEntry ? "Clocked in" : "Not clocked in"}</span></div>
        <div class="crm-time-summary">
          <div><span>Last clock in</span><strong>${escapeHtml(clockTime(tracking.lastClockInAt))}</strong></div>
          <div><span>Last clock out</span><strong>${escapeHtml(clockTime(tracking.lastClockOutAt))}</strong></div>
          <div><span>Total worked</span><strong>${escapeHtml(durationLabel(tracking.totalMinutes))}</strong></div>
        </div>
        <div class="crm-clock-actions">
          ${canClockIn ? '<button class="crm-primary" type="button" data-clock-action="clock_in">Clock in</button>' : ""}
          ${canClockOut ? '<button class="crm-clock-out" type="button" data-clock-action="clock_out">Clock out</button>' : ""}
          ${!canClockIn && !canClockOut ? '<span class="crm-clock-closed">Time tracking is closed for this booking.</span>' : ""}
        </div>
        <p class="crm-action-status" data-clock-status role="status"></p>
      </section>
      <section class="crm-detail-section crm-quality-section">
        <div class="crm-section-heading"><div><h3>Quality photos</h3><p>${qualityTotal} pictures uploaded · up to 200 Before and 200 After.</p></div>${qualityPhotos.folderLink ? `<a class="crm-row-button" href="${escapeHtml(qualityPhotos.folderLink)}" target="_blank" rel="noopener">Open folder</a>` : ""}</div>
        <p class="crm-additional-copy">Cleaners should photograph the condition at arrival and the finished work before leaving.</p>
        <div class="crm-quality-grid">
          <div class="crm-photo-stage">
            <div><h4>Before pictures</h4><span>${qualityPhotos.before.length}/200</span></div>
            ${qualityPhotoList(qualityPhotos.before)}
            <label class="crm-photo-upload${qualityPhotos.before.length >= 200 ? " is-disabled" : ""}">Upload before pictures<input type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp" multiple data-quality-input="before"${qualityPhotos.before.length >= 200 ? " disabled" : ""}></label>
          </div>
          <div class="crm-photo-stage">
            <div><h4>After pictures</h4><span>${qualityPhotos.after.length}/200</span></div>
            ${qualityPhotoList(qualityPhotos.after)}
            <label class="crm-photo-upload${qualityPhotos.after.length >= 200 ? " is-disabled" : ""}">Upload after pictures<input type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp" multiple data-quality-input="after"${qualityPhotos.after.length >= 200 ? " disabled" : ""}></label>
          </div>
        </div>
        <p class="crm-action-status" data-quality-status role="status"></p>
      </section>
      <section class="crm-detail-section">
        <h3>Payment</h3>
        <div class="crm-payment-summary"><div><span>Total</span><strong>${money(payment.totalCents)}</strong></div><div><span>Paid</span><strong>${money(payment.paidCents)}</strong></div><div><span>Remaining</span><strong>${money(payment.remainingCents)}</strong></div></div>
        ${booking.estimate?.promoDiscount?.amountCents ? `<p class="crm-complete-note"><strong>${escapeHtml(booking.estimate.promoCode || booking.estimate.promoDiscount.code || "Promo")}</strong> applied: ${escapeHtml(String(booking.estimate.promoDiscount.percent || 0))}% off (${money(booking.estimate.promoDiscount.amountCents)}). Original total: ${money(booking.estimate.originalTotalCents || (payment.totalCents + booking.estimate.promoDiscount.amountCents))}.</p>` : ""}
        <p class="crm-complete-note">${booking.status === "Cancelled"
          ? (booking.estimate?.cancellation?.refundCents
            ? `${escapeHtml(booking.estimate.cancellation.label || "Booking canceled")}. Payment status: ${escapeHtml(String(paymentStatus).replace(/_/g, " "))}. A ${money(booking.estimate.cancellation.refundCents)} refund was submitted and any uncaptured balance authorization was released.`
            : `${escapeHtml(booking.estimate?.cancellation?.label || "Booking canceled")}. Payment status: ${escapeHtml(String(paymentStatus).replace(/_/g, " "))}. The ${money(booking.estimate?.cancellation?.retainedCents || 0)} deposit was retained, no balance is due, and any uncaptured authorization was released.`)
          : `Balance status: ${escapeHtml(String(paymentStatus).replace(/_/g, " "))}. Marking this booking Completed will attempt to capture the remaining ${money(payment.remainingCents)}.`}</p>
      </section>
      <section class="crm-detail-section">
        <h3>Update booking</h3>
        <form class="crm-status-form" data-status-form>
          <label>Status<select name="status">${STATUS_OPTIONS.map((status) => `<option${status === booking.status ? " selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select></label>
          <label class="crm-offer-option" data-completion-offer${booking.status === "Completed" ? "" : " hidden"}><input type="checkbox" name="sendAdditionalWork"><span><strong>Send customer an additional-work order link</strong><small>Email and text after the remaining balance is collected.</small></span></label>
          <fieldset class="crm-cancellation-options" data-cancellation-options hidden disabled>
            <legend>Who canceled this booking?</legend>
            <label><input type="radio" name="cancellationSource" value="iman" required><span><strong>Canceled by Iman Cleaning</strong><small>Refund the full ${money(payment.paidCents)} paid and release the remaining-balance hold.</small></span></label>
            <label><input type="radio" name="cancellationSource" value="customer" required><span><strong>Canceled by customer</strong><small>48 hours or more: full refund. Less than 48 hours: keep the 25% deposit (${money(Math.min(payment.paidCents, payment.depositCents))}). Release the hold in either case.</small></span></label>
          </fieldset>
          <button class="crm-primary" type="submit">Save status</button>
        </form>
        <p class="crm-action-status" data-action-status role="status"></p>
      </section>
      <section class="crm-detail-section crm-additional-work-section">
        <div class="crm-section-heading"><div><h3>Additional-work offer</h3><p>${escapeHtml(offerStatus)}</p></div>${booking.status === "Completed" && (offerSentAt || additionalWork.offerRequested) ? '<button class="crm-row-button" type="button" data-resend-additional-work>Resend link</button>' : ""}</div>
        <p class="crm-additional-copy">The customer chooses hours and minutes at $80 per cleaner-hour, reviews the amount and authorizes a saved-card charge. Each approval, payment and email/text confirmation remains connected to this booking.</p>
        ${orderMarkup}
        <div data-additional-approvals data-booking-id="${escapeHtml(booking.id)}">Loading additional-work history…</div>
        <p class="crm-action-status" data-additional-work-status role="status"></p>
      </section>
    </div>`;
  }

  async function loadAdditionalApprovals(booking) {
    const target = $('[data-additional-approvals]');
    if (!target || target.dataset.bookingId !== booking.id) return;
    try {
      const data = await api('/api/crm/additional-work?bookingId=' + encodeURIComponent(booking.id));
      if (!target.isConnected || target.dataset.bookingId !== booking.id) return;
      target.innerHTML = (data.orders || []).map(o => `<div class="crm-detail-section"><h4>${escapeHtml(o.duration)} · ${money(o.amountCents)}</h4><p>${escapeHtml(o.card || 'Card not selected')} · ${escapeHtml(o.status.replace(/_/g, ' '))}</p><p>Approval: ${o.approvedAt ? escapeHtml(clockTime(o.approvedAt)) : 'Not yet approved'}<br>Reference: ${escapeHtml(o.id)}</p>${o.error ? `<p>${escapeHtml(o.error)}</p>` : ''}${(o.confirmations || []).map(n => `<p><strong>${n.channel === 'sms' ? 'Text' : 'Email'} confirmation · approval ${escapeHtml(String(n.revision))}</strong>: ${escapeHtml(n.status)}${n.sentAt ? ' · ' + escapeHtml(clockTime(n.sentAt)) : ''}<br>${escapeHtml(n.approval.time)} · ${money(n.approval.amountCents)} · ${escapeHtml(n.approval.card)}${n.error ? '<br>' + escapeHtml(n.error) : ''}</p>`).join('')}</div>`).join('') || '<p>No additional-work approvals yet.</p>';
    } catch {
      if (target.isConnected) target.textContent = 'Additional-work history could not load. Reopen this booking to try again.';
    }
  }

  function openBooking(id) {
    const booking = state.bookings.find((item) => item.id === id);
    if (!booking) return;
    state.selectedId = id;
    $("[data-booking-detail]").innerHTML = detailMarkup(booking);
    loadAdditionalApprovals(booking);
    dialog.showModal();
  }

  async function updateBookingStatus(booking, status, form) {
    const actionStatus = $("[data-action-status]", form.closest(".crm-dialog-body"));
    const sendAdditionalWork = status === "Completed" && Boolean(form.elements.sendAdditionalWork?.checked);
    const cancellationSource = status === "Cancelled"
      ? String(form.elements.cancellationSource?.value || "")
      : "";
    if (status === "Completed") {
      const payment = paymentFor(booking);
      const offerCopy = sendAdditionalWork ? " After successful payment, the additional-work link will be sent by email and text." : " No additional-work link will be sent.";
      const approved = window.confirm(`Confirm the cleaning is finished? This will attempt to charge the remaining ${money(payment.remainingCents)} to the customer's saved payment method.${offerCopy}`);
      if (!approved) return;
    }
    if (status === "Cancelled") {
      if (!cancellationSource) {
        actionStatus.className = "crm-action-status is-error";
        actionStatus.textContent = "Choose who canceled the booking before continuing.";
        return;
      }
      const payment = paymentFor(booking);
      const appointmentTime = new Date(booking.schedule).getTime();
      const lessThan48Hours = !Number.isFinite(appointmentTime)
        || appointmentTime - Date.now() < 48 * 60 * 60 * 1000;
      const retainedCents = cancellationSource === "customer" && lessThan48Hours
        ? Math.min(payment.paidCents, payment.depositCents)
        : 0;
      const refundCents = Math.max(0, payment.paidCents - retainedCents);
      const outcome = cancellationSource === "iman"
        ? `Iman Cleaning canceled: refund the full ${money(refundCents)} paid and release any remaining-balance hold.`
        : lessThan48Hours
          ? `Customer canceled with less than 48 hours' notice: retain the 25% deposit of ${money(retainedCents)}, refund ${money(refundCents)}, and release any remaining-balance hold.`
          : `Customer canceled at least 48 hours before the appointment: refund the full ${money(refundCents)} paid and release any remaining-balance hold.`;
      if (!window.confirm(`${outcome} This cannot be undone from the CRM. Continue?`)) return;
    }
    const button = $("button[type='submit']", form);
    button.disabled = true;
    actionStatus.className = "crm-action-status";
    actionStatus.textContent = "Saving…";
    try {
      const data = await api("/api/crm/bookings", {
        method: "PATCH",
        body: JSON.stringify({ id: booking.id, status, sendAdditionalWork, cancellationSource })
      });
      booking.status = status;
      const paymentResult = data.payment || {};
      const receiptResult = data.completionReceipt || {};
      const reviewResult = data.reviewRequest || {};
      if (status === "Completed") {
        const receiptStatusMessage = receiptResult.status === "sent"
          ? " Final paid receipt emailed."
          : receiptResult.status === "already_sent"
            ? " Final paid receipt was already sent."
            : " Final receipt email needs attention; save Completed again to retry.";
        if (["captured", "already_captured"].includes(paymentResult.status)) {
          actionStatus.className = "crm-action-status is-success";
          const offerResult = data.additionalWork || {};
          actionStatus.textContent = offerResult.status === "sent"
            ? "Booking completed, balance collected, and the additional-work link was sent to the customer."
            : offerResult.status === "failed"
              ? "Booking completed and balance collected, but the additional-work message needs attention. Use Resend link."
              : "Booking completed and the remaining balance was captured. No additional-work link was sent.";
          actionStatus.textContent += receiptStatusMessage;
          actionStatus.textContent += ["scheduled", "already_scheduled"].includes(reviewResult.status)
            ? " Review email and text scheduled for 24 hours after completion."
            : reviewResult.status === "already_sent"
              ? " Google review request was already sent."
              : " Review request scheduling needs attention; save Completed again to retry.";
          toast(offerResult.status === "sent" ? "Booking completed and additional-work link sent." : "Booking completed and remaining balance collected.");
        } else if (paymentResult.status === "not_applicable") {
          actionStatus.className = "crm-action-status is-success";
          actionStatus.textContent = `Booking marked completed. Automatic balance collection does not apply to this booking.${receiptStatusMessage}${["scheduled", "already_scheduled"].includes(reviewResult.status) ? " Review email and text scheduled for 24 hours after completion." : reviewResult.status === "already_sent" ? " Google review request was already sent." : " Review request scheduling needs attention; save Completed again to retry."}`;
          toast("Booking marked completed.");
        } else {
          actionStatus.className = "crm-action-status is-error";
          actionStatus.textContent = `Booking was marked completed, but payment needs attention (${String(paymentResult.status || "unknown").replace(/_/g, " ")}).`;
          toast("Booking completed, but the payment needs attention.", "error");
        }
      } else if (status === "Cancelled") {
        const retained = Number(paymentResult.retainedCents || 0);
        const refunded = Number(paymentResult.refundedCents || 0);
        actionStatus.className = "crm-action-status is-success";
        actionStatus.textContent = cancellationSource === "iman"
          ? `Canceled by Iman Cleaning. ${money(refunded)} was submitted for a full refund, and the remaining-balance hold was released.`
          : retained
            ? `Canceled by customer with less than 48 hours' notice. The ${money(retained)} deposit was retained, ${money(refunded)} was submitted for refund, and the remaining-balance hold was released.`
            : `Canceled by customer at least 48 hours before the appointment. ${money(refunded)} was submitted for a full refund, and the remaining-balance hold was released.`;
        toast("Booking canceled and payment updated.");
      } else {
        actionStatus.className = "crm-action-status is-success";
        actionStatus.textContent = `Booking status changed to ${status}.`;
        toast(`Booking changed to ${status}.`);
      }
      await loadBookings({ quiet: true });
      const refreshed = state.bookings.find((item) => item.id === booking.id);
      if (refreshed) {
        const savedMessage = actionStatus.textContent;
        const savedClass = actionStatus.className;
        $("[data-booking-detail]").innerHTML = detailMarkup(refreshed);
        loadAdditionalApprovals(refreshed);
        const refreshedStatus = $("[data-action-status]", dialog);
        refreshedStatus.textContent = savedMessage;
        refreshedStatus.className = savedClass;
      }
    } catch (error) {
      actionStatus.className = "crm-action-status is-error";
      actionStatus.textContent = error.message;
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function saveBookingDetails(booking, form) {
    if (!form.reportValidity()) return;
    const payment = paymentFor(booking);
    const revisedTotalCents = Math.round(Number(form.elements.total.value) * 100);
    const priceChanged = revisedTotalCents !== payment.totalCents;
    const scheduleChanged = form.elements.scheduleLocal.value !== appointmentInputValue(booking);
    const changes = [scheduleChanged ? "the appointment time" : "", priceChanged ? "the price and remaining balance" : ""].filter(Boolean);
    const summary = changes.length ? ` This changes ${changes.join(" and ")}.` : "";
    const communicationCopy = scheduleChanged
      ? " The customer will receive the new date and time by text. If the new appointment is more than 24 hours away, the existing balance hold will be released and a replacement hold will be scheduled for the 48-hour window."
      : " No customer message or new charge will be sent automatically.";
    if (!window.confirm(`Save all edited booking details?${summary}${communicationCopy}`)) return;
    const button = $("button[type='submit']", form);
    const status = $("[data-booking-edit-status]", form);
    button.disabled = true;
    status.className = "crm-action-status";
    status.textContent = "Saving booking details…";
    try {
      const data = await api("/api/crm/bookings", {
        method: "PATCH",
        body: JSON.stringify({
          id: booking.id,
          bookingAction: "save_details",
          clientName: form.elements.clientName.value,
          email: form.elements.email.value,
          phone: form.elements.phone.value,
          serviceLabel: form.elements.serviceLabel.value,
          scheduleLocal: form.elements.scheduleLocal.value,
          totalCents: revisedTotalCents,
          laborHours: Number(form.elements.laborHours.value),
          teamHours: Number(form.elements.teamHours.value),
          cleanerCount: Number(form.elements.cleanerCount.value),
          sqft: Number(form.elements.sqft.value || 0),
          bedroomsLabel: form.elements.bedroomsLabel.value,
          bathroomsLabel: form.elements.bathroomsLabel.value,
          address: form.elements.address.value,
          addons: form.elements.addons.value,
          notes: form.elements.notes.value
        })
      });
      await loadBookings({ quiet: true });
      const refreshed = state.bookings.find((item) => item.id === booking.id);
      if (refreshed) {
        $("[data-booking-detail]").innerHTML = detailMarkup(refreshed);
        loadAdditionalApprovals(refreshed);
        const refreshedForm = $("[data-booking-edit-form]", dialog);
        refreshedForm.hidden = false;
        const refreshedToggle = $("[data-toggle-booking-editor]", dialog);
        refreshedToggle.setAttribute("aria-expanded", "true");
        refreshedToggle.textContent = "Hide editor";
        const refreshedStatus = $("[data-booking-edit-status]", dialog);
        const noticeFailed = data.scheduleNotification?.status === "failed";
        const calendarFailed = data.calendar?.status === "error";
        const authorizationFailed = data.paymentAuthorization?.status === "requires_attention";
        const authorizationMessage = data.paymentAuthorization?.status === "reset"
          ? (data.paymentAuthorization.replacement?.status === "scheduled"
            ? "Previous balance hold released; the replacement hold is scheduled for 48 hours before service."
            : ["Previous balance hold released.", `Replacement authorization: ${String(data.paymentAuthorization.replacement?.status || "pending").replaceAll("_", " ")}.`].join(" "))
          : data.paymentAuthorization?.status === "retained_short_notice"
            ? "Existing balance hold retained because the new appointment is within 24 hours."
            : authorizationFailed
              ? `Payment authorization needs attention: ${data.paymentAuthorization.error || "review the hold in Stripe."}`
              : "";
        refreshedStatus.className = noticeFailed || calendarFailed || authorizationFailed ? "crm-action-status is-error" : "crm-action-status is-success";
        refreshedStatus.textContent = [
          "Booking details saved.",
          data.scheduleNotification?.status === "sent" ? "Customer rescheduling text sent." : "",
          authorizationMessage,
          noticeFailed ? data.scheduleNotification.error : "",
          calendarFailed ? data.calendar.error : "Google Calendar is up to date."
        ].filter(Boolean).join(" ");
      }
      if (data.paymentAuthorization?.status === "requires_attention") toast("Booking saved, but the balance hold needs attention.", "error");
      else if (data.scheduleNotification?.status === "failed") toast("Booking saved, but the customer text needs attention.", "error");
      else if (data.scheduleNotification?.status === "sent") toast("Booking saved and the customer was texted.");
      else toast("Booking details saved.");
    } catch (error) {
      status.className = "crm-action-status is-error";
      status.textContent = error.message;
      toast(error.message, "error");
      button.disabled = false;
    }
  }

  async function resendAdditionalWork(booking, button) {
    const status = $("[data-additional-work-status]", dialog);
    button.disabled = true;
    status.className = "crm-action-status";
    status.textContent = "Sending email and text…";
    try {
      await api("/api/crm/bookings", {
        method: "PATCH",
        body: JSON.stringify({ id: booking.id, additionalWorkAction: "resend" })
      });
      await loadBookings({ quiet: true });
      const refreshed = state.bookings.find((item) => item.id === booking.id);
      if (refreshed) {
        $("[data-booking-detail]").innerHTML = detailMarkup(refreshed);
        loadAdditionalApprovals(refreshed);
        const refreshedStatus = $("[data-additional-work-status]", dialog);
        refreshedStatus.className = "crm-action-status is-success";
        refreshedStatus.textContent = "Additional-work link sent again to the customer.";
      }
      toast("Additional-work link resent.");
    } catch (error) {
      status.className = "crm-action-status is-error";
      status.textContent = error.message;
      toast(error.message, "error");
      button.disabled = false;
    }
  }

  async function updateClock(booking, clockAction, button) {
    const actionStatus = $("[data-clock-status]", button.closest(".crm-time-section"));
    button.disabled = true;
    actionStatus.className = "crm-action-status";
    actionStatus.textContent = clockAction === "clock_in" ? "Clocking in…" : "Clocking out…";
    try {
      await api("/api/crm/bookings", {
        method: "PATCH",
        body: JSON.stringify({ id: booking.id, clockAction })
      });
      await loadBookings({ quiet: true });
      const refreshed = state.bookings.find((item) => item.id === booking.id);
      if (refreshed) {
        $("[data-booking-detail]").innerHTML = detailMarkup(refreshed);
        loadAdditionalApprovals(refreshed);
        const refreshedStatus = $("[data-clock-status]", dialog);
        refreshedStatus.className = "crm-action-status is-success";
        refreshedStatus.textContent = clockAction === "clock_in"
          ? "Clocked in. The booking is now In progress."
          : "Clocked out. Review the recorded time, then mark Completed when the work is finished.";
      }
      toast(clockAction === "clock_in" ? "Team clocked in." : "Team clocked out.");
    } catch (error) {
      actionStatus.className = "crm-action-status is-error";
      actionStatus.textContent = error.message;
      toast(error.message, "error");
      button.disabled = false;
    }
  }

  async function saveCleanerAssignment(booking, form) {
    const status = $("[data-assignment-status]", form.closest(".crm-assignment-section"));
    const button = $("button[type='submit']", form);
    button.disabled = true;
    status.className = "crm-action-status";
    status.textContent = "Saving cleaner assignment…";
    try {
      const data = await api("/api/crm/bookings", {
        method: "PATCH",
        body: JSON.stringify({
          id: booking.id,
          assignmentAction: "save",
          cleanerNames: form.elements.cleanerNames.value
        })
      });
      await loadBookings({ quiet: true });
      const refreshed = state.bookings.find((item) => item.id === booking.id);
      if (refreshed) {
        $("[data-booking-detail]").innerHTML = detailMarkup(refreshed);
        loadAdditionalApprovals(refreshed);
        const refreshedStatus = $("[data-assignment-status]", dialog);
        refreshedStatus.className = "crm-action-status is-success";
        refreshedStatus.textContent = data.cleanerNames.length
          ? `Cleaner assignment saved. Booking status: ${data.status}.`
          : "Cleaner assignment removed.";
      }
      toast(data.cleanerNames.length ? "Cleaner assignment saved." : "Cleaner assignment removed.");
    } catch (error) {
      status.className = "crm-action-status is-error";
      status.textContent = error.message;
      toast(error.message, "error");
      button.disabled = false;
    }
  }

  async function uploadQualityPhotos(booking, stage, input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const current = qualityPhotosFor(booking);
    const stageCount = current[stage].length;
    const status = $("[data-quality-status]", dialog);
    if (stageCount + files.length > 200) {
      status.className = "crm-action-status is-error";
      status.textContent = `Choose ${200 - stageCount} or fewer pictures. Each booking can contain up to 200 ${stage} pictures.`;
      input.value = "";
      return;
    }
    input.disabled = true;
    status.className = "crm-action-status";
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        status.textContent = `Uploading ${index + 1} of ${files.length} ${stage} pictures…`;
        const prepared = await api("/api/crm/photo-upload-url", {
          method: "POST",
          body: JSON.stringify({ bookingId: booking.id, stage, fileName: file.name, mimeType: file.type, size: file.size })
        });
        const uploaded = await fetch(prepared.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": prepared.mimeType },
          body: file
        });
        const upload = await uploaded.json().catch(() => ({}));
        if (!uploaded.ok || !upload.id) throw new Error(`Picture ${index + 1} could not be uploaded.`);
        await api("/api/crm/photo-record", {
          method: "POST",
          body: JSON.stringify({ bookingId: booking.id, stage, upload })
        });
      }
      await loadBookings({ quiet: true });
      const refreshed = state.bookings.find((item) => item.id === booking.id);
      if (refreshed) {
        $(`[data-booking-detail]`).innerHTML = detailMarkup(refreshed);
        loadAdditionalApprovals(refreshed);
        const refreshedStatus = $("[data-quality-status]", dialog);
        refreshedStatus.className = "crm-action-status is-success";
        refreshedStatus.textContent = `${files.length} ${stage} picture${files.length === 1 ? "" : "s"} uploaded successfully.`;
      }
      toast(`${stage === "before" ? "Before" : "After"} pictures uploaded.`);
    } catch (error) {
      status.className = "crm-action-status is-error";
      status.textContent = error.message;
      toast(error.message, "error");
      input.disabled = false;
    }
  }

  async function resendQuotePhotoLink(quote, button) {
    const status = $("[data-quote-photo-status]", dialog);
    button.disabled = true;
    if (status) status.textContent = "Sending a new secure upload link…";
    try {
      const data = await api("/api/crm/quote-photo-link", {
        method: "PATCH",
        body: JSON.stringify({ quoteId: quote.id })
      });
      quote.photoUpload = data.photoUpload || quote.photoUpload;
      quote.status = "Awaiting photos";
      $(`[data-booking-detail]`).innerHTML = quoteDetailMarkup(quote);
      toast("Photo-upload link sent by text and email.");
    } catch (error) {
      if (status) {
        status.className = "crm-action-status is-error";
        status.textContent = error.message;
      }
      toast(error.message, "error");
      button.disabled = false;
    }
  }

  async function retryQuotePhotoRemindersOnly(quote, button) {
    const status = $("[data-quote-photo-status]", dialog);
    button.disabled = true;
    if (status) {
      status.className = "crm-action-status";
      status.textContent = "Scheduling reminders without resending the upload link…";
    }
    try {
      const data = await api("/api/crm/quote-photo-reminders", {
        method: "PATCH",
        body: JSON.stringify({ quoteId: quote.id })
      });
      quote.photoUpload = data.photoUpload || quote.photoUpload;
      $(`[data-booking-detail]`).innerHTML = quoteDetailMarkup(quote);
      const refreshedStatus = $("[data-quote-photo-status]", dialog);
      if (refreshedStatus) {
        refreshedStatus.className = "crm-action-status is-success";
        refreshedStatus.textContent = "12-hour and 24-hour reminders scheduled. The upload link was not resent.";
      }
      toast("Photo reminders scheduled. No link was resent.");
    } catch (error) {
      if (status) {
        status.className = "crm-action-status is-error";
        status.textContent = error.message;
      }
      toast(error.message, "error");
      button.disabled = false;
    }
  }

  async function saveManualContact(form) {
    const status = $("[data-contact-status]", form);
    const button = $("button[type='submit']", form);
    const values = Object.fromEntries(new FormData(form));
    values.emailMarketingEligible = form.elements.emailMarketingEligible.checked;
    values.smsMarketingConsent = form.elements.smsMarketingConsent.checked;
    button.disabled = true;
    status.textContent = "Saving customer…";
    try {
      const data = await api("/api/crm/contacts", { method: "POST", body: JSON.stringify(values) });
      state.manualContacts.unshift(data.contact);
      form.reset();
      $("[data-sms-consent-source]", form).hidden = true;
      status.className = "crm-action-status is-success";
      status.textContent = "Customer saved in the CRM.";
      renderAll();
      toast("Existing customer added.");
    } catch (error) {
      status.className = "crm-action-status is-error";
      status.textContent = error.message;
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function confirmManualSmsConsent(button) {
    const status = $("[data-manual-sms-consent-status]");
    button.disabled = true;
    status.className = "crm-action-status";
    status.textContent = "Recording consent and checking the SMS opt-out list…";
    try {
      const data = await api("/api/crm/contacts", {
        method: "PATCH",
        body: JSON.stringify({
          operation: "confirm-manual-sms-consent",
          smsConsentSource: "Business owner confirmed documented prior email and SMS marketing permission on October 8, 2026."
        })
      });
      await loadBookings();
      status.className = "crm-action-status is-success";
      status.textContent = `${data.updated} previous-customer records added to the email and SMS audiences. ${data.suppressed} opted-out SMS record${data.suppressed === 1 ? " was" : "s were"} kept suppressed.`;
      toast("Previous-customer email and SMS consent recorded.");
    } catch (error) {
      status.className = "crm-action-status is-error";
      status.textContent = error.message;
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function deleteManualContact(button) {
    const name = button.dataset.contactName || "this customer";
    if (!window.confirm(`Permanently delete ${name} from the CRM?`)) return;
    button.disabled = true;
    try {
      await api("/api/crm/contacts", { method: "DELETE", body: JSON.stringify({ id: button.dataset.deleteManualContact }) });
      state.manualContacts = state.manualContacts.filter((contact) => contact.id !== button.dataset.deleteManualContact);
      renderAll();
      toast(`${name} was deleted from the CRM.`);
    } catch (error) {
      button.disabled = false;
      toast(error.message, "error");
    }
  }

  function setView(view) {
    state.view = view;
    $$("[data-view]").forEach((section) => { section.hidden = section.dataset.view !== view; });
    $$("[data-view-button]").forEach((button) => button.classList.toggle("is-active", button.dataset.viewButton === view));
    const titles = { overview: "Business overview", bookings: "Booking management", quotes: "Quote management", walkthroughs: "Walkthrough requests", customers: "Customer directory", calls: "Call history", conversations: "AI Conversations", callbacks: "Customer callbacks", "same-day": "Same-day requests", concerns: "Complaints & Concerns", marketing: "Marketing subscribers", trash: "Trash" };
    $("[data-page-title]").textContent = titles[view];
    if (view === "trash") renderTrash();
    if (view === "quotes") renderQuotes();
    if (view === "walkthroughs") renderWalkthroughs();
    closeSidebar();
  }

  function openSidebar() {
    $("[data-sidebar]").classList.add("is-open");
    $("[data-sidebar-scrim]").classList.add("is-open");
  }

  function closeSidebar() {
    $("[data-sidebar]").classList.remove("is-open");
    $("[data-sidebar-scrim]").classList.remove("is-open");
  }

  function signOut() {
    sessionStorage.removeItem("imanCrmAdminToken");
    state.token = "";
    state.bookings = [];
    state.quotes = [];
    state.manualContacts = [];
    state.calls = [];
    state.callbacks = [];
    state.conversations = [];
    state.conversationsError = "";
    state.concerns = [];
    state.concernsError = "";
    app.hidden = true;
    loginView.hidden = false;
    $("[data-login-form]").reset();
    $("[data-login-status]").textContent = "";
    if (voiceDevice) voiceDevice.destroy();
    voiceDevice = null;
    activeCall = null;
    if (deleteQuoteDialog.open) deleteQuoteDialog.close("no");
    if (dialog.open) dialog.close();
    if (dialerDialog.open) dialerDialog.close();
    if (messageDialog.open) messageDialog.close();
  }

  async function login(token) {
    state.token = token;
    const status = $("[data-login-status]");
    const button = $(".crm-login-submit");
    button.disabled = true;
    button.textContent = "Checking access…";
    status.textContent = "";
    try {
      await loadBookings();
      sessionStorage.setItem("imanCrmAdminToken", state.token);
      loginView.hidden = true;
      app.hidden = false;
      setView("overview");
    } catch (error) {
      state.token = "";
      sessionStorage.removeItem("imanCrmAdminToken");
      status.textContent = error.status === 401 ? "That access key is not valid." : error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Open CRM";
    }
  }

  $("[data-date-label]").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  $("[data-login-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    login(String(new FormData(event.currentTarget).get("adminToken") || "").trim());
  });

  $("[data-toggle-password]").addEventListener("click", (event) => {
    const input = $("#crm-token");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    event.currentTarget.textContent = show ? "Hide" : "Show";
    event.currentTarget.setAttribute("aria-label", show ? "Hide access key" : "Show access key");
  });

  document.addEventListener("click", (event) => {
    const deleteContact = event.target.closest("[data-delete-manual-contact]");
    if (deleteContact) {
      deleteManualContact(deleteContact);
      return;
    }
    const confirmManualSms = event.target.closest("[data-confirm-manual-sms-consent]");
    if (confirmManualSms) {
      confirmManualSmsConsent(confirmManualSms);
      return;
    }
    const newCustomPayment = event.target.closest("[data-new-custom-payment]");
    if (newCustomPayment) {
      event.preventDefault();
      createStandalonePaymentLink(newCustomPayment);
      return;
    }
    const callbackButton = event.target.closest("[data-call-back]");
    if (callbackButton) {
      callBack(callbackButton.dataset.callBack);
      return;
    }
    const callCustomer = event.target.closest("[data-call-customer]");
    if (callCustomer) {
      openDialer(callCustomer.dataset.customerPhone || "", callCustomer.dataset.customerName || "Customer", callCustomer.dataset.sourceId || "", callCustomer.dataset.sourceType || "");
      return;
    }
    const textCustomer = event.target.closest("[data-text-customer]");
    if (textCustomer) {
      openMessageComposer(textCustomer.dataset.customerPhone || "", textCustomer.dataset.customerName || "Customer");
      return;
    }
    const phoneLink = event.target.closest('a[href^="tel:"]');
    if (phoneLink && app.contains(phoneLink)) {
      event.preventDefault();
      openDialer(decodeURIComponent(phoneLink.getAttribute("href").slice(4)));
      return;
    }
    const dialNumber = event.target.closest("[data-dial-number]");
    if (dialNumber) {
      openDialer(dialNumber.dataset.dialNumber || "");
      return;
    }
    const viewButton = event.target.closest("[data-view-button], [data-view-shortcut]");
    if (viewButton) {
      setView(viewButton.dataset.viewButton || viewButton.dataset.viewShortcut);
      if (dialog.contains(viewButton)) dialog.close();
    }
    const bookingButton = event.target.closest("[data-open-booking]");
    if (bookingButton) openBooking(bookingButton.dataset.openBooking);
    const quoteButton = event.target.closest("[data-open-quote]");
    if (quoteButton) openQuote(quoteButton.dataset.openQuote);
    const preparePayment = event.target.closest("[data-prepare-custom-payment]");
    if (preparePayment) {
      openQuote(preparePayment.dataset.prepareCustomPayment);
      const form = $("[data-custom-payment-form]", dialog);
      if (form) { form.hidden = false; updatePaymentPreview(form); form.elements.service.focus(); }
      return;
    }
    const addUnit = event.target.closest("[data-add-quote-unit]");
    const removeUnit = event.target.closest("[data-remove-quote-unit]");
    const addItem = event.target.closest("[data-add-unit-item]");
    const removeItem = event.target.closest("[data-remove-unit-item]");
    if (addUnit || removeUnit || addItem || removeItem) {
      const button = addUnit || removeUnit || addItem || removeItem;
      const form = button.closest("[data-custom-payment-form]");
      if (!form) return;
      if (addUnit) {
        const count = $$("[data-quote-unit]", form).length;
        if (count >= 20) { toast("A quote can contain up to 20 units.", "error"); return; }
        $("[data-quote-units]", form).insertAdjacentHTML("beforeend", quoteUnitMarkup({}, count));
      } else if (removeUnit) button.closest("[data-quote-unit]").remove();
      else if (addItem) {
        const unit = button.closest("[data-quote-unit]");
        if ($$("[data-unit-item]", unit).length >= 40) { toast("A unit can contain up to 40 items.", "error"); return; }
        $("[data-unit-items]", unit).insertAdjacentHTML("beforeend", quoteUnitItemMarkup({ quantity: 1, kind: "addon" }));
      } else button.closest("[data-unit-item]").remove();
      updatePaymentPreview(form);
      return;
    }
    const togglePayment = event.target.closest("[data-toggle-custom-payment]");
    if (togglePayment) {
      const form = $("[data-custom-payment-form]", togglePayment.closest("section"));
      if (!form.hidden) openQuote(form.dataset.quoteId);
      else { form.hidden = false; updatePaymentPreview(form); form.elements.service.focus(); }
      return;
    }
    const textPayment = event.target.closest("[data-text-payment-link]");
    if (textPayment) {
      const quote = state.quotes.find(item => item.id === textPayment.dataset.textPaymentLink);
      if (quote?.paymentReady && quote.approvalUrl && !quote.deletedAt && !quote.editLocked) {
        openMessageComposer(quote.phone, quote.customerName);
        $("[data-message-body]").value = `IMAN Cleaning Service: Your custom cleaning estimate is ready. Review your service details, sign the agreement and pay your deposit securely here: ${quote.approvalUrl}`;
      }
      return;
    }
    const emailPayment = event.target.closest("[data-email-payment-link]");
    if (emailPayment) {
      const quote = state.quotes.find(item => item.id === emailPayment.dataset.emailPaymentLink);
      if (!quote?.paymentReady || !quote.approvalUrl || quote.deletedAt || quote.editLocked) return;
      if (!quote.email) { toast("Add the customer’s email address first.", "error"); return; }
      if (!window.confirm(`Email this payment link to ${quote.email}?`)) return;
      emailPayment.disabled = true;
      const original = emailPayment.textContent;
      emailPayment.textContent = "Sending…";
      api("/api/crm/payment-link-email", { method: "POST", body: JSON.stringify({ id: quote.id }) })
        .then(() => toast(`Payment link emailed to ${quote.email}.`))
        .catch(error => toast(error.message || "The payment-link email could not be sent.", "error"))
        .finally(() => { emailPayment.disabled = false; emailPayment.textContent = original; });
      return;
    }
    const toggleEditor = event.target.closest("[data-toggle-quote-editor]");
    const toggleDiscount = event.target.closest('[data-toggle-quote-discount]');
    if (toggleDiscount) {
      const form = $('[data-quote-discount-form]', toggleDiscount.closest('section'));
      if (!form) return;
      if (!form.hidden) form.reset();
      form.hidden = !form.hidden;
      if (!form.hidden) { updateDiscountPreview(form); form.elements.discount.focus(); }
      return;
    }
    if (toggleEditor) {
      const form = $("[data-quote-edit-form]", toggleEditor.closest("section"));
      if (!form.hidden) form.reset();
      form.hidden = !form.hidden;
      if (!form.hidden) form.elements.customerName.focus();
    }
    const quoteDelete = event.target.closest("[data-delete-quote]");
    const quoteRestore = event.target.closest("[data-restore-quote]");
    if (quoteDelete || quoteRestore) {
      const button = quoteDelete || quoteRestore;
      const quote = state.quotes.find(item => item.id === (button.dataset.deleteQuote || button.dataset.restoreQuote));
      if (quote) {
        const scope = button.closest("[data-quote-action-scope]") || button.closest("section");
        const status = $("[data-quote-edit-status]", scope);
        if (quoteDelete) requestQuoteDeletion(quote, status, button);
        else if (!button.disabled) quoteMutation(quote, { operation: "restore" }, "PATCH", status, button);
      }
    }
    const callButton = event.target.closest("[data-open-call]");
    if (callButton) openCall(callButton.dataset.openCall);
    const conversationButton = event.target.closest("[data-open-conversation]");
    if (conversationButton) openConversation(conversationButton.dataset.openConversation);
    const concernButton = event.target.closest("[data-open-concern]");
    if (concernButton) openConcern(concernButton.dataset.openConcern);
    const concernFilter = event.target.closest("[data-concern-filter]");
    if (concernFilter) { state.concernStatus = concernFilter.dataset.concernFilter; renderConcerns(); }
    const resendQuotePhotos = event.target.closest("[data-resend-quote-photos]");
    if (resendQuotePhotos) {
      const quote = state.quotes.find((item) => item.id === resendQuotePhotos.dataset.resendQuotePhotos);
      if (quote) resendQuotePhotoLink(quote, resendQuotePhotos);
    }
    const retryPhotoReminders = event.target.closest("[data-retry-quote-photo-reminders]");
    if (retryPhotoReminders) {
      const quote = state.quotes.find((item) => item.id === retryPhotoReminders.dataset.retryQuotePhotoReminders);
      if (quote) retryQuotePhotoRemindersOnly(quote, retryPhotoReminders);
    }
    const copyPhotoLink = event.target.closest("[data-copy-quote-photo-link]");
    if (copyPhotoLink) {
      navigator.clipboard.writeText(copyPhotoLink.dataset.copyQuotePhotoLink)
        .then(() => toast("Link copied."))
        .catch(() => toast("The link could not be copied.", "error"));
    }
    const clockButton = event.target.closest("[data-clock-action]");
    if (clockButton) {
      const booking = state.bookings.find((item) => item.id === state.selectedId);
      if (booking) updateClock(booking, clockButton.dataset.clockAction, clockButton);
    }
    const resendButton = event.target.closest("[data-resend-additional-work]");
    if (resendButton) {
      const booking = state.bookings.find((item) => item.id === state.selectedId);
      if (booking) resendAdditionalWork(booking, resendButton);
    }
    const customerButton = event.target.closest("[data-customer-bookings]");
    if (customerButton) {
      state.search = customerButton.dataset.customerBookings;
      $("[data-global-search]").value = state.search;
      state.status = "All";
      setView("bookings");
      renderBookings();
    }
    const filter = event.target.closest("[data-status-filter]");
    if (filter) { state.status = filter.dataset.statusFilter; renderBookings(); }
    const quoteFilter = event.target.closest("[data-quote-filter]");
    if (quoteFilter) { state.quoteType = quoteFilter.dataset.quoteFilter; renderQuotes(); }
    const marketingFilter = event.target.closest("[data-marketing-filter]");
    if (marketingFilter) { state.marketingSegment = marketingFilter.dataset.marketingFilter; renderMarketing(); }
    const campaignPreview = event.target.closest("[data-preview-marketing-campaign]");
    if (campaignPreview) refreshMarketingCampaign();
    const campaignSend = event.target.closest("[data-send-marketing-channel]");
    if (campaignSend) sendMarketingCampaign(campaignSend.dataset.sendMarketingChannel, campaignSend);
    const callbackFilter = event.target.closest("[data-callback-filter]");
    if (callbackFilter) { state.callbackStatus = callbackFilter.dataset.callbackFilter; renderCallbacks(); }
    const callbackAction = event.target.closest("[data-callback-status]");
    if (callbackAction) updateCallbackStatus(callbackAction.dataset.callbackId, callbackAction.dataset.callbackStatus, callbackAction);
    const sameDayAction = event.target.closest("[data-same-day-action]");
    if (sameDayAction) updateSameDay(sameDayAction.dataset.sameDayId, sameDayAction.dataset.sameDayAction, sameDayAction);
    const bookingEditorToggle = event.target.closest("[data-toggle-booking-editor]");
    if (bookingEditorToggle) {
      const form = $("[data-booking-edit-form]", bookingEditorToggle.closest(".crm-booking-editor-section"));
      form.hidden = !form.hidden;
      bookingEditorToggle.setAttribute("aria-expanded", String(!form.hidden));
      bookingEditorToggle.textContent = form.hidden ? "Edit booking" : "Hide editor";
    }
    const bookingEditorCancel = event.target.closest("[data-cancel-booking-edit]");
    if (bookingEditorCancel) {
      const section = bookingEditorCancel.closest(".crm-booking-editor-section");
      const form = $("[data-booking-edit-form]", section);
      form.reset();
      form.hidden = true;
      const toggle = $("[data-toggle-booking-editor]", section);
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "Edit booking";
    }
    if (event.target.closest("[data-close-dialog]")) dialog.close();
  });

  document.addEventListener("input", event => {
    const discountForm = event.target.closest('[data-quote-discount-form]');
    if (discountForm) updateDiscountPreview(discountForm);
    const form = event.target.closest("[data-custom-payment-form]");
    if (form) updatePaymentPreview(form);
  });

  document.addEventListener("submit", (event) => {
    const walkthroughForm = event.target.closest('[data-walkthrough-confirm-form]');
    if (walkthroughForm) { event.preventDefault(); confirmWalkthrough(walkthroughForm); return; }
    const discountForm = event.target.closest('[data-quote-discount-form]');
    if (discountForm) { event.preventDefault(); saveQuoteDiscount(discountForm); return; }
    const paymentForm = event.target.closest("[data-custom-payment-form]");
    if (paymentForm) { event.preventDefault(); saveCustomPayment(paymentForm); return; }
    const quoteForm = event.target.closest("[data-quote-edit-form]");
    if (quoteForm) { event.preventDefault(); saveQuoteEdit(quoteForm); return; }
    const messageForm = event.target.closest("[data-message-form]");
    if (messageForm) {
      event.preventDefault();
      sendCustomerText(messageForm);
      return;
    }
    const dialerForm = event.target.closest("[data-dialer-form]");
    if (dialerForm) {
      event.preventDefault();
      startOutboundCall(dialerForm);
      return;
    }
    const concernForm = event.target.closest("[data-concern-form]");
    if (concernForm) {
      event.preventDefault();
      saveConcern(concernForm);
      return;
    }
    const contactForm = event.target.closest("[data-contact-form]");
    if (contactForm) {
      event.preventDefault();
      saveManualContact(contactForm);
      return;
    }
    const assignmentForm = event.target.closest("[data-assignment-form]");
    if (assignmentForm) {
      event.preventDefault();
      const booking = state.bookings.find((item) => item.id === state.selectedId);
      if (booking) saveCleanerAssignment(booking, assignmentForm);
      return;
    }
    const bookingEditForm = event.target.closest("[data-booking-edit-form]");
    if (bookingEditForm) {
      event.preventDefault();
      const booking = state.bookings.find((item) => item.id === state.selectedId);
      if (booking) saveBookingDetails(booking, bookingEditForm);
      return;
    }
    const form = event.target.closest("[data-status-form]");
    if (!form) return;
    event.preventDefault();
    const booking = state.bookings.find((item) => item.id === state.selectedId);
    if (booking) updateBookingStatus(booking, form.elements.status.value, form);
  });

  document.addEventListener("change", (event) => {
    const manualSmsConsent = event.target.closest("[data-manual-sms-consent]");
    if (manualSmsConsent) {
      const source = $("[data-sms-consent-source]", manualSmsConsent.form);
      source.hidden = !manualSmsConsent.checked;
      source.querySelector("input").required = manualSmsConsent.checked;
      if (!manualSmsConsent.checked) source.querySelector("input").value = "";
      return;
    }
    const qualityInput = event.target.closest("[data-quality-input]");
    if (qualityInput) {
      const booking = state.bookings.find((item) => item.id === state.selectedId);
      if (booking) uploadQualityPhotos(booking, qualityInput.dataset.qualityInput, qualityInput);
      return;
    }
    const select = event.target.closest("[data-status-form] select[name='status']");
    if (!select) return;
    const option = $("[data-completion-offer]", select.form);
    option.hidden = select.value !== "Completed";
    if (option.hidden) select.form.elements.sendAdditionalWork.checked = false;
    const cancellationOptions = $("[data-cancellation-options]", select.form);
    const isCancellation = select.value === "Cancelled";
    cancellationOptions.hidden = !isCancellation;
    cancellationOptions.disabled = !isCancellation;
    if (!isCancellation) {
      for (const input of cancellationOptions.querySelectorAll("input")) input.checked = false;
    }
  });

  $("[data-global-search]").addEventListener("input", (event) => {
    state.search = event.target.value;
    if (state.view === "bookings") renderBookings();
    if (state.view === "quotes") renderQuotes();
    if (state.view === "walkthroughs") renderWalkthroughs();
    if (state.view === "trash") renderTrash();
    if (state.view === "customers") renderCustomers();
    if (state.view === "calls") renderCalls();
    if (state.view === "conversations") renderConversations();
    if (state.view === "callbacks") renderCallbacks();
    if (state.view === "same-day") renderSameDayRequests();
    if (state.view === "concerns") renderConcerns();
  });
  $("[data-booking-sort]").addEventListener("change", (event) => { state.sort = event.target.value; renderBookings(); });
  $("[data-quote-sort]").addEventListener("change", (event) => { state.quoteSort = event.target.value; renderQuotes(); });
  $("[data-refresh]").addEventListener("click", async () => {
    try { await loadBookings(); toast("CRM refreshed."); } catch (error) { toast(error.message, "error"); }
  });
  $("[data-open-dialer]").addEventListener("click", () => openDialer(""));
  $("[data-open-message]").addEventListener("click", () => openMessageComposer(""));
  $("[data-end-call]").addEventListener("click", endOutboundCall);
  $("[data-close-dialer]").addEventListener("click", () => {
    if (activeCall) return setDialerStatus("End the active call before closing the dialer.", "error");
    dialerDialog.close();
  });
  $("[data-close-message]").addEventListener("click", () => messageDialog.close());
  $("[data-sign-out]").addEventListener("click", signOut);
  $("[data-open-menu]").addEventListener("click", openSidebar);
  $("[data-close-menu]").addEventListener("click", closeSidebar);
  $("[data-sidebar-scrim]").addEventListener("click", closeSidebar);
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialerDialog.addEventListener("click", (event) => { if (event.target === dialerDialog && !activeCall) dialerDialog.close(); });
  dialerDialog.addEventListener("cancel", (event) => { if (activeCall) event.preventDefault(); });
  messageDialog.addEventListener("click", (event) => { if (event.target === messageDialog) messageDialog.close(); });

  const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isNativeContainer = Boolean(window.Capacitor?.isNativePlatform?.());
  const isStandaloneApp = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
  if (iosInstall && isAppleMobile && !isNativeContainer && !isStandaloneApp && localStorage.getItem("imanCrmInstallTipDismissed") !== "1") {
    iosInstall.hidden = false;
  }
  $("[data-dismiss-ios-install]")?.addEventListener("click", () => {
    localStorage.setItem("imanCrmInstallTipDismissed", "1");
    iosInstall.hidden = true;
  });

  if ("serviceWorker" in navigator && !isNativeContainer) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/crm-sw.js", { scope: "/crm" }).catch(() => {});
    });
  }

  if (state.token) {
    login(state.token);
  }
})();
