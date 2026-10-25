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
    if (!attempt || typeof attempt.then !== "function") return Promise.resolve();

    // Mobile Safari can temporarily reject autoplay (for example, in Low
    // Power Mode). Keep the poster visible and retry on the next lifecycle
    // event instead of showing a manual play control.
    return attempt.catch(() => undefined);
  }, []);

  React.useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktopViewport = window.matchMedia("(min-width: 768px)");
    const updateVideoPreference = () => {
      const enabled = !reducedMotion.matches && desktopViewport.matches;
      setVideoEnabled(enabled);
      if (!enabled && videoRef.current) videoRef.current.pause();
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
    addChangeListener(desktopViewport);
    return () => {
      removeChangeListener(reducedMotion);
      removeChangeListener(desktopViewport);
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
    const retryPlayback = () => playHeroVideo();

    video.addEventListener("loadedmetadata", playHeroVideo);
    video.addEventListener("canplay", playHeroVideo);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", retryPlayback);
    window.addEventListener("focus", retryPlayback);
    playHeroVideo();

    return () => {
      video.removeEventListener("loadedmetadata", playHeroVideo);
      video.removeEventListener("canplay", playHeroVideo);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", retryPlayback);
      window.removeEventListener("focus", retryPlayback);
    };
  }, [playHeroVideo, videoEnabled]);

  return (
    <section className="page-hero on-photo home-hero-photo" id="top">
      <picture className="home-hero-poster" aria-hidden="true">
        <source type="image/avif"
          srcSet="./assets/home-hero-video-poster-768w.avif 768w, ./assets/home-hero-video-poster.avif 1280w"
          sizes="100vw" />
        <img src="./assets/home-hero-video-poster.jpg" alt="" width="1280" height="720"
          fetchPriority="high" decoding="sync" />
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
          preload="auto"
          poster="./assets/home-hero-video-poster.jpg"
          aria-hidden="true"
          tabIndex="-1"
          src="./assets/home-hero-video-fast.mp4"
        />
      )}
      <div className="ds-shell page-hero-inner">
        <Badge tone="leaf" check size="sm">Fully Insured • Background-Checked Cleaners</Badge>
        <h1>NYC&apos;s Reliable Residential &amp; Commercial Cleaning Service</h1>
        <p className="ds-lead">
          House, apartment, and commercial cleaning in Brooklyn, Queens, and Manhattan.
        </p>
        <div className="page-hero-actions">
          <Button href="./book-now.html" variant="accent" size="lg"
            data-conv="book"
            iconRight={<Icon name="arrow" size={18} />}>Check My Price</Button>
          <small className="hero-price-time">It only takes about two minutes.</small>
        </div>
        <div className="hero-trust-line" aria-label="Customer reviews">
          <a href={D.googleReviewsHref} target="_blank" rel="noopener noreferrer"
            data-conv="google_reviews">
            <svg className="hero-google-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.5c-.3 1.4-1.1 2.7-2.4 3.6v3h3.8c2.2-2.1 3.6-5.1 3.6-8.6Z" />
              <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.8-3.1l-3.8-3c-1 .7-2.3 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.5v3.1A12 12 0 0 0 12 24Z" />
              <path fill="#FBBC04" d="M5.4 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V6.7H1.5A12 12 0 0 0 0 12c0 1.9.5 3.7 1.5 5.3l3.9-3.1Z" />
              <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.9 1.1 15.2 0 12 0A12 12 0 0 0 1.5 6.7l3.9 3.1c.9-2.8 3.5-5 6.6-5Z" />
            </svg>
            4.9 ★ Read Our Reviews
          </a>
        </div>
      </div>
    </section>
  );
}

function HomeSeoIntro() {
  return (
    <section className="home-seo-intro" aria-label="NYC cleaning services">
      <div className="ds-shell home-seo-intro-inner">
        <p>Iman Cleaning Service LLC provides residential and commercial cleaning in Brooklyn, Queens, and Manhattan, including standard, deep, move-in, move-out, and post-construction cleaning.</p>
      </div>
    </section>
  );
}

