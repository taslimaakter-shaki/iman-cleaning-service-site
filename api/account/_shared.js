const crypto = require("node:crypto");

const ACCESS_COOKIE = "iman_customer_access";
const REFRESH_COOKIE = "iman_customer_refresh";
const DEFAULT_PUBLIC_SITE_URL = "https://www.imancleaningservice.com";
const ACCOUNT_EMAIL_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const ACCOUNT_EMAIL_RATE_LIMIT_MAX = 4;
const ACCOUNT_IP_RATE_LIMIT_MAX = 12;
const recentAccountEmailRequests = new Map();

function cleanText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function validEmail(value) {
  const email = cleanText(value, 180).toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "";
}

function publicAccountUrl(pathname) {
  const configuredUrls = [process.env.PUBLIC_SITE_URL, process.env.SITE_URL];
  let baseUrl = DEFAULT_PUBLIC_SITE_URL;
  for (const configured of configuredUrls) {
    if (!cleanText(configured, 500)) continue;
    try {
      const url = new URL(cleanText(configured, 500));
      if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) continue;
      baseUrl = url.origin;
      break;
    } catch {
      // Ignore an invalid override and keep the explicit production URL.
    }
  }
  return new URL(String(pathname || "/"), `${baseUrl}/`).toString();
}

function requestAddress(request) {
  return cleanText(
    String(request.headers?.["x-forwarded-for"] || "").split(",")[0]
      || request.headers?.["x-real-ip"]
      || request.socket?.remoteAddress
      || "unknown",
    160
  );
}

function consumeAccountEmailRateLimit(request, email, action, now = Date.now()) {
  if (recentAccountEmailRequests.size > 1000) {
    for (const [key, value] of recentAccountEmailRequests) {
      if (now - value.windowStartedAt >= ACCOUNT_EMAIL_RATE_LIMIT_WINDOW_MS) {
        recentAccountEmailRequests.delete(key);
      }
    }
  }
  const normalizedAction = cleanText(action, 40);
  const buckets = [
    { value: `ip|${normalizedAction}|${requestAddress(request)}`, maximum: ACCOUNT_IP_RATE_LIMIT_MAX },
    { value: `email|${normalizedAction}|${cleanText(email, 180).toLowerCase()}`, maximum: ACCOUNT_EMAIL_RATE_LIMIT_MAX }
  ].map(({ value, maximum }) => ({
    key: crypto.createHash("sha256").update(value).digest("hex"),
    maximum
  }));

  for (const bucket of buckets) {
    const current = recentAccountEmailRequests.get(bucket.key);
    if (current && now - current.windowStartedAt < ACCOUNT_EMAIL_RATE_LIMIT_WINDOW_MS && current.count >= bucket.maximum) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(
          (ACCOUNT_EMAIL_RATE_LIMIT_WINDOW_MS - (now - current.windowStartedAt)) / 1000
        ))
      };
    }
  }

  for (const bucket of buckets) {
    const current = recentAccountEmailRequests.get(bucket.key);
    if (!current || now - current.windowStartedAt >= ACCOUNT_EMAIL_RATE_LIMIT_WINDOW_MS) {
      recentAccountEmailRequests.set(bucket.key, { count: 1, windowStartedAt: now });
    } else {
      current.count += 1;
    }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function json(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Enter valid account information."), { statusCode: 400 });
  }
}

function authConfig() {
  const url = cleanText(process.env.SUPABASE_URL, 500).replace(/\/$/, "");
  const key = cleanText(process.env.SUPABASE_ANON_KEY, 3000)
    || cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY, 3000);
  if (!url || !key) {
    throw Object.assign(new Error("Customer accounts are not configured yet."), {
      statusCode: 503,
      setup: "Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel."
    });
  }
  return { url, key };
}

function oauthAuthorizeUrl(provider, redirectTo) {
  const { url } = authConfig();
  const supportedProviders = new Set(["google"]);
  const normalizedProvider = cleanText(provider, 40).toLowerCase();
  if (!supportedProviders.has(normalizedProvider)) {
    throw Object.assign(new Error("This login provider is not supported."), { statusCode: 400 });
  }
  const destination = new URL(redirectTo);
  const allowedOrigin = new URL(publicAccountUrl("/")).origin;
  if (destination.origin !== allowedOrigin) {
    throw Object.assign(new Error("The login return address is not allowed."), { statusCode: 400 });
  }
  const authorizeUrl = new URL(`${url}/auth/v1/authorize`);
  authorizeUrl.searchParams.set("provider", normalizedProvider);
  authorizeUrl.searchParams.set("redirect_to", destination.toString());
  return authorizeUrl.toString();
}

