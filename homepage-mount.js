(() => {
  const mobileHomepage = window.matchMedia("(max-width: 767px)");

  if (mobileHomepage.matches) {
    const header = document.querySelector("[data-static-home] .site-header");
    const nav = header?.querySelector(".hdr-nav");
    const menuButton = header?.querySelector(".hdr-burger");

    if (nav && menuButton) {
      const closeMenu = () => {
        nav.dataset.open = "false";
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-label", "Open navigation menu");
      };

      menuButton.addEventListener("click", () => {
        const open = menuButton.getAttribute("aria-expanded") !== "true";
        nav.dataset.open = String(open);
        menuButton.setAttribute("aria-expanded", String(open));
        menuButton.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
      });
      nav.addEventListener("click", (event) => {
        if (event.target.closest("a")) closeMenu();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeMenu();
      });
    }

    return;
  }

  let attempts = 0;
  const mount = () => {
    if (!window.ImanSite?.App || !window.React || !window.ReactDOM) {
      attempts += 1;
      if (attempts < 200) window.setTimeout(mount, 30);
      return;
    }

    const root = document.getElementById("root");
    if (!root) return;

    ReactDOM.createRoot(root).render(React.createElement(window.ImanSite.App));
  };

  mount();
})();
