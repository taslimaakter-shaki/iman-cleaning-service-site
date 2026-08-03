(() => {
  const promo = document.querySelector("[data-home-booking-promo]");
  if (!promo) return;

  const storageKey = "imanBookingPromoDismissedAt";
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  let timer;
  let shown = false;

  const readDismissedAt = () => {
    try { return Number(window.localStorage.getItem(storageKey) || 0); } catch { return 0; }
  };
  const rememberDismissal = () => {
    try { window.localStorage.setItem(storageKey, String(Date.now())); } catch {}
  };
  const recentlyDismissed = () => Date.now() - readDismissedAt() < sevenDays;
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
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollable > 0 && window.scrollY / scrollable >= .3) show();
  };

  if (recentlyDismissed()) return;

  timer = window.setTimeout(show, 7000);
  window.addEventListener("scroll", handleScroll, { passive: true });
  promo.querySelector("[data-home-booking-promo-close]")?.addEventListener("click", dismiss);
  promo.querySelector("[data-home-booking-promo-cta]")?.addEventListener("click", rememberDismissal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !promo.hidden) dismiss();
  });
})();
