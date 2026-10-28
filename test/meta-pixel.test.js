const assert = require("node:assert/strict");
const fs = require("node:fs");

const pixel = fs.readFileSync("meta-pixel.js", "utf8");
const bookingConfirmed = fs.readFileSync("booking-confirmed.html", "utf8");
const quotePaid = fs.readFileSync("quote-paid.html", "utf8");
const privacy = fs.readFileSync("privacy-policy.html", "utf8");

assert.match(pixel, /const PIXEL_ID = "1600479927833362"/);
assert.match(pixel, /readConsent\(\) !== "allowed"/);
assert.match(pixel, /connect\.facebook\.net\/en_US\/fbevents\.js/);
assert.match(pixel, /if \(!window\._fbq\) window\._fbq = fbq/);
assert.match(pixel, /document\.querySelector\('\s*script\[src\*="connect\.facebook\.net\/en_US\/fbevents\.js"\]\s*'\)/);
assert.match(pixel, /fbq\("track", "PageView"\)/);
assert.match(pixel, /fbq\("track", "InitiateCheckout"/);
assert.match(pixel, /imanMetaCheckout:\$\{checkoutId\}/);
assert.match(pixel, /window\.imanMetaTrackInitiateCheckout = trackInitiateCheckout/);
assert.match(pixel, /fbq\("track", "Purchase", \{ value, currency \}, \{ eventID: transactionId \}\)/);
assert.match(pixel, /imanMetaPurchase:\$\{transactionId\}/);
assert.match(pixel, /data-iman-cookie-allow/);
assert.match(pixel, /data-iman-cookie-deny/);

for (const html of [bookingConfirmed, quotePaid]) {
  assert.match(html, /meta-pixel\.js/);
  assert.match(html, /data\.analyticsPurchase/);
  assert.match(html, /imanMetaTrackPurchase/);
  assert.ok(html.indexOf("data.analyticsPurchase") < html.indexOf("imanMetaTrackPurchase"));
}

assert.match(privacy, /Meta Pixel/);
assert.match(privacy, /card details, service addresses, booking notes, cleaning answers, or uploaded photos/);
assert.match(privacy, /data-ad-cookie-choices/);

const booking = fs.readFileSync("book-now.js", "utf8");
assert.match(booking, /imanMetaTrackInitiateCheckout/);
assert.ok(booking.indexOf("imanMetaTrackInitiateCheckout") < booking.indexOf("window.location.href = data.checkoutUrl"));

console.log("meta pixel consent and verified purchase tracking tests passed");
