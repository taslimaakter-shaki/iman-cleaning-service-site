const assert = require("node:assert/strict");
const {
  calculateWindowQuote,
  recommendResidentialService
} = require("../api/booking/_shared");

const standardRequest = {
  propertyType: "residential",
  scope: "both",
  frequency: "one_time",
  condition: "routine",
  size: "standard",
  access: "ground_safe"
};

function testQueensExample() {
  const quote = calculateWindowQuote({
    ...standardRequest,
    windows: [{ type: "double_hung", quantity: 8 }],
    screens: 8
  }, "11432");
  assert.equal(quote.subtotal, 312);
  assert.equal(quote.tax, 27.69);
  assert.equal(quote.total, 339.69);
  assert.equal(Math.round(quote.totalCents * 0.25), 8492);
}

function testMinimumsDiscountsAndTax() {
  const residential = calculateWindowQuote({
    ...standardRequest,
    windows: [{ type: "single_hung", quantity: 1 }]
  }, "11001");
  assert.equal(residential.subtotal, 250);
  assert.equal(residential.taxRate, 0.08625);
  assert.equal(residential.tax, 21.56);

  const storefront = calculateWindowQuote({
    ...standardRequest,
    propertyType: "commercial",
    scope: "exterior",
    frequency: "weekly",
    windows: [{ type: "storefront_panel", quantity: 12 }]
  }, "10001");
  assert.equal(storefront.subtotal, 125);
  assert.equal(storefront.tax, 11.09);
  assert.equal(storefront.total, 136.09);
}

function testHalfSizeBathroomWindows() {
  const quote = calculateWindowQuote({
    ...standardRequest,
    propertyType: "commercial",
    windows: [
      { type: "bathroom_sliding_half", quantity: 5 },
      { type: "bathroom_hung_half", quantity: 5 }
    ]
  }, "10001");
  assert.equal(quote.subtotal, 210);
  assert.equal(quote.units[0].baseItems[0].label, "5 × Bathroom sliding window (half-size) (interior & exterior)");
  assert.equal(quote.units[0].baseItems[1].label, "5 × Bathroom hung window (half-size) (interior & exterior)");
}

function testRemovedWindowAddOnsAreIgnored() {
  const quote = calculateWindowQuote({
    ...standardRequest,
    propertyType: "commercial",
    windows: [{ type: "bathroom_sliding_half", quantity: 10 }],
    storms: 10,
    removableGrids: 10,
    extraPanes: 10,
    extraPanels: 10,
    extraLouvers: 10,
    secondFloor: 10,
    obstructions: 10
  }, "10001");
  assert.equal(quote.subtotal, 200);
  assert.deepEqual(quote.units[0].addOns, []);
}

function testReviewTriggersAndRouting() {
  assert.equal(recommendResidentialService({ cleaningCategory: "window" }).serviceKey, "window");
  assert.throws(() => calculateWindowQuote({
    ...standardRequest,
    condition: "hard_water",
    windows: [{ type: "double_hung", quantity: 8 }]
  }, "11432"), (error) => error.statusCode === 409 && error.reviewRequired === true);
}

testQueensExample();
testMinimumsDiscountsAndTax();
testHalfSizeBathroomWindows();
testRemovedWindowAddOnsAreIgnored();
testReviewTriggersAndRouting();
console.log("Window booking pricing tests passed.");
