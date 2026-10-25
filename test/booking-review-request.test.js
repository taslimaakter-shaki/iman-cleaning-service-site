const assert = require("assert");

const shared = require("../api/booking/_shared");
const notifications = require("../api/booking/_notifications");
const originalUpdate = shared.updateBookingEstimate;
const originalSms = notifications.sendCustomerSms;
const saved = [];
const sent = [];

shared.updateBookingEstimate = async (id, estimate) => {
  saved.push({ id, estimate });
  return { id, estimate };
};
notifications.sendCustomerSms = async (to, body) => {
  sent.push({ to, body });
  return { status: "sent", messageId: "SM-review" };
};
delete require.cache[require.resolve("../api/booking/_review-request")];
const review = require("../api/booking/_review-request");

(async () => {
  assert.equal(review.GOOGLE_REVIEW_URL, "https://g.page/r/CZr1C9xnMwR3EBM/review");
  assert.equal(review.buildReviewRequestSms(), "Thank you for choosing IMAN Cleaning Service. We hope you’re enjoying your freshly cleaned space!\n\nWe’d appreciate your Google review:\nhttps://g.page/r/CZr1C9xnMwR3EBM/review\n\nNeed help? Call 929-232-1930. Reply STOP to opt out.");
  const email = review.buildReviewRequestEmail({ client_name: "Amina", email: "amina@example.com" });
  assert.equal(email.subject, "How did we do? — IMAN Cleaning Service");
  assert.match(email.text, /freshly cleaned space/);
  assert.match(email.html, /Leave a Google Review/);

  const booking = { id: "BOOK-1", status: "Completed", client_name: "Amina", email: "amina@example.com", phone: "9292321930", estimate: { total: 250 } };
  const result = await review.sendReviewRequest({
    booking,
    now: new Date("2026-09-08T18:00:00Z"),
    sendEmail: async () => (sent.push({ channel: "email" }), { status: "sent", messageId: "EMAIL-review" }),
    sendSms: async () => (sent.push({ channel: "sms" }), { status: "sent", messageId: "SM-review" })
  });
  assert.equal(result.status, "sent");
  assert.equal(result.sentAt, "2026-09-08T18:00:00.000Z");
  assert.deepEqual(sent.map((item) => item.channel), ["email", "sms"]);
  assert.equal(saved.length, 2);
  assert.equal(saved[1].estimate.total, 250);
  assert.equal(saved[1].estimate.reviewRequest.emailMessageId, "EMAIL-review");
  assert.equal(saved[1].estimate.reviewRequest.smsMessageId, "SM-review");

  const duplicate = await review.sendReviewRequest({ booking, now: new Date("2026-09-08T19:00:00Z") });
  assert.equal(duplicate.status, "already_sent");
  assert.equal(sent.length, 2, "Do not send a second email or text for the same completed booking");
  assert.equal(saved.length, 2, "Do not rewrite a booking when its review request was already sent");

  await assert.rejects(
    () => review.sendReviewRequest({ booking: { id: "BOOK-2", status: "Confirmed", phone: "9292321930", estimate: {} } }),
    /only after the booking is completed/
  );

  shared.updateBookingEstimate = originalUpdate;
  notifications.sendCustomerSms = originalSms;
  console.log("Booking review-request tests passed: exact message, completed-only delivery, persistence and duplicate prevention.");
})().catch((error) => {
  shared.updateBookingEstimate = originalUpdate;
  notifications.sendCustomerSms = originalSms;
  console.error(error);
  process.exitCode = 1;
});
