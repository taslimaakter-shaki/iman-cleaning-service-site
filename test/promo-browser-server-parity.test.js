const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('book-now.js','utf8');
const code=source.slice(source.indexOf('  const applyPromoData ='),source.indexOf('  const applyPromo ='));
const original={serviceKey:'recurring',subtotalCents:20000,taxCents:1775,priceCents:21775,taxRate:.08875,protectedPetFeeCents:5000,protectedPetSubtotalCents:4592};
for(const serviceKey of ['standard','recurring']) {
 const pkg={...original,serviceKey},state={package:pkg};const noop=()=>{};
 const c=vm.createContext({state,arrivalOption:()=>null,clearArrivalDiscount:noop,removePromo:noop,promoInput:null,removePromoButton:null,renderQuoteOverview:noop,renderPriceBreakdown:noop,resetAgreementReview:noop,syncCheckoutReview:noop,persistBookingDraft:noop});
 vm.runInContext(code+'globalThis.run=applyPromoData;',c);c.run({code:'TEST',percent:20});
 const expected=serviceKey==='recurring'?require('../api/booking/_recurring-discount').applyRecurringDiscount(pkg,{percent:20}):require('../api/booking/_promo').applyPromotion(pkg,{code:'TEST',percent:20,eligibleServices:['standard']});
 assert.equal(state.package.priceCents,expected.priceCents);
 assert.equal(state.package.taxCents,expected.taxCents);
 assert.equal(state.promo.application,expected.promoDiscount.application);
}
console.log('Browser/server promo parity: recurring after-tax and standard before-tax preserve the pet fee.');
