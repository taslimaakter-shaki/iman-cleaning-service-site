(() => {
  "use strict";
  const token = new URLSearchParams(location.search).get("token") || "";
  const loading = document.querySelector("[data-upload-loading]");
  const content = document.querySelector("[data-upload-content]");
  const errorBox = document.querySelector("[data-upload-error]");
  const errorCopy = document.querySelector("[data-upload-error-copy]");
  const input = document.querySelector("[data-photo-input]");
  const button = document.querySelector("[data-upload-button]");
  const selection = document.querySelector("[data-photo-selection]");
  const status = document.querySelector("[data-upload-status]");
  const existingStatus = document.querySelector("[data-existing-status]");
  let existingCount = 0;

  function setStatus(message, kind = "info") {
    status.textContent = message;
    status.dataset.kind = kind;
    status.hidden = false;
  }

  function showError(message) {
    loading.hidden = true;
    content.hidden = true;
    errorCopy.textContent = message;
    errorBox.hidden = false;
  }

  async function api(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("A selected photo could not be read."));
      image.src = url;
    });
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Photo compression failed.")), "image/jpeg", .72));
  }

  async function compress(file) {
    if (file.type.startsWith("video/")) {
      if (!["video/mp4", "video/quicktime", "video/webm"].includes(file.type)) {
        throw new Error(`${file.name} is not a supported video format.`);
      }
      if (file.size > 3.8 * 1024 * 1024) {
        throw new Error(`${file.name} is too large. Videos must be 3.8 MB or smaller.`);
      }
      return file;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await canvasBlob(canvas);
      if (blob.size > 3.8 * 1024 * 1024) throw new Error(`${file.name} is too large. Please choose a smaller photo.`);
      return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function selectedFiles() {
    return Array.from(input.files || []);
  }

  input.addEventListener("change", () => {
    const files = selectedFiles();
    const remaining = Math.max(0, 100 - existingCount);
    if (files.length > remaining) {
      input.value = "";
      selection.textContent = `You may add ${remaining} more file${remaining === 1 ? "" : "s"}.`;
      selection.hidden = false;
      button.disabled = true;
      return;
    }
    selection.textContent = files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : "";
    selection.hidden = !files.length;
    button.disabled = !files.length;
  });

  button.addEventListener("click", async () => {
    const files = selectedFiles();
    if (!files.length) return;
    button.disabled = true;
    input.disabled = true;
    const uploaded = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        setStatus(`Preparing and uploading file ${index + 1} of ${files.length}…`);
        const prepared = await compress(files[index]);
        const form = new FormData();
        form.append("photo", prepared, prepared.name);
        uploaded.push(await api(`/api/quote/photo-later?token=${encodeURIComponent(token)}&index=${existingCount + index + 1}`, { method: "POST", body: form }));
      }
      setStatus("Saving your files…");
      const completed = await api(`/api/quote/photo-later?token=${encodeURIComponent(token)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: uploaded })
      });
      existingCount = completed.photoCount;
      input.value = "";
      selection.hidden = true;
      setStatus(`Thank you! ${existingCount} file${existingCount === 1 ? " was" : "s were"} received. Our team will review them and contact you about your quote.`, "success");
      existingStatus.textContent = `${existingCount} of 100 files uploaded. You may return to this link to add more.`;
      existingStatus.hidden = false;
    } catch (error) {
      setStatus(error.message || "Your photos could not be uploaded. Please try again.", "error");
    } finally {
      input.disabled = false;
      button.disabled = !selectedFiles().length;
    }
  });

  (async () => {
    if (!token) return showError("This photo-upload link is missing its secure code. Please request a new link.");
    try {
      const info = await api(`/api/quote/photo-later?token=${encodeURIComponent(token)}`);
      existingCount = Number(info.photoCount || 0);
      document.querySelector("[data-quote-id]").textContent = info.quoteId;
      document.querySelector("[data-customer-name]").textContent = info.customerName || "there";
      if (existingCount) {
        existingStatus.textContent = `${existingCount} of 100 files already uploaded. You may add more.`;
        existingStatus.hidden = false;
      }
      loading.hidden = true;
      content.hidden = false;
    } catch (error) {
      showError(error.message || "This photo-upload link is invalid or has expired.");
    }
  })();
})();
