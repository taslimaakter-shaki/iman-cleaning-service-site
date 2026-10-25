const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const OUT_DIR = "/Users/taslimaaktershaki/Downloads/nyc_apartment_contacts_1000";
const TARGET_RECORDS = Number(process.env.TARGET_RECORDS || 1000);
const TARGET_CANDIDATES = Number(process.env.TARGET_CANDIDATES || 1500);
const NODE_MODULES = "/Users/taslimaaktershaki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const CANDIDATES_PATH = path.join(OUT_DIR, "google_maps_candidates.json");
const CONTACTS_PATH = path.join(OUT_DIR, "nyc_apartment_contacts.json");
const PROGRESS_PATH = path.join(OUT_DIR, "progress.json");

fs.mkdirSync(OUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function nycZips() {
  const ranges = [
    [10001, 10282],
    [10301, 10314],
    [10451, 10475],
    [11101, 11109],
    [11201, 11256],
    [11351, 11385],
    [11411, 11436],
    [11691, 11697],
  ];
  const extra = [11004, 11005];
  const zips = new Set(extra.map(String));
  for (const [start, end] of ranges) {
    for (let zip = start; zip <= end; zip += 1) zips.add(String(zip));
  }
  return [...zips].sort();
}

function searchQueries() {
  const terms = [
    "apartment buildings",
    "apartment rental agency",
    "apartment complex",
    "luxury apartments",
  ];
  const queries = [];
  for (const term of terms) {
    for (const zip of nycZips()) queries.push(`${term} in ${zip} New York`);
  }
  return queries;
}

function canonicalMapsUrl(url) {
  if (!url) return "";
  const stripped = url.split("?")[0];
  return stripped.replace(/\/@.*$/, "");
}

async function collectCandidates(browser) {
  const existing = fs.existsSync(CANDIDATES_PATH)
    ? JSON.parse(fs.readFileSync(CANDIDATES_PATH, "utf8"))
    : [];
  const seen = new Map(existing.map((item) => [canonicalMapsUrl(item.url), item]));
  const queries = searchQueries();
  let queryIndex = 0;

  async function worker(workerId) {
    const page = await browser.newPage({ locale: "en-US", viewport: { width: 1280, height: 900 } });
    while (queryIndex < queries.length && seen.size < TARGET_CANDIDATES) {
      const query = queries[queryIndex++];
      const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(4500);
        const links = await page.locator('a[href*="/maps/place"]').evaluateAll((els) =>
          els.map((a) => ({
            url: a.href,
            text: a.innerText || a.getAttribute("aria-label") || "",
          }))
        );
        for (const link of links) {
          const key = canonicalMapsUrl(link.url);
          if (!key || seen.has(key)) continue;
          seen.set(key, {
            url: link.url,
            canonical_url: key,
            first_seen_query: query,
            result_text: cleanText(link.text),
          });
        }
      } catch (error) {
        console.error(`[candidate worker ${workerId}] ${query}: ${error.message}`);
      }
      if (queryIndex % 25 === 0 || seen.size >= TARGET_CANDIDATES) {
        fs.writeFileSync(CANDIDATES_PATH, JSON.stringify([...seen.values()], null, 2));
        writeProgress({ stage: "candidates", candidates: seen.size, queries_done: queryIndex, total_queries: queries.length });
        console.log(`[candidates] ${seen.size} unique profiles after ${queryIndex}/${queries.length} queries`);
      }
      await sleep(300);
    }
    await page.close();
  }

  await Promise.all([0, 1, 2, 3].map(worker));
  const result = [...seen.values()];
  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(result, null, 2));
  writeProgress({ stage: "candidates_done", candidates: result.length, queries_done: queryIndex, total_queries: queries.length });
  return result;
}

function writeProgress(update) {
  const previous = fs.existsSync(PROGRESS_PATH) ? JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8")) : {};
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ ...previous, ...update, updated_at: new Date().toISOString() }, null, 2));
}

