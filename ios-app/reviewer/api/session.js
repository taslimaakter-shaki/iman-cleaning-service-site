const { createHash, timingSafeEqual } = require("node:crypto");
const { sha256 } = require("../reviewer-hash.json");

// This standalone service has no business database, staff keys, or payment integrations.
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Sign in using POST." });
  const key = req.headers["x-review-key"];
  const digest = createHash("sha256").update(typeof key === "string" ? key : "").digest();
  if (!timingSafeEqual(digest, Buffer.from(sha256, "hex"))) {
    return res.status(401).json({ error: "Invalid review access key." });
  }
  return res.status(200).json({ account: "app-review", workspace: "sample" });
};
