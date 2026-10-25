(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.IMAN_WALKTHROUGH = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const requestType = "Commercial walkthrough";
  const spaceTypes = ["Office", "Retail store", "Restaurant / café", "Salon / spa", "School / daycare", "Medical office", "Warehouse", "Building common areas", "Other"];
  const areas = ["Workspaces", "Restrooms", "Kitchen / break room", "Lobby / reception", "Hallways / stairs", "Dining areas", "Storage areas", "Windows / glass", "Other"];
  const conditions = ["Construction dust / debris", "Heavy grease", "Significant clutter", "Pest activity", "Suspected mold", "Water / sewage damage", "Bodily fluids / sharps", "None", "Unsure"];

  function newYorkNow(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(now);
    const get = type => parts.find(part => part.type === type).value;
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  }

  function fail(field, message) {
    throw Object.assign(new Error(message), { field, statusCode: 400 });
  }

  function validate(raw = {}, now = new Date()) {
    function value(field, limit, required = true) {
      const text = typeof raw[field] === "string" ? raw[field].trim() : "";
      if (required && !text) fail(field, `Please enter ${field.toLowerCase()}.`);
      if (text.length > limit) fail(field, `${field} must be ${limit} characters or fewer.`);
      return text;
    }
    const businessName = value("Business Name", 160);
    const name = value("Full Name", 120);
    const email = value("Email", 254);
    if (!/^[^@\s<>;,]+@[^@\s<>;,]+\.[^@\s<>;,]+$/.test(email)) fail("Email", "Please enter a valid email address.");
    const phone = value("Phone", 30);
    const digits = phone.replace(/\D/g, "");
    if (!/^[+\d().\s-]+$/.test(phone) || !(digits.length === 10 || (digits.length === 11 && digits.startsWith("1")) || (phone.startsWith("+") && digits.length >= 11 && digits.length <= 15))) {
      fail("Phone", "Please enter a valid phone number, including the country code if outside the US.");
    }
    const street = value("Street Address", 250);
    const suite = value("Floor or Suite", 100, false);
    const city = value("City", 100);
    const zip = value("ZIP Code", 5);
    if (!/^\d{5}$/.test(zip)) fail("ZIP Code", "Please enter a five-digit ZIP code.");
    function dateValue(field, required = false) {
      const date = value(field, 10, required);
      if (!date) return "";
      const parsed = new Date(`${date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) fail(field, "Please choose a valid date.");
      return date;
    }
    function timeValue(field) {
      const time = value(field, 5, false);
      if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(field, "Please choose a valid time.");
      return time;
    }
    function choice(field, options, required = true) {
      const selected = value(field, 100, required);
      if (selected && !options.includes(selected)) fail(field, `Please choose a valid ${field.toLowerCase()}.`);
      return selected;
    }
    function selections(field, options, required = false) {
      const source = Array.isArray(raw[field]) ? raw[field] : String(raw[field] || "").split("|");
      const selected = [...new Set(source.map(item => String(item).trim()).filter(Boolean))];
      if (required && !selected.length) fail(field, `Please select at least one ${field.toLowerCase()}.`);
      if (selected.some(item => !options.includes(item))) fail(field, `Please select valid ${field.toLowerCase()} options.`);
      return selected.join(" | ");
    }
    const spaceType = choice("Commercial Space Type", spaceTypes);
    const cleaningPlan = choice("Cleaning Plan", ["One-time cleaning", "Recurring cleaning"]);
    const selectedAreas = selections("Areas Needing Cleaning", areas, false);
    const selectedConditions = selections("Conditions to Review", conditions, false);
    const conditionList = selectedConditions.split(" | ");
    if (conditionList.length > 1 && conditionList.some(item => item === "None" || item === "Unsure")) fail("Conditions to Review", "Choose either specific conditions, None, or Unsure.");
    const squareFeetUnknown = String(raw["Square Footage Unknown"] || "") === "Yes";
    const squareFeet = value("Approximate Square Footage", 10, !squareFeetUnknown);
    if (squareFeet && (!/^\d+$/.test(squareFeet) || Number(squareFeet) < 1 || Number(squareFeet) > 10000000)) fail("Approximate Square Footage", "Enter a valid square footage or choose I’m not sure.");
    const serviceStartUnknown = String(raw["Service Start Unknown"] || raw["Service Start Flexible"] || "") === "Yes";
    const serviceStartDate = dateValue("Preferred Service Start Date", !serviceStartUnknown);
    const date = dateValue("Preferred Walkthrough Date", true);
    const time = timeValue("Preferred Walkthrough Time");
    const alternativeDate = dateValue("Alternative Walkthrough Date");
    const alternativeTime = timeValue("Alternative Walkthrough Time");
    if (alternativeTime && !alternativeDate) fail("Alternative Walkthrough Date", "Choose an alternative date or leave the alternative time blank.");
    const localNow = newYorkNow(now);
    if (date < localNow.slice(0, 10)) fail("Preferred Walkthrough Date", "Please choose today or a future walkthrough date.");
    if (time && `${date}T${time}` <= localNow) fail("Preferred Walkthrough Time", "Please choose a future walkthrough time or leave the time blank.");
    if (alternativeDate && alternativeDate < localNow.slice(0, 10)) fail("Alternative Walkthrough Date", "Please choose today or a future alternative date.");
    if (alternativeDate && alternativeTime && `${alternativeDate}T${alternativeTime}` <= localNow) fail("Alternative Walkthrough Time", "Please choose a future alternative time or leave the time blank.");
    if (serviceStartDate && serviceStartDate < localNow.slice(0, 10)) fail("Preferred Service Start Date", "Please choose today or a future service start date.");
    const conditionDetailsRequired = Boolean(selectedConditions) && !conditionList.some(item => item === "None" || item === "Unsure");
    const conditionDetails = value("Condition Details", 1500, conditionDetailsRequired);
    const restaurant = spaceType === "Restaurant / café";
    const medical = spaceType === "Medical office";
    const yesNoUnsure = ["Yes", "No", "Unsure"];
    const restaurantSpecialty = restaurant ? choice("Restaurant Specialty Work", yesNoUnsure) : "";
    const medicalSpecialty = medical ? choice("Medical Specialty Work", yesNoUnsure) : "";
    const [first, ...last] = name.split(/\s+/);
    const result = {
      "Request Type": requestType, "Service Category": "Commercial", "Service Type": requestType,
      "Business Name": businessName,
      "Full Name": name, "First Name": first, "Last Name": last.join(" "),
      "Contact Role": value("Contact Role", 100, false),
      Email: email, Phone: digits.length === 10 ? `+1${digits}` : `+${digits}`,
      "Street Address": street, "Floor or Suite": suite, City: city, State: "NY", "ZIP Code": zip,
      "Commercial Space Type": spaceType,
      "Cleaning Plan": cleaningPlan,
      "Other Commercial Space": spaceType === "Other" ? value("Other Commercial Space", 120) : "",
      "Approximate Square Footage": squareFeetUnknown ? "I’m not sure" : squareFeet,
      "Areas Needing Cleaning": selectedAreas,
      "Conditions to Review": selectedConditions, "Condition Details": conditionDetails,
      "Preferred Service Start Date": serviceStartUnknown ? "I’m not sure" : serviceStartDate,
      "Preferred Walkthrough Date": date, "Preferred Walkthrough Time": time,
      "Alternative Walkthrough Date": alternativeDate, "Alternative Walkthrough Time": alternativeTime,
      "Walkthrough Time Zone": "America/New_York",
      "Walkthrough Notes": value("Walkthrough Notes", 2000, false),
      "Photo Upload Preference": "optional"
    };
    if (restaurant) {
      result["Restaurant Specialty Work"] = restaurantSpecialty;
      result["Restaurant Specialty Details"] = restaurantSpecialty === "Yes" ? value("Restaurant Specialty Details", 1000) : value("Restaurant Specialty Details", 1000, false);
    }
    if (medical) {
      result["Medical Specialty Work"] = medicalSpecialty;
      result["Medical Specialty Details"] = medicalSpecialty === "Yes" ? value("Medical Specialty Details", 1000) : value("Medical Specialty Details", 1000, false);
    }
    return result;
  }
  function isWalkthrough(fields) { return fields?.["Request Type"] === requestType; }
  return { validate, isWalkthrough, requestType, spaceTypes, areas, conditions, newYorkNow };
});
