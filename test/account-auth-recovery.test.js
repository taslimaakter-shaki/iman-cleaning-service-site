const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.PUBLIC_SITE_URL = "https://www.imancleaningservice.com";

function request(body, overrides = {}) {
  return {
    method: "POST",
    body,
    headers: {
      host: "www.imancleaningservice.com",
      origin: "https://www.imancleaningservice.com",
      "x-forwarded-for": "203.0.113.20",
      ...(overrides.headers || {})
    },
    socket: { remoteAddress: "203.0.113.20" },
    ...overrides
  };
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(value) {
      this.body = value;
      this.data = JSON.parse(value || "{}");
    }
  };
}

async function call(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

const calls = [];
global.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  const payload = options.body ? JSON.parse(options.body) : {};
  if (payload.email === "provider-limited@example.com") {
    return {
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ message: "Email rate limit exceeded" })
    };
  }
  if (payload.email === "provider-outage@example.com") {
    return {
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ message: "Provider unavailable" })
    };
  }
  if (payload.email === "unknown-provider@example.com") {
    return {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: "User not found" })
    };
  }
  if (payload.email === "network-outage@example.com") throw new Error("network unavailable");
  if (String(url).includes("/auth/v1/user")) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: "user-123",
        email: "customer@example.com",
        email_confirmed_at: "2026-08-24T00:00:00.000Z",
        user_metadata: { full_name: "Customer Name" }
      })
    };
  }
  return { ok: true, status: 200, text: async () => "{}" };
};