/* ---- Proof strip ------------------------------------------------------- */
function ProofStrip() {
  const items = [
    ["Fully insured", "Homes & businesses"],
    ["NYC service", "Manhattan, Brooklyn & Queens"],
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
  const displayPrice = () => "Request a personalized quote";

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
            {isOpen ? "Hide services" : "View services"}
          </span>
        </span>
        <span className="service-category-symbol" aria-hidden="true">
          {isOpen ? "−" : "+"}
        </span>
      </button>
      <div className="service-category-panel" id={panelId} hidden={!isOpen}>
        <p className="service-category-description">{category.description}</p>
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
    <section className="section service-category-section" id="services">
      <div className="ds-shell">
        <div className="sec-head">
          <span className="ds-kicker">Start with the right service</span>
          <h2>Cleaning services for homes and businesses</h2>
        </div>
        <div className="two-cards">
          {D.serviceCategories.map((category) => (
            <ServiceCategoryAccordion key={category.title} category={category} />
          ))}
        </div>
        <div className="service-category-more">
          <Button href="./services-hub.html" variant="secondary" size="md" iconRight={<Icon name="arrow" size={16} />}>Explore All Services</Button>
        </div>
      </div>
    </section>
  );
}

const workProjects = [
  {
    image: "./assets/our-work/jamaica-client-bedroom-primary-home.webp",
    width: 540,
    height: 720,
    alt: "Freshly cleaned bedroom in a Jamaica, Queens home",
    meta: "Residential Cleaning · Jamaica, Queens",
    title: "From a flyer to a happy client",
    id: "jamaica-queens-flyer-cleaning-story-2026-08"
  },
  {
    image: "./assets/our-work/astoria-monthly-kitchen-after-home.webp",
    width: 720,
    height: 540,
    alt: "Clean kitchen after a monthly apartment cleaning in Astoria, Queens",
    meta: "Monthly Cleaning · Astoria, Queens",
    title: "A monthly reset for a busy cat parent",
    id: "astoria-monthly-apartment-transformation-2026-08"
  },
  {
    image: "./assets/our-work/move-in-cleaning-kitchen-home.webp",
    width: 540,
    height: 720,
    alt: "Clean kitchen after a move-in cleaning in Astoria, Queens",
    meta: "Move-In Cleaning · Astoria, Queens",
    title: "A fresh start for a mom and her newborn",
    id: "one-bedroom-move-in-cleaning-2026-08"
  }
];

