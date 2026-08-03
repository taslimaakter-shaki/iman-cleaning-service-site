(() => {
  const directPrefixes = new Set([
    "100", "101", "102", "103", "104",
    "111", "112", "113", "114", "115", "116", "118"
  ]);

  const westernLongIslandZips = new Set([
    "11001", "11002", "11003", "11004", "11005", "11010", "11020", "11021",
    "11022", "11023", "11024", "11030", "11040", "11041", "11042", "11050",
    "11051", "11052", "11053", "11054", "11055", "11096"
  ]);

  const easternLongIslandZips = new Set([
    "11701", "11702", "11709", "11710", "11714", "11724", "11732", "11735",
    "11736", "11753", "11756", "11758", "11762", "11765", "11771", "11773",
    "11774", "11783", "11791", "11793", "11797"
  ]);

  const normalize = (zip) => String(zip || "").replace(/\D/g, "").slice(0, 5);
  const isValid = (zip) => /^\d{5}$/.test(String(zip || ""));
  const isServed = (zip) => {
    const normalized = normalize(zip);
    if (!isValid(normalized)) return false;
    return directPrefixes.has(normalized.slice(0, 3)) ||
      westernLongIslandZips.has(normalized) ||
      easternLongIslandZips.has(normalized);
  };

  const serviceArea = { normalize, isValid, isServed };
  if (typeof window !== "undefined") window.IMAN_BOOKING_SERVICE_AREA = serviceArea;
  if (typeof module !== "undefined" && module.exports) module.exports = serviceArea;
})();
