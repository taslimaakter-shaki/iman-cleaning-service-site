import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensions = new Set([".html", ".js", ".jsx"]);
const ignored = new Set(["node_modules", ".git", "halal-diner-preview"]);
const replacement = `<div class="footer-service-base">
      <h4>Based in Queens, New York</h4>
      <p>Serving Queens, Brooklyn, Manhattan, Staten Island, and the Bronx</p>
      <p><a href="tel:+19298034053">929-803-4053</a> · Open daily, 8 AM–8 PM</p>
    </div>`;

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(fullPath);
    return extensions.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

function replaceBalancedFooterLocation(source) {
  const marker = '<div class="footer-location">';
  let result = source;
  let start = result.indexOf(marker);
  while (start !== -1) {
    const tagPattern = /<\/?div\b[^>]*>/g;
    tagPattern.lastIndex = start;
    let depth = 0;
    let end = -1;
    for (let match = tagPattern.exec(result); match; match = tagPattern.exec(result)) {
      depth += match[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        end = tagPattern.lastIndex;
        break;
      }
    }
    if (end === -1) throw new Error(`Unbalanced footer-location block near index ${start}`);
    result = result.slice(0, start) + replacement + result.slice(end);
    start = result.indexOf(marker, start + replacement.length);
  }
  return result;
}

for (const file of filesIn(root)) {
  const original = fs.readFileSync(file, "utf8");
  let updated = replaceBalancedFooterLocation(original);
  updated = updated
    .replace(/\s*"streetAddress":\s*"138-44 Queens Blvd",?/g, "")
    .replace(/"addressLocality":\s*"Briarwood"/g, '"addressLocality": "Queens"')
    .replace(/\s*"postalCode":\s*"11435",?/g, "")
    .replace(/138-44 Queens Boulevard|138-44 Queens Blvd/g, "")
    .replace(/Briarwood,\s*NY\s*11435/g, "Queens, NY");
  if (updated !== original) fs.writeFileSync(file, updated);
}
