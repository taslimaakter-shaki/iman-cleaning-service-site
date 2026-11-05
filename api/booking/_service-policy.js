const { isStandaloneWindowService, unavailableMessage } = require("../../cloud-run/gemini-estimator/service-policy");

function isRetiredWindowQuote(record = {}) {
  const form = record.formFields || {};
  return [
    record.service, record.service_label, record.serviceLabel, record.serviceKey, record.pricingMode, record.packageId,
    ...(Array.isArray(record.packageIds) ? record.packageIds : []),
    record.eligibility?.requestedService, record.eligibility?.cleaningCategory,
    record.estimate?.serviceKey, record.estimate?.eligibility?.requestedService, record.estimate?.pricingMode,
    record.packageSnapshot?.serviceKey, record.packageSnapshot?.id, record.packageSnapshot?.pricingMode,
    record.crmQuote?.fields?.service, form["Requested Service"], form["Service Type"],
    form.Service, form["Cleaning Service"], form.service, form["Service Category"]
  ].some(isStandaloneWindowService);
}

function assertServiceAvailable(record) {
  if (isRetiredWindowQuote(record)) {
    throw Object.assign(new Error(unavailableMessage), { statusCode: 410 });
  }
}

module.exports = { isRetiredWindowQuote, assertServiceAvailable };
