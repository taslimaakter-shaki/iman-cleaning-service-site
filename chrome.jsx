/* Iman Cleaning — shared site chrome: Icon set, Header, Footer.
   Loaded by every UI-kit page. Exported to window.ImanChrome. */
(function () {
  const { Button, Badge } = window.ImanCleaningDesignSystem_5652ad;
  const D = window.IMAN_DATA;

  const Icon = ({ name, size = 24, stroke = "currentColor", sw = 1.8 }) => {
    const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none",
      stroke, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
    const paths = {
      shield: <><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></>,
      quote: <><path d="M7 7h4v4c0 2-1.4 3.4-3.4 4M14 7h4v4c0 2-1.4 3.4-3.4 4" /></>,
      pin: <><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></>,
      clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
      phone: <><path d="M5 4h3l1.5 4.5L7.5 10a12 12 0 0 0 6 6l1.5-2 4.5 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 1-2z" /></>,
      arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
      star: <><path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6.1L12 17l-5.4 2.7 1.2-6.1L3.3 9.4l6.1-.8L12 3z" fill={stroke} stroke="none" /></>,
      check: <><path d="M20 6L9 17l-5-5" strokeWidth="2.4" /></>,
      sparkle: <><path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3z" /></>,
      mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 7l8 6 8-6" /></>,
      menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
      home: <><path d="M4 11l8-6 8 6" /><path d="M6 10v9h12v-9" /></>,
      building: <><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></>,
      truck: <><rect x="2" y="7" width="12" height="9" rx="1" /><path d="M14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>,
      calendar: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /></>,
      camera: <><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.2" /></>,
      play: <><circle cx="12" cy="12" r="9" /><path d="M10 9l5 3-5 3z" fill={stroke} stroke="none" /></>,
      leaf: <><path d="M5 19c0-8 6-13 14-13 0 8-6 13-14 13z" /><path d="M5 19c3-4 7-6 11-7" /></>,
      heart: <><path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5c0 5-7 9.5-7 9.5z" /></>,
      message: <><path d="M4 5h16v11H8l-4 4z" /></>,
    };
    return <svg {...p} aria-hidden="true" style={{ flexShrink: 0 }}>{paths[name]}</svg>;
  };

  function Header({ active, onDark = false, homepage = false }) {
    const [scrolled, setScrolled] = React.useState(false);
    const [open, setOpen] = React.useState(false);
    React.useEffect(() => {
      const onScroll = () => setScrolled(window.scrollY > 24);
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return () => window.removeEventListener("scroll", onScroll);
    }, []);
    const nav = homepage ? [
      { label: "Services", href: "./services-hub.html", key: "services" },
      { label: "Why Iman", href: "./why-us.html", key: "why" },
      { label: "Service Areas", href: "./areas.html", key: "areas" },
      { label: "Careers", href: "./careers.html", key: "careers" },
      { label: "FAQs", href: "./faq.html", key: "faq" },
      { label: "Contact", href: "./contact.html", key: "contact" },
    ] : [
      { label: "Our Services", href: "./services-hub.html", key: "services" },
      { label: "Why us", href: "./why-us.html", key: "why" },
      { label: "Service Areas", href: "./areas.html", key: "areas" },
      { label: "Careers", href: "./careers.html", key: "careers" },
      { label: "FAQs", href: "./faq.html", key: "faq" },
      { label: "Contact us", href: "./contact.html", key: "contact" },
    ];
    return (
      <header className={"site-header" + (scrolled ? " is-scrolled" : "") + (onDark ? " on-dark" : "") + (homepage ? " is-homepage" : "")}>
        <div className="hdr-inner ds-shell">
          <a href="./index.html" className="hdr-brand" aria-label="Iman Cleaning Service LLC home">
            <img className="hdr-mark" src="./assets/iman-logo-icon.png?v=20260727-clean-header-logo" alt="Iman Cleaning Service LLC" width="46" height="46" decoding="async" />
            <span className="hdr-words" aria-hidden="true"><strong>IMAN</strong><small>Cleaning Service LLC</small></span>
          </a>
          <nav className="hdr-nav" data-open={open} aria-label="Primary navigation">
            {nav.map((n) => (
              <a key={n.key} href={n.href} aria-current={active === n.key ? "page" : undefined}
                onClick={() => setOpen(false)}>{n.label}</a>
            ))}
            <div className="hdr-mobile-actions">
              <Button href="./login.html" variant="secondary" size="sm" fullWidth
                aria-label="Log in to your customer account">Log In</Button>
              <Button href="./book-now.html" variant="accent" size="sm" fullWidth
                aria-label="Book cleaning online" data-conv="book">Book Online</Button>
            </div>
          </nav>
          <div className="hdr-actions">
            {homepage ? (
              <>
                <Button href="./login.html" variant="secondary" size="sm"
                  aria-label="Log in to your customer account">Log In</Button>
                <Button href="./book-now.html" variant="accent" size="sm"
                  aria-label="Book cleaning online" data-conv="book">Book Online</Button>
              </>
            ) : (
              <>
                <Button href="./login.html" variant="secondary" size="sm"
                  aria-label="Log in to your customer account">Log In</Button>
                <Button href="./book-now.html" variant="accent" size="sm"
                  aria-label="Book cleaning online" data-conv="book">Book Online</Button>
              </>
            )}
            <button className="hdr-burger" aria-label={open ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={open} onClick={() => setOpen(!open)}>
              <span>Menu</span>
              <Icon name="menu" size={22} stroke="currentColor" />
            </button>
          </div>
        </div>
      </header>
    );
  }

  function Footer() {
    const contacts = [
      { icon: "mail", h: "Email us", v: "Info@imancleaningservice.com", href: "mailto:Info@imancleaningservice.com" },
      { icon: "pin", h: "Service area", v: "Queens, New York City, and select Long Island communities", href: "./areas.html" },
      { icon: "phone", h: "Call us", v: "929-803-4053", href: "tel:+19298034053" },
      { icon: "clock", h: "Business hours", v: "8 AM – 8 PM · 7 days" },
    ];
    const socials = [
      { name: "Instagram", href: "https://www.instagram.com/imancleaningservicellc/",
        bg: "radial-gradient(circle at 30% 110%, #ffd35c 0%, #ff9a4d 22%, #fd3f6c 46%, #d534b8 70%, #3f5cff 100%)", fg: "#fff",
        path: "M7.8 3h8.4A4.8 4.8 0 0 1 21 7.8v8.4A4.8 4.8 0 0 1 16.2 21H7.8A4.8 4.8 0 0 1 3 16.2V7.8A4.8 4.8 0 0 1 7.8 3Zm0 1.8A3 3 0 0 0 4.8 7.8v8.4a3 3 0 0 0 3 3h8.4a3 3 0 0 0 3-3V7.8a3 3 0 0 0-3-3H7.8Zm8.9 1.3a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z" },
      { name: "Facebook", href: "https://www.facebook.com/Imancleaningservicellc/", bg: "#1877f2", fg: "#fff",
        path: "M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.6 1.6-1.6H16V4.8c-.2 0-.9-.1-1.8-.1-2.7 0-4.3 1.6-4.3 4.5V11H7.5v3h2.4v7h3.6Z" },
      { name: "YouTube", href: "https://www.youtube.com/@ImanCleaningServiceLLC", bg: "#ff0000", fg: "#fff",
        path: "M21.6 7.2a2.9 2.9 0 0 0-2-2A34.6 34.6 0 0 0 12 4.8a34.6 34.6 0 0 0-7.6.4 2.9 2.9 0 0 0-2 2A31 31 0 0 0 2 12a31 31 0 0 0 .4 4.8 2.9 2.9 0 0 0 2 2 34.6 34.6 0 0 0 7.6.4 34.6 34.6 0 0 0 7.6-.4 2.9 2.9 0 0 0 2-2A31 31 0 0 0 22 12a31 31 0 0 0-.4-4.8ZM10 15.5v-7l6 3.5-6 3.5Z" },
      { name: "TikTok", href: "https://www.tiktok.com/@imancleaningservicellc", bg: "#111", fg: "#fff",
        path: "M14.6 3c.3 2 1.5 3.5 3.4 4.1v2.7a6.7 6.7 0 0 1-3.4-1.1v6.3a5 5 0 1 1-4.1-4.9v2.8a2.2 2.2 0 1 0 1.4 2V3h2.7Z" },
      { name: "Google Business Profile", href: "https://share.google/EAX7wC22J4PyMKcNx", bg: "#fff", fg: "#fff", google: true },
    ];
    const Google = () => (
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.5c-.3 1.4-1.1 2.7-2.4 3.6v3h3.8c2.2-2.1 3.6-5.1 3.6-8.6Z"/>
        <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.8-3.1l-3.8-3c-1 .7-2.3 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.5v3.1A12 12 0 0 0 12 24Z"/>
        <path fill="#FBBC04" d="M5.4 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V6.7H1.5A12 12 0 0 0 0 12c0 1.9.5 3.7 1.5 5.3l3.9-3.1Z"/>
        <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.9 1.1 15.2 0 12 0A12 12 0 0 0 1.5 6.7l3.9 3.1c.9-2.8 3.5-5 6.6-5Z"/>
      </svg>
    );
    return (
      <>
      <footer className="site-footer" aria-label="Website footer">
        <div className="ds-shell">
          <div className="footer-brand">
            <span className="footer-mark" aria-hidden="true" />
            <div><strong>Iman Cleaning Service LLC</strong><span>Residential &amp; commercial cleaning</span></div>
          </div>
          <div className="footer-grid">
            {contacts.map((c) => (
              <div key={c.h} className="footer-cell">
                <span className="footer-ico" aria-hidden="true"><Icon name={c.icon} size={20} stroke="#fff" /></span>
                <h4>{c.h}</h4>
                <p>{c.href ? <a href={c.href}>{c.v}</a> : c.v}</p>
              </div>
            ))}
          </div>
          <div className="footer-location">
            <div className="footer-location-map">
              <iframe
                title="Map showing Iman Cleaning Service LLC in Queens, New York"
                src="https://www.google.com/maps?q=Iman%20Cleaning%20Service%20LLC%2C%20Queens%2C%20NY&output=embed"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
            <div className="footer-location-copy">
              <h4>Our location</h4>
              <address>Queens, New York City, and select Long Island communities</address>
              <a href="https://www.google.com/maps/search/?api=1&query=Iman%20Cleaning%20Service%20LLC%20Queens%20NY"
                target="_blank" rel="noopener noreferrer">View on Google Maps</a>
            </div>
          </div>
          <div className="footer-follow">
            <h4>Follow us for more</h4>
            <div className="social-row">
              {socials.map((s) => (
                <a key={s.name} className={"social-ico" + (s.google ? " is-google" : "")} href={s.href}
                  target="_blank" rel="noopener noreferrer" aria-label={s.name}
                  style={{ background: s.bg, color: s.fg }}>
                  {s.google ? <Google /> : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={s.path} /></svg>
                  )}
                </a>
              ))}
            </div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 Iman Cleaning Service LLC. All rights reserved.</span>
            <nav className="footer-legal" aria-label="Legal">
              <a href="./careers.html">Careers</a>
              <a href="./privacy-policy.html">Privacy Policy</a>
              <a href="./sms-terms.html">SMS Terms</a>
            </nav>
          </div>
        </div>
      </footer>
      </>
    );
  }

  window.ImanChrome = { Icon, Header, Footer };
})();
