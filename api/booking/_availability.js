const {
  availableSlotsForPackage,
  calculateHourlyCleaningQuote,
  calculateWindowQuote,
  calculateResidentialQuoteBundle,
  catalogForClient,
  getPackageBundle,
  isNYCServiceZip,
  temporarilyPausedServiceBorough,
  json,
  packageForClient,
  readJsonBody,
  recommendResidentialService
} = require("./_shared");

module.exports = async function handler(request, response) {
  try {
    if (!["GET", "POST"].includes(request.method)) {
      return json(response, 405, { error: "Method not allowed." });
    }
    if (request.method === "GET" && request.query?.calendarStatus === "1") {
      await require('./_calendar').assertCalendarReady();
      return json(response, 200, { ready: true, gapHours: 3 });
    }
    if (request.method === "GET" && request.query?.googleCalendarStatus === "1") {
      try {
        const connection = await require('./_shared').googleCalendarConnectionStatus();
        return json(response, connection.connected && connection.writable ? 200 : 503, connection);
      } catch {
        return json(response, 503, { connected: false, writable: false, error: 'Google Calendar access needs to be authorized for the website.' });
      }
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      const pausedBorough = temporarilyPausedServiceBorough(body.serviceZip);
      if (pausedBorough) {
        return json(response, 409, { error: `We’re temporarily not providing service in ${pausedBorough}. We expect to resume service there soon.` });
      }
      if (!isNYCServiceZip(body.serviceZip)) {
        return json(response, 400, { error: "Enter a ZIP code within our New York City service area." });
      }
      const serviceKey = String(body.serviceKey || "").trim();
      if (serviceKey === "organization") {
        return json(response, 410, { error: "Organization Service is no longer available. Please choose another cleaning service." });
      }
      if (serviceKey === "hourly" && body.pricingMode === "hourly_formula") {
        const pkg = calculateHourlyCleaningQuote(body.unitDetails?.[0]?.hours);
        const slots = await availableSlotsForPackage(pkg);
        return json(response, 200, { package: packageForClient(pkg), slots });
      }
      if (serviceKey === "window" && body.pricingMode === "window_formula") {
        const pkg = calculateWindowQuote(body.unitDetails?.[0], body.serviceZip);
        const slots = await availableSlotsForPackage(pkg);
        return json(response, 200, { package: packageForClient(pkg), slots });
      }
      if (!["standard", "recurring", "deep", "move", "post"].includes(serviceKey) || body.pricingMode !== `${serviceKey}_formula`) {
        return json(response, 400, { error: "This pricing request is not supported." });
      }
      const pkg = calculateResidentialQuoteBundle(body.unitDetails, serviceKey, body.eligibility);
      const slots = await availableSlotsForPackage(pkg);
      return json(response, 200, { package: packageForClient(pkg), slots });
    }

    const packageId = String(request.query?.packageId || "");
    const packageIds = String(request.query?.packageIds || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!packageId && !packageIds.length) {
      return json(response, 200, {
        catalog: catalogForClient(),
        teamSize: 2
      });
    }

    const pkg = packageIds.length ? getPackageBundle(packageIds) : getPackageBundle([packageId]);
    if (!pkg) return json(response, 404, { error: "Cleaning package not found." });

    const slots = await availableSlotsForPackage(pkg);
    return json(response, 200, { package: packageForClient(pkg), slots });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Availability could not be loaded.",
      setup: error.setup,
      details: error.details
    });
  }
};

module.exports.recommendResidentialService = recommendResidentialService;
