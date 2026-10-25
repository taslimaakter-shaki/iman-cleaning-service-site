(function () {
  "use strict";

  var VERSION = "20260911-review-redesign";
  var GOOGLE_REVIEWS = "https://share.google/EAX7wC22J4PyMKcNx";
  var reviews = [
    {
      author: "Mahin Muhtasimul",
      text: "They did a great job cleaning my house. They showed up on time, were friendly, and paid attention to the little things."
    },
    {
      author: "Mohammod Rahman",
      text: "Got them for move out cleaning. They were very efficient with the whole arrangement. Very reasonable with scheduling and payment."
    },
    {
      author: "Amena Badat",
      text: "Truly amazing service, my house hasn’t looked so clean before. They are very very respectful and understand everything that needs to be done in a space to make it feel like home."
    }
  ];

  function googleIcon() {
    return '<svg class="site-reviews__google" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.5c-.3 1.4-1.1 2.7-2.4 3.6v3h3.8c2.2-2.1 3.6-5.1 3.6-8.6Z"/>' +
      '<path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.8-3.1l-3.8-3c-1 .7-2.3 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.5v3.1A12 12 0 0 0 12 24Z"/>' +
      '<path fill="#FBBC04" d="M5.4 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V6.7H1.5A12 12 0 0 0 0 12c0 1.9.5 3.7 1.5 5.3l3.9-3.1Z"/>' +
      '<path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.9 1.1 15.2 0 12 0A12 12 0 0 0 1.5 6.7l3.9 3.1c.9-2.8 3.5-5 6.6-5Z"/>' +
      '</svg>';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character];
    });
  }

  function addStylesheet() {
    if (document.querySelector('link[data-site-reviews-css]')) return;
    var script = document.currentScript || document.querySelector('script[src*="site-reviews.js"]');
    var href = script && script.src
      ? new URL("site-reviews.css?v=" + VERSION, script.src).href
      : "./site-reviews.css?v=" + VERSION;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-site-reviews-css", "");
    document.head.appendChild(link);
  }

  function createSection() {
    var section = document.createElement("section");
    section.className = "site-reviews";
    section.id = "customer-reviews";
    section.setAttribute("aria-labelledby", "site-customer-reviews-title");
    section.innerHTML =
      '<div class="site-reviews__inner">' +
        '<header class="site-reviews__head">' +
          '<div><h2 id="site-customer-reviews-title">Trusted by New Yorkers</h2></div>' +
          '<div class="site-reviews__summary">' +
            '<div class="site-reviews__rating"><span class="site-reviews__stars" aria-hidden="true">★★★★★</span><strong><span class="sr-only">4.9 out of 5 stars, </span>4.9 on Google</strong></div>' +
            '<a href="' + GOOGLE_REVIEWS + '" target="_blank" rel="noopener noreferrer" data-conv="google_reviews">Read All Reviews <span aria-hidden="true">→</span></a>' +
          '</div>' +
        '</header>' +
        '<div class="site-reviews__track" aria-label="Customer reviews">' +
          reviews.map(function (review, index) {
            return '<article class="site-reviews__card" id="site-customer-review-' + (index + 1) + '">' +
              '<div class="site-reviews__card-top"><div class="site-reviews__card-stars" role="img" aria-label="5 out of 5 stars"><span aria-hidden="true">★★★★★</span></div><span class="site-reviews__quote-mark" aria-hidden="true">“</span></div>' +
              '<blockquote>“' + escapeHtml(review.text) + '”</blockquote>' +
              '<footer><span class="site-reviews__identity"><strong>' + escapeHtml(review.author) + '</strong><span class="site-reviews__source">Google Review</span></span>' + googleIcon() + '</footer>' +
            '</article>';
          }).join("") +
        '</div>' +
        '<nav class="site-reviews__dots" aria-label="Choose a customer review">' +
          reviews.map(function (_, index) {
            return '<button class="site-reviews__dot' + (index === 0 ? ' is-active' : '') + '" type="button" aria-label="Show review ' + (index + 1) + '"' + (index === 0 ? ' aria-current="true"' : '') + '></button>';
          }).join("") +
        '</nav>' +
      '</div>';
    return section;
  }

  function initializeCarousel(section) {
    var track = section.querySelector(".site-reviews__track");
    var cards = Array.from(section.querySelectorAll(".site-reviews__card"));
    var dots = Array.from(section.querySelectorAll(".site-reviews__dot"));
    var frame = 0;

    function setActive(index) {
      dots.forEach(function (dot, dotIndex) {
        var active = dotIndex === index;
        dot.classList.toggle("is-active", active);
        if (active) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
    }

    dots.forEach(function (dot, index) {
      dot.addEventListener("click", function () {
        cards[index].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        setActive(index);
      });
    });

    track.addEventListener("scroll", function () {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(function () {
        var center = track.scrollLeft + track.clientWidth / 2;
        var nearest = cards.reduce(function (best, card, index) {
          var cardCenter = card.offsetLeft + card.offsetWidth / 2;
          var distance = Math.abs(cardCenter - center);
          return distance < best.distance ? { index: index, distance: distance } : best;
        }, { index: 0, distance: Infinity });
        setActive(nearest.index);
      });
    }, { passive: true });
  }

  function install() {
    document.querySelectorAll(".hdr-nav").forEach(function (nav) {
      if (nav.querySelector('a[href$="our-work.html"]')) return;
      var workLink = document.createElement("a");
      workLink.href = "./our-work.html";
      workLink.textContent = "Our Work";
      if (/\/our-work\.html$/.test(window.location.pathname)) workLink.setAttribute("aria-current", "page");
      var servicesLink = nav.querySelector('a[href$="services-hub.html"]');
      if (servicesLink) servicesLink.insertAdjacentElement("afterend", workLink);
      else nav.insertBefore(workLink, nav.firstChild);
    });

    addStylesheet();
    document.querySelectorAll(".review-band").forEach(function (existing) {
      existing.remove();
    });

    var section = document.querySelector(".site-reviews") || createSection();
    var finalSections = document.querySelectorAll(".final-cta, .standard-final-cta");
    var finalSection = finalSections.length ? finalSections[finalSections.length - 1] : null;
    var customQuoteSections = Array.from(finalSections).filter(function (candidate) {
      return candidate.querySelector('a[href*="contact.html"]');
    });
    var customQuoteSection = customQuoteSections.length ? customQuoteSections[customQuoteSections.length - 1] : null;
    var footers = document.querySelectorAll("footer.site-footer");
    var footer = footers.length ? footers[footers.length - 1] : document.querySelector("body > footer");
    if (customQuoteSection && customQuoteSection.parentNode) customQuoteSection.parentNode.insertBefore(section, customQuoteSection.nextSibling);
    else if (finalSection && finalSection.parentNode) finalSection.parentNode.insertBefore(section, finalSection);
    else if (footer && footer.parentNode) footer.parentNode.insertBefore(section, footer);
    else {
      var main = document.querySelector("main");
      (main || document.body).appendChild(section);
    }
    if (!section.hasAttribute("data-site-reviews-ready")) {
      section.setAttribute("data-site-reviews-ready", "true");
      initializeCarousel(section);
    }
    if (location.hash === "#customer-reviews") section.scrollIntoView({ block: "start" });
  }

  addStylesheet();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
  window.addEventListener("load", install, { once: true });
  window.setTimeout(install, 750);
}());

// Shared GA4 conversion events used across public pages.
(function () {
  if (window.__imanConversionTrackingReady) return;
  window.__imanConversionTrackingReady = true;
  if (typeof window.gtag !== "function") {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", "G-6MEJH73E0H");
    var analyticsScript = document.createElement("script");
    analyticsScript.async = true;
    analyticsScript.src = "https://www.googletagmanager.com/gtag/js?id=G-6MEJH73E0H";
    document.head.appendChild(analyticsScript);
  }
  document.addEventListener("click", function (event) {
    var link = event.target.closest("a[href], button[data-conv]");
    if (!link || typeof window.gtag !== "function") return;
    var href = String(link.getAttribute("href") || "");
    if (href.indexOf("tel:") === 0) {
      window.gtag("event", "phone_click", { link_url: href, page_location: window.location.href });
    }
    if (link.getAttribute("data-conv") === "book" || /(?:book-now\.html|quote\.html)/i.test(href)) {
      window.gtag("event", "check_my_price_click", { link_url: href, page_location: window.location.href });
    }
  });
}());
