const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
assert.equal(fs.existsSync(path.join(root, "quote.html")), false, "The public custom-quote page must remain deleted.");

const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
assert.ok(
  vercel.rewrites.some((rule) => rule.source === "/quote.html" && rule.destination.startsWith("/api/gone")),
  "The removed URL must return the permanent Gone response."
);

for (const file of ["index.html", "services-hub.html", "standard-cleaning.html", "post-construction-cleaning.html", "commercial-cleaning.html", "our-work.html", "book-now.js"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert.doesNotMatch(source, /(?:href=["']|return `\.\/)quote\.html/, `${file} still links to the deleted page.`);
}

console.log("Custom-quote page removal, HTTP 410 route, and Contact Us replacements passed.");
