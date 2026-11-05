const assert = require("assert");
const { bookingQuote, customizedQuote, legacyFolderQuote, savedQuote } = require("../api/crm/_quotes");

const unpaid = bookingQuote({
  id: "BK-UNPAID",
  created_at: "2026-09-02T12:00:00.000Z",
  client_name: "Online Customer",
  service_label: "Standard Cleaning",
  estimate: { total: 400, payment: { totalCents: 40000, paidCents: 0, status: "deposit_pending" } }
});
assert.strictEqual(unpaid.type, "Instant quote");
assert.strictEqual(unpaid.status, "Awaiting deposit");
assert.strictEqual(unpaid.amountCents, 40000);

const paid = bookingQuote({
  ...unpaid,
  id: "BK-PAID",
  estimate: { payment: { totalCents: 40000, paidCents: 10000, status: "deposit_paid" } }
});
assert.strictEqual(paid.status, "Booked");

const custom = customizedQuote({
  quoteId: "QUOTE-123",
  status: "Submitted",
  folderLink: "https://drive.google.com/example",
  formFields: {
    "First Name": "Jane",
    "Last Name": "Doe",
    "Email": "jane@example.com",
    "Phone Number": "555-0100",
    "ZIP Code": "11432",
    "Requested Service": "Deep Cleaning"
  }
}, { id: "file-1" });
assert.strictEqual(custom.type, "Customized quote");
assert.strictEqual(custom.customerName, "Jane Doe");
assert.strictEqual(custom.service, "Deep Cleaning");
assert.strictEqual(custom.editFields.cleanerCount,0,"New custom quotes need a manually chosen team");
assert.strictEqual(custom.editFields.laborHours,0,"Do not invent labor hours");
assert.strictEqual(custom.paymentReady,false);
const submitted = customizedQuote({quoteId:"QUOTE-DETAILS",formFields:{"Service Type":"Post-construction cleaning","Street Address":"123 Example St",City:"Queens",State:"NY","ZIP Code":"11432","1st Priority Available Day":"2030-09-15","1st Priority Start Time":"8:00 AM","Project Details":"Kitchen only"}},{});
assert.strictEqual(submitted.service,"Post-construction cleaning");
assert.strictEqual(submitted.editFields.serviceDate,"2030-09-15");assert.strictEqual(submitted.editFields.serviceTime,"08:00");
assert.strictEqual(submitted.editFields.address,"123 Example St, Queens, NY, 11432");assert.strictEqual(submitted.editFields.details,"Kitchen only");

const legacy = legacyFolderQuote({
  id: "folder-1",
  name: "QUOTE-20260902000000000 - Legacy Customer",
  createdTime: "2026-09-02T12:00:00.000Z"
});
assert.strictEqual(legacy.customerName, "Legacy Customer");
assert.strictEqual(legacy.type, "Customized quote");

const saved = savedQuote({
  quoteId: "SAVED-123",
  createdAt: Date.now(),
  expiresAt: Date.now() + 100000,
  customer: { firstName: "Sam", lastName: "Smith", email: "sam@example.com" },
  eligibility: { requestedService: "unknown", serviceZip: "11367" },
  unitDetails: []
}, { id: "file-2", appProperties: {} });
assert.strictEqual(saved.type, "Instant quote");
assert.strictEqual(saved.status, "Quote sent");
assert.strictEqual(saved.customerName, "Sam Smith");

console.log("CRM quote tests passed");

const discounted = bookingQuote({id:'BK-DISCOUNTED', estimate:{total:206.09,
  promoCode:'FALL10', promoDiscount:{label:'Fall cleaning discount',percent:5,amountCents:1052},
  arrivalDiscount:{label:'Anytime that day arrival discount',percent:5,amountCents:1052},
  payment:{totalCents:20609,depositCents:5152,paidCents:0}}});
assert.deepStrictEqual(discounted.appliedDiscounts.map(d=>d.amountCents),[1052,1052]);
assert.strictEqual(discounted.appliedDiscounts[0].code,'FALL10');
assert.strictEqual(discounted.editFields.discountCents,0,'Existing discounts must not become a new manual discount');
assert.strictEqual(discounted.amountCents,20609,'Do not subtract existing discounts a second time');
const weekly = {code:'WEEKLY20',label:'Weekly',amountCents:2000};
const recurring = bookingQuote({id:'BK-RECURRING',estimate:{total:180,promoDiscount:weekly,recurringDiscount:weekly,manualDiscount:{label:'Welcome',amountCents:1000},payment:{totalCents:18000}}});
assert.deepStrictEqual(recurring.appliedDiscounts.map(d=>d.kind),['recurringDiscount','manualDiscount']);
assert.strictEqual(recurring.appliedDiscounts[1].application,'after_tax');