async function run() {
  const forgotPassword = require("../api/account/_forgot-password");
  const magicLink = require("../api/account/_magic-link");
  const resetPassword = require("../api/account/_reset-password");
  const signup = require("../api/account/_signup");
  const confirm = require("../api/account/_confirm");

  calls.length = 0;
  let res = await call(forgotPassword, request({ email: " Customer@Example.com " }));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.data.ok, true);
  assert.match(res.data.message, /If an account exists/i);
  assert.match(calls[0].url, /\/auth\/v1\/recover\?redirect_to=/);
  assert.match(decodeURIComponent(calls[0].url), /https:\/\/www\.imancleaningservice\.com\/reset-password\.html/);
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { email: "customer@example.com" });

  calls.length = 0;
  res = await call(magicLink, request(
    { email: "member@example.com" },
    { headers: { host: "www.imancleaningservice.com", origin: "https://www.imancleaningservice.com", "x-forwarded-for": "203.0.113.21" } }
  ));
  assert.strictEqual(res.statusCode, 200);
  assert.match(calls[0].url, /\/auth\/v1\/otp\?redirect_to=/);
  assert.match(decodeURIComponent(calls[0].url), /https:\/\/www\.imancleaningservice\.com\/account-confirmed\.html/);
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { email: "member@example.com", create_user: false });

  calls.length = 0;
  res = await call(magicLink, request(
    { email: "unknown-provider@example.com" },
    { headers: { host: "www.imancleaningservice.com", origin: "https://www.imancleaningservice.com", "x-forwarded-for": "203.0.113.30" } }
  ));
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.data.message, /If an account exists/i);

  calls.length = 0;
  let limitedResponse;
  for (let index = 0; index < 5; index += 1) {
    limitedResponse = await call(magicLink, request(
      { email: "limited@example.com" },
      { headers: { host: "www.imancleaningservice.com", origin: "https://www.imancleaningservice.com", "x-forwarded-for": "203.0.113.24" } }
    ));
  }
  assert.strictEqual(limitedResponse.statusCode, 429);
  assert.match(limitedResponse.headers["retry-after"], /^\d+$/);
  assert.strictEqual(calls.length, 4);

  calls.length = 0;
  res = await call(magicLink, request(
    { email: "provider-limited@example.com" },
    { headers: { host: "www.imancleaningservice.com", origin: "https://www.imancleaningservice.com", "x-forwarded-for": "203.0.113.25" } }
  ));
  assert.strictEqual(res.statusCode, 429);
  assert.match(res.data.error, /wait a minute/i);

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    calls.length = 0;
    res = await call(forgotPassword, request(
      { email: "provider-outage@example.com" },
      { headers: { host: "www.imancleaningservice.com", origin: "https://www.imancleaningservice.com", "x-forwarded-for": "203.0.113.26" } }
    ));
    assert.strictEqual(res.statusCode, 503);
    assert.match(res.data.error, /temporarily unavailable/i);

    calls.length = 0;
    res = await call(magicLink, request(
      { email: "network-outage@example.com" },
      { headers: { host: "www.imancleaningservice.com", origin: "https://www.imancleaningservice.com", "x-forwarded-for": "203.0.113.27" } }
    ));
    assert.strictEqual(res.statusCode, 503);
    assert.match(res.data.error, /temporarily unavailable/i);
  } finally {
    console.error = originalConsoleError;
  }

  calls.length = 0;
  res = await call(forgotPassword, request(
    { email: "not-an-email" },
    { headers: { host: "www.imancleaningservice.com", origin: "https://www.imancleaningservice.com", "x-forwarded-for": "203.0.113.22" } }
  ));
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(calls.length, 0);

  calls.length = 0;
  res = await call(confirm, request({
    accessToken: "confirmed-access-token",
    refreshToken: "confirmed-refresh-token",
    expiresIn: "invalid"
  }));
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.headers["set-cookie"][0], /Max-Age=3600/);

  calls.length = 0;
  res = await call(signup, request({
    fullName: "New Customer",
    email: "new-customer@example.com",
    phone: "929-555-0100",
    password: "new-password"
  }, {
    headers: { host: "www.imancleaningservice.com", origin: "https://www.imancleaningservice.com", "x-forwarded-for": "203.0.113.29" }
  }));
  assert.strictEqual(res.statusCode, 201);
  assert.match(decodeURIComponent(calls[0].url), /\/auth\/v1\/signup\?redirect_to=https:\/\/www\.imancleaningservice\.com\/account-confirmed\.html/);

  calls.length = 0;
  res = await call(resetPassword, request({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresIn: "not-a-number",
    password: "new-password"
  }));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls[0].url, "https://example.supabase.co/auth/v1/user");
  assert.strictEqual(calls[0].options.method, "PUT");
  assert.strictEqual(calls[0].options.headers.Authorization, "Bearer access-token");
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { password: "new-password" });
  assert.strictEqual(res.headers["set-cookie"].length, 2);
  assert.match(res.headers["set-cookie"][0], /Max-Age=3600/);
  res.headers["set-cookie"].forEach((cookie) => {
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
  });
  assert.match(calls[1].url, /\/auth\/v1\/logout\?scope=others$/);
  assert.strictEqual(calls[1].options.headers.Authorization, "Bearer access-token");

  calls.length = 0;
  res = await call(magicLink, request(
    { email: "blocked@example.com" },
    { headers: { host: "www.imancleaningservice.com", origin: "https://attacker.example", "x-forwarded-for": "203.0.113.28" } }
  ));
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(calls.length, 0);

  calls.length = 0;
  res = await call(forgotPassword, request(
    { email: "cross-site@example.com" },
    { headers: { host: "www.imancleaningservice.com", origin: undefined, "sec-fetch-site": "cross-site", "x-forwarded-for": "203.0.113.31" } }
  ));
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(calls.length, 0);

  calls.length = 0;
  res = await call(forgotPassword, request(
    { email: "wrong-scheme@example.com" },
    { headers: { host: "www.imancleaningservice.com", origin: "http://www.imancleaningservice.com", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.32" } }
  ));
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(calls.length, 0);

  calls.length = 0;
  res = await call(resetPassword, request({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    password: "short"
  }));
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(calls.length, 0);

  const route = require("../api/account/[action]");
  calls.length = 0;
  const routeRequest = request({ email: "route@example.com" }, {
    query: { action: "magic-link" },
    headers: { host: "www.imancleaningservice.com", origin: "https://www.imancleaningservice.com", "x-forwarded-for": "203.0.113.23" }
  });
  res = await call(route, routeRequest);
  assert.strictEqual(res.statusCode, 200);
  assert.match(calls[0].url, /\/auth\/v1\/otp\?/);

  calls.length = 0;
  res = await call(route, request({ email: "forgot-route@example.com" }, {
    query: { action: "forgot-password" },
    headers: { host: "www.imancleaningservice.com", origin: "https://www.imancleaningservice.com", "x-forwarded-for": "203.0.113.33" }
  }));
  assert.strictEqual(res.statusCode, 200);
  assert.match(calls[0].url, /\/auth\/v1\/recover\?/);

  calls.length = 0;
  res = await call(route, request({ password: "short" }, {
    query: { action: "reset-password" },
    headers: { host: "www.imancleaningservice.com", origin: "https://www.imancleaningservice.com", "x-forwarded-for": "203.0.113.34" }
  }));
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(calls.length, 0);

  const callbackSource = fs.readFileSync(require.resolve("../account-auth-callback.js"), "utf8");
  const callbackDestination = (hash) => {
    let destination = "";
    const callbackWindow = {};
    vm.runInNewContext(callbackSource, {
      URLSearchParams,
      window: callbackWindow,
      location: {
        hash,
        pathname: "/",
        replace(value) { destination = value; }
      }
    });
    return { destination, redirecting: callbackWindow.__IMAN_AUTH_REDIRECT__ };
  };
  let callbackResult = callbackDestination("#access_token=a&refresh_token=b&type=recovery");
  assert.match(callbackResult.destination, /^\/reset-password\.html#/);
  assert.strictEqual(callbackResult.redirecting, true);
  callbackResult = callbackDestination("#access_token=a&refresh_token=b&type=magiclink");
  assert.match(callbackResult.destination, /^\/account-confirmed\.html#/);
  assert.strictEqual(callbackResult.redirecting, true);

  const homepage = fs.readFileSync(require.resolve("../index.html"), "utf8");
  assert.ok(
    homepage.indexOf("account-auth-callback.js?v=20260824-recovery") < homepage.indexOf("analyticsScript.src"),
    "The auth callback must run before analytics is loaded."
  );
  assert.match(homepage, /if \(!window\.__IMAN_AUTH_REDIRECT__\)/);
  assert.doesNotMatch(homepage, /<script\s+async\s+src="https:\/\/www\.googletagmanager\.com/);

  console.log("account auth recovery tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
