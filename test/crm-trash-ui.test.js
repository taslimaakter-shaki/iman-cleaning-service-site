const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../crm.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../crm.html"), "utf8");
const dialogMarkup = html.match(/<dialog class="crm-delete-confirm"[\s\S]*?<\/dialog>/)[0];
assert.match(dialogMarkup, /Are you sure you want to delete this quote\?/);
assert.match(dialogMarkup, /value="no" autofocus>No<\/button>/);
assert.match(dialogMarkup, /value="yes"[^>]*>Yes<\/button>/);
assert.match(dialogMarkup, /method="dialog"/);
assert.doesNotMatch(dialogMarkup, /<input|<textarea/);
assert.doesNotMatch(source, /window\.prompt/);
assert.match(html, /data-view-button="trash"/);
assert.match(html, /data-view="trash"/);

class Element extends EventTarget {
  constructor() {
    super(); this.open = false; this.returnValue = ""; this.disabled = false;
    this.isConnected = true; this.innerHTML = ""; this.textContent = "";
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  showModal() { this.open = true; }
  close(value) { if (value !== undefined) this.returnValue = value; this.open = false; this.dispatchEvent(new Event("close")); }
  querySelector(selector) { return element(selector); }
  querySelectorAll() { return []; }
  contains() { return false; }
}
const elements = new Map();
const element = selector => {
  if (!elements.has(selector)) elements.set(selector, new Element());
  return elements.get(selector);
};
const document = new Element();
const requests = [];
let apiFailure = false;
const window = { navigator: {}, matchMedia: () => ({ matches: false }) };
const context = {
  document, window, navigator: { userAgent: "Test", platform: "Test" },
  sessionStorage: { getItem: () => "" }, localStorage: { getItem: () => "" },
  setTimeout: () => 1, clearTimeout() {}, console,
  fetch: async (url, options) => {
    assert.equal(url, "/api/crm/quotes", "No messages, payments or other endpoints in this test");
    requests.push({ url, ...options });
    if (apiFailure) return { ok: false, status: 409, json: async () => ({ error: "Quote changed. Refresh and try again." }) };
    if (options.method) {
      const body = JSON.parse(options.body);
      const quote = window.test.state.quotes.find(item => item.id === body.id);
      assert.equal(body.source, quote.editSource);
      assert.equal(body.version, quote.editVersion);
      if (options.method === "DELETE") {
        assert.equal(body.confirmation, quote.id);
        quote.deletedAt = "2030-01-02T00:00:00Z";
      } else {
        assert.equal(options.method, "PATCH"); assert.equal(body.operation, "restore");
        quote.deletedAt = "";
      }
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ quotes: window.test.state.quotes }) };
  }
};
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, "window.test = { state, requestQuoteDeletion, quoteMutation, renderTrash, filteredQuotes, trashedQuotes, renderCounts };\n})();"), context);
const { state, requestQuoteDeletion, quoteMutation, renderTrash, filteredQuotes, trashedQuotes, renderCounts } = window.test;
const quote = (id, deletedAt = "") => ({ id, customerName: id, email: `${id}@example.test`, type: "Instant quote", editSource: "saved", editVersion: "revision-1", deletedAt });
const selected = quote("TEST-SELECTED");
state.token = "mock-admin-only";
state.quotes = [selected, quote("TEST-OTHER"), quote("TEST-CUSTOM", "2029-01-01T00:00:00Z")];
state.quotes[2].type = "Customized quote";
const dialog = element("[data-delete-quote-dialog]");
const status = new Element();
const button = new Element();

(async () => {
  for (const answer of ["no", undefined]) {
    const pending = requestQuoteDeletion(selected, status, button);
    assert(dialog.open); assert(button.disabled);
    dialog.close(answer); await pending;
    assert.equal(requests.length, 0, "No and Escape must not delete");
    assert(!button.disabled);
  }
  const pending = requestQuoteDeletion(selected, status, button);
  await requestQuoteDeletion(selected, status, button);
  dialog.close("yes"); await pending;
  assert.equal(requests.filter(r => r.method === "DELETE").length, 1, "Repeated clicks submit once");
  assert(selected.deletedAt);
  assert.equal(state.quotes[1].deletedAt, "", "Only the selected quote is deleted");
  assert.deepEqual(Array.from(filteredQuotes(), q => q.id), ["TEST-OTHER"]);
  assert.deepEqual(Array.from(trashedQuotes(), q => q.id), ["TEST-SELECTED", "TEST-CUSTOM"]);
  assert.match(element("[data-trash-list]").innerHTML, /Restore quote/);
  assert.equal(element("[data-nav-trash-count]").textContent, 2);
  assert.match(element("[data-toast]").textContent, /moved to Trash/);

  // A previous Yes must never carry forward to Escape on the next prompt.
  const cancelled = requestQuoteDeletion(state.quotes[1], status, button);
  dialog.close(); await cancelled;
  assert.equal(requests.filter(r => r.method === "DELETE").length, 1);

  await quoteMutation(selected, { operation: "restore" }, "PATCH", status, new Element());
  assert(!selected.deletedAt);
  assert.equal(filteredQuotes().length, 2);
  assert.equal(trashedQuotes().length, 1);
  assert.equal(element("[data-nav-trash-count]").textContent, 1);

  state.search = "test-custom"; renderTrash();
  assert.equal(trashedQuotes().length, 1);
  state.search = "does-not-exist"; renderTrash();
  assert.equal(element("[data-trash-empty]").hidden, false);
  assert.equal(element("[data-trash-empty-title]").textContent, "No deleted quotes found");
  state.search = ""; state.quotes[2].customerName = '<img src=x onerror="bad()">'; renderTrash();
  assert.doesNotMatch(element("[data-trash-list]").innerHTML, /<img/);
  assert.match(element("[data-trash-list]").innerHTML, /&lt;img/);

  apiFailure = true;
  const failure = requestQuoteDeletion(selected, status, button); dialog.close("yes"); await failure;
  assert(!selected.deletedAt); assert(!button.disabled);
  assert.match(status.textContent, /Quote changed/);
  apiFailure = false;
  state.quotes[2].deletedAt = ""; renderTrash(); renderCounts();
  assert.equal(element("[data-nav-trash-count]").textContent, 0);
  assert.equal(element("[data-trash-empty-title]").textContent, "Trash is empty");

  const count = requests.length;
  const signedOut = requestQuoteDeletion(selected, status, button);
  state.token = ""; dialog.close("yes"); await signedOut;
  assert.equal(requests.length, count, "Signing out cancels pending deletion");
  console.log("CRM Trash: Yes/No, Escape, repeat clicks, exact customer binding, restore, filters, counts, search, escaping and error handling passed (mock records only).");
})().catch(error => { console.error(error); process.exitCode = 1; });
