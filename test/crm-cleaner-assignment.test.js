const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildCleanerAssignmentSms, parseCleanerNames } = require("../api/crm/[action]")._test;

assert.deepEqual(
  parseCleanerNames("Fatimah, Aisha\nFatimah"),
  ["Fatimah", "Aisha"],
  "names should be split, trimmed, and deduplicated"
);
assert.deepEqual(
  parseCleanerNames(["  Fatimah  Akter ", "Aisha", "aisha", ""]),
  ["Fatimah Akter", "Aisha"],
  "arrays and case-insensitive duplicates should be supported"
);
assert.deepEqual(parseCleanerNames(" \n, "), [], "blank input should remove the assignment");

const assignmentSms = buildCleanerAssignmentSms(
  { schedule: "2026-11-08T13:00:00.000Z" },
  ["Fatimah", "Aisha"]
);
assert.match(assignmentSms, /professionals are Fatimah and Aisha/i);
assert.match(assignmentSms, /November 8, 2026/i);
assert.match(assignmentSms, /Reply STOP/i);

assert.match(assignmentSms, /8:00 AM/, "Fixed appointments include their arrival time");
for (const confirmationStatus of ["pending", undefined, "confirmed"]) {
  const sms = buildCleanerAssignmentSms({
    schedule: "2026-11-09T02:00:00.000Z",
    estimate: { arrivalPreference: { flexible: true, confirmationStatus } }
  }, ["Fatimah"]);
  assert.match(sms, /November 8, 2026/, "Use the New York service date");
  if (confirmationStatus === "confirmed") {
    assert.match(sms, /9:00 PM/);
  } else {
    assert.match(sms, /Service date:/);
    assert.doesNotMatch(sms, /\d{1,2}:\d{2}/, "Do not disclose a provisional time");
  }
}

const crmSource = fs.readFileSync(path.join(__dirname, "..", "crm.js"), "utf8");
assert.match(crmSource, /\[0, 1, 2, 3\]\.map/, "the assignment form should render four cleaner fields");
assert.match(crmSource, /Cleaner \$\{index \+ 1\} <span>\(optional\)<\/span>/, "every cleaner field should be labeled optional");
assert.match(crmSource, /querySelectorAll\("\[data-cleaner-name\]"\)/, "all four fields should be collected when saving");

console.log("CRM cleaner assignment tests passed.");
