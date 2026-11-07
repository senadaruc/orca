# grazr HerdrM parity — implementation plan

Design: [2026-11-05-grazr-herdrm-parity-design.md](../specs/2026-11-05-grazr-herdrm-parity-design.md). One commit per task; `pnpm tc`, the task's tests, `oxlint` on touched files before each commit; `pnpm run check:code-quality:changed` and `verify:localization-extraction` at the end of each feature.

## Feature A — engine and per-model windows

1. **Engine**: on `~/projects/herdr-grazr` branch `orca-port`, make `changed_at` the newer of config.env mtime and last rotation (test in `test_grazr.py`), bump to `0.4.7+fork.13`, run `python3 -m unittest test_grazr`, commit. Copy the engine files into `resources/grazr/engine`, update `VERSION`, update `grazr-engine-version` expectations if any test pins the version.
2. **Status report**: `changed_at`, `plan`, `organization`, `updated` in `grazr-status-report.ts`; `planLabel()` port of `GrazrPlan.label`; tests.
3. **View model**: `windowBars`, `modelScopes`, segment `models`, centre `modelLines`, row `windows/plan/organization/readingFrom` in `grazr-rotation-view.ts`; tests with a Fable window fixture.
4. **Rows UI**: `GrazrWindowBars.tsx`, `GrazrAccountRows.tsx` additions, `en.json`.
5. **Ring UI**: inner rings in `grazr-ring-geometry.ts` (test) and `GrazrClockRing.tsx`, legend, centre model lines.

## Feature B — model switch

6. **Recogniser**: `src/shared/grazr-model-switch-prompt.ts` + ported tests.
7. **Screen readers**: `pty-screen-readers.ts`; register/unregister in `terminal-keydown-fit.ts`.
8. **Watcher**: `grazr-model-switch-watcher.ts` with injectable deps (readScreen, press, now/sleep, isClaudePane, enabled, report) + test of the answer loop; hook in `use-app-shell-services.ts`.
9. **Setting + checkbox**: `grazrAutoModelSwitch` in settings types/defaults; checkbox in the dialog; `en.json`.

## Feature C — sync

10. **Verb**: `setAccounts` in `grazr-engine-command.ts`/`grazr-service.ts`/IPC/bridge; test.
11. **Planner**: `grazr-sync-planner.ts` + ported tests.
12. **Devices + lines**: `grazr-sync-devices.ts` (enumerate/dedupe), `grazr-sync-lines.ts` (HerdrM wording), `src/shared/grazr-sync-types.ts`.
13. **Coordinator**: `grazr-sync-coordinator.ts` with injectable deps (status/setAccounts/swap, devices, clock, timer, store file, notify, broadcast) + tests (preview/apply, push then settle, needs-update, busy retry, excluded device); wire in `ipc/grazr.ts` (state file in userData, broadcast over `grazr:syncStateChanged`), IPC handlers, bridge, web api stub, `onSyncStateChanged`.
14. **Section UI**: `GrazrSyncSection.tsx` in the dialog; `use-grazr-host-status` kicks the sync after actions; `en.json`.

## Finish

15. `pnpm tc`, all grazr tests, `oxlint`, `pnpm run check:code-quality:changed`, `pnpm run verify:localization-extraction`; record verification in the spec folder's verification note; build the app in the background and screenshot the dialog over CDP for the ring, bars and sections.
