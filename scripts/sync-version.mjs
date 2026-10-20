import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'manifest.json');
const buildInfoPath = path.join(root, 'build-info.js');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const build = process.env.REVIEW_TAB_BUILD ?? new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
manifest.version = pkg.version;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(buildInfoPath, `var ReviewTabBuild = Object.freeze({ version: ${JSON.stringify(pkg.version)}, build: ${JSON.stringify(build)} });\n`);
console.log(`Synchronized ${pkg.version} / ${build}`);
