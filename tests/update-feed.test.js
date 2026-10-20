const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
test('release feed describes exact production artifact and digest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const feed = JSON.parse(fs.readFileSync(path.join(root, 'updates.json'), 'utf8'));
  const update = feed.addons[manifest.applications.zotero.id].updates.find(row => row.version === manifest.version);
  assert.ok(update);
  assert.match(update.update_link, /^https:\/\/github\.com\/LuoRory\/zotero-review-tab\/releases\/download\/v/);
  assert.match(update.update_hash, /^sha256:[0-9a-f]{64}$/);
  const artifact = path.join(root, 'dist', `zotero-review-tab-${manifest.version}.xpi`);
  if (fs.existsSync(artifact)) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
    assert.equal(update.update_hash, `sha256:${hash}`);
    const generated = JSON.parse(execFileSync(process.execPath, ['scripts/generate-update.mjs', artifact], { cwd: root, encoding: 'utf8' }));
    assert.deepEqual(generated, feed);
  }
});
