(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImanMovingKitchens = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const VERSION = 1;
  const BASE_PRICE = 80;
  const RATES = { refrigerator: 40, oven: 50, door: 3, drawer: 1.5 };
  const empty = () => ({ excludeKitchenItems: "", excludeOven: "", excludeRefrigerator: "", excludeCabinets: "", cabinetCount: "", drawerCount: "" });
  function reconcile(unit) {
    const previous = Array.isArray(unit.movingKitchens) ? unit.movingKitchens : [];
    unit.movingKitchens = Array.from({ length: Math.max(0, Math.min(20, Number(unit.kitchens) || 0)) },
      (_, index) => ({ ...empty(), ...previous[index] }));
    return unit.movingKitchens;
  }
  const answerTarget = (unit, question) => Number.isInteger(question.kitchenIndex)
    ? unit.movingKitchens[question.kitchenIndex] : unit;
  function setAnswer(unit, question, value) {
    const target = answerTarget(unit, question);
    target[question.key] = value;
    if (Number.isInteger(question.kitchenIndex)) {
      if (question.key === "excludeKitchenItems" && value === "no") {
        target.excludeOven = target.excludeRefrigerator = target.excludeCabinets = "";
      }
      if (question.key === "excludeCabinets" && value === "yes") {
        target.cabinetCount = target.drawerCount = "";
      }
    }
  }
  function questions(unit) {
    return reconcile(unit).flatMap((kitchen, kitchenIndex, kitchens) => {
      const suffix = kitchens.length > 1 ? ` — Kitchen ${kitchenIndex + 1}` : "";
      const entries = [{
        key: "excludeKitchenItems",
        question: "Would you like to exclude any of the included kitchen items?",
        helper: "Moving Cleaning includes inside the oven, refrigerator, and cabinets. Included refrigerator, cabinet, and drawer interiors must be empty before we arrive. Excluding an item reduces the kitchen price.",
        options: [{ value: "no", label: "No — keep all three included" }, { value: "yes", label: "Yes — choose items to exclude" }]
      }];
      if (kitchen.excludeKitchenItems === "yes") entries.push(
        { key: "excludeOven", question: "Include inside oven cleaning?", options: [
          { value: "no", label: "Keep included — $50" }, { value: "yes", label: "Exclude" }] },
        { key: "excludeRefrigerator", question: "Include inside refrigerator cleaning?", options: [
          { value: "no", label: "Keep included — empty refrigerator, $40" }, { value: "yes", label: "Exclude" }] },
        { key: "excludeCabinets", question: "Include inside cabinet and drawer cleaning?", options: [
          { value: "no", label: "Keep included" }, { value: "yes", label: "Exclude" }] }
      );
      if (kitchen.excludeKitchenItems === "no" || (kitchen.excludeKitchenItems === "yes" && kitchen.excludeCabinets === "no")) entries.push(
        { key: "cabinetCount", type: "number", question: "How many cabinet doors?", label: "Number of cabinet doors",
          helper: "Count each cabinet door separately.", min: 1, max: 100 },
        { key: "drawerCount", type: "number", question: "How many kitchen drawers need cleaning inside?", label: "Number of kitchen drawers",
          min: 0, max: 100 }
      );
      return entries.map(question => ({ ...question, kitchenIndex, question: question.question + suffix }));
    });
  }
  function price(details, kitchenCount, unitNumber) {
    const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
    if (kitchenCount === 0 && details === undefined) return [];
    if (!Array.isArray(details) || details.length !== kitchenCount) fail(`Complete the kitchen selections for Unit ${unitNumber}.`);
    return details.map((raw, index) => {
      const context = `Kitchen ${index + 1} in Unit ${unitNumber}`;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`Complete the selections for ${context}.`);
      const yesNo = key => {
        if (!["yes", "no"].includes(raw[key])) fail(`Choose whether to include or exclude kitchen items for ${context}.`);
        return raw[key];
      };
      const excludeKitchenItems = yesNo("excludeKitchenItems");
      const exclusions = Object.fromEntries(["excludeOven", "excludeRefrigerator", "excludeCabinets"].map(key => [key, excludeKitchenItems === "yes" ? yesNo(key) : "no"]));
      const count = (key, min, name) => {
        const value = raw[key];
        if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "" || !Number.isInteger(Number(value)) || Number(value) < min || Number(value) > 100) {
          fail(`Enter ${name} from ${min} to 100 for ${context}.`);
        }
        return Number(value);
      };
      const cabinetCount = exclusions.excludeCabinets === "yes" ? 0 : count("cabinetCount", 1, "the number of cabinet doors");
      const drawerCount = exclusions.excludeCabinets === "yes" ? 0 : count("drawerCount", 0, "the number of drawers");
      const refrigeratorPrice = exclusions.excludeRefrigerator === "yes" ? 0 : RATES.refrigerator;
      const ovenPrice = exclusions.excludeOven === "yes" ? 0 : RATES.oven;
      const cabinetPrice = cabinetCount * RATES.door + drawerCount * RATES.drawer;
      return { excludeKitchenItems, ...exclusions, cabinetCount, drawerCount,
        cabinetsEmpty: exclusions.excludeCabinets === "yes" ? "" : "yes",
        basePrice: BASE_PRICE, refrigeratorPrice, ovenPrice, cabinetPrice,
        greaseBasePrice: BASE_PRICE + ovenPrice + cabinetPrice,
        total: BASE_PRICE + refrigeratorPrice + ovenPrice + cabinetPrice };
    });
  }
  return { VERSION, BASE_PRICE, RATES, reconcile, questions, answerTarget, setAnswer, price };
});
