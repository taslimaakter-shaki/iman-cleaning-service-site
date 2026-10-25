import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const phone = "929-803-4053";
const reviews = "https://share.google/EAX7wC22J4PyMKcNx";

const pages = [
  {
    file: "cleaning-services-nyc.html",
    title: "Cleaning Services in Queens & NYC | Iman Cleaning",
    description: "House, apartment, deep, office, and commercial cleaning services in Queens and across New York City. Check availability and book online.",
    h1: "Cleaning Services in Queens & NYC",
    lead: "Reliable residential and commercial cleaning for homes, apartments, rentals, offices, and businesses in Queens and throughout New York City.",
    kicker: "New York City cleaning service",
    introTitle: "Cleaning designed for New York City spaces",
    intro: [
      "Iman Cleaning Service LLC provides standard, deep, move-in, move-out, apartment, office, and commercial cleaning. Queens is our home base, with appointments also available across New York City subject to schedule and ZIP-code confirmation.",
      "New York properties have different access rules, layouts, parking conditions, and cleaning priorities. Share the property type, borough, rooms, condition, elevator or stair access, and priority tasks when booking so the team can prepare for your service."
    ],
    detailTitle: "New York City areas we serve",
    neighborhoods: ["Queens", "Manhattan", "Brooklyn", "The Bronx", "Staten Island", "Jamaica", "Flushing", "Forest Hills"],
    zips: ["10001", "10301", "10451", "11101", "11201", "11354", "11432", "11435"],
    localNote: "Appointments are available throughout New York City subject to schedule, service type, and ZIP-code confirmation.",
    landmarks: "Our service area includes homes and businesses across the five boroughs, with a strong local focus on Queens communities such as Jamaica, Flushing, Briarwood, Kew Gardens, and Forest Hills.",
    source: "cleaning-services-nyc",
    faq: [
      ["What cleaning services are available in Queens and NYC?", "Services include standard cleaning, deep cleaning, apartment cleaning, move-in and move-out cleaning, office and commercial cleaning, detailed cleaning, organization, and custom cleaning projects."],
      ["Do you clean both homes and businesses?", "Yes. We clean houses, apartments, condos, co-ops, rentals, offices, stores, and other commercial properties."],
      ["Do you serve all five New York City boroughs?", "Appointments may be available in Queens, Manhattan, Brooklyn, The Bronx, and Staten Island, subject to the service requested, schedule, and ZIP-code confirmation."],
      ["Do you bring cleaning supplies?", "Yes. The team brings the professional products and equipment needed for the confirmed service."],
      ["How do I book a cleaning service in NYC?", "Use Book Online to check your ZIP code and see the available service and price, or call 929-803-4053 for help."]
    ]
  },
  {
    file: "queens-cleaning-service.html",
    title: "Cleaning Services in Queens, NY | Homes, Apartments & Offices",
    description: "Professional cleaning services in Queens, NY for houses, apartments, offices, and businesses. Standard, deep, move-in, move-out, and commercial cleaning.",
    h1: "Cleaning Services in Queens, NY",
    lead: "Professional cleaning for Queens houses, apartments, condos, co-ops, offices, and businesses—with clear options for routine, deep, moving, and commercial service.",
    kicker: "Queens cleaning service",
    introTitle: "Reliable cleaning across Queens",
    intro: [
      "Iman Cleaning Service LLC provides residential and commercial cleaning throughout Queens. Customers can choose routine house and apartment cleaning, a more thorough deep clean, move-in or move-out cleaning, office cleaning, or a custom service for a larger project.",
      "Queens properties range from apartment towers and co-ops to detached houses, multi-family homes, offices, and storefronts. During booking, share your property type, access details, rooms, condition, and priorities so the cleaning team can prepare for the service."
    ],
    detailTitle: "Queens neighborhoods we serve",
    neighborhoods: ["Jamaica", "Flushing", "Forest Hills", "Briarwood", "Kew Gardens", "Fresh Meadows", "Astoria", "Jackson Heights"],
    zips: ["11101", "11354", "11355", "11365", "11375", "11415", "11432", "11435"],
    localNote: "Service is available throughout Queens subject to schedule and ZIP-code confirmation.",
    landmarks: "Local service reaches homes and businesses near Downtown Jamaica, Flushing Meadows Corona Park, Austin Street in Forest Hills, and other Queens community centers.",
    source: "queens-cleaning-service",
    faq: [
      ["What cleaning services are available in Queens?", "Services include standard cleaning, deep cleaning, move-in and move-out cleaning, apartment cleaning, office and commercial cleaning, detailed cleaning, organization, and custom cleaning projects."],
      ["How much does house cleaning cost in Queens?", "Standard cleaning starts at $200 and deep cleaning starts at $300. Your exact total depends on the property, condition, selected service, and add-ons shown during booking."],
      ["Do you clean Queens apartments and co-ops?", "Yes. We clean studios, apartments, condos, co-ops, walk-ups, elevator buildings, and multi-family homes throughout Queens."],
      ["Do you bring cleaning supplies?", "Yes. The team brings the professional products and equipment needed for the confirmed service."],
      ["How do I book cleaning in Queens?", "Use the Book Online button to check your ZIP code and see the available service and price, or call 929-803-4053."]
    ]
  },
  {
    file: "house-cleaning-jamaica-ny.html",
    title: "Cleaning Service in Jamaica, Queens, NY",
    description: "House and apartment cleaning in Jamaica, Queens, NY. Book standard, deep, move-in, move-out, and office cleaning with clear online pricing.",
    h1: "Cleaning Service in Jamaica, Queens, NY",
    lead: "Reliable cleaning for houses, apartments, condos, co-ops, multi-family properties, offices, and small businesses in Jamaica, Queens.",
    kicker: "Jamaica, Queens",
    introTitle: "Cleaning built around Jamaica properties",
    intro: [
      "Jamaica includes apartment buildings, attached and detached houses, condos, co-ops, multi-family properties, offices, and active commercial corridors. We provide routine cleaning, deep cleaning, moving cleaning, and business cleaning based on the space and current condition.",
      "Share elevator or stair access, parking or building instructions, pets, bedrooms, bathrooms, and the areas that need priority attention. Those details help us prepare the right service before the appointment."
    ],
    detailTitle: "Jamaica service area",
    neighborhoods: ["Jamaica", "Jamaica Estates", "Briarwood", "Hollis", "South Jamaica", "Richmond Hill", "Kew Gardens"],
    zips: ["11432", "11433", "11434", "11435", "11436"],
    localNote: "Appointments are available throughout Jamaica and nearby Queens neighborhoods, subject to schedule and ZIP-code confirmation.",
    landmarks: "We serve homes and businesses near Downtown Jamaica, York College, Jamaica Center for Arts and Learning, and surrounding residential communities.",
    source: "house-cleaning-jamaica",
    faq: [
      ["What cleaning services are available in Jamaica, Queens?", "Available options include standard house cleaning, apartment cleaning, deep cleaning, move-in and move-out cleaning, office cleaning, detailed cleaning, and organization support."],
      ["How much does cleaning cost in Jamaica, NY?", "Standard cleaning starts at $200 and deep cleaning starts at $300. The booking form calculates the available price from your property details and selected service."],
      ["Can you clean an apartment or multi-family home in Jamaica?", "Yes. We clean apartments, condos, co-ops, walk-ups, elevator buildings, and multi-family homes."],
      ["Are cleaning supplies included?", "Yes. We bring the professional products and equipment needed for the confirmed service."],
      ["How do I schedule Jamaica cleaning?", "Book online to check your ZIP code and available price, or call 929-803-4053 for help."]
    ]
  },
  {
    file: "house-cleaning-flushing-ny.html",
    title: "Home, Apartment & Move-In Cleaning in Flushing, NY",
    description: "Professional home, apartment, deep, move-in, and move-out cleaning in Flushing, Queens, NY. Check your ZIP code and book online.",
    h1: "Home & Apartment Cleaning in Flushing, NY",
    lead: "Professional standard, deep, move-in, and move-out cleaning for Flushing homes, apartments, condos, co-ops, and multi-family properties.",
    kicker: "Flushing, Queens",
    introTitle: "Cleaning for Flushing homes and apartments",
    intro: [
      "Flushing has high-rise apartments, co-ops, condos, walk-ups, detached houses, and multi-family properties. We tailor the cleaning level to the space and condition, whether you need regular upkeep, a first-time deep clean, or an empty-home moving clean.",
      "When booking, include building access, elevator or stair details, parking instructions, pets, and your highest-priority rooms. This helps the team arrive prepared for the property."
    ],
    detailTitle: "Flushing service area",
    neighborhoods: ["Downtown Flushing", "Murray Hill", "Queensboro Hill", "East Flushing", "College Point", "Whitestone", "Fresh Meadows"],
    zips: ["11354", "11355", "11358", "11365", "11367"],
    localNote: "Appointments are available in Flushing and nearby Queens neighborhoods, subject to schedule and ZIP-code confirmation.",
    landmarks: "Local service includes homes and businesses around Downtown Flushing, Main Street, and communities near Flushing Meadows Corona Park.",
    source: "house-cleaning-flushing",
    faq: [
      ["What cleaning services are available in Flushing?", "Services include standard home and apartment cleaning, deep cleaning, move-in and move-out cleaning, detailed cleaning, and organization support."],
      ["Do you clean Flushing co-ops and high-rise apartments?", "Yes. We clean co-ops, condos, high-rise apartments, elevator buildings, walk-ups, and multi-family homes."],
      ["Can I book move-in or move-out cleaning in Flushing?", "Yes. Moving cleaning is available for empty homes and includes kitchen cleaning with the refrigerator, oven, and inside empty cabinets."],
      ["How much does cleaning cost in Flushing?", "Standard cleaning starts at $200 and deep cleaning starts at $300. Your available price is calculated from the property and service details entered during booking."],
      ["How do I book a Flushing cleaning appointment?", "Use Book Online to check your ZIP code and see the available price, or call 929-803-4053."]
    ]
  }
];

