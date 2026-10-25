import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entries = await readdir(root, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
  .map((entry) => path.join(root, entry.name));

const loginAction = '<a class="home-nav-action home-nav-action-secondary" href="./login.html" aria-label="Log in to your customer account">Log In</a>';
const staticLoginAction = '<a class="seo-static-button is-secondary is-small" href="./login.html" aria-label="Log in to your customer account">Log In</a>';

for (const file of files) {
  const original = await readFile(file, "utf8");
  const updated = original.replace(/<header\b[\s\S]*?<\/header>/gi, (header) => header
    .replace(/\s*<a\b[^>]*href=["'](?:\.\/|\/)login\.html["'][^>]*>\s*My Account\s*<\/a>/gi, "")
    .replace(/<a\b[^>]*class=["'][^"']*home-nav-action-secondary[^"']*["'][^>]*href=["']tel:\+19298034053["'][^>]*>\s*Call Us\s*<\/a>/gi, loginAction)
    .replace(/<a\b[^>]*class=["'][^"']*seo-static-button is-secondary is-small[^"']*["'][^>]*href=["']tel:\+19298034053["'][^>]*>\s*Call Us\s*<\/a>/gi, staticLoginAction)
  );

  if (updated !== original) await writeFile(file, updated);
}
