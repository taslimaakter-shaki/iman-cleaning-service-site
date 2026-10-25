(() => {
  const directPrefixes = new Set([
    "100", "101", "102", "103", "104",
    "111", "112", "113", "114", "116"
  ]);

  // NYC Finance identifies these two 110 ZIP codes as Queens. Other 110 ZIP
  // codes can cross the city boundary and require address-level review.
  const queensSplitZips = new Set(["11004", "11005"]);
  const temporarilyPausedPrefixes = new Map([
    ["103", "Staten Island"],
    ["104", "the Bronx"]
  ]);

  const normalize = (zip) => String(zip || "").replace(/\D/g, "").slice(0, 5);
  const isValid = (zip) => /^\d{5}$/.test(String(zip || ""));
  const isServed = (zip) => {
    const normalized = normalize(zip);
    if (!isValid(normalized)) return false;
    return directPrefixes.has(normalized.slice(0, 3)) || queensSplitZips.has(normalized);
  };
  const temporarilyPausedBorough = (zip) => {
    const normalized = normalize(zip);
    if (!isValid(normalized)) return "";
    return temporarilyPausedPrefixes.get(normalized.slice(0, 3)) || "";
  };

  const serviceArea = { normalize, isValid, isServed, temporarilyPausedBorough };
  if (typeof window !== "undefined") window.IMAN_BOOKING_SERVICE_AREA = serviceArea;
  if (typeof module !== "undefined" && module.exports) module.exports = serviceArea;
})();
