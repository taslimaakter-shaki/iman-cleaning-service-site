const assert = require("assert");

const review = require("../api/booking/_review-request");

function booking() {
  return {
    id: "BOOK-1",
    status: "Completed",
    client_name: "Amina",
    email: "amina@example.com",
    phone: "9292321930",
    estimate: { total: 250 }
  };
}

function saveChanges(saved) {
  return async (record, reviewRequest) => {
    saved.push(reviewRequest);
    record.estimate.reviewRequest = reviewRequest;
  };
}

(async () => {
  assert.equal(review.GOOGLE_REVIEW_URL, "https://g.page/r/CZr1C9xnMwR3EBM/review");
  assert.equal(review.REVIEW_DELAY_MS, 24 * 60 * 60 * 1000);
  assert.equal(review.buildReviewRequestSms(), "Thank you for choosing IMAN Cleaning Service. We hope you’re enjoying your freshly cleaned space!\n\nWe’d appreciate your Google review:\nhttps://g.page/r/CZr1C9xnMwR3EBM/review\n\nNeed help? Call 929-232-1930. Reply STOP to opt out.");
  const email = review.buildReviewRequestEmail({ client_name: "Amina", email: "amina@example.com" });
  assert.equal(email.subject, "How did we do? — IMAN Cleaning Service");
  assert.match(email.text, /freshly cleaned space/);
  assert.match(email.html, /Leave a Google Review/);

  const current = booking();
  const saved = [];
  const scheduled = await review.scheduleReviewRequest({
    booking: current,
    now: new Date("2026-09-08T18:00:00Z"),
    save: saveChanges(saved)
  });
  assert.equal(scheduled.status, "scheduled");
  assert.equal(scheduled.completedAt, "2026-09-08T18:00:00.000Z");
  assert.equal(scheduled.dueAt, "2026-09-09T18:00:00.000Z");
  assert.equal(saved.length, 1);

  const earlySends = [];
  const early = await review.sendReviewRequest({
    booking: current,
    now: new Date("2026-09-09T17:59:59Z"),
    sendEmail: async () => (earlySends.push("email"), { status: "sent" }),
    sendSms: async () => (earlySends.push("sms"), { status: "sent" }),
    save: saveChanges(saved)
  });
  assert.equal(early.status, "scheduled");
  assert.deepEqual(earlySends, [], "Do not send the review request before 24 hours have passed");

  const sent = [];
  const processed = await review.processDueReviewRequests({
    now: new Date("2026-09-09T18:00:00Z"),
    listBookings: async () => [current],
    send: ({ booking: record, now }) => review.sendReviewRequest({
      booking: record,
      now,
      sendEmail: async () => (sent.push("email"), { status: "sent", messageId: "EMAIL-review" }),
      sendSms: async () => (sent.push("sms"), { status: "sent", messageId: "SM-review" }),
      save: saveChanges(saved)
    })
  });
  assert.equal(processed.due, 1);
  assert.equal(processed.sent, 1);
  assert.deepEqual(sent, ["email", "sms"]);
  assert.equal(current.estimate.reviewRequest.sentAt, "2026-09-09T18:00:00.000Z");
  assert.equal(current.estimate.reviewRequest.emailMessageId, "EMAIL-review");
  assert.equal(current.estimate.reviewRequest.smsMessageId, "SM-review");

  const duplicateSchedule = await review.scheduleReviewRequest({ booking: current, save: async () => { throw new Error("must not rewrite"); } });
  assert.equal(duplicateSchedule.status, "already_sent");
  const duplicate = await review.sendReviewRequest({ booking: current, now: new Date("2026-09-09T19:00:00Z") });
  assert.equal(duplicate.status, "already_sent");

  await assert.rejects(
    () => review.scheduleReviewRequest({ booking: { id: "BOOK-2", status: "Confirmed", estimate: {} } }),
    /only after the booking is completed/
  );
  console.log("Booking review-request tests passed: 24-hour delay, email and text delivery, persistence and duplicate prevention.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
