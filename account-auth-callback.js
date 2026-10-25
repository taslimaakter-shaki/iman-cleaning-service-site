(() => {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const hasSession = hash.has("access_token") && hash.has("refresh_token");
  const hasAuthResult = hasSession || hash.has("error") || hash.has("error_description");
  if (!hasAuthResult) return;
  const destination = hash.get("type") === "recovery"
    ? "/reset-password.html"
    : "/account-confirmed.html";
  if (location.pathname.endsWith(destination)) return;
  window.__IMAN_AUTH_REDIRECT__ = true;
  location.replace(`${destination}${location.hash}`);
})();
