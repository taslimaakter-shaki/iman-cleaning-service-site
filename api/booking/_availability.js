const {
  availableSlotsForPackage,
  calculateOrganizationQuote,
  calculateResidentialQuoteBundle,
  catalogForClient,
  getPackageBundle,
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

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      const serviceKey = String(body.serviceKey || "").trim();
      if (serviceKey === "organization" && body.pricingMode === "organization_formula") {
        const pkg = calculateOrganizationQuote(body.unitDetails?.[0]?.hours);
        const slots = await availableSlotsForPackage(pkg);
        return json(response, 200, { package: packageForClient(pkg), slots });
      }
      if (!["standard", "deep", "move"].includes(serviceKey) || body.pricingMode !== `${serviceKey}_formula`) {
        return json(response, 400, { error: "This pricing request is not supported." });
      }
      const pkg = calculateResidentialQuoteBundle(body.unitDetails, serviceKey);
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
