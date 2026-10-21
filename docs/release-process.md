# Release process

## Version authority

`package.json` is the source of the release version.

```powershell
npm run version:sync
```

updates `manifest.json` and the generated `build-info.js` stamp.

## Validation

Before a release, first choose and synchronize the new version, then run `npm run build` once with a fixed `REVIEW_TAB_BUILD` value. Generate `updates.json` from that final XPI, run `npm run check`, upload the XPI, verify its downloaded SHA-256, and only then publish the matching update manifest. Do not rebuild after generating the feed.

```powershell
$env:REVIEW_TAB_BUILD = 'release'
npm run build
node scripts/generate-update.mjs dist/zotero-review-tab-<version>.xpi > updates.json
npm run check
```

`npm run build` is intentionally mutating because it synchronizes generated version metadata before packaging. Run it from an intentional release state and inspect resulting changes before committing or tagging.

## XPI packaging

`package_xpi.py` creates:

```text
dist/zotero-review-tab-<version>.xpi
```

The packager uses Deflate compression, disables ZIP64, includes explicit runtime files and vendor attribution, and verifies required archive contents.

`dist/` is a local generated directory and is ignored by Git. Publish release XPI files through a release artifact channel rather than source history.

## Updates

The manifest points to `updates.json` on the public repository default branch. Each update entry must point to an immutable GitHub Release XPI and include its SHA-256 hash. Upload and verify the release asset before publishing the update entry; never use placeholder URLs.

## Manual release checklist

- Test a clean installation and an upgrade with a disposable Zotero profile and a backed-up test library.
- Check initial scanning, a manual refresh, book reading-day boundaries, grading and undo, note display, opening annotations in the reader, and persistence after restart.
- Test a corrupted state note on a disposable library and verify it is not overwritten.
- Verify declared Zotero versions and target operating systems before claiming support; record actual results.
- Inspect the archive, licenses, metadata and release notes. Verify the public update feed only after the immutable Release asset is uploaded.