const esc = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const json = (value) => JSON.stringify(value, null, 2).replaceAll("</", "<\\/");

function header() {
  return `<header class="site-header on-dark is-homepage">
  <div class="hdr-inner ds-shell">
    <a href="./index.html" class="hdr-brand" aria-label="Iman Cleaning Service LLC home">
      <img class="hdr-mark" src="./assets/iman-logo-icon.png?v=20260727-clean-header-logo" alt="Iman Cleaning Service LLC" width="46" height="46" decoding="async">
      <span class="hdr-words" aria-hidden="true"><strong>IMAN</strong><small>Cleaning Service LLC</small></span>
    </a>
    <nav class="hdr-nav" aria-label="Primary navigation">
      <a href="./services-hub.html">Services</a><a href="./why-us.html">Why Iman</a><a href="./areas.html" aria-current="page">Service Areas</a><a href="./careers.html">Careers</a><a href="./faq.html">FAQs</a><a href="./contact.html">Contact</a>
    </nav>
    <div class="hdr-actions">
      <a class="seo-static-button is-secondary is-small" href="./login.html" aria-label="Log in to your customer account">Log In</a>
      <a class="seo-static-button is-accent is-small" href="./book-now.html" data-conv="book">Book Online</a>
    </div>
  </div>
</header>`;
}

