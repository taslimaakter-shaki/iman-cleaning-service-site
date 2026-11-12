(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImanBookingConditions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Version 1 preserves kitchen dirt charges on existing saved quotes.
  // New quotes use bathroom-only buildup; editing reconciles to this version.
  const VERSION = 2;
  const supportedVersion = version => version === 1 || version === VERSION;
  const definitions = {
    clutter: {
      title: "How cluttered are the rooms?", label: "Clutter",
      levels: [
        { value: "low", label: "Little or no clutter", rate: 0, description: "Floors and surfaces are mostly clear.", photo: "./assets/clutter/low" },
        { value: "moderate", label: "Moderate clutter", rate: 40, description: "Some belongings are scattered on floors or surfaces.", photo: "./assets/clutter/moderate" },
        { value: "several", label: "Significant clutter", rate: 50, description: "Several areas have scattered items that limit cleaning access.", photo: "./assets/clutter/several" },
        { value: "heavy", label: "Heavy clutter", rate: 60, description: "Many belongings cover floors or surfaces, making cleaning difficult.", photo: "./assets/clutter/heavy" }
      ]
    },
    dust: {
      title: "How dusty or dirty are these rooms?", label: "Dust & dirt",
      singularTitle: "How dusty or dirty are these rooms?",
      levels: [
        { value: "none", label: "Light", rate: 0, description: "A light layer of dust and minor everyday dirt. Most surfaces are fairly clean.", photo: "./assets/dust/light" },
        { value: "some", label: "Moderate", rate: 0, description: "Visible dust and dirt on several surfaces, along baseboards, or around floor edges.", photo: "./assets/dust/moderate" },
        { value: "heavy", label: "Heavy", rate: 40, description: "Thick dust, ground-in dirt, or stubborn residue across many surfaces, requiring intensive cleaning.", photo: "./assets/dust/heavy" }
      ]
    },
    buildup: {
      title: "How much dirt or buildup is in the bathroom?", label: "Dirt & buildup",
      singularTitle: "How much dirt or buildup is in the bathroom?", selectionLabel: "bathrooms",
      levels: [
        { value: "none", label: "Light", rate: 0, description: "Minor water spots and everyday dirt. No noticeable buildup.", photo: "./assets/buildup/light" },
        { value: "some", label: "Moderate", rate: 50, description: "Visible grime, soap scum, or mineral deposits that require extra scrubbing.", photo: "./assets/buildup/moderate" },
        { value: "heavy", label: "Heavy", rate: 60, description: "Thick grime, heavy soap scum, stubborn mineral deposits, or extensive dirt buildup requiring intensive scrubbing.", photo: "./assets/buildup/heavy" }
      ]
    },
    grease: {
      title: "How much grease buildup is in each kitchen?", label: "Kitchen grease",
      singularTitle: "How much grease buildup is in the kitchen?", selectionLabel: "kitchens",
      levels: [
        { value: "none", label: "Light", rate: 0, description: "Minor grease splatters or light cooking residue. No sticky or thick buildup.", photo: "./assets/grease/light" },
        { value: "some", label: "Moderate", rate: 50, description: "Visible grease, sticky surfaces, or cooking residue on the stovetop, backsplash, cabinets, or range hood that requires extra scrubbing.", photo: "./assets/grease/moderate" },
        { value: "heavy", label: "Heavy", rate: 60, description: "Thick, sticky, or hardened grease covering multiple surfaces that requires intensive degreasing and scrubbing.", photo: "./assets/grease/heavy" }
      ]
    },
    mold: {
      title: "Is there any visible mold or mildew in the bathrooms?", label: "Bathroom mold",
      singularTitle: "Is there any visible mold or mildew in the bathroom?", selectionLabel: "bathrooms",
      levels: [
        { value: "none", label: "No visible mold", rate: 0, description: "No visible mold or mildew on grout, around the bathtub or shower, or on other bathroom surfaces.", photo: "./assets/mold/none" },
        { value: "some", label: "Moderate mold", rate: 60, description: "Visible patches of possible mold or mildew on some grout lines, in corners, or around the bathtub or shower.", photo: "./assets/mold/moderate" },
        { value: "heavy", label: "Significant mold", rate: 100, description: "Widespread possible mold or mildew across many grout lines and multiple areas around the bathtub or shower.", photo: "./assets/mold/heavy" }
      ]
    }
  };
  const count = value => Math.max(0, Math.min(30, Math.floor(Number(value) || 0)));
  const extraLabels = { office: "Office", storage: "Storage room", pet: "Pet room", guest: "Guest room", playroom: "Playroom", denStudy: "Den or study", other: "Other room" };
  function roomsForUnit(unit = {}) {
    const rooms = [];
    const add = (key, label, quantity, start = 0, areaKeys = [key]) => {
      for (let index = start; index < quantity; index++) {
        rooms.push({ id: `${key}:${index + 1}`, key, label: quantity - start === 1 ? label : `${label} ${index + 1}`, areaKeys });
      }
    };
    add("bedrooms", "Bedroom", count(unit.bedrooms));
    add("fullBathrooms", "Full bathroom", count(unit.fullBathrooms));
    add("halfBathrooms", "Half bathroom", count(unit.halfBathrooms));
    add("kitchens", "Kitchen", count(unit.kitchens));
    const paired = unit.livingDining === "combined" ? Math.min(count(unit.livingRooms), count(unit.diningRooms)) : 0;
    add("combinedLivingDining", "Living & dining area", paired, 0, ["livingRooms", "diningRooms"]);
    add("livingRooms", "Living room", count(unit.livingRooms), paired);
    add("diningRooms", "Dining room", count(unit.diningRooms), paired);
    const extraNames = Object.entries(extraLabels).flatMap(([key, label]) => {
      const quantity = count(unit.additionalRoomTypes?.[key]);
      return Array.from({ length: quantity }, (_, index) => quantity === 1 ? label : `${label} ${index + 1}`);
    });
    for (let index = 0; index < count(unit.additionalRooms); index++) {
      rooms.push({ id: `additionalRooms:${index + 1}`, key: "additionalRooms", label: extraNames[index] || (count(unit.additionalRooms) === 1 ? "Additional room" : `Additional room ${index + 1}`), areaKeys: ["additionalRooms"] });
    }
    return rooms;
  }
  const applicable = (room, kind, version = VERSION) => kind === "dust" ? ["bedrooms", "livingRooms", "diningRooms", "combinedLivingDining", "additionalRooms"].includes(room.key)
    : kind === "buildup" ? ["fullBathrooms", "halfBathrooms"].includes(room.key) || (version === 1 && room.key === "kitchens")
    : kind === "grease" ? room.key === "kitchens"
    : kind === "mold" ? ["fullBathrooms", "halfBathrooms"].includes(room.key) : true;
  const levelFor = (kind, value) => definitions[kind]?.levels.find(level => level.value === value);
  // Used when room counts change: retain existing room answers, drop removed
  // rooms, and leave newly added rooms unanswered instead of assuming Light.
  function reconcile(unit) {
    const previous = unit.roomConditions || {};
    return Object.fromEntries(roomsForUnit(unit).map(room => [room.id,
      Object.fromEntries(Object.keys(definitions).filter(kind => applicable(room, kind) && levelFor(kind, previous[room.id]?.[kind]))
        .map(kind => [kind, previous[room.id][kind]]))
    ]));
  }
  function validate(unit, unitNumber = 1, version = VERSION) {
    const rooms = roomsForUnit(unit);
    const source = unit.roomConditions === undefined ? {} : unit.roomConditions;
    const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
    if (!source || typeof source !== "object" || Array.isArray(source)) fail(`Choose room conditions for Unit ${unitNumber}.`);
    const ids = new Set(rooms.map(room => room.id));
    if (Object.keys(source).some(id => !ids.has(id))) fail(`Review the selected rooms in Unit ${unitNumber}; some condition answers refer to rooms no longer selected.`);
    return Object.fromEntries(rooms.map(room => {
      const answer = source[room.id] === undefined ? {} : source[room.id];
      if (!answer || typeof answer !== "object" || Array.isArray(answer)) fail(`Choose the conditions for ${room.label} in Unit ${unitNumber}.`);
      const kinds = Object.keys(definitions).filter(kind => applicable(room, kind, version));
      if (Object.keys(answer).some(kind => !kinds.includes(kind))) fail(`Review the condition answers for ${room.label} in Unit ${unitNumber}.`);
      return [room.id, Object.fromEntries(kinds.map(kind => {
        const value = answer[kind];
        if (!levelFor(kind, value)) fail(`Choose ${definitions[kind].label.toLowerCase()} for ${room.label} in Unit ${unitNumber}.`);
        return [kind, value];
      }))];
    }));
  }
  return { VERSION, supportedVersion, definitions, roomsForUnit, applicable, levelFor, reconcile, validate };
});