function extractAddressFromText(text) {
  const lines = String(text || "").split(/\n+/).map(cleanText).filter(Boolean);
  const zipLine = lines.find((line) => /\bNY\s+\d{5}(?:-\d{4})?\b/i.test(line) && /\d/.test(line));
  if (zipLine) return zipLine;
  return lines.find((line) => /\d{1,5}\s+[^,]+,\s*(?:New York|NY|Brooklyn|Queens|Bronx|Staten Island)/i.test(line)) || "";
}

function extractPhoneFromText(text) {
  const match = String(text || "").match(/(?:\+1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
  return match ? cleanText(match[0]) : "";
}

function extractWebsiteFromButtons(buttons) {
  const website = buttons.find((item) => /^Website:/i.test(item.aria || "") && item.href && !item.href.includes("google."));
  if (website) return website.href;
  const external = buttons.find((item) => item.href && /^https?:\/\//i.test(item.href) && !/google\.|gstatic\.|schema\.org/i.test(item.href));
  return external ? external.href : "";
}

function extractPhoneFromButtons(buttons) {
  const phone = buttons.find((item) => /^Phone:/i.test(item.aria || ""));
  if (phone) return cleanText((phone.aria || "").replace(/^Phone:\s*/i, ""));
  const call = buttons.find((item) => (item.href || "").startsWith("tel:"));
  if (call) return cleanText(call.href.replace(/^tel:/i, ""));
  return "";
}

function normalizeWebsite(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function sameDomain(url, base) {
  try {
    const a = new URL(url);
    const b = new URL(base);
    const ah = a.hostname.replace(/^www\./, "");
    const bh = b.hostname.replace(/^www\./, "");
    return ah === bh || ah.endsWith(`.${bh}`) || bh.endsWith(`.${ah}`);
  } catch {
    return false;
  }
}

function findEmails(text) {
  const emails = new Set();
  const decoded = String(text || "")
    .replace(/%40/g, "@")
    .replace(/\s*\[at\]\s*/gi, "@")
    .replace(/\s*\(at\)\s*/gi, "@")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s*\[dot\]\s*/gi, ".")
    .replace(/\s*\(dot\)\s*/gi, ".");
  const matches = decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi) || [];
  for (const raw of matches) {
    const email = raw
      .replace(/^mailto:/i, "")
      .replace(/[.,;:)]+$/g, "")
      .toLowerCase();
    if (!email.includes("example.") && !/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i.test(email)) emails.add(email);
  }
  return [...emails];
}

async function fetchWithTimeout(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !/text|html|xml|json/i.test(contentType)) return { ok: false, url, text: "" };
    const text = await response.text();
    return { ok: true, url: response.url || url, text };
  } catch {
    return { ok: false, url, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

function extractLinks(html, baseUrl) {
  const links = new Set();
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const href = match[1].trim();
    const label = match[2].replace(/<[^>]+>/g, " ");
    if (!/(contact|leasing|lease|office|about|management|team|resident|inquir|tour|visit)/i.test(`${href} ${label}`)) continue;
    try {
      const absolute = new URL(href, baseUrl).toString();
      if (sameDomain(absolute, baseUrl)) links.add(absolute);
    } catch {}
  }
  return [...links].slice(0, 8);
}

async function findWebsiteEmails(website) {
  const site = normalizeWebsite(website);
  if (!site) return { emails: [], checked_pages: [], contact_page: "" };
  const checked = [];
  const found = new Set();
  const home = await fetchWithTimeout(site);
  if (home.ok) {
    checked.push(home.url);
    findEmails(home.text).forEach((email) => found.add(email));
  }
  const links = home.ok ? extractLinks(home.text, home.url) : [];
  const fallbackPaths = ["/contact", "/contact-us", "/leasing", "/about", "/management"];
  for (const fallbackPath of fallbackPaths) {
    if (links.length >= 8) break;
    try {
      const candidate = new URL(fallbackPath, site).toString();
      if (!links.includes(candidate)) links.push(candidate);
    } catch {}
  }
  for (const link of links.slice(0, 8)) {
    if (checked.includes(link)) continue;
    const page = await fetchWithTimeout(link);
    if (!page.ok) continue;
    checked.push(page.url);
    findEmails(page.text).forEach((email) => found.add(email));
    if (found.size >= 5) break;
  }
  return {
    emails: [...found],
    checked_pages: checked,
    contact_page: links[0] || "",
  };
}

async function scrapePlace(page, candidate) {
  await page.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3800);
  const title = cleanText((await page.title()).replace(/\s*-\s*Google Maps\s*$/i, ""));
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/unusual traffic|not a robot|captcha/i.test(text)) throw new Error("Google captcha/unusual traffic page detected");
  const buttons = await page.locator("a,button").evaluateAll((els) =>
    els.map((el) => ({
      text: el.innerText || "",
      href: el.href || "",
      aria: el.getAttribute("aria-label") || "",
    }))
  );
  const website = extractWebsiteFromButtons(buttons);
  const phone = extractPhoneFromButtons(buttons) || extractPhoneFromText(text);
  const address = extractAddressFromText(text);
  const categoryLine = String(text || "")
    .split(/\n+/)
    .map(cleanText)
    .find((line) => /Apartment|Condominium|Property management|Real estate/i.test(line) && !line.includes(title));
  return {
    name: title,
    category: categoryLine || "",
    address,
    phone,
    website,
    google_business_profile: page.url(),
    source_query: candidate.first_seen_query || "",
  };
}

