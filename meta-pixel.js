(function () {
  "use strict";

  const PIXEL_ID = "1600479927833362";
  const CONSENT_KEY = "imanAdvertisingCookiesV1";
  const pendingPurchases = new Map();
  const pendingCheckouts = new Map();
  let initialized = false;

  function readConsent() {
    try {
      const value = window.localStorage.getItem(CONSENT_KEY);
      return value === "allowed" || value === "denied" ? value : "unset";
    } catch {
      return "unset";
    }
  }

  function writeConsent(value) {
    try { window.localStorage.setItem(CONSENT_KEY, value); } catch {}
  }

  function initializePixel() {
    if (initialized || readConsent() !== "allowed") return;
    initialized = true;

    let fbq = window.fbq;
    if (!fbq) {
      fbq = window.fbq = function () {
        fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
      };
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = "2.0";
      fbq.queue = [];
    }
    if (!window._fbq) window._fbq = fbq;

    if (!document.querySelector('script[src*="connect.facebook.net/en_US/fbevents.js"]')) {
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      const firstScript = document.getElementsByTagName("script")[0];
      firstScript.parentNode.insertBefore(script, firstScript);
    }

    fbq("init", PIXEL_ID);
    fbq("track", "PageView");
    pendingCheckouts.forEach((checkout) => trackInitiateCheckout(checkout));
    pendingCheckouts.clear();
    pendingPurchases.forEach((purchase) => trackPurchase(purchase));
    pendingPurchases.clear();
  }

  function trackInitiateCheckout(checkout) {
    if (!checkout || typeof checkout !== "object") return false;
    const checkoutId = String(checkout.checkoutId || "").trim();
    const value = Number(checkout.value);
    const currency = String(checkout.currency || "USD").trim().toUpperCase();
    const contentName = String(checkout.contentName || "Cleaning service").trim().slice(0, 100);
    if (!checkoutId || !Number.isFinite(value) || value < 0 || !/^[A-Z]{3}$/.test(currency)) return false;

    if (readConsent() !== "allowed") {
      if (readConsent() === "unset") pendingCheckouts.set(checkoutId, { checkoutId, value, currency, contentName });
      return false;
    }

    initializePixel();
    const storageKey = `imanMetaCheckout:${checkoutId}`;
    try {
      if (window.localStorage.getItem(storageKey) === "1") return false;
    } catch {}

    window.fbq("track", "InitiateCheckout", {
      value,
      currency,
      content_name: contentName,
      content_type: "product"
    }, { eventID: `checkout-${checkoutId}` });
    try { window.localStorage.setItem(storageKey, "1"); } catch {}
    return true;
  }

  function trackPurchase(purchase) {
    if (!purchase || typeof purchase !== "object") return false;
    const transactionId = String(purchase.transactionId || "").trim();
    const value = Number(purchase.value);
    const currency = String(purchase.currency || "USD").trim().toUpperCase();
    if (!transactionId || !Number.isFinite(value) || value < 0 || !/^[A-Z]{3}$/.test(currency)) return false;

    if (readConsent() !== "allowed") {
      if (readConsent() === "unset") pendingPurchases.set(transactionId, { transactionId, value, currency });
      return false;
    }

    initializePixel();
    const storageKey = `imanMetaPurchase:${transactionId}`;
    try {
      if (window.localStorage.getItem(storageKey) === "1") return false;
    } catch {}

    window.fbq("track", "Purchase", { value, currency }, { eventID: transactionId });
    try { window.localStorage.setItem(storageKey, "1"); } catch {}
    return true;
  }

  function removeBanner() {
    document.querySelector("[data-iman-cookie-banner]")?.remove();
  }

  function showBanner() {
    removeBanner();
    const banner = document.createElement("section");
    banner.setAttribute("data-iman-cookie-banner", "");
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Advertising cookie choices");
    banner.innerHTML = `
      <style>
        [data-iman-cookie-banner]{position:fixed;z-index:2147483647;right:18px;bottom:18px;box-sizing:border-box;width:min(440px,calc(100% - 36px));padding:20px;border:1px solid #cddfdb;border-radius:14px;background:#fff;color:#193b3f;box-shadow:0 18px 56px rgba(3,45,49,.2);font:400 15px/1.5 Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        [data-iman-cookie-banner] strong{display:block;margin-bottom:6px;font-size:17px;color:#034341}
        [data-iman-cookie-banner] p{margin:0;color:#52696c}
        [data-iman-cookie-banner] a{color:#075f5d;font-weight:700}
        [data-iman-cookie-actions]{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
        [data-iman-cookie-actions] button{min-height:42px;padding:0 16px;border-radius:999px;font:700 14px/1 Inter,system-ui,sans-serif;cursor:pointer}
        [data-iman-cookie-allow]{border:1px solid #075f5d;background:#075f5d;color:#fff}
        [data-iman-cookie-deny]{border:1px solid #bdd1cd;background:#fff;color:#075f5d}
      </style>
      <strong>Your privacy choices</strong>
      <p>We use optional Meta advertising cookies to measure bookings and improve our ads. Essential booking features work without them. <a href="./privacy-policy.html#cookies">Learn more</a>.</p>
      <div data-iman-cookie-actions>
        <button type="button" data-iman-cookie-allow>Allow advertising cookies</button>
        <button type="button" data-iman-cookie-deny>No thanks</button>
      </div>`;
    document.body.appendChild(banner);
    banner.querySelector("[data-iman-cookie-allow]").addEventListener("click", () => {
      writeConsent("allowed");
      removeBanner();
      initializePixel();
    });
    banner.querySelector("[data-iman-cookie-deny]").addEventListener("click", () => {
      writeConsent("denied");
      pendingCheckouts.clear();
      pendingPurchases.clear();
      removeBanner();
    });
  }

  window.imanMetaTrackInitiateCheckout = trackInitiateCheckout;
  window.imanMetaTrackPurchase = trackPurchase;
  window.imanShowAdvertisingCookieChoices = showBanner;

  function start() {
    document.querySelectorAll("[data-ad-cookie-choices]").forEach((button) => {
      button.addEventListener("click", showBanner);
    });
    if (readConsent() === "allowed") initializePixel();
    else if (readConsent() === "unset") showBanner();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