function serviceCards() {
  const cards = [
    ["home-residential-cleaning-card.webp", "Professionally cleaned residential living room", "Homes & apartments", "Residential Cleaning", [
      ["Standard Cleaning", "Starts at $200", "standard-cleaning.html"],
      ["Deep Cleaning", "Starts at $300", "deep-cleaning.html"],
      ["Move-In / Move-Out Cleaning", "Starts at $300", "move-in-move-out-cleaning.html"]
    ]],
    ["home-commercial-cleaning-card.webp", "Professionally cleaned commercial interior", "Offices & businesses", "Commercial Cleaning", [
      ["Office Cleaning", "Custom quote", "office-cleaning.html"],
      ["Retail Store Cleaning", "Custom quote", "retail-store-cleaning.html"],
      ["Janitorial Cleaning", "Custom quote", "janitorial-recurring-cleaning.html"]
    ]],
    ["home-window-cleaning-card.webp", "Professional window cleaning with a squeegee", "Homes & businesses", "Window Cleaning", [
      ["Interior & Exterior Glass", "Custom quote", "quote.html?service=window-cleaning"],
      ["Frames, Sills & Tracks", "Custom quote", "quote.html?service=window-cleaning"],
      ["Homes & Storefronts", "Custom quote", "quote.html?service=window-cleaning"]
    ]]
  ];
  return cards.map(([img, alt, kicker, title, links]) => `<details class="service-category-accordion seo-service-category">
    <summary class="service-category-toggle"><img src="./assets/${img}" alt="${alt}" width="900" height="600" loading="lazy" decoding="async"><span class="service-category-shade" aria-hidden="true"></span><span class="service-category-toggle-copy"><span class="service-category-kicker">${kicker}</span><strong>${title}</strong><span class="service-category-action">View services &amp; pricing</span></span><span class="service-category-symbol" aria-hidden="true">+</span></summary>
    <div class="service-category-panel"><ul>${links.map(([name, price, href]) => `<li><a href="./${href}"><span><strong>${name}</strong><small>${price}</small></span><span aria-hidden="true">→</span></a></li>`).join("")}</ul></div>
  </details>`).join("");
}