function WorkPreview() {
  return (
    <section className="work-preview" id="our-work" aria-labelledby="work-preview-title">
      <div className="ds-shell">
        <header className="work-preview-head">
          <div>
            <span className="ds-kicker">Real projects · Real results</span>
            <h2 id="work-preview-title">See Our Cleaning Work</h2>
          </div>
          <a className="work-preview-all" href="./our-work.html">View All Projects <span aria-hidden="true">→</span></a>
        </header>
        <div className="work-preview-grid">
          {workProjects.map((project) => (
          <a className="work-preview-card" href={`./our-work.html#${project.id}`} key={project.title}>
              <span className="work-preview-media">
                <img src={project.image} alt={project.alt} width={project.width} height={project.height} loading="lazy" decoding="async" />
              </span>
              <span className="work-preview-body">
                <span className="work-preview-meta">{project.meta}</span>
                <strong>{project.title}</strong>
                <span className="work-preview-link">View project <span aria-hidden="true">→</span></span>
              </span>
            </a>
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

/* ---- Service areas ----------------------------------------------------- */
function Areas() {
  return (
    <section className="areas-band" id="areas">
      <div className="ds-shell areas-band-inner">
        <h2>NYC service areas</h2>
        <ul className="areas-links" aria-label="Cleaning service areas">
          {D.serviceAreas.map((area) => (
            <li key={area.name}>
              {area.href ? <a href={area.href}>{area.name}</a> : <span>{area.name}</span>}
            </li>
          ))}
        </ul>
        <a className="areas-learn-more" href="./areas.html">
          Explore All NYC Service Areas
          <Icon name="arrow" size={18} stroke="currentColor" />
        </a>
      </div>
    </section>
  );
}

function GoogleReviewIcon() {
  return (
    <svg className="review-google-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.5c-.3 1.4-1.1 2.7-2.4 3.6v3h3.8c2.2-2.1 3.6-5.1 3.6-8.6Z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.8-3.1l-3.8-3c-1 .7-2.3 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.5v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC04" d="M5.4 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V6.7H1.5A12 12 0 0 0 0 12c0 1.9.5 3.7 1.5 5.3l3.9-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.9 1.1 15.2 0 12 0A12 12 0 0 0 1.5 6.7l3.9 3.1c.9-2.8 3.5-5 6.6-5Z" />
    </svg>
  );
}

/* ---- Customer reviews -------------------------------------------------- */
function ReviewBand() {
  const trackRef = React.useRef(null);
  const [activeReview, setActiveReview] = React.useState(0);

  const showReview = (index) => {
    const track = trackRef.current;
    const card = track?.children[index];
    if (!track || !card) return;
    track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: "smooth" });
    setActiveReview(index);
  };

  const updateActiveReview = () => {
    const track = trackRef.current;
    if (!track) return;
    const cards = Array.from(track.children);
    const closest = cards.reduce((best, card, index) => {
      const distance = Math.abs((card.offsetLeft - track.offsetLeft) - track.scrollLeft);
      return distance < best.distance ? { index, distance } : best;
    }, { index: 0, distance: Infinity });
    setActiveReview(closest.index);
  };

  return (
    <section className="review-band" aria-labelledby="customer-reviews-title">
      <div className="ds-shell review-inner">
        <header className="review-section-head">
          <div>
            <h2 id="customer-reviews-title">Trusted by New Yorkers</h2>
          </div>
          <div className="review-summary">
            <strong>
              <span className="review-stars" aria-label={`${D.reviewRating} out of 5 stars`}>
                <span aria-hidden="true">★★★★★</span>
              </span>{" "}{D.reviewRating} on Google
            </strong>
            <a href={D.googleReviewsHref} target="_blank" rel="noopener noreferrer"
              aria-label="Read all Iman Cleaning Service reviews on Google" data-conv="google_reviews">
              Read All Reviews <span aria-hidden="true">→</span>
            </a>
          </div>
        </header>
        <div className="review-card-track" ref={trackRef} onScroll={updateActiveReview}
          aria-label="Customer reviews">
          {D.reviews.map((review, index) => (
            <article className="review-card" id={`customer-review-${index + 1}`} key={review.author}>
              <div className="review-card-stars" aria-label="5 out of 5 stars">
                <span aria-hidden="true">★★★★★</span>
              </div>
              <blockquote>&ldquo;{review.text}&rdquo;</blockquote>
              <footer>
                <strong>{review.author}</strong>
                <span><GoogleReviewIcon />Google Review</span>
              </footer>
            </article>
          ))}
        </div>
        <nav className="review-dots" aria-label="Choose a customer review">
          {D.reviews.map((review, index) => (
            <button key={review.author} type="button"
              className={activeReview === index ? "is-active" : ""}
              aria-label={`Show review ${index + 1}`}
              aria-current={activeReview === index ? "true" : undefined}
              onClick={() => showReview(index)} />
          ))}
        </nav>
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

/* ---- FAQ + contact highlights ----------------------------------------- */
function HelpHighlights() {
  return (
    <section className="home-help-band" aria-labelledby="home-help-title">
      <div className="ds-shell">
        <div className="home-help-grid">
          <article className="home-faq-highlight">
            <span className="home-help-label">Frequently asked questions</span>
            <h2 id="home-help-title">Questions before you book?</h2>
            <div className="home-faq-preview">
              <details>
                <summary>What is included in a cleaning?</summary>
                <p>Your cleaning scope depends on the service and options you select. You can review the included work before booking.</p>
              </details>
              <details>
                <summary>Do you bring cleaning supplies and equipment?</summary>
                <p>Yes. We bring professional cleaning products and equipment unless you ask us to use specific products.</p>
              </details>
              <details>
                <summary>How do quotes and payments work?</summary>
                <p>You’ll see or receive your price before booking. A 25% deposit reserves the appointment, and the remaining balance is due after cleaning.</p>
              </details>
              <details>
                <summary>Where do you provide cleaning service?</summary>
                <p>We serve Brooklyn, Queens, and Manhattan. Enter your ZIP code to confirm availability for your address.</p>
              </details>
              <details>
                <summary>What is the difference between standard and deep cleaning?</summary>
                <p>Standard cleaning supports routine upkeep. Deep cleaning is designed for heavier buildup and areas that require more detailed attention.</p>
              </details>
            </div>
            <a className="home-help-link" href="./faq.html">View All FAQs <span aria-hidden="true">→</span></a>
          </article>

          <article className="home-contact-highlight">
            <span className="home-help-label">Contact us</span>
            <h2>Need help choosing a service?</h2>
            <p>Questions about cleaning, pricing, availability, or an existing appointment? Our team is here to help.</p>
            <div className="home-help-actions">
              <Button href="./contact.html" variant="accent" size="lg" iconRight={<Icon name="arrow" size={18} />}>Contact Us</Button>
            </div>
          </article>
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
        <HomeSeoIntro />
        <WorkPreview />
        <Areas />
        <ReviewBand />
        <HelpHighlights />
      </main>
      <Footer />
    </div>
  );
}

window.ImanSite = { App };
