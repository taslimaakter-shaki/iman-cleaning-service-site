const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Readable } = require("node:stream");
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const root = path.join(__dirname, "..");
const schema = fs.readFileSync(path.join(root, "supabase-schema.sql"), "utf8")
  .match(/create table if not exists public\.bookings \(([\s\S]*?)\n\);/)[1];
const required = [...schema.matchAll(/^\s*(\w+) text not null[^\n]*$/gm)]
  .filter(([line]) => !/default/i.test(line)).map(([, name]) => name);

// Actual quote handler -> actual managed booking builder -> actual Supabase
// storage serializer. Only provider boundaries are mocked; no network is used.
function fixture(units) {
  const bookings = new Map(), sessions = [], calls = [];
  let creates = 0, rejectInsert = false;
  const env = { SUPABASE_URL: "https://storage.example.test", SUPABASE_SERVICE_ROLE_KEY: "test-only",
    STRIPE_SECRET_KEY: "sk_test_mock", PUBLIC_SITE_URL: "https://www.imancleaningservice.com" };
  let record;
  const reply = (status, data) => ({ ok: status < 400, status, text: async () => JSON.stringify(data), json: async () => clone(data) });
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url), method = options.method || "GET";
    calls.push({ url, method });
    if (parsed.origin === env.SUPABASE_URL) {
      assert.equal(parsed.pathname, "/rest/v1/bookings");
      if (method === "GET") return reply(200, [...bookings.values()].filter(row => `eq.${row.id}` === parsed.searchParams.get("id")));
      const body = JSON.parse(options.body);
      if (method === "POST") {
        for (const column of required) {
          if (body[column] == null) return reply(400, { code: "23502", message: `null value in column "${column}" of relation "bookings" violates not-null constraint` });
          assert.equal(typeof body[column], "string", column);
        }
        if (rejectInsert) return reply(503, { message: "Storage temporarily unavailable" });
        assert(Number.isInteger(body.sqft) && body.sqft >= 0);
        assert(Array.isArray(body.addons));assert.equal(body.status, "New");
        assert(!bookings.has(body.id), "Retry must reuse the same pending booking");
        creates++;bookings.set(body.id, clone(body));return reply(201, [body]);
      }
      assert.equal(method, "PATCH");
      const id = parsed.searchParams.get("id").slice(3);
      bookings.set(id, { ...bookings.get(id), ...body });return reply(200, [bookings.get(id)]);
    }
    assert.equal(parsed.origin, "https://api.stripe.com", "No message, calendar or other provider calls");
    assert.equal(parsed.pathname, "/v1/checkout/sessions");
    if (method === "GET") return reply(200, { data: sessions, has_more: false });
    assert.equal(method, "POST");assert.equal(bookings.size, 1, "Booking must pass storage constraints before checkout");
    const params = new URLSearchParams(options.body);
    assert.equal(params.get("line_items[0][price_data][unit_amount]"), "4355");
    assert.equal(params.get("metadata[total_amount_cents]"), "17420");
    assert.equal(params.get("metadata[remaining_amount_cents]"), "13065");
    assert.equal(params.get("metadata[balance_collection]"), "automatic_48h_authorization");
    assert.equal(params.get("payment_intent_data[setup_future_usage]"), "off_session");
    assert.equal(params.get("metadata[agreement_signature]"), "Example Customer");
    const session = { id: "cs_mock", url: "https://checkout.stripe.test/mock", status: "open", payment_status: "unpaid",
      metadata: { quote_id: "QUOTE-STORAGE-TEST", quote_revision: "revision-storage", booking_id: params.get("metadata[booking_id]"),
        checkout_summary_version: params.get("metadata[checkout_summary_version]") } };
    sessions.push(session);return reply(200, session);
  };
  const drive = { files: {
    list: async () => ({ data: { files: [{ id: "mock-quote-file" }] } }),
    get: async () => ({ data: clone(record) }),
    update: async ({ media }) => { record = JSON.parse(media.body);return { data: { id: "mock-quote-file" } }; }
  } };
  const load = (file, dependencies) => {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), {
      module, exports: module.exports, require: name => dependencies[name] || require(name),
      process: { env }, fetch, Buffer, URLSearchParams, Date, Intl, AbortSignal, console
    }, { filename: file });return module.exports;
  };
  const calendar = {
    assertCalendarReady: async () => {},
    reserveBooking: async id => {
      const row = bookings.get(id);
      row.estimate.calendarReservation = { state: 'creating', attempt: 'test-attempt' };
      return clone(row);
    },
    attachCheckout: async (id, attempt, session) => { assert.equal(attempt, 'test-attempt'); assert.equal(session.id, 'cs_mock'); },
    cleanupCheckout: async () => {}
  };
  const bookingStore = load("api/booking/_shared.js", { "./_calendar": calendar });
  const admin = load("api/crm/_quote-admin.js", {
    "../booking/_shared": bookingStore, "../quote/_shared": { getGoogleClients: () => ({ drive, config: { parentFolderId: "mock-parent" } }) }
  });
  const fields = { customerName: "Example Customer", email: "customer@example.test", phone: "+12125550123", address: "123 Example St",
    service: "Deep Cleaning", amountCents: 17420, rushFeeCents: 0, serviceDate: "2030-09-15", serviceTime: "08:00",
    cleanerCount: 1, laborHours: 2, packageItems: "", details: "Agreed scope", units, submittedFields: [] };
  record = { quoteId: "QUOTE-STORAGE-TEST", crmQuote: { revision: "revision-storage", checkoutFlow: "instant_booking", fields } };
  const resolve = () => admin.resolveManaged({ quoteId: record.quoteId, managedSource: "custom", managedId: record.quoteId });
  const handler = load("api/quote/_approve-checkout.js", {
    "../booking/_calendar": calendar,
    "./_shared": { cleanText: bookingStore.cleanText, centsToDollars: value => (value / 100).toFixed(2), json: bookingStore.json },
    "./_short-approval": { resolveShortApproval: async code => { assert.equal(code, "test00000001");return resolve(); } },
    "../crm/_quote-admin": admin
  });
  const request = async (changes = {}) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ code: "test00000001", revision: "revision-storage", agreementScrolled: "true",
      agreementAccepted: "true", agreementSignature: "Example Customer", ...changes })) data.append(key, value);
    const encoded = new Request("https://request.example.test", { method: "POST", body: data });
    const req = Readable.from([Buffer.from(await encoded.arrayBuffer())]);
    req.method = "POST";req.headers = Object.fromEntries(encoded.headers);
    const res = { setHeader() {}, end(value) { this.body = JSON.parse(value); } };
    await handler(req, res);return res;
  };
  return { request, bookings, sessions, calls, fields, admin, resolve, get record() { return record; }, get creates() { return creates; },
    setRejectInsert(value) { rejectInsert = value; } };
}
const room = (name, quantity = 1, kind = "room") => ({ name, quantity, kind, unitPriceCents: 8000, lineTotalCents: quantity * 8000 });

