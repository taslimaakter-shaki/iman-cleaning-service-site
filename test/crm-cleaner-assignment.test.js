const assert = require("node:assert/strict");
const { parseCleanerNames } = require("../api/crm/[action]")._test;

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

console.log("CRM cleaner assignment tests passed.");
