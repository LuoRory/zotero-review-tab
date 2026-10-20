# Changelog

All notable changes to this project are documented here.

## [Unreleased]

## [0.2.1] - 2026-10-20

- Add a production update feed for Zotero XPI compatibility.
- Preserve review history and defer background work while the review tab is inactive.
- Protect state writes from external changes and improve review UI consistency.

- Repository normalization, documentation, metadata, and reproducible release workflow.

## [0.2.0] - 2026-10-20

- **The plugin no longer renders PDFs itself.** Clicking an annotation now selects the annotation's parent item in Zotero, which brings up Zotero's own right-hand item pane: item details, attachment thumbnails and any other plugin's sections, all rendered by Zotero. The item pane is expanded if it was collapsed.
- Removed the entire embedded PDF viewer: `viewer.html` loading, `srcdoc` inlining, the iframe, the `webviewerloaded` listener, blob URL management, the annotation preview pane and its styles. Roughly 400 lines of code that could not be made to work reliably are gone rather than left half-functional.
- The right pane now only ever shows notes. Annotation clicking is a one-way jump to Zotero's own UI, which is the supported way to view a PDF.

## [0.1.23] - 2026-10-20

- The pane now waits for the viewer's `webviewerloaded` event instead of polling for globals. `viewer.mjs` dispatches it with `parent.document.dispatchEvent(...)` and puts the viewer **window** in `detail.source`; `PDFViewerApplication` only exists on that window afterwards. The listener is therefore attached to the document (not the window) and the application is read from `detail.source.PDFViewerApplication`, matching what `reader.js` does.
- Timeout now distinguishes "viewer never announced itself" from "loaded but missing objects".

## [0.1.22] - 2026-10-20

- `viewer.html` is now read as bytes with `IOUtils.read()` and decoded with `TextDecoder`, falling back to a synchronous `XMLHttpRequest` on the `resource://` URL. `Zotero.File.getContentsAsync()` turned out to hand back an `XMLHttpRequest` object in this environment (`[object XMLHttpRequest]`), so the pane no longer depends on its return shape at all.
- The decoded text and the rewritten HTML were verified against the real `viewer.html` shipped with Zotero (65980 chars, all three references rewritten, `<base>` inserted).

## [0.1.21] - 2026-10-20

- Fixed "无法读取 PDF 文件：TypeError: source.replace is not a function". `Zotero.File.getContentsAsync()` returns a `Uint8Array` unless a character encoding is passed, so `viewer.html` is now read with `'utf-8'`, with a `TextDecoder` fallback for readers that ignore the argument.

## [0.1.20] - 2026-10-20

- The viewer page is now loaded as inline `srcdoc` instead of `iframe.src = 'resource://…'`. Setting a `resource://` URL on an iframe created by the add-on's document is blocked — the `load` event never fires — so `viewer.html` is read with `Zotero.File.getContentsAsync()`, its three relative references (`../build/pdf.mjs`, `viewer.mjs`, `viewer.css`) are rewritten to absolute `resource://` URLs, and a `<base href>` is added for the viewer's own relative fetches. This mirrors how Zotero loads HTML attachments (`reader.js` `_getSrcDoc`).

## [0.1.19] - 2026-10-20

- The embedded viewer's failure modes are now reported on screen instead of leaving a white column. After the iframe loads, each required object (`window`, `document`, `pdfjsLib`, `PDFViewerApplication`, `pdfViewer`) is checked and any missing one is named; a 6 s timeout fires if the `load` event never arrives at all, distinguishing "iframe never loaded" from "viewer loaded but did not initialise".
- Loading uses `win.pdfjsLib.getDocument()` directly on the viewer iframe, followed by `pdfViewer.setDocument()`.

## [0.1.18] - 2026-10-20

- The embedded viewer now loads the document through `globalThis.pdfjsLib.getDocument()` and hands it to `pdfViewer.setDocument()`, instead of calling `PDFViewerApplication.open()`. `viewer.mjs` itself reads pdf.js from `globalThis.pdfjsLib`, so the library is already initialised in the iframe and nothing extra has to be imported; `open()` re-entered the viewer's own startup and left the pane blank.
- Every step now reports into the pane ("正在加载 PDF…", "改用字节数据重新加载…", "PDF 加载失败：…", "iframe 里没有 pdfjsLib"), so a failure can no longer present as a silent white column.
- After the document loads, a resize event and `page-width` scaling force the viewer to recompute page sizes against the injected full-height layout.

## [0.1.17] - 2026-10-20

- Fixed the blank PDF pane. The injected stylesheet contained a stray `#viewerContainer[data-rt3]{display:none}` rule, which could hide the page container itself. Only the shell is hidden now (`#toolbarContainer`, `#secondaryToolbar`, `#sidebarContainer`, `#loadingBar`, `#errorWrapper`), and `#viewerContainer` is pinned to the full iframe.
- The viewer is opened with a `blob:` URL; if that fails the PDF bytes are passed straight to `app.open({ data })` instead, so the pane no longer depends on blob visibility across the `resource://` boundary.
- PDF load failures and password-protected documents are reported inside the pane instead of leaving it white.

## [0.1.16] - 2026-10-20

- Fixed "无法读取 PDF 文件: TypeError: Zotero.Utilities.Internal.base64ToArrayBuffer is not a function". The PDF bytes are now read directly as a `Uint8Array` with `IOUtils.read()` instead of going through the removed base64 helper. A zero-length file is reported as such.