async function enrichContacts(browser, candidates) {
  const existing = fs.existsSync(CONTACTS_PATH)
    ? JSON.parse(fs.readFileSync(CONTACTS_PATH, "utf8"))
    : [];
  const seenProfiles = new Set(existing.map((item) => canonicalMapsUrl(item.google_business_profile || item.candidate_url || "")));
  const contacts = [...existing];
  const queue = candidates.filter((candidate) => !seenProfiles.has(canonicalMapsUrl(candidate.url)));
  let next = 0;

  async function worker(workerId) {
    const page = await browser.newPage({ locale: "en-US", viewport: { width: 1280, height: 900 } });
    while (next < queue.length && contacts.length < TARGET_RECORDS) {
      const candidate = queue[next++];
      try {
        const profile = await scrapePlace(page, candidate);
        if (!/apartment|condominium|property|real estate|housing|rental|residence/i.test(`${profile.name} ${profile.category}`)) {
          continue;
        }
        const emailInfo = await findWebsiteEmails(profile.website);
        const record = {
          ...profile,
          email: emailInfo.emails[0] || "",
          all_emails_found: emailInfo.emails.join(", "),
          contact_page_checked: emailInfo.contact_page,
          website_pages_checked: emailInfo.checked_pages.join(" | "),
          candidate_url: candidate.url,
          scraped_at: new Date().toISOString(),
        };
        contacts.push(record);
        if (contacts.length % 10 === 0) {
          fs.writeFileSync(CONTACTS_PATH, JSON.stringify(contacts, null, 2));
          writeProgress({ stage: "contacts", contacts: contacts.length, candidates_done: next, candidate_total: queue.length });
          console.log(`[contacts] ${contacts.length}/${TARGET_RECORDS} records, ${contacts.filter((item) => item.email).length} with email`);
        }
      } catch (error) {
        console.error(`[detail worker ${workerId}] ${candidate.url}: ${error.message}`);
        if (/captcha/i.test(error.message)) throw error;
      }
      await sleep(500);
    }
    await page.close();
  }

  await Promise.all([0, 1, 2].map(worker));
  fs.writeFileSync(CONTACTS_PATH, JSON.stringify(contacts, null, 2));
  writeProgress({
    stage: "contacts_done",
    contacts: contacts.length,
    contacts_with_email: contacts.filter((item) => item.email).length,
  });
  return contacts;
}

async function main() {
  console.log(`Using node_modules at ${NODE_MODULES}`);
  console.log(`Saving output in ${OUT_DIR}`);
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const candidates = await collectCandidates(browser);
    console.log(`[candidates] done: ${candidates.length}`);
    const contacts = await enrichContacts(browser, candidates);
    console.log(`[contacts] done: ${contacts.length}, with email: ${contacts.filter((item) => item.email).length}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
