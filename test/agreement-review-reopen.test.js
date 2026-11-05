const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../book-now.js"), "utf8");
const handlers = script.slice(script.indexOf("  const resetAgreementReview ="), script.indexOf("  const validAgreementSignedName ="));
const overlay = { hidden: true };
const checkbox = { checked: true, disabled: false };
const signature = { value: "Test Customer" };
const state = { agreementReview: { accepted: true } };
let position = 800; // The first signature was completed at the bottom.
const scroll = {
  get clientHeight() { return overlay.hidden ? 0 : 200; },
  get scrollHeight() { return overlay.hidden ? 0 : 1000; },
  get scrollTop() { return position; },
  set scrollTop(value) { if (!overlay.hidden) position = value; },
  addEventListener(type, handler) { this[type] = handler; },
  focus() {}
};
const context = vm.createContext({
  state, AGREEMENT_VERSION: "test", agreementReviewOverlay: overlay, agreementScroll: scroll,
  agreementAccept: checkbox, agreementSignedName: signature, agreementAcceptButton: {},
  agreementContentLoaded: true, agreementReturnFocus: null, agreementReviewButton: null,
  closeAgreementReview() {}, syncAgreementControls() {},
  document: { activeElement: null, body: { classList: { add() {}, remove() {} } }, querySelectorAll: () => [] }
});
const review = vm.runInContext(handlers + "\n({ resetAgreementReview, openAgreementReview, closeAgreementReview })", context);

(async () => {
  review.resetAgreementReview(); // The customer changed the appointment.
  scroll.scroll(); // A queued event from the closed agreement cannot count toward the next signature.
  assert.equal(state.agreementReview.scrolledToEndAt, "");
  await review.openAgreementReview();
  assert.equal(position, 0);
  assert.equal(checkbox.disabled, true);
  assert.equal(checkbox.checked, false);
  assert.equal(signature.value, "");

  scroll.scrollTop = 300;
  scroll.scroll();
  review.closeAgreementReview();
  await review.openAgreementReview();
  assert.equal(position, 300);
  assert.equal(checkbox.disabled, true);

  scroll.scrollTop = 800;
  scroll.scroll();
  assert.equal(checkbox.disabled, false);
  assert.ok(state.agreementReview.scrolledToEndAt >= state.agreementReview.openedAt);
  console.log("Appointment edits restart the agreement. Reopening the same review preserves reading progress.");
})().catch(error => { console.error(error); process.exitCode = 1; });
