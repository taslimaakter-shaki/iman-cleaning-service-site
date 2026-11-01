const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "book-now.html"), "utf8");
const script = fs.readFileSync(path.join(root, "book-now.js"), "utf8");

assert.match(html, /data-resume-quote/);
assert.match(html, /data-resume-continue>Continue Quote/);
assert.match(html, /data-resume-new>Start New/);
assert.match(script, /persistBookingDraft = saveBookingDraft;/);
assert.match(script, /saveBookingDraft\(\{ immediate: true \}\);\s*closeWizard\(\{ preserveDraft: true \}\);/);
assert.match(script, /window\.addEventListener\("pagehide"/);
assert.match(script, /BOOKING_DRAFT_MAX_AGE = 7 \* 24 \* 60 \* 60 \* 1000/);
assert.match(
  script,
  /if \(quoteDetailsMode && !value\("unitCount"\)\) \{[\s\S]*?form\.elements\.unitCount\.value = String\(Math\.min\(10, Math\.max\(1, restoredUnits \|\| 1\)\)\);/,
  "Legacy detail drafts should recover a valid unit count before their questions are rebuilt."
);
const detailLoader = script.indexOf("const loadCurrentUnitDetails = () => {");
const resumedUnitClamp = script.indexOf("state.currentUnitIndex = Math.max(0, Math.min(Number(state.currentUnitIndex) || 0, count - 1));", detailLoader);
const currentUnitRead = script.indexOf("const current = state.unitDetails[state.currentUnitIndex] || emptyUnitDetails();", detailLoader);
assert.ok(detailLoader >= 0 && resumedUnitClamp > detailLoader && resumedUnitClamp < currentUnitRead);

console.log("Booking resume-draft tests passed.");
