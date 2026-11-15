const conditions = require("../../booking-conditions");

function unitsFor(estimate = {}) {
  return Array.isArray(estimate.units) ? estimate.units
    : Array.isArray(estimate.eligibility?.units) ? estimate.eligibility.units : [];
}

function unitLabel(estimate, index) {
  if ((estimate.eligibility?.propertyType || estimate.propertyType) === "house") {
    let floors = estimate.eligibility?.houseFloorSelection || [];
    if (typeof floors === "string") {
      try { floors = JSON.parse(floors); } catch { floors = []; }
    }
    return Array.isArray(floors) && typeof floors[index] === "string" && floors[index].trim()
      ? floors[index].trim() : `Floor ${index + 1}`;
  }
  return `Unit ${index + 1}`;
}

function hasRoomAnswers(estimate) {
  return conditions.supportedVersion(estimate.eligibility?.roomConditionVersion)
    || unitsFor(estimate).some(unit => unit.roomConditions && typeof unit.roomConditions === "object");
}

function conditionSections(estimate) {
  // Use only recorded answers. Never infer Light for an unanswered question.
  const rooms = unitsFor(estimate).flatMap((unit, index) => conditions.roomsForUnit(unit)
    .map(room => ({ ...room, unitLabel: unitLabel(estimate, index), answers: unit.roomConditions?.[room.id] || {} })));
  return Object.entries(conditions.definitions).flatMap(([kind, definition]) => {
    const answered = rooms.filter(room => conditions.levelFor(kind, room.answers[kind]));
    if (!answered.length) return [];
    // Version-1 bookings could include kitchen buildup; preserve those answers.
    const title = kind === "buildup" && answered.some(room => room.key === "kitchens")
      ? "How much dirt or buildup is in the kitchens and bathrooms?"
      : answered.length === 1 && definition.singularTitle ? definition.singularTitle : definition.title;
    return [{ title, rows: answered.map(room => {
      const level = conditions.levelFor(kind, room.answers[kind]);
      return [`${room.unitLabel} - ${room.label}`, `${level.label} - ${level.description}`];
    }) }];
  });
}

function conditionChargeLabel(area) {
  const level = conditions.levelFor(area.conditionType, area.level);
  const names = { dust: "dust and dirt", buildup: "buildup", grease: "grease buildup" };
  return level ? `${area.label}: ${level.label}${names[area.conditionType] ? ` ${names[area.conditionType]}` : ""}`
    : area.label;
}

module.exports = { unitsFor, unitLabel, hasRoomAnswers, conditionSections, conditionChargeLabel };
