const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const browserCode = fs.readFileSync(path.join(__dirname, "..", "book-now.js"), "utf8");

assert.match(
  browserCode,
  /if \(laborHours > 6\) \{\s*return `2 team members for up to \$\{formatTime\(laborHours \/ 2\)\}`;/,
  "Jobs above 6 labor-hours should always be divided between two team members."
);
assert.match(
  browserCode,
  /if \(laborHours > 0\) \{\s*return `1 team member for up to \$\{formatTime\(laborHours\)\}, or 2 team members for up to \$\{formatTime\(laborHours \/ 2\)\}`;/,
  "Jobs of 6 labor-hours or less should show both one-person and two-person staffing options."
);

console.log("Staffing summary shows one- or two-person options through 6 labor-hours and enforces two people above 6.");
