const assert = require("assert");
const { sanitize, validate } = require("../api/crm/_contacts");

(() => {
  const record = sanitize({
    name: "  Monthly Client  ",
    email: "CLIENT@EXAMPLE.COM",
    phone: "929-555-0100",
    customerType: "monthly_recurring",
    emailMarketingEligible: true,
    smsMarketingConsent: true,
    smsConsentSource: "Written permission on file"
  });
  validate(record);
  assert.equal(record.name, "Monthly Client");
  assert.equal(record.email, "client@example.com");
  assert.equal(record.customerType, "monthly_recurring");
  assert.equal(record.smsMarketingConsent, true);

  const noConsent = sanitize({ name: "Past Customer", email: "past@example.com", customerType: "past_inactive" });
  validate(noConsent);
  assert.equal(noConsent.phone, "");
  assert.equal(noConsent.smsMarketingConsent, false);
  console.log("CRM manual-contact tests passed.");
})();