function footer() {
  return `<footer class="site-footer" aria-label="Website footer"><div class="ds-shell">
    <div class="footer-brand"><span class="footer-mark" aria-hidden="true"></span><div><strong>Iman Cleaning Service LLC</strong><span>Residential &amp; commercial cleaning</span></div></div>
    <div class="footer-grid">
      <div class="footer-cell"><span class="footer-ico" aria-hidden="true">✉</span><h4>Email us</h4><p><a href="mailto:Info@imancleaningservice.com">Info@imancleaningservice.com</a></p></div>
      <div class="footer-cell"><span class="footer-ico" aria-hidden="true">⌖</span><h4>Service area</h4><p><a href="./areas.html">Queens, Brooklyn, Manhattan, Staten Island, and the Bronx</a></p></div>
      <div class="footer-cell"><span class="footer-ico" aria-hidden="true">☎</span><h4>Call us</h4><p><a href="tel:+19298034053">${phone}</a></p></div>
      <div class="footer-cell"><span class="footer-ico" aria-hidden="true">◷</span><h4>Business hours</h4><p>8 AM–8 PM · 7 days</p></div>
    </div>
    <div class="footer-location"><div class="footer-location-map"><iframe title="Map showing Iman Cleaning Service LLC in Queens, New York" src="https://www.google.com/maps?q=Iman%20Cleaning%20Service%20LLC%2C%20Queens%2C%20NY&amp;output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div><div class="footer-location-copy"><h4>Our location</h4><address>Queens, Brooklyn, Manhattan, Staten Island, and the Bronx</address><a href="https://www.google.com/maps/search/?api=1&amp;query=Iman%20Cleaning%20Service%20LLC%20Queens%20NY" target="_blank" rel="noopener noreferrer">View on Google Maps</a></div></div>
    <div class="footer-follow"><h4>Follow us for more</h4><nav class="seo-static-socials" aria-label="Social media"><a href="https://www.instagram.com/imancleaningservicellc/" target="_blank" rel="noopener noreferrer">Instagram</a><a href="https://www.facebook.com/Imancleaningservicellc/" target="_blank" rel="noopener noreferrer">Facebook</a><a href="https://www.youtube.com/@ImanCleaningServiceLLC" target="_blank" rel="noopener noreferrer">YouTube</a><a href="https://www.tiktok.com/@imancleaningservicellc" target="_blank" rel="noopener noreferrer">TikTok</a><a href="${reviews}" target="_blank" rel="noopener noreferrer">Google</a></nav></div>
    <div class="footer-bottom"><span>© 2026 Iman Cleaning Service LLC. All rights reserved.</span><nav class="footer-legal" aria-label="Legal"><a href="./careers.html">Careers</a><a href="./privacy-policy.html">Privacy Policy</a><a href="./sms-terms.html">SMS Terms</a></nav></div>
  </div></footer>`;
}

