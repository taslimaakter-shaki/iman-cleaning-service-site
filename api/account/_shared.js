const ACCESS_COOKIE = "iman_customer_access";
const REFRESH_COOKIE = "iman_customer_refresh";

function cleanText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
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
  const key = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY, 3000);
  if (!url || !key) {
    throw Object.assign(new Error("Customer accounts are not configured yet."), {
      statusCode: 503,
      setup: "Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel."
    });
  }
  return { url, key };
}

function accountConfigAvailable() {
  return Boolean(
    cleanText(process.env.SUPABASE_URL, 500) &&
    cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY, 3000)
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
  if (!origin) return true;
  const host = cleanText(request.headers?.["x-forwarded-host"] || request.headers?.host, 300);
  try {
    return new URL(origin).host === host;
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
  json,
  publicUser,
  readJsonBody,
  sameOrigin,
  setSessionCookies
};
