(() => {
  const promo = document.querySelector("[data-home-booking-promo]");
  if (!promo) return;

  const storageKey = "imanBookingPromoDismissedAt";
  const dismissalWindow = 6 * 60 * 60 * 1000;
  const scrollDelay = 5 * 1000;
  const fallOfferEndsAt = Date.parse("2026-12-21T04:59:59.999Z");
  let timer;
  let shown = false;
  let scrollStarted = false;

  const fallOfferActive = Date.now() <= fallOfferEndsAt;
  promo.classList.toggle("is-fall-promo", fallOfferActive);
  if (!fallOfferActive) {
    promo.querySelector("[data-home-booking-promo-icon]").textContent = "✓";
    promo.querySelector("[data-home-booking-promo-kicker]").textContent = "Personalized online price";
    promo.querySelector("[data-home-booking-promo-title]").textContent = "Ready for a cleaner space?";
    promo.querySelector("[data-home-booking-promo-description]").textContent = "Check your service area and see your personalized cleaning price in about two minutes.";
    promo.querySelector("[data-home-booking-promo-cta]").textContent = "Check my price →";
  }

  const readDismissedAt = () => {
    try { return Number(window.localStorage.getItem(storageKey) || 0); } catch { return 0; }
  };
  const rememberDismissal = () => {
    try { window.localStorage.setItem(storageKey, String(Date.now())); } catch {}
  };
  const recentlyDismissed = () => Date.now() - readDismissedAt() < dismissalWindow;
  const show = () => {
    if (shown || recentlyDismissed()) return;
    shown = true;
    promo.hidden = false;
    window.removeEventListener("scroll", handleScroll);
  };
  const dismiss = () => {
    window.clearTimeout(timer);
    promo.hidden = true;
    rememberDismissal();
    window.removeEventListener("scroll", handleScroll);
  };
  const handleScroll = () => {
    if (scrollStarted || shown) return;
    scrollStarted = true;
    timer = window.setTimeout(show, scrollDelay);
  };

  if (recentlyDismissed()) return;

  window.addEventListener("scroll", handleScroll, { passive: true });
  promo.querySelector("[data-home-booking-promo-close]")?.addEventListener("click", dismiss);
  promo.querySelector("[data-home-booking-promo-cta]")?.addEventListener("click", rememberDismissal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !promo.hidden) dismiss();
  });
})();
