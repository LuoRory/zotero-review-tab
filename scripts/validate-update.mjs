import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) throw new Error('Pass an update manifest path');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const feed = JSON.parse(fs.readFileSync(file, 'utf8'));
const zotero = manifest.applications.zotero;
const update = feed.addons?.[zotero.id]?.updates?.find(item => item.version === manifest.version);
if (!update) throw new Error(`Missing update for ${zotero.id} v${manifest.version}`);
const expected = `https://github.com/LuoRory/zotero-review-tab/releases/download/v${manifest.version}/zotero-review-tab-${manifest.version}.xpi`;
if (update.update_link !== expected) throw new Error('Unexpected release asset URL');
if (!/^sha256:[a-f0-9]{64}$/.test(update.update_hash || '')) throw new Error('Invalid SHA-256 update hash');
if (update.applications?.zotero?.strict_min_version !== zotero.strict_min_version || update.applications?.zotero?.strict_max_version !== zotero.strict_max_version) throw new Error('Update compatibility range differs from manifest');
const artifact = path.join('dist', `zotero-review-tab-${manifest.version}.xpi`);
if (fs.existsSync(artifact)) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  if (update.update_hash !== `sha256:${hash}`) throw new Error('Update hash differs from local XPI');
}
if (packageJson.version !== manifest.version) throw new Error('Package and manifest versions differ');
console.log(`Validated update manifest for ${manifest.version}`);
