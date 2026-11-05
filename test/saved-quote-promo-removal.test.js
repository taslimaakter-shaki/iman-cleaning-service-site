const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { calculateHourlyCleaningQuote, calculateResidentialQuoteBundle, packageForClient } = require('../api/booking/_shared');
const { applyPromotion, PROMOTIONS } = require('../api/booking/_promo');
const { applyArrivalDiscount: serverArrival } = require('../api/booking/_arrival-preference');
const { buildAgreementAcceptance, AGREEMENT_VERSION, AGREEMENT_ACCEPTANCE_TEXT } = require('../api/booking/_checkout')._test;

const source = fs.readFileSync(require.resolve('../book-now.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const noop = () => {};
const quoteUrl = 'https://example.test/book-now.html?quote=original-token';
const schedule = '2030-11-05T08:00:00-05:00';

function browser(original) {
  const discounted = packageForClient(applyPromotion(original, PROMOTIONS.FALL10));
  const state = {
    package: structuredClone(discounted), promo: discounted.promoDiscount,
    packageBeforePromo: null, savedQuoteUrl: quoteUrl,
    eligibility: { requestedService: original.serviceKey, serviceZip: '11432' },
    unitDetails: original.units, pricingMode: original.pricingMode,
    availableSlots: [], arrivalPreference: '', agreementReview: { accepted: true }
  };
  const elements = Object.fromEntries([
    'firstName', 'lastName', 'email', 'phone', 'quoteFirstName', 'quoteLastName',
    'quoteEmail', 'quotePhone', 'quoteCommunicationConsent', 'smsMarketingConsent'
  ].map(name => [name, { value: '', checked: true }]));
  let payload;
  const context = vm.createContext({
    state, URL, window: { location: { origin: 'https://example.test', href: quoteUrl } },
    form: { elements }, quoteContactForm: { elements },
    value: name => name === 'schedule' ? schedule : elements[name]?.value || '',
    fetch: async (_url, options) => {
      if (options) payload = JSON.parse(options.body);
      return { ok: true, json: async () => ({
        unchanged: true, quoteUrl, quoteRevision: 'saved-revision',
        package: structuredClone(discounted), eligibility: state.eligibility,
        unitDetails: original.units, customer: {}, delivery: {}
      }) };
    },
    promoInput: {}, removePromoButton: {}, applyPromoButton: {}, promoStatus: {},
    zipStatus: null, organizationHoursInput: {}, serviceArea: { normalize: zip => zip },
    canUseInstantQuoteZip: () => true, allMobileQuestions: [],
    resetAgreementReview: () => { state.agreementReview = { accepted: false }; },
    showQuoteLoadError: message => { throw new Error(message); },
    displayTime: time => time,
    ...Object.fromEntries([
      'showSavedQuoteDelivery', 'renderQuoteOverview', 'syncCheckoutReview', 'persistBookingDraft',
      'setStatus', 'showQuoteLoading', 'applyServiceZip', 'syncServiceChoice', 'syncPropertyTypeChoice',
      'syncAnswerChoices', 'syncUnitCount', 'syncQuotedServiceCopy', 'hideQuoteLoading',
      'closeZipGate', 'openWizard', 'goToStep', 'showBookedQuoteConfirmation'
    ].map(name => [name, noop]))
  });
  vm.runInContext([
    section('  const packageWithoutPromo =', '  const openSameDayDialog ='),
    section('  const ARRIVAL_OPTIONS =', '  const setSchedulerStatus ='),
    // Run the real pricing normalization; only the DOM display is omitted.
    section('  const renderPriceBreakdown =', '    const breakdown = document.querySelector("[data-price-breakdown]")') + '\n};',
    section('  const removePromo =', '  document.querySelector("[data-continue-contact]").addEventListener'),
    section('  const restoreSavedQuote =', '  const savedQuoteToken ='),
    section('  const agreementContextFingerprint =', '  const syncAgreementControls =')
  ].join('\n'), context);
  return { state, context, discounted, run: code => vm.runInContext(code, context), payload: () => payload };
}

function assertCheckoutPrice(b, expected) {
  for (const key of ['subtotalCents', 'subtotal', 'taxCents', 'tax', 'priceCents', 'price', 'totalCents', 'total']) {
    assert.equal(b.state.package[key], expected[key], `${key} matches server checkout`);
  }
  assert.equal(b.state.package.discountedSubtotalCents, expected.discountedSubtotalCents ?? expected.subtotalCents);
  assert.equal(b.state.package.protectedPetFeeCents, expected.protectedPetFeeCents);
  assert.equal(b.state.package.manHours, expected.manHours);
  const now = Date.now();
  const evidence = buildAgreementAcceptance({
    pkg: expected, slot: { value: schedule }, request: { headers: {} }, secretKey: 'test-only',
    review: {
      version: AGREEMENT_VERSION, accepted: true, signedName: 'Jane Example', acceptanceText: AGREEMENT_ACCEPTANCE_TEXT,
      openedAt: new Date(now - 60000).toISOString(), scrolledToEndAt: new Date(now - 30000).toISOString(),
      acceptedAt: new Date(now - 10000).toISOString(), contextFingerprint: b.run('agreementContextFingerprint()')
    }
  });
  assert.equal(evidence.context.totalCents, expected.priceCents);
  assert.equal(evidence.context.depositCents, Math.round(expected.priceCents * 0.25));
}

(async () => {
  const originals = [
    calculateHourlyCleaningQuote(4),
    calculateResidentialQuoteBundle([{
      bedrooms: 2, fullBathrooms: 1, halfBathrooms: 0, hasLivingRoom: 'no', hasDiningRoom: 'no',
      hasPets: 'no', refrigerator: 'no', oven: 'no', cabinets: 'no', additionalCleaning: 'no', additionalRooms: 0
    }], 'standard', {
      propertyHasPets: 'yes', propertyPetCount: 2, propertyPetType: 'cats', petsSecured: 'yes'
    })
  ];
  for (const original of originals) {
    for (const entry of ['unchanged', 'saved-link', 'older-draft']) {
      for (const arrival of ['morning', 'any_day']) {
        const b = browser(original);
        if (entry === 'unchanged') {
          assert.equal(await b.run('sendSavedQuote()'), quoteUrl);
          assert.equal(b.payload().previousQuoteToken, 'original-token');
        } else if (entry === 'saved-link') {
          await b.run("restoreSavedQuote('original-token')");
        }
        assert.equal(b.state.package.priceCents, b.discounted.priceCents, 'Reopening retains the offer');
        if (entry !== 'older-draft') {
          assert.equal(b.state.packageBeforePromo.priceCents, original.priceCents);
          assert.equal(b.state.packageBeforePromo.taxCents, original.taxCents);
          assert.equal(b.state.quoteRevision, 'saved-revision');
        }
        b.state.arrivalPreference = arrival;
        b.run('applyArrivalDiscount(arrivalOption(state.arrivalPreference))');
        const savedSnapshot = JSON.stringify(b.discounted);
        b.run('removePromo()');
        assert.equal(b.state.promo, null);
        assert.equal(b.state.package.promoDiscount, null);
        assert.equal(b.state.package.promoCode, '');
        assert.equal(b.state.agreementReview.accepted, false, 'Price changes require a new agreement review');
        assertCheckoutPrice(b, serverArrival(original, arrival));
        assert.equal(JSON.stringify(b.discounted), savedSnapshot, 'Removing a promo does not mutate its saved snapshot');
        if (original.serviceKey === 'hourly' && arrival === 'morning') {
          assert.equal(b.state.package.price, 320, 'Previously stuck at the $304 promo total');
        }

        b.context.promotion = PROMOTIONS.FALL10;
        b.run('applyPromoData(promotion)');
        assertCheckoutPrice(b, serverArrival(applyPromotion(original, PROMOTIONS.FALL10), arrival));
        b.run('removePromo()');
        assertCheckoutPrice(b, serverArrival(original, arrival));
      }
    }
  }
  console.log('Saved quote promo removal: unchanged quotes, saved links, older drafts, full tax/total restoration, arrival discounts, pet fees, reapplication and checkout agreement validation passed. No live requests.');
})().catch(error => { console.error(error); process.exitCode = 1; });
