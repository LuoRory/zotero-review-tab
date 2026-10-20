# Architecture

## Runtime layout

The repository root is also the Zotero source-proxy root. Do not move runtime modules under `src/` without redesigning the proxy and packaging workflow.

```text
manifest.json
bootstrap.js
build-info.js
schedule.js
discovery.js
queue-policy.js
vendor/ts-fsrs-5.4.2.umd.js
fsrs-adapter.js
content/
```

## Bootstrap dependency order

`bootstrap.js` loads classic scripts in this order:

```text
build-info
→ schedule
→ discovery
→ annotation-image
→ queue-policy
→ unit-maintenance
→ ts-fsrs UMD
→ fsrs-adapter
```

The UMD FSRS bundle may export to `globalThis.FSRS`; bootstrap normalizes that export to the plugin scope before loading the adapter.

## Data flow

```text
Zotero notes and PDF annotations
→ parent-item resolution
→ paper or book-reading-day units
→ compact Review Tab sync state
→ daily FSRS queue
→ explicit rating or practice record
```

`discovery.js` owns source grouping. `queue-policy.js` owns daily capacity/admission. `fsrs-adapter.js` owns card/log DTOs and local-day due policy. `bootstrap.js` connects these pure modules to Zotero APIs and persistence.

## Synchronization and responsiveness

The Review tab opens by default at startup. While no Review tab is selected, item notifications are only coalesced in memory; no parent scan or sync-state write runs in the background. Selecting a Review tab drains those changes before it renders. A fresh process with existing state performs one full, non-destructive reconciliation when the Review tab first becomes active, so changes made while Zotero was closed are discovered.

State-changing work is serialized per library. A source unit that disappears is marked unavailable instead of deleting its FSRS card, logs, queue references or user flags; unavailable units are excluded from new review actions and reactivate if the same source unit returns. If the sync-state note differs from the version loaded by the plugin, writes fail closed rather than overwriting an external edit or sync update.

## Testing

Runtime modules use browser/global exports and CommonJS exports for Node tests. Pure discovery, queue, FSRS adapter, and schedule logic is covered through Node's built-in test runner under `tests/`.
