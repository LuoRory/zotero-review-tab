# Contributing

## Prerequisites

- Zotero 10 for runtime validation.
- Node.js 20+ for syntax checks and the built-in Node test runner.
- Python 3 for release packaging.

## Source-proxy development

The Zotero plugin root must remain the repository root: it contains `manifest.json`, `bootstrap.js`, and the proxy-relative runtime modules. Follow [docs/development.md](docs/development.md) to configure a Zotero source proxy.

## Validation

Run the non-mutating validation path before proposing changes:

```powershell
npm test
npm run check
```

Add or update tests for changes to FSRS scheduling, discovery, daily queue policy, state migration, or source-summary grouping.

## Release build

`npm run build` is intentionally mutating: it runs `version:sync`, which synchronizes `manifest.json` and regenerates `build-info.js`, then produces `dist/zotero-review-tab-<version>.xpi`.

Run it only from an intentional release state. Do not commit `dist/` artifacts.

## Data boundary

Never add automatic writes to Zotero source items, PDFs, annotations, normal notes, tags, collections, or the Extra field. The only automatic write target is the plugin-owned `Review Tab — Sync State` standalone note.

## Zotero restart

Changes to bootstrap code, registered chrome, UI resources, or vendored runtime modules require a controlled Zotero restart. The development scripts can inspect proxy state, restart Zotero, read logs, and roll back the proxy; some operations modify the local Zotero profile, so read the command output carefully.
