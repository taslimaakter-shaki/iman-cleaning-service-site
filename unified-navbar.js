(function () {
  const header = document.querySelector(".iman-unified-navbar");
  if (!header) return;

  const menuButton = header.querySelector(".hdr-burger");
  const nav = header.querySelector(".hdr-nav");
  if (!menuButton || !nav) return;

  if (!nav.querySelector('a[href$="our-work.html"]')) {
    const workLink = document.createElement("a");
    workLink.href = "./our-work.html";
    workLink.textContent = "Our Work";
    const servicesLink = nav.querySelector('a[href$="services-hub.html"]');
    if (servicesLink) servicesLink.insertAdjacentElement("afterend", workLink);
    else nav.prepend(workLink);
  }

  if (/\/our-work\.html$/.test(window.location.pathname)) {
    const workLink = nav.querySelector('a[href$="our-work.html"]');
    if (workLink) workLink.setAttribute("aria-current", "page");
  }

  const setOpen = (open) => {
    nav.dataset.open = String(open);
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
  };

  menuButton.addEventListener("click", () => setOpen(nav.dataset.open !== "true"));
  nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setOpen(false)));
  document.addEventListener("click", (event) => {
    if (nav.dataset.open === "true" && !header.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.dataset.open === "true") {
      setOpen(false);
      menuButton.focus();
    }
  });
})();
