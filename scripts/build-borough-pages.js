const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, '_content-boroughs.js'), 'utf8'), sandbox);

const queens = {
  slug: 'queens-cleaning-service', borough: 'Queens',
  title: 'Queens Cleaning Service | Iman Cleaning Service NYC',
  desc: 'Professional house, apartment, deep, moving, office, and commercial cleaning throughout Queens, NY. Fully insured cleaners and clear online pricing.',
  h1: 'Cleaning Service in Queens, NY', kicker: 'Service area · Queens',
  sub: 'Professional cleaning for Queens homes, apartments, offices, and businesses.',
  intro: 'Queens is our home base. We clean studios, apartments, co-ops, family houses, offices, stores, and rental properties across the borough with service planned around each property’s layout and access.',
  intro2: 'From Jamaica and Flushing to Astoria, Forest Hills, Bayside, and the Rockaways, our fully insured team provides one-time and recurring cleaning seven days a week.',
  hoods: 'Jamaica · Flushing · Astoria · Forest Hills · Briarwood · Kew Gardens · Bayside · Sunnyside · Jackson Heights · Long Island City · Ozone Park · The Rockaways',
  services: [
    { slug: 'standard-cleaning', name: 'Standard cleaning', blurb: 'Routine house and apartment cleaning for a consistently comfortable home.' },
    { slug: 'deep-cleaning', name: 'Deep cleaning', blurb: 'A detailed reset for heavier buildup, kitchens, bathrooms, and neglected areas.' },
    { slug: 'move-in-move-out-cleaning', name: 'Move-in / move-out', blurb: 'Empty-home cleaning for leases, closings, handoffs, and new beginnings.' },
    { slug: 'commercial-cleaning', name: 'Commercial cleaning', blurb: 'One-time and recurring cleaning for offices, stores, clinics, and businesses.' }
  ],
  faqs: [
    { q: 'Which Queens neighborhoods do you serve?', a: 'We serve neighborhoods throughout Queens, including Jamaica, Flushing, Astoria, Forest Hills, Briarwood, Kew Gardens, Bayside, Sunnyside, Jackson Heights, Long Island City, and Ozone Park.' },
    { q: 'Do you clean both Queens apartments and houses?', a: 'Yes. We clean studios, apartments, condos, co-ops, townhouses, and single-family or multi-family homes.' },
    { q: 'Can I see my price before booking?', a: 'Yes. Enter your ZIP code and property details to receive personalized pricing before you choose an appointment.' }
  ]
};

