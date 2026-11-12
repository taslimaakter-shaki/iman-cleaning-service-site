(function () {
  "use strict";
  const model = window.ImanBookingConditions;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, action, className = "booking-secondary") => {
    const node = el("button", className, text);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  };
  window.ImanConditionPicker = {
    create({ container, getUnits, unitLabel, photoChoice, onChange, onEdit }) {
      const dialog = document.querySelector("[data-condition-room-picker]");
      let currentKind = "clutter";
      let returnLevel = "";
      const inventory = kind => getUnits().flatMap((unit, unitIndex) => model.roomsForUnit(unit)
        .filter(room => !kind || model.applicable(room, kind))
        .map(room => ({ ...room, unitIndex, fullLabel: `${unitLabel(unitIndex)} · ${room.label}` })));
      const answer = (room, kind) => getUnits()[room.unitIndex].roomConditions?.[room.id]?.[kind];
      const assign = (room, kind, value) => {
        const unit = getUnits()[room.unitIndex];
        unit.roomConditions ||= {};
        unit.roomConditions[room.id] ||= {};
        if (value) unit.roomConditions[room.id][kind] = value;
        else delete unit.roomConditions[room.id][kind];
      };
      const changed = () => { onChange(); render(currentKind); };
      const kinds = () => inventory("grease").length ? ["clutter", "buildup", "grease"] : ["clutter", "buildup"];
      const missing = kind => inventory(kind).filter(room => !model.levelFor(kind, answer(room, kind)));
      const reconcile = () => getUnits().forEach(unit => { unit.roomConditions = model.reconcile(unit); });
      const closePicker = () => dialog.close();
      dialog.addEventListener("close", () => {
        container.querySelector(`[data-condition-select="${returnLevel}"]`)?.focus();
      });
      function openPicker(kind, level) {
        returnLevel = level.value;
        dialog.replaceChildren();
        const header = el("div", "booking-room-picker-header");
        const heading = el("h2", "", `${model.definitions[kind].label}: ${level.label}`);
        heading.id = "condition-room-picker-title";
        header.append(heading, button("Done", closePicker, "booking-primary"));
        dialog.append(header, el("p", "booking-condition-help", "Choose the rooms that match this condition. Selecting a room moves it from its previous level."));
        getUnits().forEach((unit, unitIndex) => {
          const rooms = inventory(kind).filter(room => room.unitIndex === unitIndex);
          if (!rooms.length) return;
          const group = el("fieldset", "booking-room-picker-unit");
          group.append(el("legend", "", unitLabel(unitIndex)));
          rooms.forEach(room => {
            const row = el("label", "booking-room-picker-row");
            const input = el("input");
            input.type = "checkbox";
            input.checked = answer(room, kind) === level.value;
            input.dataset.conditionRoom = `${unitIndex}/${room.id}`;
            const copy = el("span", "", room.label);
            const current = el("small", "", model.levelFor(kind, answer(room, kind))?.label || "");
            input.addEventListener("change", () => {
              assign(room, kind, input.checked ? level.value : "");
              current.textContent = model.levelFor(kind, answer(room, kind))?.label || "";
              changed();
            });
            copy.append(current);
            row.append(input, copy);
            group.append(row);
          });
          dialog.append(group);
        });
        dialog.append(button("Done", closePicker, "booking-primary booking-room-picker-done"));
        dialog.showModal();
      }
      function render(kind) {
        currentKind = kind;
        container.replaceChildren();
        container.dataset.conditionKind = kind;
        if (kind === "summary") return renderSummary();
        const definition = model.definitions[kind];
        const rooms = inventory(kind);
        const singleKitchen = kind === "grease" && rooms.length === 1;
        const heading = el("h2", "", singleKitchen ? "How much grease buildup is in the kitchen?" : definition.title);
        heading.tabIndex = -1;
        container.append(heading);
        const cards = el("div", "booking-condition-question booking-condition-cards" + (kind === "grease" ? " booking-grease-photos" : ""));
        definition.levels.forEach(level => {
          const assigned = rooms.filter(room => answer(room, kind) === level.value);
          const choice = button("", () => {
            if (!singleKitchen) return openPicker(kind, level);
            assign(rooms[0], kind, level.value);
            changed();
            container.querySelector(`[data-condition-select="${level.value}"]`)?.focus();
          }, "booking-answer-choice");
          choice.dataset.conditionSelect = level.value;
          if (singleKitchen) {
            const selected = answer(rooms[0], kind) === level.value;
            choice.classList.toggle("is-selected", selected);
            choice.setAttribute("aria-pressed", String(selected));
          } else {
            choice.setAttribute("aria-haspopup", "dialog");
            choice.setAttribute("aria-label", `Select rooms for ${level.label.toLowerCase()}`);
          }
          const copy = el("span", "booking-condition-option-copy");
          copy.append(el("strong", "", level.label), el("span", "", level.description));
          choice.append(copy);
          if (singleKitchen) {
            const indicator = el("i", "", "✓");
            indicator.setAttribute("aria-hidden", "true");
            choice.append(indicator);
          }
          const photoTitle = kind === "clutter" ? level.label : `${level.label} ${definition.label.toLowerCase()}`;
          const card = photoChoice(choice, photoTitle, level.photo);
          card.dataset.conditionLevel = level.value;
          if (singleKitchen) {
            cards.append(card);
            return;
          }
          const actions = el("div", "booking-condition-card-actions");
          const select = button(`Select ${kind === "grease" ? "kitchens" : "rooms"}`, () => openPicker(kind, level));
          select.dataset.conditionSelect = level.value;
          select.setAttribute("aria-label", `Select ${kind === "grease" ? "kitchens" : "rooms"} for ${photoTitle.toLowerCase()}`);
          const all = button(`Apply to all ${kind === "grease" ? "kitchens" : "rooms"}`, () => {
            rooms.forEach(room => assign(room, kind, level.value));
            changed();
            container.querySelector(`[data-condition-all="${level.value}"]`)?.focus();
          }, "booking-condition-link");
          all.dataset.conditionAll = level.value;
          all.setAttribute("aria-label", `Apply ${photoTitle.toLowerCase()} to all ${kind === "grease" ? "kitchens" : "rooms"}`);
          actions.append(select, all);
          const chips = el("div", "booking-condition-assigned");
          assigned.forEach(room => chips.append(el("span", "", room.fullLabel)));
          card.append(actions, chips);
          cards.append(card);
        });
        container.append(cards, el("p", "booking-clutter-note", "Photos are examples only. Your home's condition may vary."));
      }
      function renderSummary() {
        const heading = el("h2", "", "Review the room conditions");
        heading.tabIndex = -1;
        container.append(heading, el("p", "booking-condition-help", "Each room is priced using its own conditions."));
        const actions = el("div", "booking-condition-summary-actions");
        kinds().forEach(kind => actions.append(button(`Edit ${model.definitions[kind].label.toLowerCase()}`, () => onEdit(kind))));
        container.append(actions);
        getUnits().forEach((unit, unitIndex) => {
          const rooms = model.roomsForUnit(unit);
          if (!rooms.length) return;
          const group = el("section", "booking-condition-summary-unit");
          group.append(el("h3", "", unitLabel(unitIndex)));
          rooms.forEach(room => {
            const row = el("div", "booking-condition-summary-room");
            row.append(el("strong", "", room.label));
            const values = el("dl");
            kinds().filter(kind => model.applicable(room, kind)).forEach(kind => {
              const pair = el("div");
              const selected = model.levelFor(kind, unit.roomConditions?.[room.id]?.[kind]);
              pair.append(el("dt", "", model.definitions[kind].label), el("dd", "", selected?.label || "Not answered"));
              values.append(pair);
            });
            row.append(values);
            group.append(row);
          });
          container.append(group);
        });
      }
      return { render, kinds, missing, reconcile, inventory };
    }
  };
})();
