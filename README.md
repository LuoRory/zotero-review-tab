# Review Tab for Zotero

Review Tab is a Zotero bootstrap plugin for revisiting academic papers and professional books. It scans existing Zotero notes and PDF annotations once, builds compact review units, and uses an offline FSRS scheduler to maintain a local-time daily queue.

## What it does

- Papers are reviewed as whole parent-item units.
- Book-like items are split into reading-day sessions using a configurable local-day boundary (default 04:00).
- Existing content is classified into recent New candidates or a controlled historical backlog.
- A daily queue prioritizes due FSRS reviews, then admits a limited number of New and backlog units within the daily capacity.
- Main review actions are **Continue** (Good) and **Did not remember** (Again); Hard and Easy are secondary options.
- Arbitrary review records a practice event by default and affects FSRS only after an explicit merge and rating.
- Click a note to display it in the right pane. The annotation list displays text and comments; choose **原文** to open the annotation in Zotero's PDF reader. Image and ink previews are not currently rendered in the list.

## Installation and limitations

Build an XPI as described below, then install it using Zotero's Add-ons manager. The manifest declares Zotero 7 through 10 compatibility; this range has not been verified here across all versions and platforms.

The plugin keeps its own state in a standalone Zotero note. It opens the Review tab by default, but defers source reconciliation until that tab is active, so editing unrelated items while working elsewhere does not start a review scan or state-note write. Back up your Zotero library before testing; if the state note is damaged, unsupported, or externally changed after loading, the plugin stops rather than overwriting it. Back up and resolve the state note before retrying. Source units that disappear remain in the scheduler history as unavailable records and cannot be reviewed until their source returns. Automatic updates use the public release update feed.

## Data boundary

Review Tab reads Zotero notes and PDF annotations. It does not automatically modify bibliographic items, PDFs, source annotations, existing notes, tags, collections, or Extra fields.

The only automatic write target is a standalone per-library note titled `Review Tab — Sync State`. It stores compact unit summaries, FSRS card state, review/practice logs, parameters, and the stable daily queue. Source text is not copied into this state note.

For a full statement, see [docs/zotero-data-boundary.md](docs/zotero-data-boundary.md).

## Development

This repository is designed to be a Zotero source-proxy root. Runtime files intentionally remain at the repository root because Zotero loads `manifest.json`, `bootstrap.js`, and sibling scripts relative to that root.

```powershell
npm test
npm run check
npm run dev:status
npm run dev:restart
```

See [docs/development.md](docs/development.md) for source-proxy setup and restart behavior.

## Release build

```powershell
npm run build
```

The build command is intentionally mutating: it synchronizes generated version/build metadata before packaging a Deflate, ZIP64-disabled XPI under `dist/`. The `dist/` directory is local-only and ignored by Git. See [docs/release-process.md](docs/release-process.md).

## License and notices

Original Review Tab code is licensed under [MIT](LICENSE). The plugin vendors `ts-fsrs` 5.4.2 under its own MIT license; see [NOTICE](NOTICE) and `vendor/` for the license, provenance, and integrity hash.

## References

- [Zotero plugin development](https://www.zotero.org/support/dev/client_coding/plugin_development)
- [Zotero 7+ developer architecture](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)

