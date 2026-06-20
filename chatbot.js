(() => {
  const STORAGE_KEY = "imanLiveChatSession";
  const quickPrompts = [
    "I need a cleaning quote.",
    "Do you have availability today?",
    "I need deep cleaning.",
    "I need move-out cleaning.",
    "I need office cleaning."
  ];

  const fallbackText = "Live chat is not connected yet. Please text 929-803-4053 or call 929-803-4053.";

  function safeJsonParse(value) {
    try {
      return JSON.parse(value || "{}");
    } catch (error) {
      return {};
    }
  }

  function loadSavedSession() {
    try {
      return safeJsonParse(window.localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      return {};
    }
  }

  function saveSession(update) {
    const current = loadSavedSession();
    const next = { ...current, ...update };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {}
    return next;
  }

  function makeClientMessageId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function buildWidget() {
    const widget = document.createElement("section");
    widget.className = "iman-chatbot";
    widget.setAttribute("aria-label", "Iman Cleaning Service live chat");
    widget.innerHTML = `
      <button class="iman-chatbot-toggle" type="button" aria-label="Open live chat" aria-expanded="false">
        <span aria-hidden="true">Chat</span>
        <strong>Live Chat</strong>
      </button>
      <div class="iman-chatbot-panel" hidden>
        <div class="iman-chatbot-head">
          <div>
            <span>Iman Cleaning</span>
            <strong>Live Chat</strong>
          </div>
          <button type="button" aria-label="Close chat">x</button>
        </div>
        <div class="iman-chatbot-fields">
          <label class="iman-chatbot-field">
            <span>Name</span>
            <input type="text" name="visitorName" autocomplete="name" maxlength="120">
          </label>
          <label class="iman-chatbot-field">
            <span>Phone or email</span>
            <input type="text" name="visitorContact" autocomplete="email" maxlength="180">
          </label>
        </div>
        <div class="iman-chatbot-messages" aria-live="polite"></div>
        <div class="iman-chatbot-prompts" aria-label="Quick messages"></div>
        <form class="iman-chatbot-form">
          <input type="text" name="message" autocomplete="off" maxlength="1600" placeholder="Type your message">
          <button type="submit">Send</button>
        </form>
        <p class="iman-chatbot-consent">
          By sending, you agree Iman Cleaning Service LLC may reply about your request by chat, phone, or text. Msg/data rates may apply. Reply STOP to opt out. <a href="./sms-terms.html">SMS Terms</a> · <a href="./privacy-policy.html">Privacy Policy</a>
        </p>
        <p class="iman-chatbot-status" role="status"></p>
      </div>
    `;
    document.body.appendChild(widget);
    return widget;
  }

  function normalizeServerMessage(message) {
    return {
      id: message.id ? String(message.id) : "",
      sender: message.sender || "system",
      body: message.body || "",
      clientMessageId: message.clientMessageId || message.client_message_id || "",
      createdAt: message.createdAt || message.created_at || ""
    };
  }

  function initChatbot() {
    const widget = buildWidget();
    const saved = loadSavedSession();
    const renderedMessages = new Map();
    let sessionId = saved.sessionId || "";
    let pollTimer = null;
    let isPolling = false;

    const toggle = widget.querySelector(".iman-chatbot-toggle");
    const panel = widget.querySelector(".iman-chatbot-panel");
    const closeButton = widget.querySelector(".iman-chatbot-head button");
    const messages = widget.querySelector(".iman-chatbot-messages");
    const prompts = widget.querySelector(".iman-chatbot-prompts");
    const form = widget.querySelector(".iman-chatbot-form");
    const input = form.querySelector("input[name='message']");
    const submitButton = form.querySelector("button");
    const nameInput = widget.querySelector("input[name='visitorName']");
    const contactInput = widget.querySelector("input[name='visitorContact']");
    const status = widget.querySelector(".iman-chatbot-status");

    nameInput.value = saved.visitorName || "";
    contactInput.value = saved.visitorContact || "";

    function setStatus(text, isError = false) {
      status.textContent = text || "";
      status.classList.toggle("is-error", Boolean(isError));
    }

    function messageKey(message) {
      if (message.id) return `id:${message.id}`;
      if (message.clientMessageId) return `client:${message.clientMessageId}`;
      return `local:${Date.now()}:${Math.random()}`;
    }

    function addOrUpdateMessage(rawMessage) {
      const message = normalizeServerMessage(rawMessage);
      const serverKey = message.id ? `id:${message.id}` : "";
      const clientKey = message.clientMessageId ? `client:${message.clientMessageId}` : "";
      let key = messageKey(message);
      let item = serverKey ? renderedMessages.get(serverKey) : null;

      if (!item && serverKey && clientKey && renderedMessages.has(clientKey)) {
        item = renderedMessages.get(clientKey);
        renderedMessages.delete(clientKey);
        renderedMessages.set(serverKey, item);
        key = serverKey;
      }

      if (!item) {
        item = document.createElement("div");
        renderedMessages.set(key, item);
        messages.appendChild(item);
      }

      item.className = `iman-chat-message iman-chat-message-${message.sender}`;
      item.textContent = message.body;
      messages.scrollTop = messages.scrollHeight;
    }

    function saveVisitorFields() {
      saveSession({
        sessionId,
        visitorName: nameInput.value.trim(),
        visitorContact: contactInput.value.trim()
      });
    }

    async function pollMessages() {
      if (!sessionId || isPolling) return;
      isPolling = true;
      try {
        const response = await fetch(`/api/chat/messages?sessionId=${encodeURIComponent(sessionId)}`, {
          headers: {
            Accept: "application/json"
          }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 404) {
            sessionId = "";
            saveSession({ sessionId: "" });
          }
          return;
        }
        (data.messages || []).forEach(addOrUpdateMessage);
        if (data.session?.status === "closed") {
          setStatus("This chat is closed. Send a new message to start again.");
        }
      } catch (error) {
        setStatus("Could not refresh chat replies.", true);
      } finally {
        isPolling = false;
      }
    }

    function startPolling() {
      if (pollTimer) return;
      pollMessages();
      pollTimer = window.setInterval(pollMessages, 4500);
    }

    function stopPolling() {
      if (!pollTimer) return;
      window.clearInterval(pollTimer);
      pollTimer = null;
    }

    function setBusy(isBusy) {
      widget.classList.toggle("is-busy", isBusy);
      submitButton.disabled = isBusy;
      input.disabled = isBusy;
    }

    async function sendMessage(message) {
      const trimmed = message.trim();
      if (!trimmed) return;

      saveVisitorFields();
      const clientMessageId = makeClientMessageId();
      addOrUpdateMessage({
        sender: "visitor",
        body: trimmed,
        clientMessageId
      });
      input.value = "";
      setBusy(true);
      setStatus("Sending...");

      try {
        const response = await fetch("/api/chat/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            sessionId,
            clientMessageId,
            visitorName: nameInput.value.trim(),
            visitorContact: contactInput.value.trim(),
            message: trimmed,
            pageUrl: window.location.href,
            referrer: document.referrer
          })
        });
        const data = await response.json().catch(() => ({}));
        if (data.session?.id) {
          sessionId = data.session.id;
          saveVisitorFields();
        }
        if (data.message) {
          addOrUpdateMessage(data.message);
        }
        if (!response.ok) {
          addOrUpdateMessage({
            sender: "error",
            body: fallbackText
          });
          setStatus("Live chat needs setup.", true);
          return;
        }
        setStatus("Sent. Replies will appear here.");
        startPolling();
      } catch (error) {
        addOrUpdateMessage({
          sender: "error",
          body: fallbackText
        });
        setStatus("Could not send chat message.", true);
      } finally {
        setBusy(false);
        input.focus();
      }
    }

    quickPrompts.forEach((prompt) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = prompt;
      button.addEventListener("click", () => {
        input.value = prompt;
        input.focus();
      });
      prompts.appendChild(button);
    });

    nameInput.addEventListener("change", saveVisitorFields);
    contactInput.addEventListener("change", saveVisitorFields);
    toggle.addEventListener("click", () => {
      const willOpen = panel.hidden;
      panel.hidden = !willOpen;
      toggle.setAttribute("aria-expanded", String(willOpen));
      if (willOpen) {
        input.focus();
        startPolling();
      } else {
        stopPolling();
      }
    });
    closeButton.addEventListener("click", () => {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      stopPolling();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      sendMessage(input.value);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopPolling();
      } else if (!panel.hidden) {
        startPolling();
      }
    });

    addOrUpdateMessage({
      sender: "system",
      body: "Hi. Send a message and the Iman Cleaning Service team will reply here."
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initChatbot);
  } else {
    initChatbot();
  }
})();
