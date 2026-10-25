import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const ignored = new Set(["node_modules", ".git", "halal-diner-preview"]);
const replacement = `<div class="footer-location">
      <div class="footer-location-map">
        <iframe title="Map showing Iman Cleaning Service LLC in Queens, New York" src="https://www.google.com/maps?q=Iman%20Cleaning%20Service%20LLC%2C%20Queens%2C%20NY&amp;output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
      </div>
      <div class="footer-location-copy">
        <h4>Our location</h4>
        <address>Queens, Brooklyn, Manhattan, Staten Island, and the Bronx</address>
        <a href="https://www.google.com/maps/search/?api=1&amp;query=Iman%20Cleaning%20Service%20LLC%20Queens%20NY" target="_blank" rel="noopener noreferrer">View on Google Maps</a>
      </div>
    </div>`;

function htmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(fullPath);
    return path.extname(entry.name) === ".html" ? [fullPath] : [];
  });
}

function replaceBalancedBlock(source) {
  const marker = '<div class="footer-service-base">';
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
    if (end === -1) throw new Error(`Unbalanced footer block near index ${start}`);
    result = result.slice(0, start) + replacement + result.slice(end);
    start = result.indexOf(marker, start + replacement.length);
  }
  return result;
}

let changed = 0;
for (const file of htmlFiles(root)) {
  const original = fs.readFileSync(file, "utf8");
  const updated = replaceBalancedBlock(original);
  if (updated !== original) {
    fs.writeFileSync(file, updated);
    changed += 1;
  }
}
console.log(`Restored footer maps in ${changed} HTML files.`);
