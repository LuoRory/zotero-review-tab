# Security policy

## Supported version

The current development version is supported while it is developed from the Zotero source-proxy workflow described in `docs/development.md`.

## Reporting a vulnerability

Do not include personal bibliographic metadata, note text, annotation text, API keys, or Zotero database files in a public report.

Report a suspected vulnerability privately to the repository maintainer with:

- affected plugin version/build;
- Zotero version and operating system;
- minimal reproduction steps;
- expected and actual behavior;
- sanitized logs or screenshots, if useful.

## Data boundary

Review Tab reads Zotero source content to form review units. It automatically writes only its own standalone `Review Tab — Sync State` note. Development scripts may manage the Zotero source proxy and its associated profile metadata, but must never modify the Zotero library database, attachment storage, or unrelated plugin data.
