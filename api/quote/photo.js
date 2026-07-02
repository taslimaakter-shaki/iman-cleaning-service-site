const Busboy = require("busboy");
const { Readable } = require("stream");
const { driveWebViewLink, getGoogleClients, json } = require("./_shared");

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

function parseMultipart(request) {
  return new Promise((resolve, reject) => {
    const fields = {};
    let upload = null;
    let totalBytes = 0;

    const busboy = Busboy({
      headers: request.headers,
      limits: {
        fileSize: MAX_PHOTO_BYTES,
        files: 1,
        fields: 8
      }
    });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (name, file, info) => {
      const chunks = [];
      file.on("data", (chunk) => {
        totalBytes += chunk.length;
        chunks.push(chunk);
      });
      file.on("limit", () => {
        reject(Object.assign(new Error("Compressed photo is too large."), { statusCode: 413 }));
      });
      file.on("end", () => {
        upload = {
          fieldName: name,
          filename: info.filename || "quote-photo.jpg",
          mimeType: info.mimeType || "image/jpeg",
          buffer: Buffer.concat(chunks)
        };
      });
    });

    busboy.on("error", reject);
    busboy.on("finish", () => {
      if (!upload || !upload.buffer.length) {
        return reject(Object.assign(new Error("Photo file is required."), { statusCode: 400 }));
      }
      if (totalBytes > MAX_PHOTO_BYTES) {
        return reject(Object.assign(new Error("Compressed photo is too large."), { statusCode: 413 }));
      }
      resolve({ fields, upload });
    });

    request.pipe(busboy);
  });
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return json(response, 405, { error: "Method not allowed." });
    }

    const { fields, upload } = await parseMultipart(request);
    const folderId = String(fields.folderId || "").trim();
    const quoteId = String(fields.quoteId || "").trim();
    const photoIndex = Number(fields.photoIndex || 0);

    if (!folderId || !quoteId) {
      return json(response, 400, { error: "quoteId and folderId are required." });
    }

    if (!/^image\/jpe?g$/i.test(upload.mimeType)) {
      return json(response, 400, { error: "Only compressed JPEG photos are accepted." });
    }

    const { drive } = getGoogleClients();
    const paddedIndex = String(photoIndex || 1).padStart(3, "0");
    const safeName = upload.filename.replace(/[^\w.\- ]+/g, "").trim() || "photo.jpg";
    const driveName = `${quoteId}-${paddedIndex}-${safeName}`;

    const created = await drive.files.create({
      requestBody: {
        name: driveName,
        parents: [folderId]
      },
      media: {
        mimeType: upload.mimeType,
        body: Readable.from(upload.buffer)
      },
      fields: "id, name, webViewLink, size"
    });

    return json(response, 201, {
      id: created.data.id,
      name: created.data.name,
      originalName: upload.filename,
      size: upload.buffer.length,
      mimeType: upload.mimeType,
      webViewLink: created.data.webViewLink || driveWebViewLink(created.data.id)
    });
  } catch (error) {
    return json(response, error.statusCode || 500, {
      error: error.message || "Photo could not be uploaded."
    });
  }
};
