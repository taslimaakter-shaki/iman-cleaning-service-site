(function () {
  "use strict";

  var root = document.querySelector("[data-work-feed]");
  if (!root) return;

  var posts = Array.isArray(window.IMAN_WORK_POSTS) ? window.IMAN_WORK_POSTS : [];

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>\"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#039;" }[character];
    });
  }

  function mediaMarkup(media, postTitle) {
    if (!Array.isArray(media) || !media.length) return "";
    return '<div class="work-post__media work-post__media--' + Math.min(media.length, 4) + '">' + media.map(function (item) {
      if (!item || !item.src) return "";
      var figureClasses = [];
      if (item.featured) figureClasses.push("work-post__media-item--featured");
      if (item.fit === "contain") figureClasses.push("work-post__media-item--contain");
      var figureAttributes = figureClasses.length ? ' class="' + figureClasses.join(" ") + '"' : "";
      if (item.type === "video") {
        return '<figure' + figureAttributes + '><video controls muted playsinline preload="metadata"' + (item.poster ? ' poster="' + escapeHtml(item.poster) + '"' : "") + ' aria-label="' + escapeHtml(item.caption || postTitle) + '"><source src="' + escapeHtml(item.src) + '" type="video/mp4">Your browser does not support this video.</video>' + (item.caption ? '<figcaption>' + escapeHtml(item.caption) + '</figcaption>' : "") + '</figure>';
      }
      var dimensions = item.width && item.height ? ' width="' + Number(item.width) + '" height="' + Number(item.height) + '"' : "";
      return '<figure' + figureAttributes + '><img src="' + escapeHtml(item.src) + '" alt="' + escapeHtml(item.alt || postTitle) + '"' + dimensions + ' loading="lazy" decoding="async">' + (item.caption ? '<figcaption>' + escapeHtml(item.caption) + '</figcaption>' : "") + '</figure>';
    }).join("") + '</div>';
  }

  function comparisonMarkup(comparisons, postTitle) {
    if (!Array.isArray(comparisons) || !comparisons.length) return "";
    return '<div class="work-post__comparisons">' + comparisons.map(function (comparison) {
      var room = comparison.room || "Cleaning transformation";
      var before = comparison.before || {};
      var after = comparison.after || {};
      if (!before.src || !after.src) return "";
      return '<section class="work-comparison" aria-label="' + escapeHtml(room) + ' before and after">' +
        '<h3>' + escapeHtml(room) + '</h3>' +
        '<div class="work-comparison__grid">' +
          '<figure><span class="work-comparison__label work-comparison__label--before">Before</span><img src="' + escapeHtml(before.src) + '" alt="' + escapeHtml(before.alt || room + " before " + postTitle) + '"' + (before.width && before.height ? ' width="' + Number(before.width) + '" height="' + Number(before.height) + '"' : "") + ' loading="lazy" decoding="async"></figure>' +
          '<figure><span class="work-comparison__label work-comparison__label--after">After</span><img src="' + escapeHtml(after.src) + '" alt="' + escapeHtml(after.alt || room + " after " + postTitle) + '"' + (after.width && after.height ? ' width="' + Number(after.width) + '" height="' + Number(after.height) + '"' : "") + ' loading="lazy" decoding="async"></figure>' +
        '</div>' +
      '</section>';
    }).join("") + '</div>';
  }

  function postMarkup(post) {
    var title = post.title || post.service || "Cleaning project";
    var meta = [post.service, post.location, post.date].filter(Boolean);
    return '<article class="work-post" id="' + escapeHtml(post.id || "") + '">' +
      '<header class="work-post__header"><img src="./assets/iman-logo-icon.png" alt="" width="48" height="48"><div><strong>Iman Cleaning Service LLC</strong><span>' + escapeHtml(meta.join(" · ")) + '</span></div></header>' +
      '<div class="work-post__copy"><h2>' + escapeHtml(title) + '</h2>' + (post.description ? '<p>' + escapeHtml(post.description) + '</p>' : "") + '</div>' +
      comparisonMarkup(post.comparisons, title) + mediaMarkup(post.media, title) +
      '<footer class="work-post__footer"><span>Professional cleaning across Brooklyn, Queens, and Manhattan</span><a href="./book-now.html">Get My Instant Quote <span aria-hidden="true">→</span></a></footer>' +
      '</article>';
  }

  if (!posts.length) {
    root.innerHTML = '<section class="work-empty" aria-labelledby="work-empty-title"><span class="work-empty__icon" aria-hidden="true">✦</span><h2 id="work-empty-title">Our latest projects are coming soon</h2><p>Check back for real photos, videos, and descriptions from recent cleaning projects in Brooklyn, Queens, and Manhattan.</p><a href="./book-now.html">Get My Instant Quote <span aria-hidden="true">→</span></a></section>';
    return;
  }

  root.innerHTML = posts.map(postMarkup).join("");

  function scrollToRequestedPost() {
    if (!window.location.hash) return;
    var postId = window.location.hash.slice(1);
    try {
      postId = decodeURIComponent(postId);
    } catch (error) {
      // Keep the original fragment if it is not valid encoded text.
    }
    var requestedPost = document.getElementById(postId);
    if (!requestedPost || !root.contains(requestedPost)) return;
    window.requestAnimationFrame(function () {
      requestedPost.scrollIntoView({ block: "start" });
    });
  }

  scrollToRequestedPost();
  window.addEventListener("hashchange", scrollToRequestedPost);
}());
