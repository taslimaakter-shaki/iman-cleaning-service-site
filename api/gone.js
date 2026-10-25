module.exports = function handler(_request, response) {
  response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  response.status(410).send("This page has been permanently removed.");
};
