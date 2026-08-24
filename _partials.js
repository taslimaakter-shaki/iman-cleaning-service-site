/* Iman Cleaning production site — shared page partials used by the build scripts.
   Evaluated inside run_script; defines window.P. */
window.P = (() => {
  const BASE = "https://www.imancleaningservice.com/";
  const PHONE = "929-803-4053", TEL = "tel:9298034053";

  const NAV = [
    ["services.html", "Our Services"],
    ["why-us.html", "Why us"],
    ["areas.html", "Service areas"],
    ["careers.html", "Careers"],
    ["faq.html", "FAQs"],
    ["contact.html", "Contact us"],
  ];

  const FOOTER_LINKS = [
    ["index.html", "Home"], ["services.html", "All services"],
    ["standard-cleaning.html", "Standard cleaning"], ["deep-cleaning.html", "Deep cleaning"],
    ["move-in-move-out-cleaning.html", "Move-in / move-out"], ["airbnb-cleaning.html", "Airbnb turnover"],
    ["details-cleaning.html", "Detailed cleaning"], ["extreme-cleaning.html", "Extreme cleaning"],
    ["organization-services.html", "Organization"], ["office-cleaning.html", "Office cleaning"],
    ["retail-store-cleaning.html", "Retail cleaning"], ["restaurant-cleaning.html", "Restaurant cleaning"],
    ["medical-clinic-cleaning.html", "Medical & clinic"], ["post-construction-cleaning.html", "Post-construction"],
    ["janitorial-recurring-cleaning.html", "Janitorial"],
    ["areas.html", "Service areas"], ["why-us.html", "Why us"], ["faq.html", "FAQs"],
    ["quote.html", "Free estimate"], ["contact.html", "Contact"],
  ];

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function head({ title, desc, file, ldBlocks = [] }) {
    const url = BASE + (file === "index.html" ? "" : file);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#0b6474">
<meta name="author" content="Iman Cleaning Service LLC">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Iman Cleaning Service LLC">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${BASE}assets/brand-card.png">
<meta property="og:image:alt" content="Iman Cleaning Service LLC — NYC residential &amp; commercial cleaning">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${BASE}assets/brand-card.png">
<link rel="icon" href="./assets/iman-logo-icon.png">
<link rel="stylesheet" href="./site.css">
${ldBlocks.map((o) => `<script type="application/ld+json">\n${JSON.stringify(o, null, 1)}\n</script>`).join("\n")}
</head>`;
  }

  function header(activeFile) {
    return `<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="shell hdr-inner">
    <a href="./index.html" class="hdr-brand">
      <img src="./assets/iman-logo-icon.png" alt="Iman Cleaning Service LLC logo" width="46" height="46">
      <span class="hdr-words"><strong>IMAN</strong><small>Cleaning Service LLC</small></span>
    </a>
    <nav class="hdr-nav" aria-label="Main">
      ${NAV.map(([f, l]) => `<a href="./${f}"${f === activeFile ? ' aria-current="page"' : ""}>${l}</a>`).join("\n      ")}
    </nav>
    <div class="hdr-actions">
      <a class="hdr-action primary" href="./login.html" aria-label="Log in to your customer account">Log In</a>
    </div>
  </div>
</header>`;
  }

  function crumbs(items) {
    // items: [[href|null, label], ...] — last item is current page
    return `<nav aria-label="Breadcrumb" class="shell crumbs">
  <ol>
    ${items.map(([h, l], i) => h
      ? `<li><a href="./${h}">${esc(l)}</a> ›</li>`
      : `<li aria-current="page">${esc(l)}</li>`).join("\n    ")}
  </ol>
</nav>`;
  }

  function crumbsLd(items, file) {
    return {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": items.map(([h, l], i) => {
        const o = { "@type": "ListItem", "position": i + 1, "name": l };
        if (h) o.item = BASE + (h === "index.html" ? "" : h);
        return o;
      }),
    };
  }

  function faqHtml(faqs, headKicker, headH) {
    return `<section class="shell section" style="max-width:860px" aria-labelledby="faq-h">
    <span class="kicker">${esc(headKicker)}</span>
    <h2 class="section-head-h" id="faq-h" style="max-width:22ch;margin-top:8px;font-size:clamp(1.8rem,3.2vw,2.6rem)">${esc(headH)}</h2>
    <div class="faq">
      ${faqs.map((f, i) => `<details${i === 0 ? " open" : ""}>
        <summary>${esc(f.q)}</summary>
        <p>${esc(f.a)}</p>
      </details>`).join("\n      ")}
    </div>
  </section>`;
  }

  function faqLd(faqs) {
    return {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": faqs.map((f) => ({
        "@type": "Question", "name": f.q,
        "acceptedAnswer": { "@type": "Answer", "text": f.a },
      })),
    };
  }

  const GUARANTEE = `<div class="shell"><div class="guarantee" role="list" aria-label="Service guarantees">
    <span role="listitem">Fully insured &amp; background-checked</span>
    <span role="listitem">Exact price before you book</span>
    <span role="listitem">Supplies &amp; equipment included</span>
    <span role="listitem">Satisfaction guarantee — we make it right</span>
  </div></div>`;

  function ctaPanel({ kicker, h, p, btn, btnHref = "quote.html" }) {
    return `<section class="shell" aria-label="Get a quote">
    <div class="cta-panel">
      <span class="kicker">${esc(kicker)}</span>
      <h2>${esc(h)}</h2>
      <p>${esc(p)}</p>
      <div class="hero-actions">
        <a class="btn btn-accent btn-lg" href="./${btnHref}" data-conv="quote">${esc(btn)}</a>
        <a class="btn btn-ghost-light btn-lg" href="${TEL}" data-conv="call">Call us ${PHONE}</a>
      </div>
    </div>
  </section>`;
  }

  function footer() {
    return `<footer class="site-footer">
  <div class="shell">
    <div class="footer-brand">
      <img src="./assets/iman-logo-icon.png" alt="" width="50" height="50">
      <div><strong>Iman Cleaning Service LLC</strong><span>Residential &amp; commercial cleaning</span></div>
    </div>
    <div class="footer-grid">
      <p><strong>Call us</strong><br><a href="${TEL}">929-803-4053</a></p>
      <p><strong>Email</strong><br><a href="mailto:Info@imancleaningservice.com">Info@imancleaningservice.com</a></p>
      <p><strong>Service area</strong><br>All five NYC boroughs and Long Island — Queens, Brooklyn, Manhattan, Staten Island, and the Bronx</p>
      <p><strong>Hours</strong><br>Open 24 hours · 7 days a week</p>
    </div>
    <nav class="footer-nav" aria-label="All pages">
      ${FOOTER_LINKS.map(([f, l]) => `<a href="./${f}">${l}</a>`).join("\n      ")}
    </nav>
    <nav class="footer-nav" aria-label="Social">
      <a href="https://www.instagram.com/imancleaningservicellc/" rel="noopener">Instagram</a>
      <a href="https://www.facebook.com/Imancleaningservicellc/" rel="noopener">Facebook</a>
      <a href="https://www.youtube.com/@ImanCleaningServiceLLC" rel="noopener">YouTube</a>
      <a href="https://www.tiktok.com/@imancleaningservicellc" rel="noopener">TikTok</a>
    </nav>
    <p class="footer-bottom">© 2026 Iman Cleaning Service LLC. All rights reserved.</p>
  </div>
</footer>
<nav class="mobile-bar" aria-label="Quick contact">
  <a class="mb-call" href="${TEL}" data-conv="call">Call</a>
  <a class="mb-quote" href="./quote.html" data-conv="quote">Free estimate</a>
</nav>
<script>
/* Analytics & conversion hooks. Paste your GA4 id below to activate. */
window.dataLayer = window.dataLayer || [];
function gtag(){ dataLayer.push(arguments); }
var GA4_ID = ""; /* e.g. "G-XXXXXXXXXX" */
if (GA4_ID) {
  var s = document.createElement("script"); s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA4_ID;
  document.head.appendChild(s);
  gtag("js", new Date()); gtag("config", GA4_ID);
}
document.addEventListener("click", function (e) {
  var a = e.target.closest("[data-conv]");
  if (a) gtag("event", "conversion_click", { conv_type: a.getAttribute("data-conv"), page_path: location.pathname });
});
</script>
</body>
</html>`;
  }

  function heroImg(img, imgW, imgH, alt) {
    const has768 = ["home-hero-bedroom","contact-kitchen-hero","nyc-skyline-sunset","nyc-skyline","commercial-restaurant","home-hero-clean-living-room","quote-retail-hero","home-hero-team"].includes(img);
    const srcset = has768 ? ` srcset="./assets/${img}-768w.jpg 768w, ./assets/${img}.jpg ${imgW}w" sizes="100vw"` : "";
    return `<img src="./assets/${img}.jpg"${srcset} width="${imgW}" height="${imgH}" alt="${esc(alt)}" fetchpriority="high" decoding="async">`;
  }

  return { BASE, PHONE, TEL, esc, head, header, crumbs, crumbsLd, faqHtml, faqLd, GUARANTEE, ctaPanel, footer, heroImg };
})();