const pages = [...sandbox.window.BOROUGHS, queens];
const esc = (value) => String(value).replace(/[&<>\"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

for (const page of pages) {
  const canonical = `https://www.imancleaningservice.com/${page.slug}.html`;
  const schema = {
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.imancleaningservice.com/' },
        { '@type': 'ListItem', position: 2, name: 'Service Areas', item: 'https://www.imancleaningservice.com/areas.html' },
        { '@type': 'ListItem', position: 3, name: `${page.borough} Cleaning Service`, item: canonical }
      ]},
      { '@type': 'Service', name: `${page.borough} Cleaning Service`, url: canonical, description: page.desc,
        serviceType: 'Residential and commercial cleaning', areaServed: { '@type': 'AdministrativeArea', name: `${page.borough}, New York` },
        provider: { '@type': 'CleaningService', '@id': 'https://www.imancleaningservice.com/#business', name: 'Iman Cleaning Service LLC', telephone: '+1-929-232-1930', url: 'https://www.imancleaningservice.com/' }
      },
      { '@type': 'FAQPage', mainEntity: page.faqs.map((faq) => ({ '@type': 'Question', name: faq.q, acceptedAnswer: { '@type': 'Answer', text: faq.a }})) }
    ]
  };
  const services = page.services.map((s) => `<article class="borough-card"><h3>${esc(s.name)}</h3><p>${esc(s.blurb)}</p><a href="./${esc(s.slug)}.html">Explore ${esc(s.name)} →</a></article>`).join('');
  const faqs = page.faqs.map((f, i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  const html = `<!doctype html>
<html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title><meta name="description" content="${esc(page.desc)}"><meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:site_name" content="Iman Cleaning Service LLC"><meta property="og:title" content="${esc(page.title)}"><meta property="og:description" content="${esc(page.desc)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="https://www.imancleaningservice.com/brand-card.png">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(page.title)}"><meta name="twitter:description" content="${esc(page.desc)}">
<link rel="stylesheet" href="./design-system.css"><link rel="stylesheet" href="./site.css?v=20261002-local-seo"><link rel="stylesheet" href="./homepage-footer.css?v=20260929-compact-footer-v2">
<script type="application/ld+json">${json(schema)}</script></head><body><div class="site-scroll">
<header class="site-header"><div class="hdr-inner ds-shell"><a href="./index.html" class="hdr-brand" aria-label="Iman Cleaning Service LLC home"><img class="hdr-mark" src="./assets/iman-logo-icon.png?v=20260727-clean-header-logo" alt="Iman Cleaning Service LLC" width="46" height="46"><span class="hdr-words" aria-hidden="true"><strong>IMAN</strong><small>Cleaning Service LLC</small></span></a><nav class="hdr-nav" aria-label="Primary navigation"><a href="./services-hub.html">Our Services</a><a href="./our-work.html">Our Work</a><a href="./areas.html" aria-current="page">Service Areas</a><a href="./faq.html">FAQs</a><a href="./contact.html">Contact Us</a></nav><div class="hdr-actions"><a class="seo-static-button is-secondary is-small" href="./login.html">Log In</a></div></div></header>
<main><section class="page-hero on-photo" style="--hero-img:url('./assets/nyc-skyline-sunset.png')"><div class="ds-shell page-hero-inner"><span class="ds-kicker">${esc(page.kicker)}</span><h1>${esc(page.h1)}</h1><p class="ds-lead">${esc(page.sub)}</p><div class="page-hero-actions"><a class="seo-static-button is-accent" href="./book-now.html?source=${esc(page.slug)}">Check My Price →</a><a class="seo-static-button is-secondary" href="tel:+19292321930">Call 929-232-1930</a></div><p class="hero-cta-note">Personalized pricing in about two minutes.</p></div></section>
<section class="section"><div class="ds-shell local-intro-grid"><div class="local-intro-copy"><span class="ds-kicker">Local knowledge · professional care</span><h2>Cleaning planned for ${esc(page.borough)} properties</h2><p>${esc(page.intro)}</p><p>${esc(page.intro2)}</p></div><aside class="local-detail-card"><h3>Neighborhoods we serve</h3><p>${esc(page.hoods)}</p><h3>What to expect</h3><p>Fully insured cleaners, professional supplies, personalized pricing, and secure online booking.</p></aside></div></section>
<section class="section section-wash"><div class="ds-shell"><div class="sec-head"><span class="ds-kicker">Services in ${esc(page.borough)}</span><h2>Choose the cleaning service you need</h2></div><div class="borough-grid">${services}</div></div></section>
<section class="section local-faq"><div class="ds-shell faq-wrap"><div class="sec-head"><span class="ds-kicker">Frequently asked questions</span><h2>${esc(page.borough)} cleaning FAQs</h2></div><div class="faq-list">${faqs}</div></div></section>
<section class="final-cta"><div class="ds-shell final-inner"><span class="ds-kicker">Serving ${esc(page.borough)}</span><h2>See your personalized cleaning price.</h2><p>Tell us about your space and receive pricing before choosing an appointment.</p><div class="final-actions"><a class="seo-static-button is-accent" href="./book-now.html?source=${esc(page.slug)}">Check My Price →</a><a class="seo-static-button is-secondary" href="./contact.html">Contact Us</a></div></div></section></main>
<footer class="site-footer" aria-label="Website footer"><div class="ds-shell"><div class="footer-brand"><span class="footer-mark" aria-hidden="true"></span><div><strong>Iman Cleaning Service LLC</strong><span>Residential &amp; commercial cleaning</span></div></div><div class="footer-grid"><div class="footer-cell"><h4>Email us</h4><p><a href="mailto:Info@imancleaningservice.com">Info@imancleaningservice.com</a></p></div><div class="footer-cell"><h4>Service area</h4><p><a href="./areas.html">All five New York City boroughs</a></p></div><div class="footer-cell"><h4>Call us</h4><p><a href="tel:+19292321930">929-232-1930</a></p></div><div class="footer-cell"><h4>Business hours</h4><p>Open 24 hours · 7 days a week</p></div></div><div class="footer-bottom"><span>© 2026 Iman Cleaning Service LLC. All rights reserved.</span><nav class="footer-legal" aria-label="Legal"><a href="./privacy-policy.html">Privacy Policy</a><a href="./sms-terms.html">SMS Terms</a></nav></div></div></footer>
</div><script defer src="./site-footer.js?v=20260827-unified-footer"></script><script defer src="./site-reviews.js?v=20260911-trusted-title"></script></body></html>`;
  fs.writeFileSync(path.join(root, `${page.slug}.html`), html);
}
