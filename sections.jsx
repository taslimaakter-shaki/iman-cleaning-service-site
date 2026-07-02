/* Iman Cleaning — homepage sections. Composes design-system components from
   the compiled bundle. Exported to window.ImanSite for index.html. */
const { Button, Badge, Card, ServiceCard, ServiceListCard, FeatureTile, FaqItem } =
  window.ImanCleaningDesignSystem_5652ad;
const { Icon, Header, Footer } = window.ImanChrome;
const D = window.IMAN_DATA;

/* ---- Hero -------------------------------------------------------------- */
function Hero() {
  return (
    <section className="page-hero on-photo home-hero-photo" id="top"
      style={{ "--hero-img": "url('./assets/home-hero-bedroom.png')" }}>
      <div className="ds-shell page-hero-inner">
        <Badge tone="leaf" check size="sm">Fully insured · NYC</Badge>
        <h1>Spotless spaces, without the hassle.</h1>
        <p className="ds-lead">
          Detail-obsessed cleaning for homes, apartments, offices, and businesses across
          all five NYC boroughs. Know your price up front, then book in minutes.
        </p>
        <div className="page-hero-actions">
          <Button href={D.phoneHref} variant="accent" size="lg" iconLeft={<Icon name="phone" size={18} />}>
            Call us
          </Button>
          <Button href={"sms:" + D.phone.replace(/[^0-9]/g, "")} variant="secondary" size="lg" iconLeft={<Icon name="message" size={18} stroke="var(--brand)" />}>
            Text us
          </Button>
        </div>
        <div className="hero-trust on-dark">
          <span><Icon name="check" size={16} stroke="var(--leaf-500)" /> 5-star Google reviews</span>
          <span><Icon name="check" size={16} stroke="var(--leaf-500)" /> Background-checked cleaners</span>
          <span><Icon name="check" size={16} stroke="var(--leaf-500)" /> Open 6 AM–8 PM daily</span>
          <span><Icon name="check" size={16} stroke="var(--leaf-500)" /> Serving all five NYC boroughs</span>
          <span><Icon name="check" size={16} stroke="var(--leaf-500)" /> Residential &amp; commercial cleaning</span>
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
    ["Open daily", "6:00 AM – 8:00 PM"],
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
function Services() {
  return (
    <section className="section" id="services">
      <div className="ds-shell">
        <div className="sec-head">
          <span className="ds-kicker">Start with the right service</span>
          <h2>Choose the cleaning you need today</h2>
        </div>
        <div className="two-cards">
          {D.serviceCategories.map((c) => <ServiceListCard key={c.title} {...c} />)}
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
          <Button href="./quote.html" variant="primary" size="lg">Get a clear quote</Button>
        </div>
      </div>
    </section>
  );
}

/* ---- Why us (split: photo + reasons) ----------------------------------- */
function WhyUs() {
  return (
    <section className="why-band" id="why">
      <div className="ds-shell">
        <div className="why-band-head">
          <span className="ds-kicker" style={{ color: "var(--leaf-300)" }}>Why neighbors choose Iman</span>
          <h2>Why NYC homeowners &amp; businesses trust Iman</h2>
          <p>Trusted in homes and businesses across all five NYC boroughs — here's what you get with every visit.</p>
        </div>
        <div className="why-band-grid">
          {D.reasons.map((r) => (
            <div className="why-band-card" key={r.title}>
              <span className="why-band-ico"><Icon name={r.icon} size={24} stroke="var(--leaf-300)" /></span>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </div>
          ))}
        </div>
        <div className="why-reviews">
          <div className="why-reviews-stars" aria-label="5 out of 5 stars">
            {[0,1,2,3,4].map((i) => <Icon key={i} name="star" size={22} stroke="var(--leaf-400)" />)}
            <span>Rated 5.0 on Google</span>
          </div>
          <div className="why-reviews-grid">
            {D.reviews.map((rv) => (
              <figure className="why-review" key={rv.author}>
                <blockquote>&ldquo;{rv.text}&rdquo;</blockquote>
                <figcaption>— {rv.author}</figcaption>
              </figure>
            ))}
          </div>
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
        <span className="ds-kicker" style={{ color: "var(--leaf-300)" }}>Service areas</span>
        <h2>Cleaning across all five NYC boroughs</h2>
        <p className="ds-lead">From apartments and brownstones to Airbnbs, offices, and retail
          spaces, Iman Cleaning Service LLC covers the whole city.</p>
        <div className="areas-badges">
          {D.boroughs.map((b) => <Badge key={b} tone="solid" size="md">{b}</Badge>)}
        </div>
        <Button href="./areas.html" variant="accent" size="lg">View service areas</Button>
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
        <cite>{D.review.author}</cite>
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
      </div>
    </section>
  );
}

/* ---- Final CTA --------------------------------------------------------- */
function FinalCta() {
  return (
    <section className="final-cta" id="quote">
      <div className="ds-shell final-inner">
        <span className="ds-kicker" style={{ color: "var(--leaf-300)" }}>Ready when you are</span>
        <h2>Get a clear quote — no commitment until you approve the price.</h2>
        <p>Send your details in a few minutes. We review the scope, confirm timing and team size,
          then follow up before anything is booked.</p>
        <div className="final-actions">
          <Button href="./quote.html" variant="accent" size="lg" iconRight={<Icon name="arrow" size={18} />}>Request a quote</Button>
          <Button href={D.phoneHref} variant="secondary" size="lg"
            iconLeft={<Icon name="phone" size={18} stroke="var(--brand)" />}>Call or text {D.phone}</Button>
        </div>
      </div>
    </section>
  );
}

function App() {
  return (
    <div className="site-scroll">
      <Header onDark />
      <main>
        <Hero />
        <Services />
        <HowItWorks />
        <WhyUs />
        <Areas />
        <ReviewBand />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

window.ImanSite = { App };
