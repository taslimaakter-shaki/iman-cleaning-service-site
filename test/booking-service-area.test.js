const assert = require("node:assert/strict");
const serviceArea = require("../booking-service-area");

["10001", "10301", "10451", "11101", "11201", "11354", "11432", "11691", "11004", "11005"].forEach((zip) => {
  assert.equal(serviceArea.isServed(zip), true, `${zip} should be accepted as New York City`);
});

["11001", "11040", "11096", "11501", "11701", "11801", "11901", "", "1234"].forEach((zip) => {
  assert.equal(serviceArea.isServed(zip), false, `${zip || "blank"} should not be accepted`);
});

assert.equal(serviceArea.normalize("11432-1234"), "11432");
console.log("Booking service-area tests passed.");
