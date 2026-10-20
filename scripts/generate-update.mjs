import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const zotero = manifest.applications.zotero;
const file = process.argv[2];
if (!file || !fs.existsSync(file)) throw new Error('Pass the existing release XPI path');
if (manifest.version !== packageJson.version) throw new Error('Package and manifest versions differ');
const expectedName = `zotero-review-tab-${manifest.version}.xpi`;
if (path.basename(file) !== expectedName) throw new Error(`Expected ${expectedName}`);
const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const feed = { addons: { [zotero.id]: { updates: [{
  version: manifest.version,
  update_link: `https://github.com/LuoRory/zotero-review-tab/releases/download/v${manifest.version}/${expectedName}`,
  update_hash: `sha256:${hash}`,
  applications: { zotero: { strict_min_version: zotero.strict_min_version, strict_max_version: zotero.strict_max_version } }
}] } } };
process.stdout.write(JSON.stringify(feed, null, 2) + '\n');
