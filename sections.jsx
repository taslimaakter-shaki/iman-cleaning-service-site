/* Iman Cleaning — homepage sections. Composes design-system components from
   the compiled bundle. Exported to window.ImanSite for index.html. */
const { Button, Badge, Card, ServiceCard, ServiceListCard, FeatureTile, FaqItem } =
  window.ImanCleaningDesignSystem_5652ad;
const { Icon, Header, Footer } = window.ImanChrome;
const D = window.IMAN_DATA;

/* ---- Hero -------------------------------------------------------------- */
function Hero() {
  const videoRef = React.useRef(null);
  const [videoEnabled, setVideoEnabled] = React.useState(false);
  const [showVideoPlayButton, setShowVideoPlayButton] = React.useState(false);

  const playHeroVideo = React.useCallback(() => {
    const video = videoRef.current;
    if (!video) return Promise.resolve();

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");

    const attempt = video.play();
    if (!attempt || typeof attempt.then !== "function") {
      setShowVideoPlayButton(false);
      return Promise.resolve();
    }

    return attempt
      .then(() => setShowVideoPlayButton(false))
      .catch(() => setShowVideoPlayButton(true));
  }, []);

  React.useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateVideoPreference = () => {
      const enabled = !reducedMotion.matches;
      setVideoEnabled(enabled);
      if (!enabled) setShowVideoPlayButton(false);
    };
    const addChangeListener = (query) => {
      if (query.addEventListener) query.addEventListener("change", updateVideoPreference);
      else query.addListener(updateVideoPreference);
    };
    const removeChangeListener = (query) => {
      if (query.removeEventListener) query.removeEventListener("change", updateVideoPreference);
      else query.removeListener(updateVideoPreference);
    };

    updateVideoPreference();
    addChangeListener(reducedMotion);
    return () => {
      removeChangeListener(reducedMotion);
    };
  }, []);

  React.useEffect(() => {
    if (!videoEnabled) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    const handleVisibility = () => {
      if (document.hidden) {
        video.pause();
        return;
      }
      playHeroVideo();
    };

    video.addEventListener("canplay", playHeroVideo);
    document.addEventListener("visibilitychange", handleVisibility);
    playHeroVideo();

    return () => {
      video.removeEventListener("canplay", playHeroVideo);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [playHeroVideo, videoEnabled]);

  return (
    <section className="page-hero on-photo home-hero-photo" id="top">
      <picture className="home-hero-poster" aria-hidden="true">
        <source type="image/avif"
          srcSet="./assets/home-hero-video-poster-768w.avif 768w, ./assets/home-hero-video-poster.avif 1280w"
          sizes="100vw" />
        <img src="./assets/home-hero-video-poster.jpg" alt="" width="1280" height="720"
          fetchPriority="high" decoding="async" />
      </picture>
      {videoEnabled && (
        <video
          ref={videoRef}
          className="home-hero-video"
          width="1280"
          height="720"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="./assets/home-hero-video-poster.jpg"
          aria-hidden="true"
          tabIndex="-1"
          src="./assets/home-hero-video-fast.mp4"
        />
      )}
      {showVideoPlayButton && (
        <button
          className="home-hero-video-play"
          type="button"
          onClick={playHeroVideo}
          aria-label="Play homepage background video"
        >
          <span aria-hidden="true" />
          Play video
        </button>
      )}
      <div className="ds-shell page-hero-inner">
        <Badge tone="leaf" check size="sm">Fully Insured • Background-Checked Cleaners</Badge>
        <h1>NYC’s #1 Choice for Reliable Cleaning</h1>
        <p className="ds-lead">
          Residential and commercial cleaning with transparent pricing, flexible scheduling, and easy online booking.
        </p>
        <div className="page-hero-actions">
          <Button href="./book-now.html" variant="accent" size="lg"
            aria-label="Get my instant cleaning quote" data-conv="book"
            iconRight={<Icon name="arrow" size={18} />}>Get My Instant Quote</Button>
        </div>
        <div className="hero-trust-line" aria-label="Reviews and business hours">
          <a href={D.googleReviewsHref} target="_blank" rel="noopener noreferrer"
            aria-label="Read Iman Cleaning Service reviews on Google" data-conv="google_reviews">
            <svg className="hero-google-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.5c-.3 1.4-1.1 2.7-2.4 3.6v3h3.8c2.2-2.1 3.6-5.1 3.6-8.6Z" />
              <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.8-3.1l-3.8-3c-1 .7-2.3 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.5v3.1A12 12 0 0 0 12 24Z" />
              <path fill="#FBBC04" d="M5.4 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V6.7H1.5A12 12 0 0 0 0 12c0 1.9.5 3.7 1.5 5.3l3.9-3.1Z" />
              <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.9 1.1 15.2 0 12 0A12 12 0 0 0 1.5 6.7l3.9 3.1c.9-2.8 3.5-5 6.6-5Z" />
            </svg>
            Read Our Reviews
          </a>
          <span className="hero-trust-divider" aria-hidden="true">•</span>
          <span>Open 24 hours · 7 days a week</span>
        </div>
      </div>
    </section>
  );
}

/* ---- Proof strip ------------------------------------------------------- */
function ProofStrip() {
  const items = [
    ["Fully insured", "Homes & businesses"],
    ["All 5 boroughs", "Across New York City"],
    ["Clear quote first", "Reviewed before booking"],
    ["Open daily", "8:00 AM – 8:00 PM"],
  ];
  return (
    <section className="proof">
      <div className="ds-shell proof-grid">
        {items.map(([t, s], i) => (
          <div key={i} className="proof-item">
            <strong>{t}</strong>
            <span>{s}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---- Services ---------------------------------------------------------- */
function ServiceCategoryAccordion({ category }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const panelId = `service-category-${category.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const displayPrice = (price) => {
    if (!price) return "Custom quote";
    return /^\d|^\$/.test(String(price).trim()) ? `Starts at ${price}` : price;
  };

  return (
    <article className={`service-category-accordion${isOpen ? " is-open" : ""}`}>
      <button
        className="service-category-toggle"
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <img
          src={category.image}
          alt={category.imageAlt}
          width={category.imageWidth}
          height={category.imageHeight}
          loading="lazy"
          decoding="async"
        />
        <span className="service-category-shade" aria-hidden="true" />
        <span className="service-category-toggle-copy">
          <span className="service-category-kicker">{category.kicker}</span>
          <strong>{category.title}</strong>
          <span className="service-category-action">
            {isOpen ? "Hide services & pricing" : "View services & pricing"}
          </span>
        </span>
        <span className="service-category-symbol" aria-hidden="true">
          {isOpen ? "−" : "+"}
        </span>
      </button>
      <div className="service-category-panel" id={panelId} hidden={!isOpen}>
        <ul>
          {category.services.map((service) => (
            <li key={service.name}>
              <a href={service.href || "#"}>
                <span>
                  <strong>{service.name}</strong>
                  <small>{displayPrice(service.price)}</small>
                </span>
                <Icon name="arrow" size={18} />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function Services() {
  return (
    <section className="section" id="services">
      <div className="ds-shell">
        <div className="sec-head">
          <span className="ds-kicker">Start with the right service</span>
          <h2>Choose the cleaning you need today</h2>
        </div>
        <div className="two-cards">
          {D.serviceCategories.map((category) => (
            <ServiceCategoryAccordion key={category.title} category={category} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---- How it works (steps on a wash) ------------------------------------ */
function HowItWorks() {
  return (
    <section className="section section-wash" id="how">
      <div className="ds-shell">
        <div className="sec-head sec-head-center">
          <span className="ds-kicker">Less stress before cleaning day</span>
          <h2>How booking works, start to finish</h2>
        </div>
        <ol className="steps">
          {D.steps.map((s, i) => (
            <li key={s.n} className="step">
              <span className="step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              {i < D.steps.length - 1 && <span className="step-line" aria-hidden="true" />}
            </li>
          ))}
        </ol>
        <div className="steps-cta">
          <Button href="./book-now.html" variant="primary" size="lg">Book residential cleaning</Button>
        </div>
      </div>
    </section>
  );
}

/* ---- Why us (split: photo + reasons) ----------------------------------- */
function WhyUs() {
  return (
    <section className="why-band" id="why" aria-labelledby="why-iman-title">
      <div className="ds-shell">
        <header className="why-band-head">
          <p className="ds-kicker">Why customers choose Iman</p>
          <h2 id="why-iman-title">Cleaning you can book with confidence.</h2>
        </header>
        <div className="why-band-grid">
          {D.reasons.map((r) => (
            <article className="why-band-card" key={r.title}>
              <span className="why-band-ico" aria-hidden="true"><Icon name={r.icon} size={24} stroke="var(--leaf-300)" /></span>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </article>
          ))}
        </div>
        <div className="why-band-actions">
          <a className="why-learn-more" href="./why-us.html"
            aria-label="Learn more about why customers choose Iman Cleaning Service">
            Learn More
            <Icon name="arrow" size={18} stroke="currentColor" />
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---- Service areas ----------------------------------------------------- */
function Areas() {
  return (
    <section className="areas-band" id="areas">
      <div className="ds-shell areas-band-inner">
        <h2>Areas We Serve</h2>
        <ul className="areas-links" aria-label="Cleaning service areas">
          {D.serviceAreas.map((area) => (
            <li key={area.name}>
              {area.href ? <a href={area.href}>{area.name}</a> : <span>{area.name}</span>}
            </li>
          ))}
        </ul>
        <a className="areas-learn-more" href="./areas.html"
          aria-label="Learn more about Iman Cleaning Service areas">
          Learn More
          <Icon name="arrow" size={18} stroke="currentColor" />
        </a>
      </div>
    </section>
  );
}

/* ---- Review band (dark teal) ------------------------------------------- */
function ReviewBand() {
  return (
    <section className="review-band">
      <div className="ds-shell review-inner">
        <div className="review-stars">
          {[0,1,2,3,4].map((i) => <Icon key={i} name="star" size={26} stroke="var(--leaf-500)" />)}
        </div>
        <blockquote>&ldquo;{D.review.text}&rdquo;</blockquote>
        <cite>
          <span>Mahin Muhtasimul</span>
          <span aria-hidden="true"> · </span>
          <a href={D.googleReviewsHref} target="_blank" rel="noopener noreferrer"
            aria-label="Read Iman Cleaning Service reviews on Google" data-conv="google_reviews">
            Read Our Google Reviews
          </a>
        </cite>
      </div>
    </section>
  );
}

/* ---- FAQ --------------------------------------------------------------- */
function Faq() {
  return (
    <section className="section" id="faq">
      <div className="ds-shell faq-wrap">
        <div className="sec-head sec-head-center">
          <span className="ds-kicker">Fast answers</span>
          <h2>What people ask before booking</h2>
        </div>
        <div className="faq-list">
          {D.faqs.map((f) => (
            <FaqItem key={f.q} question={f.q} defaultOpen={f.open}>{f.a}</FaqItem>
          ))}
        </div>
        <p className="faq-more">
          <strong>Have more questions?</strong>{" "}
          <a href="./faq.html">Get your answers in our FAQs</a>.
        </p>
      </div>
    </section>
  );
}

/* ---- Final CTA --------------------------------------------------------- */
function FinalCta() {
  return (
    <section className="final-cta" id="quote">
      <div className="ds-shell final-inner">
        <span className="ds-kicker">Need a custom quote?</span>
        <h2>Tell us about your cleaning needs.</h2>
        <p>Share details about your space, what needs cleaning, and your preferred date. We’ll review everything and prepare the right quote for you.</p>
        <div className="final-actions">
          <Button href="./quote.html" variant="accent" size="lg"
            aria-label="Get a custom cleaning quote from Iman Cleaning Service" data-conv="quote"
            iconRight={<Icon name="arrow" size={18} />}>Get a Custom Quote</Button>
          <Button href="tel:+19298034053" variant="secondary" size="lg"
            aria-label="Call Iman Cleaning Service at 929-803-4053" data-conv="call"
            iconLeft={<Icon name="phone" size={18} stroke="var(--brand)" />}>Call Now</Button>
        </div>
      </div>
    </section>
  );
}

function App() {
  return (
    <div className="site-scroll">
      <Header onDark homepage />
      <main>
        <Hero />
        <Services />
        <Areas />
        <WhyUs />
        <ReviewBand />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

window.ImanSite = { App };
