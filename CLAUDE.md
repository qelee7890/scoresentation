# Scoresentation — notes for Claude

Electron app (church hymn presentation / score editor). Native dep: **better-sqlite3**.

## Releasing / publishing (read before any `npm run publish`)

Use the npm scripts as-is. They are **self-verifying** — do not "simplify" or bypass them:

```
npm run publish   # = rebuild -f  &&  verify-native  &&  electron-builder --win --publish always
```

Why each step exists (a broken release already happened — v1.5.5/1.5.6 shipped a
Node-ABI better-sqlite3 and the installed app crashed on launch with
`NODE_MODULE_VERSION 127 vs 145`):

- `"npmRebuild": false` in package.json `build` — electron-builder's bundled
  `@electron/rebuild` silently kept the **Node** prebuilt; disabling it makes
  electron-builder ship `node_modules` as-is.
- `npm run rebuild` = `electron-rebuild -f` — the **`-f` is required**; without
  it the rebuild may skip and leave a Node-ABI binary.
- `npm run verify-native` = `electron tools/check-native-abi.cjs` — hard gate:
  loads better-sqlite3 **under Electron** and exits non-zero on ABI mismatch,
  aborting the publish before a broken artifact is built/uploaded.

Extra safety: after building, launch `dist/win-unpacked/Scoresentation.exe` and
confirm the main window opens with no stderr module error.

Prereqs: `GH_TOKEN` env var (publishes to GitHub Releases `qelee7890/scoresentation`).
electron-builder auto-creates the `vX.Y.Z` tag + `latest.yml` (drives electron-updater).

A user on a broken build (app won't launch) **cannot self-update** — they must
manually reinstall the fixed installer (`dist/Scoresentation Setup X.Y.Z.exe`,
oneClick, per-user, no admin).

## Data / DB

- Baseline (shipped, read-only): `data/scoresentation.db` (hymns, 통일찬송가 558),
  `data/setlists.db`. User data overlays in `%APPDATA%/Scoresentation/data/`.
- Edit DBs with **Python `sqlite3`** (ABI-independent, won't disturb the app);
  do not use `node`/better-sqlite3 from scripts (it flips the ABI). Checkpoint
  WAL after edits: `PRAGMA wal_checkpoint(TRUNCATE)`.
- Hymn lyric conventions (amen slides, melisma hyphens, segmentation, dot→hyphen)
  and other durable facts are in the Claude memory for this project.
