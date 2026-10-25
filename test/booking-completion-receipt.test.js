const assert = require("assert");
const { buildCompletionReceiptEmail, sendCompletionReceipt } = require("../api/booking/_completion-receipt");
const { buildFinalPaymentReceiptPdf, receiptAmounts } = require("../api/booking/_final-payment-receipt-pdf");

function booking() {
  return {
    id: "BK-FINAL-1",
    status: "Completed",
    client_name: "Carissa Soodeen",
    email: "carissa@example.com",
    service: "move_in",
    service_label: "Move-In Cleaning",
    schedule: "2026-10-26T14:00:00.000Z",
    estimate: {
      orderNumber: "19641590",
      subtotal: 514.58,
      discountedSubtotal: 463.12,
      tax: 41.10,
      total: 504.22,
      promoCode: "FALL10",
      promoDiscount: { label: "FALL10", amountCents: 5146, application: "before_tax" },
      payment: {
        paymentType: "deposit_25",
        status: "paid",
        totalCents: 50422,
        depositCents: 12606,
        paidCents: 50422,
        remainingCents: 0,
        completedPaymentAt: "2026-10-26T17:45:00.000Z",
        remaining: {
          status: "captured",
          amountCents: 37816,
          capturedAt: "2026-10-26T17:45:00.000Z",
          cardBrand: "mastercard",
          cardLast4: "7581"
        }
      }
    }
  };
}

(async () => {
  const current = booking();
  assert.deepEqual(receiptAmounts(current), {
    totalCents: 50422,
    subtotalCents: 51458,
    discountedSubtotalCents: 46312,
    taxCents: 4110,
    depositCents: 12606,
    finalPaymentCents: 37816,
    paidCents: 50422,
    discount: { amountCents: 5146, label: "FALL10 discount" }
  });

  const pdf = await buildFinalPaymentReceiptPdf({ booking: current });
  assert.ok(pdf.length > 2000);
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  const email = buildCompletionReceiptEmail(current, pdf);
  assert.equal(email.subject, "Your cleaning is complete - final receipt attached");
  assert.match(email.text, /final paid receipt is attached/i);
  assert.doesNotMatch(email.text, /\$|booking reference|service subtotal|sales tax|remaining balance/i);
  const decoded = Buffer.from(email.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.match(decoded, /Content-Type: application\/pdf/);
  assert.match(decoded, /Iman-Cleaning-Final-Receipt-BK-FINAL-1\.pdf/);

  const saves = [];
  const sends = [];
  const result = await sendCompletionReceipt({
    booking: current,
    now: new Date("2026-10-26T18:00:00.000Z"),
    sendEmail: async () => {
      sends.push(true);
      return { status: "sent", messageId: "EMAIL-final", error: "" };
    },
    save: async (record, state) => {
      saves.push(state);
      record.estimate.completionReceipt = state;
    }
  });
  assert.equal(result.status, "sent");
  assert.equal(sends.length, 1);
  assert.equal(saves.length, 2);
  assert.equal(saves.at(-1).emailMessageId, "EMAIL-final");

  const duplicate = await sendCompletionReceipt({
    booking: current,
    sendEmail: async () => { throw new Error("must not resend"); },
    save: async () => { throw new Error("must not rewrite"); }
  });
  assert.equal(duplicate.status, "already_sent");

  const unpaid = booking();
  unpaid.estimate.payment.paidCents = 12606;
  unpaid.estimate.payment.remainingCents = 37816;
  await assert.rejects(() => sendCompletionReceipt({ booking: unpaid }), /paid in full/i);
  console.log("Completion receipt tests passed: concise email, attached paid-in-full PDF, correct totals and duplicate prevention.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
