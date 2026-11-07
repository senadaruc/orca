# grazr in Orca: HerdrM parity — Fable windows, model switch, cross-device sync

Date: 2026-11-05. Status: Senad asked for all three HerdrM features in the native Claude Accounts dialog ("port them to orca plugin" → native dialog, "all three", "skip the questions, just start, do it like herdrm"). Every choice below is mine unless marked _his_; the HerdrM implementation is the reference wherever Orca allows the same shape.

This extends [2026-10-22-grazr-native-design.md](./2026-10-22-grazr-native-design.md), whose v1 non-goals listed exactly these features.

## Intent

The HerdrM Claude Accounts window (`Sources/HerdrM/GrazrAccountsSheet.swift` on `feat/grazr-account-sync`, HerdrM PR #155) shows three things the Orca dialog lacks:

1. **Per-model weekly windows** ("Fable week"): one bar per window on every account card (5h, Week, Fable week), a thinner inner ring per model on the dial, "Fable N% left" in the centre, and the legend "Outer ring: all models · inner: Fable".
2. **"When Fable runs out, switch model and continue"**: Claude Code stops before its next request when the week's Fable allowance is spent and usage credits are off, and asks in the terminal: switch to the fallback model, or pay with credits. No request fails, so grazr never hears of it, and an unattended agent waits on the dialog. HerdrM reads the pane's screen, recognises that dialog by its exact shape, and presses Enter only while the focused option is the switch (the one choice that spends nothing).
3. **"Keep accounts in sync across devices"**: when the same accounts are enrolled on several hosts, each host rotates on its own and the rotations drift apart. HerdrM keeps every host on one `ACCOUNTS` order and one active account: last change wins, no leader; order first, then the switch; a host that cannot follow says so; a bounce guard pauses two hosts that keep undoing each other.

## Goals / non-goals / anti-goals

Goals: the three features above in `GrazrAccountsDialog`, behaving as in HerdrM; the engine re-vendored so the status report carries what they need; every rule from the previous design still holds (tokens and `ui/` primitives, `translate()` everywhere, no casts, files ≤ 800 lines, no low-value tests, `pnpm tc`/`oxlint`/`check:code-quality:changed` clean).

Non-goals: pins ("This Agent's Account"), the HerdrM clock/timeline view, the "Switch" per-card button (Orca keeps its row menu), mobile parity (desktop-only dialog; nothing here touches paired phones), Windows hosts (engine is POSIX), a settings-page copy of the toggles (HerdrM only has them in the window too).

Anti-goals: pressing Enter on anything that is not the usage-credits dialog with the switch focused (a permission prompt, a forged dialog in a command preview); Orca writing `~/.claude` credentials (sync only runs `set ACCOUNTS` and `swap <name>` through the engine); a sync that moves accounts before the user saw what the first round would do (HerdrM's preview + Apply).

## Engine

The vendored engine (`resources/grazr/engine`, `0.4.7+senad.6`) is replaced by the tip of `herdr-grazr` branch `orca-port` (`0.4.7+fork.12`: Ultra rule, `plan`/`organization`/`updated` per account, non-interactive enrol) plus one commit on that branch:

- `status --json` `changed_at` becomes the newer of `config.env`'s mtime and the last rotation's `at` (HerdrM's reader computes exactly this; the engine should report it itself so every client agrees). Version `0.4.7+fork.13`.

`set ACCOUNTS <names…>` already exists (validates enrolled names, refuses duplicates, prints `ACCOUNTS=…`). The HerdrM "needs update" marker `can be set this way` is what an older engine prints.

Orca's `grazr-status-report.ts` gains: `changed_at` (number | null), per account `plan` (`{type, tier, seat_tier}` → a label like HerdrM's `GrazrPlan.label`: "Max 20x", "Team 5x", "Pro"), `organization`, `updated` (epoch seconds). Still lenient: a missing field takes its empty value.

## 1. Per-model windows (UI only once the engine reports them)

`grazr-rotation-view.ts`:

- `windowBars(account, thresholds, now)`: HerdrM's `sortedWindows` (session, all-models week, then per-model weeks by scope) with `left` = remaining while the window is open, 100 after its reset; `label` "5h" / "Week" / "<scope> week"; `tone` from HerdrM's `GrazrStyle.tint` (≤2 spent, < threshold warning, else fine; threshold per group: session → `thresholds.session`, weekly incl. per-model → `thresholds.weekly`); `resetText` "resets Thu 14:00" (same formatter as the row labels) or "reset since" when the window is past its reset, empty without a reset time.
- `modelScopes(report)`: sorted distinct scopes of weekly windows across accounts (HerdrM `modelScopes`).
- Segments gain `models: Record<scope, number | null>` (the account's per-model week left, null without a reading); the centre gains `modelLines: string[]` ("Fable 100% left") for the active account. Both only on the `weekly` view, as in HerdrM (per-model limits are weekly; the 5h view shows none).
- Rows gain `windows: GrazrWindowBar[]`, `plan: string | null`, `organization: string | null`, `readingFrom: string | null` ("Reading from 1 wk. ago", `Intl.RelativeTimeFormat` short, via a `now`).

`GrazrAccountRows.tsx`: under the existing header line (index, dot, name, percent, label, menu) a bar per window: label (fixed width), `Progress` with the tone colour on its indicator, "N% left", reset text; the plan as an outline `Badge` beside the name; the organization under the name when it is not `"<name>'s Organization"`; the reading line in `text-muted-foreground`. Tones use the existing ring palette classes (`text-status-success`, `text-status-warning`, `text-destructive`).

`GrazrClockRing.tsx` + `grazr-ring-geometry.ts`: for each scope an inner ring (HerdrM: `modelRingWidth` 6, gap 7 from the main band, 3 between model rings) drawn with the same segment geometry at a smaller radius, filled by the account's per-model left, dimmed like the outer band for non-usable accounts; a legend line under the ring "Outer ring: all models · inner: Fable" when scopes exist; the centre shows the model lines under the main percentage.

## 2. Model switch

### Recogniser (`src/shared/grazr-model-switch-prompt.ts`, pure, ported line for line from `ModelSwitchPrompt.swift`)

- `modelSwitchTarget(screen): string | null`: the model the focused option would switch to, or null. The live region is the non-empty trimmed lines after the last horizontal rule (≥ 8 of `─`/`━`). It must be ≤ 16 lines, start with a dialog title (`… now uses usage credits` or `You've reached your Fable limit`), end with `Enter to confirm · Esc to cancel`, contain exactly one `❯` line matching `^❯\s*Switch to (.+?) and continue$`, and between that and the footer hold one known second option (`Yes, re-enable and continue`, `Yes, buy usage credits`, `Buy usage credits`, `Set up usage credits on claude.ai`, `Manage usage credits on claude.ai`, `Request usage credits from your admin`, `Request more from your admin`, or `Continue with …`) and at most `Upgrade to Max`.
- `modelSwitchDialogShowing(screen): boolean`: the live region starts with a dialog title (the loading step has no options yet).
- Tests: the HerdrM `ModelSwitchPromptTests` fixtures, one by one.

### Screen access (renderer)

Orca's xterm instances live in the renderer, one `ManagedPane` per split. A new store-free registry `src/renderer/src/components/terminal-pane/pty-screen-readers.ts` maps `ptyId → { tabId, leafId, terminal }`, registered where a pane binds to its PTY (`setPanePtyFitBinding` in `pty-connection/terminal-keydown-fit.ts`, which already has `session.pane.terminal`, `session.deps.tabId`, the pty id) and dropped where the binding is cleared. `readScreen(ptyId)` returns the active buffer's rows joined by `\n` (`buffer.active`, `translateToString(true)` per line), the same text HerdrM's `readPaneText` sees.

### Watcher (`src/renderer/src/components/grazr/grazr-model-switch-watcher.ts`, installed by `useGrazrModelSwitchWatcher` from `use-app-shell-services.ts`)

HerdrM checks a pane when herdr reports it `blocked`. Orca's hook-fed status does not change when Claude draws this dialog (no hook fires), so the trigger is output: each registered pane's `terminal.onWriteParsed`, debounced 1 s, reads the screen when the setting is on and the pane runs Claude (`agentStatusByPaneKey[tabId:leafId].agentType === 'claude'`, or the tab's `launchAgent === 'claude'`). On `modelSwitchDialogShowing`, the pane enters HerdrM's answer loop: up to 12 looks a second apart; Enter (`window.api.pty.write(ptyId, '\r', 'driving')`) only when `modelSwitchTarget` reads the same on two consecutive looks; at most 3 presses; a press clears the last-seen so a swallowed key is sent again after two more looks; the loop ends when the dialog is gone and, if a press was made, reports "grazr: <tab title> switched to <model>" with HerdrM's body ("Its Fable allowance ran out and usage credits are off, so it continues on <model>.") as a `toast.message`. One loop per pane at a time.

### Setting

`GlobalSettings.grazrAutoModelSwitch?: boolean` (absent = off; defaults add `false`). The dialog's checkbox (HerdrM copy and help text) writes it through `updateSettings`. Global, like HerdrM's `UserDefaults` key: it applies to every Claude pane in this Orca, whatever host it runs on. HerdrM additionally gates on "the device runs grazr"; Orca does not (my call: the shape match is the guard, and the toggle lives in the grazr dialog, so the user who turns it on runs grazr).

## 3. Cross-device sync

### Devices

A device is a host Orca can run the engine on: the local machine, every registered SSH target (`listRegisteredSshTargets()`, label = target label), and every runtime environment with an SSH link (label = environment name), de-duplicated by the resolved connection (an environment and its own SSH target are one device, keyed `ssh:<sshTargetId>`; local is `local`). The device key is the stable id (HerdrM's `UUID`); the user's exclusions are stored by key.

### Planner (`src/main/grazr/grazr-sync-planner.ts`, pure, ported from `GrazrSync.swift`)

Same types and constants: `tieWindow` 30 s, `bounceWindow` 120 s, `bounceSpan` 600 s, `pauseLength` 1800 s, `retryAfter` 600 s. `observe(devices, now) → pushes`, `settle(device)`, `recordResult(device, problem, now)`, `forget(key)`, `snapshot()`/`fromSnapshot()`, `equal(a, b)`. A device's `GrazrSyncState` comes from its status report: order as ids (names mapped through the report's accounts; without `order`, every account sorted by name), active id, `changed_at`. Problems: `not-enrolled`, `blocked` (reason), `needs-update`, `refused` (text); Orca has no pins, so `pinned` is dropped. Tests: the HerdrM `GrazrSyncTests` cases, ported.

### Coordinator (`src/main/grazr/grazr-sync-coordinator.ts`)

Runs in main, like HerdrM's `GrazrSyncCoordinator` runs in the app: a round every 60 s while enabled and applied, one after any grazr action (`kick`), one on enable (preview). A round reads every included device's status through `GrazrApi.status` (devices whose outcome is not `ok` with `installed === true` sit out, as "unread"), builds `GrazrSyncDevice`s, and runs the planner's pushes through `GrazrApi`: `setAccounts(host, names)` (new verb, `set ACCOUNTS <names…>`) then `swap(host, name)`; an answer containing `can be set this way` is `needs-update`, `failed with` → `blocked`, else `refused` with the engine's words; `Busy rotating` is retried next round. After a push the device is re-read and settled; a switch counts once the report is on the account, then a desktop notification "grazr: <device> now on <account>" / "following <source>" (`getRuntimeDesktopSurface().showNotification`).

State (`<userData>/grazr-sync.json`, `AtomicSnapshotWriter`): `enabled`, `applied`, `excluded: string[]`, `planner` snapshot, `unsettled: string[]`. Lifecycle as HerdrM: enable → preview round, pushes nothing until Apply (nothing to move → applied at once); launch while enabled and applied → restore and loop; while enabled and not applied → preview again; disable → forget everything. A device left out is forgotten in the planner (lead passes to a device already in step).

Status for the dialog (`GrazrSyncStatus`): `off` | `few-devices {name}` | `preview {lines}` | `lines {lines}`, each line `{id, text, tone: ok|warning, deviceKey?, blockedAccount?: {name, email}}`, with HerdrM's wording ("All devices in sync", "<b> follows <a> (changed 2 min ago)", "<b> will move to <account> and take <a>'s order", "Sync paused: <a> and <b> keep undoing each other. Check that their thresholds match.", "<who>: <account> is blocked (<reason>), still on <active>", "<who>: <account> is not enrolled", "grazr on <who> needs 0.4.7+fork.13 or later"). The whole snapshot `{enabled, applied, devices: [{key, name, kind: local|ssh, included, usesGrazr}], status}` is exposed by `grazr:syncState` and pushed on every change over `grazr:syncStateChanged`.

### API

`GrazrApi` gains `setAccounts(host, names)` and the sync methods: `syncState()`, `syncSetEnabled(on)`, `syncApply()`, `syncSetIncluded(key, on)`, `syncKick()`. The preload bridge adds `onSyncStateChanged(cb)`. `use-grazr-host-status`'s `run` calls `syncKick` after an action lands, like HerdrM kicks after every grazr action.

### Dialog section (`GrazrSyncSection.tsx`)

Below the model-switch checkbox, separated by borders as in HerdrM: the checkbox "Keep accounts in sync across devices" with the subtitle "Last change wins. Pins and thresholds stay per device."; when not off, the row "Devices in the sync" with one checkbox per device that runs grazr (a laptop icon for local, a server icon for SSH; lucide `Laptop`/`Server`); then the status lines (`text-status-warning` for warnings), an `Apply` button in preview, and `Re-authenticate…` on a blocked line, which opens the login terminal on that device's host (`openGrazrEnrolTerminal` with a worktree on that host via `grazrEnrolWorktreeId`, disabled with the usual tooltip when there is none).

## Files

New: `src/shared/grazr-model-switch-prompt.ts` (+ test), `src/renderer/src/components/terminal-pane/pty-screen-readers.ts`, `src/renderer/src/components/grazr/grazr-model-switch-watcher.ts` (+ test of the loop with a fake screen/clock), `src/renderer/src/components/grazr/use-grazr-model-switch-watcher.ts`, `src/main/grazr/grazr-sync-planner.ts` (+ test), `src/main/grazr/grazr-sync-coordinator.ts` (+ test with fakes for status/commands/clock), `src/main/grazr/grazr-sync-devices.ts`, `src/main/grazr/grazr-sync-lines.ts`, `src/shared/grazr-sync-types.ts`, `src/renderer/src/components/grazr/GrazrSyncSection.tsx`, `src/renderer/src/components/grazr/GrazrWindowBars.tsx`.

Changed: `resources/grazr/engine/*` + `VERSION`, `src/shared/grazr-status-report.ts` (+ test), `src/shared/grazr-rotation-view.ts` (+ test), `src/shared/grazr-api-types.ts`, `src/main/grazr/grazr-service.ts` (+ test), `src/main/grazr/grazr-engine-command.ts`, `src/main/ipc/grazr.ts`, `src/preload/api/grazr-bridge.ts`, `src/renderer/src/web/preload-api/web-grazr-api.ts`, `src/renderer/src/components/grazr/GrazrAccountsDialog.tsx`, `GrazrAccountRows.tsx`, `GrazrClockRing.tsx`, `grazr-ring-geometry.ts` (+ test), `use-grazr-host-status.ts`, `src/shared/global-settings-types.ts`, `src/shared/default-global-settings.ts`, `src/renderer/src/app-shell/use-app-shell-services.ts`, `pty-connection/terminal-keydown-fit.ts`, `src/renderer/src/i18n/locales/en.json`.

## Left to the builder

Exact spacing of the bars and the inner rings (follow the ring's existing constants); the relative-time wording for "Reading from" and "changed … ago"; which lucide icons stand for local and SSH devices; the order of the two new sections relative to "Rotate automatically" (HerdrM has no such switch; keep it last).
