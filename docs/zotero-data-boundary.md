# Zotero data boundary

## Reads

Review Tab reads only the content needed to construct and render review units:

- personal-library item metadata;
- Zotero child notes;
- PDF annotations and their attachment/parent relationships;
- creation and modification timestamps;
- configured plugin preferences.

## Automatic writes

The plugin automatically writes only one standalone note per editable personal library:

```text
Review Tab — Sync State
```

That note contains compact scheduler data: unit summaries, FSRS card state, explicit review logs, practice records, parameters, priorities, and the daily queue snapshot. When a source item or its review content disappears, the plugin retains the related scheduler history as an unavailable unit instead of automatically deleting it.

The plugin compares the loaded state note with its last known version before writing. If Zotero Sync or a manual edit changed the note, the plugin stops the write and asks the user to back up and resolve the conflict; it does not automatically merge competing review histories.

## Never automatically modified

Review Tab does not automatically change:

- source bibliographic items;
- PDFs or attachments;
- source annotations, highlight colors, or comments;
- existing Zotero notes;
- tags, collections, or Extra fields.

When a user chooses to open or create a Zotero note, open a PDF annotation, or edit a source item, Zotero's native interface performs that user-directed action.
