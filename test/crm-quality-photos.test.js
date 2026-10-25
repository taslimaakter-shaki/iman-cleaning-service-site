const assert = require("assert");
const {
  MAX_QUALITY_PHOTOS_PER_STAGE,
  qualityState,
  safeName,
  stageFor,
  totalPhotos,
  validatePhoto
} = require("../api/crm/_quality-photos");

assert.strictEqual(MAX_QUALITY_PHOTOS_PER_STAGE, 200);
assert.strictEqual(stageFor("Before"), "before");
assert.strictEqual(stageFor("after"), "after");
assert.throws(() => stageFor("during"), /Before photos or After photos/);
assert.deepStrictEqual(qualityState({}), { before: [], after: [] });
assert.strictEqual(totalPhotos({ before: [{ id: "1" }], after: [{ id: "2" }, { id: "3" }] }), 3);
assert.strictEqual(validatePhoto({ mimeType: "image/heic", size: 1024 }).mimeType, "image/heic");
assert.throws(() => validatePhoto({ mimeType: "application/pdf", size: 1024 }), /pictures only/i);
assert.throws(() => validatePhoto({ mimeType: "image/jpeg", size: 21 * 1024 * 1024 }), /20 MB/i);
assert.strictEqual(safeName("../../Kitchen: before?.JPG"), "..-..-Kitchen- before-.JPG");

console.log("CRM quality photo tests passed");
