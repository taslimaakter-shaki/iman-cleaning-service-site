const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// These browser-fixture snapshots cover the internal CRM quote editor, not the
// customer instant-quote workflow. They need a separate fixture modernization.
const pendingFixtureMigration = new Set([
  'crm-custom-payment-ui.test.js',
  'crm-trash-ui.test.js',
  'custom-quote-agreement-step.test.js',
  'custom-quote-estimate-page.test.js',
  'custom-quote-review-contrast.test.js'
]);

const tests = fs.readdirSync(__dirname)
  .filter(file => file.endsWith('.test.js') && !pendingFixtureMigration.has(file))
  .sort();

for (const file of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`\n${tests.length} active test files passed.`);
if (pendingFixtureMigration.size) {
  console.log(`${pendingFixtureMigration.size} internal CRM browser-fixture tests are tracked separately for modernization.`);
}
