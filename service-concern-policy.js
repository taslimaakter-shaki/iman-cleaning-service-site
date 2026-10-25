(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ServiceConcernPolicy = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MAX_FILES = 10;
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const PHOTO_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"];
  const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
  const ALLOWED_TYPES = [...PHOTO_TYPES, ...VIDEO_TYPES, "application/pdf"];
  const PHOTO_CONCERNS = ["Area was not cleaned", "Cleaning quality did not meet expectations", "Service was not completed", "Property was damaged"];
  const TIMING_OPTIONS = ["Before the cleaning", "Immediately after the cleaning", "Within 24 hours after the cleaning", "More than 24 hours after the cleaning"];
  const CONDITIONAL_FIELDS = {
    "Property was damaged": ["Damaged item or surface", "Damage discovered", "Condition before service", "Estimated repair or replacement cost", "Item changes after damage"],
    "Item is missing": ["Missing item description", "Last known location", "Item last seen", "Approximate item value", "Other people with access", "Police report filed", "Police report number"],
    "Incorrect charge or billing concern": ["Amount disputed", "Expected amount", "Billing dispute reason"]
  };
  const list = value => Array.isArray(value) ? value : value ? [value] : [];
  const text = value => typeof value === "string" ? value.trim() : "";
  function fileType(file) {
    if (file.type || file.mimeType) return String(file.type || file.mimeType).toLowerCase();
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", pdf: "application/pdf" }[extension] || "";
  }
  function evidenceState(fields, files) {
    return {
      photosRequired: list(fields["Type of concern"]).some(type => PHOTO_CONCERNS.includes(type)),
      photoCount: files.filter(file => PHOTO_TYPES.includes(fileType(file))).length,
      mediaCount: files.filter(file => [...PHOTO_TYPES, ...VIDEO_TYPES].includes(fileType(file))).length
    };
  }
  function validateFiles(files) {
    if (files.length > MAX_FILES) return `Please upload no more than ${MAX_FILES} files.`;
    for (const file of files) {
      if (!file || typeof file !== "object" || Array.isArray(file)) return "Please upload valid evidence files.";
      if (!ALLOWED_TYPES.includes(fileType(file))) return "Please use JPG, PNG, HEIC, HEIF, WebP, MP4, MOV, WebM, or PDF files.";
      if (!Number.isFinite(Number(file.size)) || Number(file.size) < 1 || Number(file.size) > MAX_FILE_BYTES) return "Each file must be between 1 byte and 20 MB.";
    }
    return "";
  }
  function validate(fields, files) {
    const fileError = validateFiles(files);
    if (fileError) return fileError;
    const types = list(fields["Type of concern"]);
    if (!text(fields["When concern first noticed"])) return "Please tell us when you first noticed the concern.";
    const requirements = {
      "Property was damaged": ["Damaged item or surface", "Damage discovered", "Condition before service", "Item changes after damage"],
      "Item is missing": ["Missing item description", "Last known location", "Item last seen", "Other people with access", "Police report filed"],
      "Incorrect charge or billing concern": ["Amount disputed", "Expected amount", "Billing dispute reason"]
    };
    for (const [type, keys] of Object.entries(requirements)) {
      if (!types.includes(type)) continue;
      for (const key of keys) if (!text(fields[key])) return `Please complete: ${key}.`;
    }
    for (const [type, keys] of Object.entries({
      "Property was damaged": ["Estimated repair or replacement cost"],
      "Item is missing": ["Approximate item value"],
      "Incorrect charge or billing concern": ["Amount disputed", "Expected amount"]
    })) {
      if (!types.includes(type)) continue;
      for (const key of keys) {
        const amount = text(fields[key]);
        if (amount && (!/^\d+(?:\.\d{1,2})?$/.test(amount) || !Number.isFinite(Number(amount)))) return `Enter a valid non-negative dollar amount for ${key.toLowerCase()}.`;
      }
    }
    const evidence = evidenceState(fields, files);
    if (evidence.photosRequired && evidence.photoCount < 2 && !text(fields["Evidence unavailable explanation"])) {
      return "Please upload at least 2 clear photos, or explain why you cannot provide them.";
    }
    if (evidence.mediaCount && (!list(fields["Evidence timing"]).length || list(fields["Evidence timing"]).some(item => !TIMING_OPTIONS.includes(item)))) {
      return "Please tell us when the photos or videos were taken.";
    }
    if (evidence.photoCount && !["Yes", "No", "Not sure"].includes(fields["Photos taken before cleaning"])) {
      return "Please tell us whether any photos were taken before the cleaning.";
    }
    return "";
  }
  function relevantFields(fields, files) {
    const result = { ...fields };
    const types = list(result["Type of concern"]);
    for (const [type, keys] of Object.entries(CONDITIONAL_FIELDS)) {
      if (!types.includes(type)) keys.forEach(key => delete result[key]);
    }
    if (result["Police report filed"] !== "Yes") delete result["Police report number"];
    const evidence = evidenceState(result, files);
    if (!evidence.mediaCount) delete result["Evidence timing"];
    if (!evidence.photoCount) delete result["Photos taken before cleaning"];
    if (!String(result["Reported before team left"] || "").startsWith("Yes")) delete result["Team response details"];
    return result;
  }
  return { MAX_FILES, MAX_FILE_BYTES, PHOTO_TYPES, VIDEO_TYPES, ALLOWED_TYPES, PHOTO_CONCERNS, TIMING_OPTIONS, CONDITIONAL_FIELDS, list, fileType, evidenceState, validateFiles, validate, relevantFields };
});
