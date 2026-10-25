const {
  clean,
  emailMessage,
  escapeHtml,
  getGoogleClients,
  json,
  readJsonBody,
  validateFile,
  verifyCase
} = require("./_shared");
const concernPolicy = require("../../service-concern-policy");
const { sendCustomerSms } = require("../booking/_notifications");
const { trySendFormSubmissionNotification } = require("../_form-notifications");

function value(fields, key, max = 1000) {
  const item = fields?.[key];
  return Array.isArray(item) ? item.map((entry) => clean(entry, 160)).filter(Boolean) : clean(item, max);
}

function required(fields, key, label) {
  const result = value(fields, key);
  if (!result || (Array.isArray(result) && !result.length)) {
    throw Object.assign(new Error(`${label} is required.`), { statusCode: 400 });
  }
  return result;
}

function rows(fields) {
  return Object.entries(fields || {}).map(([key, item]) => {
    const display = Array.isArray(item) ? item.join(", ") : item;
    return `<tr><th align="left" style="padding:8px 14px 8px 0;color:#073f49;vertical-align:top">${escapeHtml(key)}</th><td style="padding:8px 0">${escapeHtml(display)}</td></tr>`;
  }).join("");
}

async function sendEmail(gmail, message) {
  const sent = await gmail.users.messages.send({ userId: "me", requestBody: message });
  return sent.data.id || "";
}

