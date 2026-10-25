(() => {
  "use strict";
  const form = document.querySelector("[data-walkthrough-form]");
  const schema = window.IMAN_WALKTHROUGH;
  const serviceArea = window.IMAN_BOOKING_SERVICE_AREA;
  const submit = form.querySelector("[type=submit]");
  const status = document.querySelector("[data-walkthrough-status]");
  const params = new URLSearchParams(location.search);
  const space = params.get("space");
  const referredZip = String(params.get("zip") || "").replace(/\D/g, "").slice(0, 5);
  const other = (params.get("other") || "").slice(0, 120);
  const back = document.querySelector("[data-walkthrough-back]");
  const embedded = params.has("embed");
  let busy = false;
  let completed = false;
  let pending = null;
  const uploadedFiles = new Map();
  const fileInputs = [...form.querySelectorAll('input[type="file"]')];
  const field = name => form.elements.namedItem(name);
  if (embedded) {
    document.body.classList.add("walkthrough-embed");
    back.href += "&embed=1";
  }
  const spaceAliases = { "Retail Store": "Retail store", Restaurant: "Restaurant / café", "Medical / Clinic": "Medical office" };
  const selectedSpace = spaceAliases[space] || space;
  if (schema.spaceTypes.includes(selectedSpace)) {
    const label = document.querySelector("[data-walkthrough-space]");
    label.hidden = false;
    label.textContent = `Your space: ${selectedSpace === "Other" && other ? other : selectedSpace}`;
    field("Commercial Space Type").value = selectedSpace;
    if (selectedSpace === "Other" && other) field("Other Commercial Space").value = other;
  }
  if (serviceArea.isValid(referredZip) && serviceArea.isServed(referredZip)) {
    field("ZIP Code").value = referredZip;
  }
  const today = schema.newYorkNow().slice(0, 10);
  for (const name of ["Preferred Service Start Date", "Preferred Walkthrough Date", "Alternative Walkthrough Date"]) field(name).min = today;
  function message(text, type = "info") {
    status.hidden = false;
    status.textContent = text;
    status.dataset.status = type;
  }
  async function post(url, body) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || "Your request could not be sent. Please try again or call (929) 232-1930."), { field: data.field });
    return data;
  }
  async function uploadFile(file, photoIndex) {
    const prepared = await post("/api/quote/upload-url", {
      uploadToken: pending.uploadToken,
      fileName: file.name,
      mimeType: fileType(file),
      size: file.size,
      index: photoIndex
    });
    const response = await fetch(prepared.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": prepared.mimeType },
      body: file
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) throw new Error(`${file.name} could not be uploaded.`);
    return {
      id: data.id,
      name: data.name || prepared.name,
      originalName: file.name,
      size: Number(data.size || file.size),
      mimeType: data.mimeType || prepared.mimeType,
      webViewLink: data.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(data.id)}/view`
    };
  }
  function allFiles() { return fileInputs.flatMap(input => Array.from(input.files || [])); }
  function fileKey(file) { return [file.name, file.size, file.lastModified].join(":"); }
  function fileType(file) {
    if (file.type) return file.type.toLowerCase();
    const extension = file.name.split(".").pop().toLowerCase();
    return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", pdf: "application/pdf" })[extension] || "";
  }
  function validateFiles(files) {
    const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"]);
    if (files.length > 50) throw new Error("Please upload no more than 50 files.");
    for (const file of files) {
      const type = fileType(file);
      if (!allowed.has(type)) throw new Error(`${file.name} must be a PDF, JPG, PNG, HEIC or HEIF file.`);
      if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} must be 15 MB or smaller.`);
    }
  }
  async function prepareFile(file) {
    const type = fileType(file);
    return file.type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
  }
  function values() {
    const data = new FormData(form);
    const result = Object.fromEntries(data);
    for (const name of ["Areas Needing Cleaning", "Conditions to Review"]) result[name] = data.getAll(name).join(" | ");
    return result;
  }
  function show(element, visible) {
    element.hidden = !visible;
    for (const control of element.querySelectorAll("input, select, textarea")) control.disabled = !visible;
  }
  function updateConditionalFields() {
    const property = field("Commercial Space Type").value;
    show(document.querySelector("[data-other-property]"), property === "Other");
    field("Other Commercial Space").required = property === "Other";
    show(document.querySelector("[data-restaurant-followup]"), property === "Restaurant / café");
    show(document.querySelector("[data-medical-followup]"), property === "Medical office");
    field("Restaurant Specialty Work").required = property === "Restaurant / café";
    field("Medical Specialty Work").required = property === "Medical office";
    const restaurantDetails = field("Restaurant Specialty Work").value;
    const medicalDetails = field("Medical Specialty Work").value;
    show(document.querySelector("[data-restaurant-details]"), property === "Restaurant / café" && restaurantDetails && restaurantDetails !== "No");
    show(document.querySelector("[data-medical-details]"), property === "Medical office" && medicalDetails && medicalDetails !== "No");
    field("Restaurant Specialty Details").required = property === "Restaurant / café" && restaurantDetails === "Yes";
    field("Medical Specialty Details").required = property === "Medical office" && medicalDetails === "Yes";
    const unknownSize = field("Square Footage Unknown").checked;
    field("Approximate Square Footage").disabled = unknownSize;
    field("Approximate Square Footage").required = !unknownSize;
    const unknownStart = field("Service Start Unknown").checked;
    field("Preferred Service Start Date").disabled = unknownStart;
    field("Preferred Service Start Date").required = !unknownStart;
  }
  for (const group of form.querySelectorAll("[data-exclusive-group]")) {
    group.addEventListener("change", event => {
      if (!event.target.matches('input[type="checkbox"]')) return;
      const boxes = [...group.querySelectorAll('input[type="checkbox"]')];
      if (event.target.checked) {
        if (event.target.hasAttribute("data-exclusive")) boxes.filter(box => box !== event.target).forEach(box => { box.checked = false; });
        else boxes.filter(box => box.hasAttribute("data-exclusive")).forEach(box => { box.checked = false; });
      }
      updateConditionalFields();
    });
  }
  form.addEventListener("change", updateConditionalFields);
  updateConditionalFields();
  form.addEventListener("input", event => {
    event.target.setCustomValidity?.("");
    event.target.removeAttribute("aria-invalid");
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || completed || form.elements.namedItem("_honey").value) return;
    if (!form.reportValidity()) return;
    let fields;
    try {
      const files = allFiles();
      validateFiles(files);
      fields = schema.validate(values());
      if (!serviceArea.isServed(fields["ZIP Code"])) throw Object.assign(new Error("Enter a ZIP code within our New York City service area."), { field: "ZIP Code" });
    } catch (error) {
      const input = [...form.elements].find(control => control.name === error.field);
      input?.setCustomValidity(error.message);
      input?.setAttribute("aria-invalid", "true");
      message(error.message, "error");
      input?.focus();
      input?.reportValidity();
      return;
    }
    busy = true;
    submit.disabled = true;
    submit.textContent = "Sending request…";
    message("Sending your walkthrough request…");
    try {
      // Keep the created folder and uploaded file IDs during safe retries on this page.
      if (!pending) pending = await post("/api/quote/start", { formFields: fields });
      const files = allFiles();
      const photos = new Array(files.length);
      let next = 0;
      let complete = 0;
      async function worker() {
        while (next < files.length) {
          const index = next++;
          const file = files[index];
          const key = fileKey(file);
          if (!uploadedFiles.has(key)) {
            const prepared = await prepareFile(file);
            uploadedFiles.set(key, await uploadFile(prepared, index + 1));
          }
          photos[index] = uploadedFiles.get(key);
          complete += 1;
          message(`Securely uploaded ${complete} of ${files.length} file${files.length === 1 ? "" : "s"}…`);
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()));
      message("Sending your walkthrough request…");
      await post("/api/quote/finish", { ...pending, formFields: fields, photos });
      completed = true;
      form.hidden = true;
      document.querySelector("[data-walkthrough-intro]").hidden = true;
      const success = document.querySelector("[data-walkthrough-success]");
      success.hidden = false;
      success.querySelector("[data-walkthrough-reference]").textContent = `Request reference: ${pending.quoteId}`;
      success.querySelector("h1").focus();
      success.scrollIntoView({ behavior: "smooth", block: "start" });
      document.title = "Walkthrough request received | IMAN Cleaning Service";
    } catch (error) {
      message(error.message, "error");
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = "Request a Walkthrough";
    }
  });
  if (params.get("preview") === "confirmation" && (location.protocol === "file:" || location.hostname === "127.0.0.1" || location.hostname === "localhost")) {
    form.hidden = true;
    document.querySelector("[data-walkthrough-intro]").hidden = true;
    const success = document.querySelector("[data-walkthrough-success]");
    success.hidden = false;
    success.querySelector("[data-walkthrough-reference]").textContent = "Request reference: Preview";
    document.title = "Walkthrough request received | IMAN Cleaning Service";
  }
  if (embedded && window.parent !== window) {
    const sendHeight = () => window.parent.postMessage({ type: "imanQuoteFrameHeight", height: Math.ceil(document.documentElement.scrollHeight) }, location.origin);
    window.addEventListener("load", sendHeight);
    window.addEventListener("resize", sendHeight);
    if ("ResizeObserver" in window) new ResizeObserver(sendHeight).observe(document.body);
  }
})();
