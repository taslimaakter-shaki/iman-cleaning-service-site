// Match service names and legacy pricing keys, never room notes or package extras.
const windowTerms = new Set("window windows cleaning washing service services standalone residential commercial storefront interior exterior and only instant quote formula".split(" "));

function isStandaloneWindowService(value) {
  const words = String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  return (words.includes("window") || words.includes("windows")) && words.every(word => windowTerms.has(word));
}

const unavailableMessage = "Standalone window cleaning is no longer available. Please choose another cleaning service.";
module.exports = { isStandaloneWindowService, unavailableMessage };
