# Release process

## Version authority

`package.json` is the source of the release version.

```powershell
npm run version:sync
```

updates `manifest.json` and the generated `build-info.js` stamp.

## Validation

Before a release:

```powershell
npm run check
npm run build
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
- Inspect the archive, licenses, metadata and release notes. No update feed is currently configured.