function accountConfigAvailable() {
  return Boolean(
    cleanText(process.env.SUPABASE_URL, 500) &&
    (
      cleanText(process.env.SUPABASE_ANON_KEY, 3000) ||
      cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY, 3000)
    )
  );
}

async function authRequest(path, options = {}) {
  const { url, key } = authConfig();
  const response = await fetch(`${url}/auth/v1${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${options.accessToken || key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw Object.assign(new Error(data?.msg || data?.message || data?.error_description || "Account request failed."), {
      statusCode: response.status,
      details: data
    });
  }
  return data;
}

function parseCookies(request) {
  return String(request.headers?.cookie || "")
    .split(";")
    .reduce((cookies, item) => {
      const index = item.indexOf("=");
      if (index < 0) return cookies;
      const key = item.slice(0, index).trim();
      const value = item.slice(index + 1).trim();
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = "";
      }
      return cookies;
    }, {});
}

function secureCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function setSessionCookies(response, session) {
  if (!session?.access_token || !session?.refresh_token) return;
  response.setHeader("Set-Cookie", [
    secureCookie(ACCESS_COOKIE, session.access_token, Number(session.expires_in || 3600)),
    secureCookie(REFRESH_COOKIE, session.refresh_token, 60 * 60 * 24 * 30)
  ]);
}

function clearSessionCookies(response) {
  response.setHeader("Set-Cookie", [
    secureCookie(ACCESS_COOKIE, "", 0),
    secureCookie(REFRESH_COOKIE, "", 0)
  ]);
}

function sameOrigin(request) {
  const origin = cleanText(request.headers?.origin, 500);
  const fetchSite = cleanText(request.headers?.["sec-fetch-site"], 40).toLowerCase();
  if (!origin) return fetchSite !== "cross-site";
  const host = cleanText(request.headers?.["x-forwarded-host"] || request.headers?.host, 300);
  const forwardedProtocol = cleanText(request.headers?.["x-forwarded-proto"], 20)
    .split(",")[0]
    .toLowerCase();
  try {
    const originUrl = new URL(origin);
    if (originUrl.host !== host) return false;
    if (forwardedProtocol && originUrl.protocol !== `${forwardedProtocol}:`) return false;
    return true;
  } catch {
    return false;
  }
}

async function authenticatedUser(request, response, { required = false } = {}) {
  const cookies = parseCookies(request);
  let accessToken = cookies[ACCESS_COOKIE] || "";
  const refreshToken = cookies[REFRESH_COOKIE] || "";
  if (!accessToken && !refreshToken) {
    if (required) throw Object.assign(new Error("Please log in to continue."), { statusCode: 401 });
    return null;
  }
  try {
    const user = await authRequest("/user", { accessToken });
    return { user, accessToken };
  } catch (error) {
    if (!refreshToken) {
      clearSessionCookies(response);
      if (required) throw Object.assign(new Error("Your session expired. Please log in again."), { statusCode: 401 });
      return null;
    }
  }
  try {
    const session = await authRequest("/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: refreshToken }
    });
    setSessionCookies(response, session);
    accessToken = session.access_token;
    return { user: session.user, accessToken };
  } catch {
    clearSessionCookies(response);
    if (required) throw Object.assign(new Error("Your session expired. Please log in again."), { statusCode: 401 });
    return null;
  }
}

function publicUser(user) {
  if (!user) return null;
  const metadata = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email || "",
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
    fullName: cleanText(metadata.full_name, 160),
    phone: cleanText(metadata.phone || user.phone, 40)
  };
}

module.exports = {
  accountConfigAvailable,
  authRequest,
  authenticatedUser,
  cleanText,
  clearSessionCookies,
  consumeAccountEmailRateLimit,
  json,
  oauthAuthorizeUrl,
  publicAccountUrl,
  publicUser,
  readJsonBody,
  sameOrigin,
  setSessionCookies,
  validEmail
};