function schema(page) {
  const url = `https://www.imancleaningservice.com/${page.file}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://www.imancleaningservice.com/" },
          { "@type": "ListItem", position: 2, name: "Areas We Serve", item: "https://www.imancleaningservice.com/areas.html" },
          { "@type": "ListItem", position: 3, name: page.h1, item: url }
        ]
      },
      {
        "@type": "Service",
        name: page.h1,
        url,
        description: page.description,
        areaServed: { "@type": "Place", name: page.kicker },
        provider: {
          "@type": "CleaningService",
          "@id": "https://www.imancleaningservice.com/#business",
          name: "Iman Cleaning Service LLC",
          url: "https://www.imancleaningservice.com/",
          telephone: "+1-929-803-4053",
          priceRange: "$$",
          areaServed: ["Queens", "New York City"]
        }
      },
      {
        "@type": "FAQPage",
        mainEntity: page.faq.map(([name, text]) => ({
          "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text }
        }))
      }
    ]
  };
}

function render(page) {
  const url = `https://www.imancleaningservice.com/${page.file}`;
  return `<!doctype html>
<html lang="en-US"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}"><meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Iman Cleaning Service LLC"><meta property="og:title" content="${esc(page.title)}"><meta property="og:description" content="${esc(page.description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="https://www.imancleaningservice.com/assets/home-hero-video-poster.jpg">
<link rel="stylesheet" href="./design-system.css"><link rel="stylesheet" href="./site.css?v=20260730-local-seo"><link rel="stylesheet" href="./homepage-footer.css?v=20260730-service-area">
<script type="application/ld+json">${json(schema(page))}</script>
</head><body><div class="site-scroll">
${header()}
<main>
  <section class="page-hero on-photo home-hero-photo">
    <picture class="home-hero-poster" aria-hidden="true"><source type="image/avif" srcset="./assets/home-hero-video-poster-768w.avif 768w, ./assets/home-hero-video-poster.avif 1280w" sizes="100vw"><img src="./assets/home-hero-video-poster.jpg" alt="" width="1280" height="720" fetchpriority="high" decoding="async"></picture>
    <div class="ds-shell page-hero-inner"><span class="seo-static-badge">✓ Fully Insured • Background-Checked Cleaners</span><p class="ds-kicker">${esc(page.kicker)}</p><h1>${esc(page.h1)}</h1><p class="ds-lead">${esc(page.lead)}</p><div class="page-hero-actions"><a class="seo-static-button is-accent" href="tel:+19298034053" data-conv="call">Call Us</a><a class="seo-static-button is-secondary" href="./book-now.html?source=${page.source}" data-conv="book">Get an Instant Quote</a></div><div class="hero-trust-line"><a href="${reviews}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">★★★★★</span> Read Our Google Reviews</a><span class="hero-trust-divider" aria-hidden="true">•</span><span>Open Daily, 8 AM–8 PM</span></div></div>
  </section>
  <section class="section"><div class="ds-shell local-intro-grid"><div class="local-intro-copy"><span class="ds-kicker">Local cleaning service</span><h2>${esc(page.introTitle)}</h2>${page.intro.map((p) => `<p>${esc(p)}</p>`).join("")}</div><aside class="local-detail-card"><h3>${esc(page.detailTitle)}</h3><p>${esc(page.localNote)}</p><ul class="local-chip-list">${page.neighborhoods.map((n) => `<li>${esc(n)}</li>`).join("")}</ul><h3>Common ZIP codes</h3><p>${page.zips.join(", ")}</p><p>${esc(page.landmarks)}</p></aside></div></section>
  <section class="section" id="services"><div class="ds-shell"><div class="sec-head"><span class="ds-kicker">Start with the right service</span><h2>Choose the cleaning you need today</h2></div><div class="two-cards">${serviceCards()}</div></div></section>
  <section class="areas-band"><div class="ds-shell areas-band-inner"><h2>Explore Queens cleaning areas</h2><ul class="areas-links"><li><a href="./queens-cleaning-service.html">Queens</a></li><li><a href="./house-cleaning-jamaica-ny.html">Jamaica</a></li><li><a href="./house-cleaning-flushing-ny.html">Flushing</a></li><li><a href="./apartment-cleaning-queens.html">Queens apartments</a></li></ul><a class="areas-learn-more" href="./areas.html">View All Areas <span aria-hidden="true">→</span></a></div></section>
  <section class="why-band"><div class="ds-shell"><header class="why-band-head"><p class="ds-kicker">Why customers choose Iman</p><h2>Cleaning you can book with confidence.</h2></header><div class="why-band-grid"><article class="why-band-card"><span class="why-band-ico">✓</span><h3>Fully Insured Team</h3><p>Reliable cleaning professionals who treat your property with care.</p></article><article class="why-band-card"><span class="why-band-ico">$</span><h3>Clear Upfront Pricing</h3><p>Know the available price before service begins.</p></article><article class="why-band-card"><span class="why-band-ico">✦</span><h3>Supplies Included</h3><p>We bring the professional products and equipment needed.</p></article><article class="why-band-card"><span class="why-band-ico">♡</span><h3>Satisfaction Promise</h3><p>Tell us before we leave if something needs attention.</p></article></div></div></section>
  <section class="review-band"><div class="ds-shell review-inner"><div class="review-stars" aria-label="5 out of 5 stars"><span aria-hidden="true">★★★★★</span></div><blockquote>“They did a great job cleaning my house. They showed up on time, were friendly, and paid attention to the little things.”</blockquote><cite><span>Mahin Muhtasimul</span><span aria-hidden="true"> · </span><a href="${reviews}" target="_blank" rel="noopener noreferrer">Read Our Google Reviews</a></cite></div></section>
  <section class="section local-faq"><div class="ds-shell faq-wrap"><div class="sec-head"><span class="ds-kicker">Frequently asked questions</span><h2>${esc(page.kicker)} cleaning FAQs</h2></div><div class="faq-list">${page.faq.map(([q, a], i) => `<details${i === 0 ? " open" : ""}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div></div></section>
  <section class="final-cta"><div class="ds-shell final-inner"><span class="ds-kicker">Ready to book?</span><h2>See your cleaning price online.</h2><p>Enter your ZIP code and property details to check service availability and review your price.</p><div class="final-actions"><a class="seo-static-button is-accent" href="./book-now.html?source=${page.source}" data-conv="book">Book Online →</a><a class="seo-static-button is-secondary" href="tel:+19298034053" data-conv="call">☎ Call ${phone}</a></div></div></section>
</main>
${footer()}
</div><script>document.addEventListener("click",function(e){var a=e.target.closest("[data-conv]");if(a&&typeof window.gtag==="function")window.gtag("event","conversion_click",{conv_type:a.getAttribute("data-conv"),page_path:window.location.pathname})})</script></body></html>`;
}

for (const page of pages) fs.writeFileSync(path.join(root, page.file), render(page));
