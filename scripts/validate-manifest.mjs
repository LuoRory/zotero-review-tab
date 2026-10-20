import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const zotero = manifest.applications?.zotero;

if (manifest.manifest_version !== 2) throw new Error('manifest_version must be 2');
if (manifest.version !== packageJson.version) throw new Error(`Manifest version ${manifest.version} does not match package version ${packageJson.version}`);
if (zotero?.id !== 'review-tab@local.zotero') throw new Error('Unexpected Zotero plugin ID');
if (zotero.update_url !== 'https://raw.githubusercontent.com/LuoRory/zotero-review-tab/main/updates.json') throw new Error('Invalid production update URL');
if (!zotero.strict_min_version || !zotero.strict_max_version) throw new Error('Zotero compatibility range is required');
console.log(`Validated manifest ${manifest.name} v${manifest.version}`);
