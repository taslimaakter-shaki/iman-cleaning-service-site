const assert = require("node:assert/strict");
const { calculateResidentialUnitPrice } = require("../api/booking/_shared");

function unit(overrides = {}) {
  return {
    bedrooms: 0,
    fullBathrooms: 0,
    halfBathrooms: 0,
    hasLivingRoom: "no",
    hasDiningRoom: "no",
    livingDining: "",
    hasPets: "no",
    refrigerator: "no",
    oven: "no",
    cabinets: "no",
    additionalCleaning: "no",
    ...overrides
  };
}

function livingItem(result) {
  return result.baseItems.find((item) => item.key === "living_dining");
}

assert.equal(livingItem(calculateResidentialUnitPrice(unit(), 0, "standard")), undefined);
assert.deepEqual(livingItem(calculateResidentialUnitPrice(unit({ hasLivingRoom: "yes" }), 0, "standard")), {
  key: "living_dining", label: "Living room", amount: 50
});
assert.deepEqual(livingItem(calculateResidentialUnitPrice(unit({ hasDiningRoom: "yes" }), 0, "standard")), {
  key: "living_dining", label: "Dining room", amount: 50
});
assert.equal(livingItem(calculateResidentialUnitPrice(unit({ hasLivingRoom: "yes", hasDiningRoom: "yes", livingDining: "combined" }), 0, "standard")).amount, 80);
assert.equal(livingItem(calculateResidentialUnitPrice(unit({ hasLivingRoom: "yes", hasDiningRoom: "yes", livingDining: "separate" }), 0, "standard")).amount, 100);
const recurringLivingDining = livingItem(calculateResidentialUnitPrice(unit({ hasLivingRoom: "yes", hasDiningRoom: "yes", livingDining: "combined" }), 0, "recurring"));
assert.equal(recurringLivingDining.amount, 80);
assert.equal(livingItem(calculateResidentialUnitPrice(unit({ livingDining: "combined", hasLivingRoom: undefined, hasDiningRoom: undefined }), 0, "standard")).amount, 80);
assert.deepEqual(livingItem(calculateResidentialUnitPrice(unit({ livingRooms: 2, diningRooms: 0 }), 0, "standard")), {
  key: "living_dining", label: "2 living rooms", amount: 100
});
assert.deepEqual(livingItem(calculateResidentialUnitPrice(unit({ livingRooms: 2, diningRooms: 1, livingDining: "combined" }), 0, "standard")), {
  key: "living_dining", label: "1 combined living & dining area + 1 separate living room", amount: 130
});
assert.equal(livingItem(calculateResidentialUnitPrice(unit({ livingRooms: 2, diningRooms: 1, livingDining: "separate" }), 0, "standard")).amount, 150);

const additionalRooms = calculateResidentialUnitPrice(unit({
  additionalRooms: 3,
  additionalRoomTypes: { office: 1, storage: 1, pet: 1 }
}), 0, "deep").baseItems.find((item) => item.key === "additional_rooms");
assert.equal(additionalRooms.amount, 240);
assert.match(additionalRooms.label, /1 office/);
assert.match(additionalRooms.label, /1 storage room/);
assert.match(additionalRooms.label, /1 pet room/);
assert.throws(() => calculateResidentialUnitPrice(unit({
  additionalRooms: 2,
  additionalRoomTypes: { office: 1 }
}), 0, "deep"), /Assign all additional rooms by type/);

const multipleKitchens = calculateResidentialUnitPrice(unit({ kitchens: 2 }), 0, "deep");
assert.deepEqual(multipleKitchens.baseItems.find((item) => item.key === "kitchen"), {
  key: "kitchen", label: "2 kitchens", amount: 160
});
const standardAdditionalRoom = calculateResidentialUnitPrice(unit({
  kitchens: 1,
  additionalRooms: 1,
  additionalRoomTypes: { office: 1 }
}), 0, "standard").baseItems.find((item) => item.key === "additional_rooms");
assert.equal(standardAdditionalRoom.amount, 50);

console.log("Living and dining room pricing tests passed.");
