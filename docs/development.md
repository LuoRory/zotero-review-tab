# Development workflow

## Source proxy

Zotero loads this plugin from a profile-local proxy file. The proxy file must:

- live in the active Zotero profile's `extensions/` directory;
- have the exact plugin ID as its filename, with **no extension**:

```text
review-tab@local.zotero
```

- contain only the absolute repository root path.

The current machine's proxy target is the repository root. If the repository moves, stop Zotero first, then update the proxy target before restarting.

## Commands

```powershell
npm test              # run pure Node tests
npm run check         # parse runtime/tool code and run tests
npm run dev:status    # inspect source-proxy state
npm run dev:restart   # restart Zotero with development diagnostics
npm run dev:logs      # inspect the latest development log
npm run dev:rollback  # remove the source proxy after Zotero is closed
```

`dev:setup`, `dev:restart -Force`, and `dev:rollback` may modify the local Zotero profile or process state. Read their output and use them only on the intended profile.

## Reloading

Zotero bootstrap plugins do not provide a general, reliable save-to-hot-reload workflow. After changes to bootstrap code, UI assets, loaded scripts, or vendored runtime modules:

1. run `npm run check`;
2. restart Zotero through the development script;
3. confirm the plugin's source root and UI behavior;
4. inspect logs if startup or rendering fails.

Development logs and profile backups live outside the repository under `%LOCALAPPDATA%\ReviewTabDev\`.