(async () => {
  const f = fixture([{ name: "Unit 1", subtotalCents: 16000, items: [room("Bedrooms"), room("Full bathrooms")] }]);
  for (const invalid of [{ agreementScrolled: "false" }, { agreementAccepted: "false" }, { agreementSignature: "" }, { revision: "old" }]) {
    const result = await f.request(invalid);assert(result.statusCode >= 400);assert.equal(f.creates, 0);assert.equal(f.sessions.length, 0);
  }
  let result = await f.request();assert.equal(result.statusCode, 201, JSON.stringify(result.body));
  assert.equal(result.body.checkoutUrl, "https://checkout.stripe.test/mock");
  const booking = [...f.bookings.values()][0];
  assert.equal(booking.bedrooms_label, "1 bedroom");assert.equal(booking.bathrooms_label, "1 full bathroom");assert.equal(booking.sqft, 0);
  assert.equal(booking.estimate.payment.depositCents, 4355);assert.equal(booking.estimate.payment.remainingCents, 13065);
  assert.equal(booking.estimate.teamHours, 2);assert.equal(booking.schedule, "2030-09-15T08:00:00-04:00");
  assert.equal(f.record.crmQuote.bookingId, booking.id);assert.equal(booking.status, "New", "Only payment completion confirms a booking");
  result = await f.request();assert.equal(result.statusCode, 200);assert.equal(f.creates, 1);assert.equal(f.sessions.length, 1);

  const mixed = fixture([{ name: "A", items: [room("Bedrooms", 2), room("Full bathrooms", 2), room("Half bathrooms"), room("Bedrooms", 40, "addon")] },
    { name: "B", items: [room("Bedroom"), room("Full bathroom"), room("Half bathroom")] }]);
  result = await mixed.request();assert.equal(result.statusCode, 201, JSON.stringify(result.body));
  const combined = [...mixed.bookings.values()][0];assert.equal(combined.bedrooms_label, "3 bedrooms");assert.equal(combined.bathrooms_label, "3 full bathrooms, 2 half bathrooms");
  combined.sqft = 1500;
  const current = await mixed.resolve();mixed.fields.units = [{ name: "Office", items: [room("Workstations", 8)] }];
  combined.estimate.managedQuote.revision = "earlier";
  await mixed.admin.ensureManagedBooking(current);
  const revised = [...mixed.bookings.values()][0];assert.equal(revised.sqft, 1500);assert.equal(revised.bedrooms_label, "3 bedrooms");

  const other = fixture([{ name: "Office", items: [room("Workstations", 8), room("Bedroom windows", 2, "addon")] }]);
  result = await other.request();assert.equal(result.statusCode, 201, JSON.stringify(result.body));
  const office = [...other.bookings.values()][0];assert.equal(office.bedrooms_label, "");assert.equal(office.bathrooms_label, "");

  const failure = fixture([]);failure.setRejectInsert(true);
  result = await failure.request();assert.equal(result.statusCode, 503);assert.equal(failure.sessions.length, 0);assert.equal(failure.record.crmQuote.bookingId, undefined);
  failure.setRejectInsert(false);result = await failure.request();assert.equal(result.statusCode, 201, JSON.stringify(result.body));assert.equal(failure.creates, 1);
  console.log("Custom checkout/storage integration passed: actual multipart parser, quote builder and storage serializer; schema-required fields, unit counts, nonresidential/legacy defaults, retained existing details, exact deposit/hold terms, no checkout on storage failure, safe retry/session reuse. All providers mocked.");
})().catch(error => { console.error(error);process.exitCode = 1; });
