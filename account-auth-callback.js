(() => {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const hasSession = hash.has("access_token") && hash.has("refresh_token");
  const hasAuthResult = hasSession || hash.has("error") || hash.has("error_description");
  if (!hasAuthResult || location.pathname.endsWith("/account-confirmed.html")) return;
  location.replace(`/account-confirmed.html${location.hash}`);
})();