async function verifyUploads(drive, session, uploads) {
  const ids = uploads.map(file => clean(file?.id, 200));
  if (ids.some(id => !/^[\w-]+$/.test(id)) || new Set(ids).size !== ids.length) {
    throw Object.assign(new Error("Please upload each evidence file once before submitting."), { statusCode: 400 });
  }
  return Promise.all(uploads.map(async (upload, index) => {
    const response = await drive.files.get({ fileId: ids[index], fields: "id,name,mimeType,size,parents,appProperties,trashed" });
    const file = response.data;
    if (file.trashed || !file.parents?.includes(session.folderId) || file.appProperties?.iman_record_type !== "service_concern_evidence" || file.appProperties?.case_number !== session.caseNumber) {
      throw Object.assign(new Error("An evidence file does not belong to this concern. Please upload it again."), { statusCode: 400 });
    }
    const validated = validateFile(file);
    return { id: ids[index], name: clean(file.name, 250), originalName: clean(upload.originalName || file.name, 250), ...validated, webViewLink: `https://drive.google.com/file/d/${ids[index]}/view` };
  }));
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
    const body = await readJsonBody(request, 1024 * 1024);
    const session = verifyCase(body.uploadToken);
    let fields = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? { ...body.fields } : {};
    if (body.uploads !== undefined && !Array.isArray(body.uploads)) return json(response, 400, { error: "Invalid evidence files." });
    let uploads = body.uploads || [];
    if (uploads.length > concernPolicy.MAX_FILES) return json(response, 400, { error: "Please upload no more than 10 files." });
    const name = required(fields, "Full name", "Full name");
    const email = required(fields, "Email address", "Email address");
    const phone = required(fields, "Phone number", "Phone number");
    required(fields, "Preferred contact method", "Preferred contact method");
    required(fields, "Service address", "Service address");
    required(fields, "Date of cleaning service", "Date of cleaning service");
    required(fields, "Type of service", "Type of service");
    required(fields, "Type of concern", "Type of concern");
    required(fields, "Areas affected", "Areas affected");
    required(fields, "Detailed explanation", "Detailed explanation");
    required(fields, "Reported before team left", "When the concern was reported");
    const combinedConfirmation = Object.prototype.hasOwnProperty.call(fields, "Customer confirmation");
    // Keep already-open copies of the previous four-checkbox form working.
    const confirmationKeys = combinedConfirmation ? ["Customer confirmation"] : [
      "Accuracy confirmation", "Resolution disclaimer", "Contact authorization", "Booking-change acknowledgement"
    ];
    if (!confirmationKeys.every((key) => fields[key] === "Confirmed")) {
      throw Object.assign(new Error("Please check the customer confirmation before submitting."), { statusCode: 400 });
    }
    if (session.caseNumber !== clean(body.caseNumber, 80)) throw Object.assign(new Error("Invalid case number."), { statusCode: 400 });

    const validationError = concernPolicy.validate(fields, uploads);
    if (validationError) return json(response, 400, { error: validationError });

    const { config, drive, gmail } = getGoogleClients();
    uploads = await verifyUploads(drive, session, uploads);
    const verifiedError = concernPolicy.validate(fields, uploads);
    if (verifiedError) return json(response, 400, { error: verifiedError });
    fields = concernPolicy.relevantFields(fields, uploads);
    const evidence = concernPolicy.evidenceState(fields, uploads);
    fields["Evidence review status"] = evidence.photosRequired && evidence.photoCount < 2
      ? "Evidence exception — customer explanation provided"
      : uploads.length ? "Supporting evidence provided" : "No supporting evidence submitted";
    const createdAt = new Date().toISOString();
    const record = {
      caseNumber: session.caseNumber,
      type: "service_concern",
      status: "Submitted",
      createdAt,
      confirmationMethod: combinedConfirmation ? "single_checkbox" : "separate_checkboxes",
      customerName: name,
      email,
      phone,
      folderId: session.folderId,
      folderLink: `https://drive.google.com/drive/folders/${session.folderId}`,
      fields,
      uploads
    };
    await drive.files.create({
      requestBody: {
        name: `${session.caseNumber}-service-concern.json`,
        parents: [config.parentFolderId],
        mimeType: "application/json",
        appProperties: { iman_record_type: "service_concern", case_number: session.caseNumber, concern_status: "Submitted" }
      },
      media: { mimeType: "application/json", body: JSON.stringify(record, null, 2) },
      fields: "id"
    });

    const folderLink = record.folderLink || `https://drive.google.com/drive/folders/${session.folderId}`;
    const customerText = [
      `Hi ${name},`,
      "",
      `Your service concern has been submitted. Case number: ${session.caseNumber}.`,
      "Our team will review the information and contact you using your preferred contact method.",
      "Submitting this form does not mean a refund, complimentary service, reimbursement, or other resolution has been approved.",
      "",
      "Iman Cleaning Service LLC"
    ].join("\n");
    const customerHtml = `<!doctype html><html><body style="margin:0;background:#f3f8f7;font-family:Arial,sans-serif;color:#263b40;line-height:1.55"><div style="max-width:640px;margin:auto;padding:28px 18px"><div style="background:#fff;border:1px solid #d7e5e3;border-radius:18px;padding:30px"><p>Hi ${escapeHtml(name)},</p><h1 style="color:#073f49;font-size:26px">Your concern has been submitted.</h1><p>Thank you for providing the details. Our team will review your submission and contact you using your preferred contact method.</p><p style="padding:16px;border-radius:12px;background:#edf7f5"><strong>Case number</strong><br><span style="font-size:22px;color:#0b6474">${escapeHtml(session.caseNumber)}</span></p><p>Please save this number for future reference.</p><p style="font-size:13px;color:#60757a">Submitting this form does not mean a refund, complimentary service, reimbursement, or another specific resolution has been approved.</p></div></div></body></html>`;
    const ownerSubject = `New service concern — ${session.caseNumber}`;
    const ownerText = [`New service concern: ${session.caseNumber}`, `Submitted: ${createdAt}`, `Evidence folder: ${folderLink}`, "", ...Object.entries(fields).map(([key, item]) => `${key}: ${Array.isArray(item) ? item.join(", ") : item}`)].join("\n");
    const ownerHtml = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#263b40"><h1 style="color:#073f49">New service concern</h1><p><strong>Case:</strong> ${escapeHtml(session.caseNumber)}</p><p><a href="${escapeHtml(folderLink)}">Open evidence folder</a></p><table style="border-collapse:collapse">${rows(fields)}</table></body></html>`;

    const ownerTo = process.env.QUOTE_EMAIL_TO || "Info@imancleaningservice.com";
    const emailResults = await Promise.allSettled([
      sendEmail(gmail, emailMessage({ to: ownerTo, replyTo: email, subject: ownerSubject, text: ownerText, html: ownerHtml })),
      sendEmail(gmail, emailMessage({ to: email, subject: `Service concern received — ${session.caseNumber}`, text: customerText, html: customerHtml }))
    ]);
    const smsText = `IMAN Cleaning Service: Your service concern was submitted. Case ${session.caseNumber}. Our team will review it and contact you. No refund, recleaning, or reimbursement has been approved by this confirmation. Reply STOP to opt out.`;
    const customerSms = await sendCustomerSms(phone, smsText).catch((error) => ({ status: "failed", error: clean(error.message, 240) }));
    const ownerSms = await trySendFormSubmissionNotification({
      source: "Service concern",
      fields,
      recordId: session.caseNumber,
      folderLink,
      summaryLines: [`Concern types: ${Array.isArray(fields["Type of concern"]) ? fields["Type of concern"].join(", ") : fields["Type of concern"]}`, `Evidence files: ${uploads.length}`]
    });

    return json(response, 200, {
      ok: true,
      caseNumber: session.caseNumber,
      emailStatus: emailResults.map((item) => item.status),
      customerEmailStatus: emailResults[1]?.status === "fulfilled" ? "sent" : "failed",
      customerSmsStatus: customerSms.status,
      ownerSmsStatus: ownerSms.status
    });
  } catch (error) {
    return json(response, error.statusCode || 500, { error: error.message || "The service concern could not be submitted." });
  }
};
