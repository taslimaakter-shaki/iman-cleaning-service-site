(() => {
  const quickPrompts = [
    "How much does cleaning cost?",
    "What services do you offer?",
    "Do you clean offices?",
    "How do I book?",
    "What areas do you serve?"
  ];

  const contactLinks = `
    <div class="iman-chat-links">
      <a href="./quote.html">Request a quote</a>
      <a href="tel:9177747821">Call 917-774-7821</a>
    </div>
  `;

  const answers = [
    {
      match: /office|commercial|business|restaurant|retail|clinic|janitorial/i,
      reply: `Yes. Iman Cleaning Service LLC handles commercial spaces including offices, restaurants, retail stores, medical clinics, buildings, and recurring janitorial work. Commercial jobs are quoted based on square footage, frequency, condition, and scope. ${contactLinks}`
    },
    {
      match: /price|cost|rate|hour|estimate|how much|pricing/i,
      reply: `Iman Cleaning Service LLC prices by location, service type, condition, and time needed. Current hourly guide: Queens is $55/hour, Manhattan, Brooklyn, and Bronx are $65/hour, and Staten Island is $75/hour. For the strongest estimate, open the quote form and use the Gemini AI estimate with your details and photos. ${contactLinks}`
    },
    {
      match: /service|clean|offer|deep|standard|move|airbnb|construction/i,
      reply: `We help with standard cleaning, deep cleaning, move-in and move-out cleaning, Airbnb turnover cleaning, office cleaning, commercial cleaning, retail, restaurant, medical clinic, post-construction, and recurring janitorial cleaning. ${contactLinks}`
    },
    {
      match: /book|schedule|appointment|quote|reserve|availability/i,
      reply: `The fastest way to book is to submit the quote form with your address, property details, photos, and preferred date. Our team can review the request and confirm the right cleaning plan. ${contactLinks}`
    },
    {
      match: /area|serve|location|borough|manhattan|queens|brooklyn|bronx|staten/i,
      reply: `We serve all five boroughs of New York City: Queens, Manhattan, Brooklyn, Bronx, and Staten Island. If you are close to NYC, send a quote request and we can confirm availability. ${contactLinks}`
    },
    {
      match: /phone|call|contact|email|support|help/i,
      reply: `You can call Iman Cleaning Service LLC at 917-774-7821 or 636-253-2035. You can also email Info@imancleaningservice.com. ${contactLinks}`
    },
    {
      match: /insurance|insured|trust|safe|background/i,
      reply: `Iman Cleaning Service LLC is fully insured and focused on professional communication, careful cleaning, and reliable service. For every job, share the details clearly in the quote form so the team can prepare properly. ${contactLinks}`
    }
  ];

  function buildWidget() {
    const widget = document.createElement("section");
    widget.className = "iman-chatbot";
    widget.setAttribute("aria-label", "Iman Cleaning Service LLC chatbot");
    widget.innerHTML = `
      <button class="iman-chatbot-toggle" type="button" aria-label="Open Iman cleaning assistant" aria-expanded="false">
        <span aria-hidden="true">AI</span>
        <strong>Ask Iman</strong>
      </button>
      <div class="iman-chatbot-panel" hidden>
        <div class="iman-chatbot-head">
          <div>
            <span>Iman Assistant</span>
            <strong>How can we help?</strong>
          </div>
          <button type="button" aria-label="Close chat">x</button>
        </div>
        <div class="iman-chatbot-messages" aria-live="polite"></div>
        <div class="iman-chatbot-prompts" aria-label="Quick questions"></div>
        <form class="iman-chatbot-form">
          <input type="text" name="message" autocomplete="off" placeholder="Ask about cleaning, pricing, or booking">
          <button type="submit">Send</button>
        </form>
      </div>
    `;
    document.body.appendChild(widget);
    return widget;
  }

  function textFromHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
  }

  function getReply(message) {
    const answer = answers.find((item) => item.match.test(message));
    if (answer) return answer.reply;
    return `I can help with services, pricing, service areas, booking, and contact information. For a custom cleaning estimate, please send your property details through the quote form. ${contactLinks}`;
  }

  function initChatbot() {
    const widget = buildWidget();
    const toggle = widget.querySelector(".iman-chatbot-toggle");
    const panel = widget.querySelector(".iman-chatbot-panel");
    const closeButton = widget.querySelector(".iman-chatbot-head button");
    const messages = widget.querySelector(".iman-chatbot-messages");
    const prompts = widget.querySelector(".iman-chatbot-prompts");
    const form = widget.querySelector(".iman-chatbot-form");
    const input = form.querySelector("input");

    function addMessage(role, html) {
      const message = document.createElement("div");
      message.className = `iman-chat-message iman-chat-message-${role}`;
      message.innerHTML = role === "bot" ? html : textFromHtml(html);
      messages.appendChild(message);
      messages.scrollTop = messages.scrollHeight;
    }

    function ask(message) {
      const trimmed = message.trim();
      if (!trimmed) return;
      addMessage("user", trimmed);
      window.setTimeout(() => addMessage("bot", getReply(trimmed)), 180);
    }

    function setOpen(isOpen) {
      panel.hidden = !isOpen;
      toggle.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) input.focus();
    }

    quickPrompts.forEach((prompt) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = prompt;
      button.addEventListener("click", () => ask(prompt));
      prompts.appendChild(button);
    });

    toggle.addEventListener("click", () => setOpen(panel.hidden));
    closeButton.addEventListener("click", () => setOpen(false));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      ask(input.value);
      input.value = "";
    });

    addMessage("bot", `Hi, I’m the Iman assistant. I can help you choose a service, understand pricing, check service areas, or request a quote. ${contactLinks}`);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initChatbot);
  } else {
    initChatbot();
  }
})();