## [0.1.15] - 2026-10-20

- The annotation pane is now an **embedded PDF reader**: an `iframe` pointing at Zotero's own `resource://zotero/reader/pdf/web/viewer.html`, opened on the annotation's page with the PDF passed as a `blob:` URL. The page can be scrolled and zoomed and no external reader has to be open first.
- This replaces both previous approaches. The add-on never imports `pdf.worker.mjs` itself; the viewer loads it inside its own iframe global, where `Map.prototype` is extensible — so the incompatibility that killed 0.1.11 never applies, and the zombie-reader/white-image problems of 0.1.13–0.1.14 cannot happen.
- The viewer's own toolbar and sidebar are hidden with an injected stylesheet so only the page is visible; `blob:` URLs are released when the pane closes or switches annotations, and a stale async result is discarded instead of overwriting a newer selection.

## [0.1.14] - 2026-10-20

- Fixed "renders for a moment, then goes blank". A reader that has been closed stays in `Zotero.Reader._readers` with an unloaded window: `getPage` still resolves, but the canvas belongs to a detached document and `toDataURL` yields white. Such readers are now skipped, and a render that finishes after the reader closes is rejected instead of being shown.
- Rejects empty page exports (implausibly short PNG data URL) so the pane falls back to the annotation screenshot rather than displaying a white page.
- Stale annotation previews are discarded: rapidly clicking two annotations used to let the slower one overwrite the newer selection, which is also how the screenshot and the "open this PDF first" hint ended up on screen together.
- Placeholder and hint blocks no longer stretch in the page pane, so a hint can't be pushed to the bottom of a tall column.

## [0.1.13] - 2026-10-20

- The annotation pane shows the **whole PDF page** again, without any highlight overlay. The page is rendered through the pdf.js instance the Zotero reader has already loaded (`PDFViewerApplication.pdfDocument` in the reader iframe), so `pdf.worker.mjs` is never imported by the add-on — the `Map.prototype` incompatibility from 0.1.12 is sidestepped rather than worked around.
- When the PDF is not already open in a reader, the pane falls back to the annotated screenshot and says so ("open this PDF in Zotero first"). Clicking "open in PDF" then re-opens the pane with the full page.
- Fixed `this.pngSize is not a function`: the helper was dropped together with the pdf.js renderer but is still used to read cached screenshot dimensions.

## [0.1.12] - 2026-10-20

- The right pane's annotation view now shows the **annotation's cached screenshot** instead of a rendered PDF page, overlaid with a region mask so only the selection is visible, plus ‹ previous / next › and open-in-PDF.
- Removed the pdf.js page renderer. Zotero's `pdf.worker.mjs` fails to load in this environment: its top-level shim assigns `Map.prototype.getOrInsertComputed`, and `Map.prototype` is not extensible in Zotero's chrome scope (`TypeError: can't define property "getOrInsertComputed": Map.prototype is not extensible`). Verified that no loading strategy avoids it — module globals are separate from the add-on's globals, the DOM `viewer.mjs` bundle imports the same worker module, and a frozen prototype accepts neither assignment nor `defineProperty`.
- If the screenshot cache is missing, the pane asks Zotero to regenerate it once, then reports the missing cache and still offers "open in PDF".

## [0.1.11] - 2026-10-20

- The right pane now behaves like the classic split view: a note click renders the note, an annotation click shows the annotation's location on its PDF page instead of a separate detail card.
- PDF pages are rendered with Zotero's own pdf.js (`resource://zotero/reader/pdf/build/*`), one page at a time, destroyed right after rendering, and cached per attachment/version/page under `<data directory>/pages`. **Superseded in 0.1.12** — see above for why this could not work.
- The annotation is boxed in its colour on the page, same-page annotations are faintly marked, continuation fragments of the same paragraph are highlighted together, and ‹ previous / next › walks the annotations; zoom toggles between fit-width and 100%.
- Fixed pdf.js worker startup in the chrome scope: the worker module is registered as `globalThis.pdfjsWorker` **before** importing `pdf.mjs`, which makes pdf.js parse on the main thread instead of hanging.

## [0.1.10] - 2026-10-20

- Annotation thumbnails: image annotations and ink drawings render their cropped screenshot in the annotation list, loaded from Zotero's own cache as a `file:` URL instead of an inlined base64 string.
- Region mask: the 4× annotation screenshot is aligned to its selection rectangles with an SVG mask, so oversized legacy caches and edited selections still show exactly the selected region.
- Hover enlargement and a right-hand preview pane (annotation text, comment, large image) that replaces the note pane while open.
- "PDF preview sidebar" content: the preview pane locates the highlighted text in the attachment's full text through `Zotero.Fulltext.getItemContent()` and shows the surrounding sentence, with a button to jump to the note that quotes it.
- Continuation fragments split by line breaks are merged into one row; annotations are sorted by page, then by position.
- Ink drawings now count as annotations and are registered from the notifier.
- Fixed the "All → recent activity" sort producing NaN before a unit was rebuilt, and stopped querying the removed `fulltextWords` table.

## [0.1.9] - 2026-10-18

- Imported baseline for the Review Tab Zotero plugin.
- Added FSRS-driven daily queue, initial content discovery, backlog admission, practice records, and vendored `ts-fsrs` runtime.

Historical XPI files under local `dist/` are development artifacts and are intentionally not version-controlled.
