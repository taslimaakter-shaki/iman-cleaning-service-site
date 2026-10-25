const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const html = read("approve-quote.html");
const styles = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const reviewsCss = read("site-reviews.css");
const reviewsJs = read("site-reviews.js");

assert.match(html, /<header class="quote-page-header">/);
assert.match(styles, /\.quote-page-header\s*\{\s*background: var\(--green-dark\)/);
assert.doesNotMatch(styles, /(?:^|[{},])\s*header\b/m,
  "Page header styling must not affect the nested customer-review header");
assert.match(styles, /body \.site-reviews\s*\{\s*--reviews-muted:\s*#[a-f0-9]{6};\s*\}/i,
  "Only the muted review text is darkened on the quote page");
assert.match(reviewsJs, /<header class="site-reviews__head">/);
for (const text of ["Trusted by New Yorkers", "4.9 on Google", "Read All Reviews"]) {
  assert(reviewsJs.includes(text), `Preserve review content: ${text}`);
}
assert(!reviewsJs.includes("What Our Customers Say"));
assert(!reviewsJs.includes("Real experiences from customers across New York City"));
assert.match(reviewsJs, /https:\/\/share\.google\/EAX7wC22J4PyMKcNx/);

const sectionStyles = reviewsCss.match(/\.site-reviews\s*\{([^}]+)\}/)[1];
const color = name => sectionStyles.match(new RegExp(`${name}:\\s*(#[a-f0-9]{6})`, "i"))[1];
const muted = styles.match(/body \.site-reviews\s*\{\s*--reviews-muted:\s*(#[a-f0-9]{6})/i)[1];
const luminance = hex => {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const background = luminance(color("background"));
const link = reviewsCss.match(/\.site-reviews__summary a\s*\{\s*color:\s*(#[a-f0-9]{6})/i)[1];
for (const foreground of [color("--reviews-ink"), muted, link]) {
  const text = luminance(foreground);
  const contrast = (Math.max(background, text) + 0.05) / (Math.min(background, text) + 0.05);
  assert(contrast >= 4.5, `Review text ${foreground} must remain readable on ${color("background")}: ${contrast}`);
}
console.log("Custom quote review contrast: isolated page header, preserved review text/link, and text contrast passed.");
