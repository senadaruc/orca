# grazr in Orca: native Claude Accounts window and `grazr ▸` menu — design

Date: 2026-10-22. Status: approved in intent by Senad ("Grazr is per server, so let's add here the same GUIs we built for HerdrM"; after the plugin detour: "I ASKED FOR THIS"). Every choice below not marked _his_ is mine.

## Intent

Orca's status bar shows Claude usage **per server** (the host that owns the focused workspace). grazr, the account-rotation engine, is also per server. Senad wants the HerdrM GUI inside Orca itself, not in a plugin sidebar:

1. **The Claude Accounts window** (HerdrM's): header `<host> · swaps below 15% 5h · 15% week`, a `Week | 5h` toggle, the clock ring with numbered segments, one row per account (`1 ● name  N%  active | NEXT ▸ | spent · resets Sat 13:00 | blocked: authentication_failed`), and the buttons `Refresh`, `Add Account…`, `Swap to Next Account`, `Done`. Reached from the **Usage popover** of the status bar, for the host that popover is showing.
2. **The `grazr ▸` submenu** (Herdr's agent menu) on the worktree context menu: `Accounts…`, `Switch Shared Account ▸ <name>`, `Re-authenticate <email>…`, `Connect to Claude's status line` / `Disconnect from Claude's status line`, `Swap to the next account now`. The worktree's host is the server.

The engine stays the Python grazr (0.4.7+senad.6, already Herdr-independent: `GRAZR_STATE_DIR`, `GRAZR_CONFIG_DIR`, `GRAZR_NOTIFIER`, `status --json`, `install --force`, `notices-drain`, Orca managed-profile guard). Orca becomes the front end and the deployer. Rotation itself still happens from Claude's status-line hook on each host; Orca never swaps credentials itself.

## Goals / non-goals / anti-goals

Goals: both surfaces above, for the local machine and for every remote server Orca reaches over SSH; one click from the Usage popover to the window; numbers never older than the last refresh the user can see; engine deployed and connected from the window without a terminal, except the login itself.

Non-goals (v1): HerdrM-only features (`When Fable runs out, switch model and continue`, `Keep accounts in sync across devices`), pins / `This Agent's Account`, `Tag every pane` (no pane tags in Orca), `Let agents be pinned`; mobile parity (the dialog is desktop-only; the RPC-free design keeps paired phones unaffected); Windows hosts (the engine is POSIX; the UI says so and offers nothing); paired runtime environments that have no SSH link from this desktop (the window says "no SSH access from this desktop" and offers nothing).

Anti-goals: a second rotation path (Orca must never write `~/.claude` credentials itself); blocking the renderer on SSH; a window that silently shows stale data; running the engine on a managed Claude profile (the engine refuses; the UI surfaces the refusal verbatim).

## What Orca gives us (verified at de7a2d24)

- Usage popover: `src/renderer/src/components/status-bar/StatusBarSurface.tsx` renders `UsageRosterPanel` inside a Radix `DropdownMenu`; the owner host comes from `useOwnerUsageRateLimits` → `useActiveAccountOwner` (local, or the `runtimeEnvironments` entry owning the focused workspace). The footer already has `Usage details & history` and `Manage Accounts…` rows (`UsageRosterPanel.tsx:345-361`) wired in `use-status-bar-controller.ts:235-259`.
- Worktree context menu: `sidebar/WorktreeContextMenuView.tsx` (Radix `DropdownMenu`; submenu pattern `DropdownMenuSub/SubTrigger/SubContent`, e.g. `WorktreeStatusMenuItems.tsx`); handlers in `use-worktree-context-menu-commands.ts`; a worktree's host is `getExecutionHostIdForWorktree(state, worktreeId)` → `ExecutionHostId` (`'local' | 'ssh:<targetId>' | 'runtime:<environmentId>'`, `src/shared/execution-host.ts`).
- Modals: store-driven, `openModal(id, data)` / `closeModal()`; the `activeModal` union lives in `store/slices/ui/ui-slice-contract-contextual.ts:33`; dialogs mount once in `App.tsx` (`ClaudeAccountSwitchDialog` at line 116 is the sibling to copy: shadcn `Dialog`, `Button`, `Checkbox`).
- IPC: per domain, three pieces, no registry: `src/preload/api/<domain>-bridge.ts` (`ipcRenderer.invoke('<domain>:<fn>')`, `satisfies PreloadApi['<domain>']`), the type in `src/preload/api-types.ts`, registration in `src/preload/index.ts`; main `ipcMain.handle` in `src/main/ipc/<domain>.ts`, registered from `src/main/ipc/register-core-handlers/register-core-handlers.ts`. Push to renderer: loop `BrowserWindow.getAllWindows()` + `webContents.send` (see `codex-pending-login-url-broadcast.ts`).
- Remote execution from main: `getSshConnectionManager()?.getConnection(sshTargetId)` (status `connected`), then `execCommand(conn, cmd, { timeoutMs, stdin? })` from `src/main/ssh/remote-exec/remote-exec-command.ts` (30 s default, `SshCommandExitError {exitCode, stdout}`, `SSH_EXEC_TIMEOUT` code). A runtime environment's SSH link: `getRuntimeSshAccess(env)?.sshTargetId` with `listEnvironments(userDataPath)` (pattern: `src/main/ipc/shell-editor-ssh-host.ts`). Directory upload: `uploadSshDirectory(host, localDir, remoteDir)` in `ssh-connection-file-transfers.ts`.
- Local execution: `runProcess({ program, args, env, timeoutMs, input })` from `@orca/process-host` (never raw `child_process`; `check:main-sync-spawn-ratchet`).
- Bundled files: `resources/<dir>` + an `extraResources` entry in `config/electron-builder.config.cjs` + an asar exclusion, resolved at runtime like `resolveBundledPluginRoot` (`process.resourcesPath` when packaged, `<appPath>/resources` in dev).
- Rules that gate CI (AGENTS.md, `pnpm lint`): STYLEGUIDE tokens and `ui/` primitives only; `translate('auto.<path>.<id>', 'English')` for every string and the extraction catalog `src/renderer/src/i18n/locales/en.json` kept in sync (`verify:localization-extraction`, extractor `i18next-cli --config config/i18next.config.ts extract --sync-primary`); new files ≤ 800 lines; no `helpers/utils` names; checked types, no casts; no low-value tests (`docs/reference/test-antipatterns.md`); cross-platform guards; `pnpm tc`, `pnpm test <file>`, `oxlint`, `pnpm run check:code-quality:changed`.

## Architecture

```
renderer                                   main                                     host
UsageRosterPanel footer row ─┐
WorktreeContextMenu grazr ▸ ─┼─ openModal('grazr-accounts', {host}) ─► GrazrAccountsDialog
GrazrAccountsDialog ─ window.api.grazr.* ─► ipc grazr:* ─► GrazrService ─ run(host, verb…) ─► local: runProcess(python3 engine/grazr.py …)
                                                                   │                        └► ssh:   execCommand(conn, 'env GRAZR_* python3 ~/.local/share/orca-grazr/engine/grazr.py …')
                                                                   └─ deploy(host) ─► copy / uploadSshDirectory(resources/grazr/engine → ~/.local/share/orca-grazr/engine)
```

### Host reference

`GrazrHostRef` (in `src/shared/grazr-host.ts`): `{ kind: 'local' } | { kind: 'environment'; environmentId: string } | { kind: 'ssh'; sshTargetId: string }`. The renderer derives it from the Usage popover's owner (`RuntimeClientTarget` → local or environment) or from a worktree's `ExecutionHostId` (`parseExecutionHostId`). Main resolves `environment` → `sshTargetId` itself (never trusts a renderer-supplied target for an environment, like `shell-editor-ssh-host.ts`), and answers `{ kind: 'no-ssh-access' }` when the environment has no SSH link or the connection is not `connected`. `local` on Windows answers `{ kind: 'unsupported-platform' }`.

### Engine locations (fixed, same on every host; _his_ decision from the plugin work)

Engine `~/.local/share/orca-grazr/engine` (deployed from `resources/grazr/engine/`), state `~/.local/state/orca-grazr`, config `~/.config/orca-grazr`, notifier `osascript` for a local macOS host, `queue` everywhere else. The environment block is `GRAZR_STATE_DIR=… GRAZR_CONFIG_DIR=… GRAZR_NOTIFIER=…`; tildes are expanded on the host (remote: left for the shell; local: `os.homedir()`). Account names are shell-quoted with `quotePosixShell` (`src/shared/shell-argument-quoting.ts`).

The engine files are vendored verbatim from `~/orca-plugins/account-autoswitch/engine/` (grazr.py, claude.py, core.py, accounts.py, stores.py, atomic.py, pins.py, shim.py; no tests) into `resources/grazr/engine/` with a `VERSION` file. `electron-builder.config.cjs` gets `{ from: 'resources/grazr', to: 'grazr' }` and `'!resources/grazr/**'` in `files`.

### GrazrService (`src/main/grazr/`)

- `grazr-service.ts`: `status(host) → GrazrHostStatus`, `swap(host, name?)`, `refresh(host)`, `setEnabled(host, enabled)`, `install(host, {force})`, `uninstall(host)`, `deploy(host)`, `enrolCommand(host) → string` (the full interactive command for a terminal), `drainNotices(host) → GrazrNotice[]`. Every call runs the engine once with a 10 s timeout for `status`/`refresh`/`swap`/`set`, 20 s for `install`/`uninstall`, 60 s for `deploy`; concurrent calls for the same host are serialized on one promise chain per host (the engine takes its own locks, but two SSH execs for one host waste MaxSessions).
- `GrazrHostStatus` = `{ host: GrazrHostRef; label: string; outcome: { kind: 'ok'; report: GrazrStatusReport; fetchedAt: number } | { kind: 'not-deployed' } | { kind: 'no-ssh-access' } | { kind: 'unsupported-platform' } | { kind: 'engine-error'; message: string } | { kind: 'unreachable'; message: string } }`. `not-deployed` is detected from a 127 / "No such file" exit on the engine path (the plugin's `errors.mjs` classification is the reference).
- `grazr-engine-runner.ts`: the one place that builds the argv/command and dispatches local vs SSH (`runProcess` / `execCommand`); exported as an interface so the service is tested with a scripted fake runner.
- `grazr-host-resolver.ts`: `GrazrHostRef` → `{ kind: 'local' } | { kind: 'ssh'; connection } | failure`, using `listEnvironments` + `getRuntimeSshAccess` + `getSshConnectionManager`.
- `grazr-status-report.ts` in `src/shared/`: the TypeScript shape of `status --json` (fields used: `installed`, `connection.{statusline,failure_hook,foreign}`, `active{id,name}`, `accounts[{id,name,email,parked,snapshot[{kind,scope,group,remaining,resets_at}],blocked,in_order,first_reading_due}]`, `order`, `settings.{thresholds{session,weekly},enabled,model_limits}`, `managed_profile`, `version`), parsed defensively (an unknown field is ignored, a missing one gets its empty value).
- IPC `grazr:status|swap|refresh|setEnabled|install|uninstall|deploy|enrolCommand|drainNotices` in `src/main/ipc/grazr.ts`, bridge `src/preload/api/grazr-bridge.ts`, type `GrazrApi` in `api-types.ts`. Notices drained by the dialog's refresh are shown as sonner toasts titled `grazr · <host>`.

### Rotation view model (`src/shared/grazr-rotation-view.ts`)

A TypeScript port of the plugin's `lib/panel-data.mjs` (read it first; it already mirrors the engine's `core.next_account`, `shortfall`, `_live` and `_bound`): `windowOf`, `shortfallOf`, `orderedAccounts`, `nextAccount`, `rowState`, `centre`, `hostChip`, `buildRotationView(report, view, now)` → `{ centre: { name, percentText, hint, next }, rows: [{ index, name, email, percent, status, label, blocked, isActive, isNext }], segments: [{ index, name, remaining, state }] }`. Pure, no React, with the plugin's tests ported (same fixtures, same expected values).

### The dialog (`src/renderer/src/components/grazr/GrazrAccountsDialog.tsx` + children)

Modal id `grazr-accounts`, `modalData: { host: GrazrHostRef, label: string }`. Mounted once in `App.tsx` next to `ClaudeAccountSwitchDialog`. Layout mirrors HerdrM's window:

1. Title `Claude Accounts`, subtitle `<host label> · swaps below {session}% 5h · {weekly}% week`, and a state badge (`rotation on` / `rotation off` / `not connected` / `another grazr owns the status line` / `managed profile` / `engine not deployed` / `unreachable`).
2. `Week | 5h` segmented control (`SettingsSegmentedControl`, default `5h`).
3. The clock ring: inline SVG (`GrazrClockRing.tsx`), one arc per account in rotation order, numbered badges, the active segment filled to its remaining % for the selected window, the next account's segment outlined in the accent colour; centre: active name, `N% left`, hint, `next ▸ name`. Colours from tokens: ok `--chart-2` or the existing green used by `barColor()` in `status-bar/tooltip.tsx`, next the accent, spent `--muted-foreground`, blocked `--destructive`.
4. Rows: `n ● name · email  N%  label`, with a per-row overflow (`…`) menu: `Swap to this account`, `Re-authenticate…` (blocked rows), `Remove from rotation` (v1 omits removal: not in the Herdr menu).
5. Switch `Rotate automatically` bound to `setEnabled`.
6. Footer: `Refresh` (ghost), `Add Account…` (outline), `Swap to Next Account` (default), `Done` (ghost, closes). Buttons disable while a call is in flight and show the 200 ms-deferred spinner (STYLEGUIDE UX rule 1).
7. State-specific body instead of the ring: `engine not deployed` → `Deploy engine` button, then `Connect to Claude's status line` (= `install`, `--force` offered only after a foreign-owner refusal, with the engine's message shown inline); `no-ssh-access` / `unsupported-platform` → explanation; `unreachable` → message + Retry.
8. `Add Account…` and `Re-authenticate…`: open a new shell terminal tab in the focused worktree of that host (the terminal's `startupCommand` = `enrolCommand(host)`; the builder follows the startup-command path used by `folder-workspace-agent-startup.ts`), then closes the dialog and toasts `Finish the login in the terminal, then reopen Claude Accounts`. The engine's `enrol` is interactive (`s`/`l` then `claude` login) and must run in a TTY; nothing else needs one.
9. Refresh cadence: on open, after every action, and every 60 s while open. The footer line says `as of HH:MM`.

### Entry points

- Usage popover (`UsageRosterPanel`): a new footer row `Claude Accounts (rotation)…` between `Usage details & history` and `Manage Accounts…`, chevron like its siblings, wired in `use-status-bar-controller.ts` as `handleOpenGrazr` → `openModal('grazr-accounts', { host: <from remoteOwner>, label })`. Always shown (the dialog explains missing states).
- Worktree context menu: `GrazrWorktreeMenuItems.tsx` rendering `DropdownMenuSub` `grazr ▸` after `Copy Worktree Name`'s separator, items: `Accounts…`, `Switch Shared Account ▸` (loads `status` lazily on hover/open; lists parked, non-blocked accounts, active one disabled with `Active`; empty → `No other accounts`), `Re-authenticate <active email>…`, `Connect to Claude's status line` / `Disconnect from Claude's status line` (one of them, by `installed`), `Swap to the next account now`. Hidden for multi-select and for Windows local hosts. The host is `parseExecutionHostId(getExecutionHostIdForWorktree(state, worktree.id))`.

### Settings

None new. Per-host behaviour lives in the engine's config on that host (`config.env`, `set` verb). Orca's `GlobalSettings` is untouched; the dialog's `Week | 5h` choice is component state.

### Compatibility and platforms

- Remote hosts are reached over the desktop's SSH connection; no orcad RPC is added, so mixed desktop/server versions are unaffected and nothing needs `generate:rpc-params-catalog`.
- Linux hosts: notifier `queue`; notices surface as toasts when the dialog refreshes.
- Windows: local host unsupported (clear message); remote POSIX hosts fine.
- WSL hosts: out of scope (treated as unsupported in v1).

## Constraints for the builder

TypeScript strict, no casts (checked types), `translate()` for every user-visible string and the extraction catalog regenerated and committed (`pnpm exec i18next-cli --config config/i18next.config.ts extract --sync-primary` writes `tmp/…`; copy the `en` output's new keys into `src/renderer/src/i18n/locales/en.json` the way `verify-localization-extraction.mjs` compares them, or run the repo's own sync if one exists); tokens and `ui/` primitives only (`Dialog`, `Button`, `Switch`, `DropdownMenu*`, `Badge`, `Tooltip`, `SettingsSegmentedControl`); files under 800 lines; concrete file names; tests with vitest (`pnpm test <path>`) for the view model, the runner command builder, the host resolver and the service's outcome classification, with fakes for `runProcess`/`execCommand` only (no sleeping, no mocks that assert themselves); `pnpm tc` and `oxlint` clean; `pnpm run check:code-quality:changed` clean. Never run the engine against the real `~/.claude` or keychain in tests. Commit style: a sentence subject like the repo's (`feat(accounts): …` or a plain sentence), no PR number.

## Herdr menu → Orca mapping

| Herdr `grazr ▸`                                   | Orca                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Accounts…                                         | `grazr ▸ Accounts…` and Usage popover `Claude Accounts (rotation)…` → the dialog |
| This Agent's Account ▸                            | not in v1 (pins)                                                                 |
| Switch Shared Account ▸ name                      | `grazr ▸ Switch Shared Account ▸ name`; dialog row `Swap to this account`        |
| Re-authenticate …                                 | `grazr ▸ Re-authenticate <email>…`; dialog row `Re-authenticate…`                |
| Connect to / Disconnect from Claude's status line | `grazr ▸ Connect/Disconnect…`; dialog `Connect to Claude's status line`          |
| Let agents be pinned / Stop pinning               | not in v1                                                                        |
| Swap to the next account now                      | `grazr ▸ Swap to the next account now`; dialog `Swap to Next Account`            |
| Tag every pane                                    | not applicable                                                                   |

## Left to the builder

Exact SVG geometry (the plugin's `lib/panel.mjs` `arcPath`/`ringSvg` is the reference), the terminal-tab creation call for the enrol command, the toast copy, how `uploadSshDirectory` is given its `SshFileTransferHost` (see its callers in `src/main/managed-server/install/`), and whether `deploy` should rsync-like skip unchanged files (v1: always upload; 8 small files).
