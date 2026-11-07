# grazr native in Orca — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put HerdrM's Claude Accounts window and Herdr's `grazr ▸` menu into Orca itself, per server, driving the vendored grazr engine locally and over Orca's SSH connections.

**Architecture:** A main-process `GrazrService` runs the Python engine (`runProcess` locally, `execCommand` over the SSH connection of the server that owns a workspace) and deploys it from `resources/grazr/engine`; a preload bridge `window.api.grazr` exposes it; a store-driven `grazr-accounts` modal renders the ring and rows from a pure view model ported from the plugin; the Usage popover footer and the worktree context menu open it.

**Tech Stack:** Electron main (TypeScript, `@orca/process-host`, ssh2 via `SshConnection`), preload IPC, React 19 + shadcn/Radix primitives + Tailwind tokens, zustand store, vitest, i18next extraction.

**Spec:** `docs/superpowers/specs/2026-10-22-grazr-native-design.md` (read it first; the engine's `status --json` shape and the Herdr→Orca mapping live there).

## Global Constraints

- Every user-visible string goes through `translate('auto.components.grazr.<Component>.<slug>', 'English')` from `@/i18n/i18n`; after adding strings run `pnpm exec i18next-cli --config config/i18next.config.ts extract --sync-primary --quiet` and merge the new keys from `tmp/localization-extraction/en.json` into `src/renderer/src/i18n/locales/en.json` (sorted, same nesting); `node config/scripts/verify-localization-extraction.mjs` must pass.
- UI uses only `src/renderer/src/components/ui/*` primitives and `main.css` tokens (`text-foreground`, `text-muted-foreground`, `bg-secondary`, `border-border`, `text-destructive`, `bg-accent`); icons from `lucide-react`; no new colour literals except the ring's three state colours, which reuse `barColor()`'s classes from `status-bar/tooltip.tsx` where possible.
- New files ≤ 800 lines; no `utils`/`helpers` names; no type assertions except `as const`; comments only for "why", one line.
- Main never imports `electron` inside `src/main/grazr/` except in `src/main/ipc/grazr.ts`; processes only via `runProcess` from `@orca/process-host`; SSH only via `getSshConnectionManager()` + `execCommand` / `connection.uploadDirectory`.
- Engine paths on every host: `~/.local/share/orca-grazr/engine`, `~/.local/state/orca-grazr`, `~/.config/orca-grazr`; notifier `osascript` for local darwin, else `queue`.
- Timeouts: status/refresh/swap/set 10 s; install/uninstall 20 s; deploy 60 s; one in-flight engine call per host (promise chain).
- Tests: vitest, `pnpm test <file>`; fake only `runProcess`/`execCommand`/the resolver through injected interfaces; no sleeping; no mocks that assert themselves. Never touch `~/.claude`, `~/.grazr`, `~/.local/state/orca-grazr` or the keychain from tests.
- Gates before every commit: `pnpm tc`, `oxlint <changed files>`, `pnpm run check:code-quality:changed`, `pnpm test <new test files>`.
- Commits: one per task, subject in the repo's style (`feat(grazr): …`), body optional, trailers from the harness.

## Review Focus

1. An account name containing a quote or `$` reaches the engine unchanged, locally and over SSH (Task 3 tests both command forms with `o'brien $x`).
2. A remote host whose SSH connection is not `connected` answers `no-ssh-access` within one tick, never a 10 s hang (Task 4 test).
3. The engine missing on a host (python exits 2, "No such file") is `not-deployed`, not `engine-error`, so the dialog offers Deploy (Task 3 classification test; Task 5 renders the Deploy state).
4. The dialog's buttons cannot double-submit: a second click while a call is in flight is ignored, and the spinner appears only after 200 ms (Task 5).
5. NEXT ▸ in the dialog equals the account the engine's `swap` picks (Task 2 ports the plugin's three probe cases verbatim).

---

### Task 1: Vendor the engine and resolve its root

**Files:**

- Create: `resources/grazr/engine/{grazr.py,claude.py,core.py,accounts.py,stores.py,atomic.py,pins.py,shim.py}` (byte-copies of `/Users/deepdark/orca-plugins/account-autoswitch/engine/*.py`, no tests, no `__pycache__`), `resources/grazr/VERSION` (contents `0.4.7+senad.6\n`), `resources/grazr/README.md` (3 lines: what this is, where it is deployed, where the source lives)
- Create: `src/main/grazr/grazr-engine-resources.ts`
- Modify: `config/electron-builder.config.cjs` (add `const grazrEngineResource = { from: 'resources/grazr', to: 'grazr' }` beside `bundledPluginResources`, include it wherever `bundledPluginResources` is listed in `extraResources`, and add `'!resources/grazr/**'` beside `'!resources/plugins/launch/**'` in `files`)
- Test: `src/main/grazr/grazr-engine-resources.test.ts`

**Interfaces:**

- Produces: `resolveGrazrEngineRoot(options: { isPackaged: boolean; resourcesPath: string; appPath: string }): string` → `<resourcesPath>/grazr/engine` when packaged, `<appPath>/resources/grazr/engine` otherwise (mirror `resolveBundledPluginRoot` in `src/main/plugins/plugin-bundled-bootstrap.ts:55-63`). `GRAZR_ENGINE_FILES = ['grazr.py','claude.py','core.py','accounts.py','stores.py','atomic.py','pins.py','shim.py'] as const`. `readGrazrEngineVersion(root: string): Promise<string>` reads `../VERSION` next to the engine dir, trimmed.

- [ ] **Step 1: Write the failing test** — `resolveGrazrEngineRoot` returns the packaged and dev paths; `readGrazrEngineVersion` on the real `resources/grazr` returns `0.4.7+senad.6`; every name in `GRAZR_ENGINE_FILES` exists under the real dev root.
- [ ] **Step 2: Run `pnpm test src/main/grazr/grazr-engine-resources.test.ts`** — fails (module missing).
- [ ] **Step 3: Copy the engine files, write VERSION and README, implement the module, edit the builder config.**
- [ ] **Step 4: `pnpm test …` passes; `pnpm tc` clean.**
- [ ] **Step 5: Commit** — `feat(grazr): vendor the rotation engine as a bundled resource`

---

### Task 2: Shared types and the rotation view model

**Files:**

- Create: `src/shared/grazr-host.ts`, `src/shared/grazr-status-report.ts`, `src/shared/grazr-rotation-view.ts`, `src/shared/grazr-api-types.ts` (types only in this task; Task 4 adds `GrazrApi` to it)
- Test: `src/shared/grazr-status-report.test.ts`, `src/shared/grazr-rotation-view.test.ts`

**Interfaces:**

- `GrazrHostRef = { kind: 'local' } | { kind: 'environment'; environmentId: string } | { kind: 'ssh'; sshTargetId: string }` plus a zod schema `GrazrHostRefSchema` (zod is already a dependency; see `src/shared/rpc-contract/*-params.ts` for the style); `grazrHostRefFromExecutionHostId(id: ExecutionHostId): GrazrHostRef | null` (uses `parseExecutionHostId` from `src/shared/execution-host.ts`; `runtime:unresolved-owner` → null); `grazrHostKey(ref): string` (`local` | `env:<id>` | `ssh:<id>`).
- `src/shared/grazr-api-types.ts`: `GrazrHostOutcome = { kind: 'ok'; report: GrazrStatusReport; fetchedAt: number } | { kind: 'not-deployed' } | { kind: 'no-ssh-access' } | { kind: 'unsupported-platform' } | { kind: 'engine-error'; message: string } | { kind: 'unreachable'; message: string }`; `GrazrHostStatus = { host: GrazrHostRef; label: string; outcome: GrazrHostOutcome }`; `GrazrActionResult = { ok: true; message: string } | { ok: false; message: string; foreignOwner?: boolean }`; `GrazrNotice = { ts: string; title: string; body: string }`.
- `GrazrStatusReport` (fields per the spec) and `parseGrazrStatusReport(text: string): GrazrStatusReport | null` (null on non-JSON / non-object; missing arrays → `[]`, missing thresholds → `{ session: 0, weekly: 0 }`, `enabled`/`installed`/`managed_profile` default `false`, `model_limits` default `false`).
- `GrazrRotationView = { centre: { name: string; percentText: string; hint: string; next: string }; rows: GrazrRotationRow[]; segments: GrazrRingSegment[] }`, `GrazrRotationRow = { index: number; name: string; email: string | null; percent: number | null; status: 'active'|'next'|'spent'|'blocked'|'not-enrolled'|'unread'|'ok'; label: string; blocked: string | null; isActive: boolean; isNext: boolean }`, `GrazrRingSegment = { index: number; name: string; remaining: number | null; state: 'active'|'next'|'spent'|'blocked'|'ok'|'unknown' }`; `GrazrWindowView = 'session' | 'weekly'`.
- `buildGrazrRotationView(report: GrazrStatusReport, view: GrazrWindowView, now: Date, timeZone?: string): GrazrRotationView`; `grazrHostChip(outcome)` → `{ kind: 'on'|'off'|'not-connected'|'foreign'|'managed'|'not-deployed'|'unreachable'|'no-ssh-access'|'unsupported-platform'; label: string }` (labels are English defaults; the component translates by kind).
- Port, function by function, `/Users/deepdark/orca-plugins/account-autoswitch/lib/panel-data.mjs` (`windowOf`, `shortfallOf` with the model-limits gate, `orderedAccounts`, `nextAccount` with no wrap and the order restriction, `rowState`, `centre`, `hostChip`), and its tests from `/Users/deepdark/orca-plugins/account-autoswitch/test/panel-data.test.mjs` (same fixtures and expectations, including: order a,b,c active b → next a; order [a] + unordered z → none; exactly at threshold → eligible; expired `resets_at` → absent; per-model weekly ignored unless `model_limits`; blocked active row label `active · blocked: <reason>`).

- [ ] **Step 1: Write the failing tests** (ported cases + parser cases: empty string, `[]`, missing fields).
- [ ] **Step 2: Run them** — fail.
- [ ] **Step 3: Implement the three modules.**
- [ ] **Step 4: Tests pass; `pnpm tc` clean.**
- [ ] **Step 5: Commit** — `feat(grazr): share the host reference, status report and rotation view model`

---

### Task 3: Engine command builder, runner and outcome classification

**Files:**

- Create: `src/main/grazr/grazr-engine-command.ts`, `src/main/grazr/grazr-engine-runner.ts`, `src/main/grazr/grazr-engine-outcome.ts`
- Test: `src/main/grazr/grazr-engine-command.test.ts`, `src/main/grazr/grazr-engine-outcome.test.ts`

**Interfaces:**

- Consumes: `quotePosixShell` (`src/shared/shell-argument-quoting.ts`), `runProcess` (`@orca/process-host`), `execCommand`, `isSshExecTimeout`, `isSshCommandExitError` (`src/main/ssh/remote-exec/remote-exec-command.ts`), `SshConnection` (`src/main/ssh/connection/ssh-connection.ts`).
- `GRAZR_REMOTE_ENGINE = '~/.local/share/orca-grazr/engine'`, `GRAZR_REMOTE_STATE = '~/.local/state/orca-grazr'`, `GRAZR_REMOTE_CONFIG = '~/.config/orca-grazr'`.
- `grazrEngineEnv(target: { remote: boolean; platform: NodeJS.Platform; homedir: string }): Record<string,string>` → `GRAZR_STATE_DIR`, `GRAZR_CONFIG_DIR`, `GRAZR_NOTIFIER` (`osascript` when `!remote && platform === 'darwin'`, else `queue`); local paths absolute under `homedir`, remote paths with the literal `~`.
- `grazrLocalInvocation(verb: GrazrVerb, args: readonly string[], homedir, platform): { program: 'python3'; args: string[]; env }` — `args = [<homedir>/.local/share/orca-grazr/engine/grazr.py, verb, ...args]`.
- `grazrRemoteCommand(verb, args): string` → `env GRAZR_STATE_DIR=~/.local/state/orca-grazr GRAZR_CONFIG_DIR=~/.config/orca-grazr GRAZR_NOTIFIER=queue python3 ~/.local/share/orca-grazr/engine/grazr.py <verb> <quoted args>` (tildes unquoted so the remote shell expands them; every arg through `quotePosixShell`).
- `grazrEnrolTerminalCommand(remote: boolean, homedir, platform): string` — the interactive line a terminal runs: local → `GRAZR_STATE_DIR=… GRAZR_CONFIG_DIR=… GRAZR_NOTIFIER=… python3 <engine>/grazr.py enrol`; remote → the same string with `~` paths (the terminal already runs on that host).
- `GrazrVerb = 'status' | 'swap' | 'refresh' | 'set' | 'install' | 'uninstall' | 'notices-drain'`; `status` always gets `['--json']`.
- `GrazrRunResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError: string | null }`.
- `GrazrEngineRunner = { runLocal(verb, args, timeoutMs): Promise<GrazrRunResult>; runSsh(connection: SshConnection, verb, args, timeoutMs): Promise<GrazrRunResult> }`; `createGrazrEngineRunner(deps: { runProcess; execCommand; homedir: () => string; platform: NodeJS.Platform }): GrazrEngineRunner`. `runSsh` maps `execCommand` resolution → `{ code: 0, stdout }`, `SshCommandExitError` → `{ code: exitCode, stdout, stderr: message }`, timeout (`isSshExecTimeout`) → `timedOut: true`, other errors → `spawnError: message`.
- `classifyGrazrOutcome(result: GrazrRunResult, remote: boolean): GrazrFailure | null` with `GrazrFailure = { kind: 'timeout'|'not-deployed'|'missing-python'|'unreachable'|'engine'|'exit'; detail: string }` — port `/Users/deepdark/orca-plugins/account-autoswitch/lib/errors.mjs` (timeout first; ENOENT/127 → missing-python; remote 255 → unreachable; python exit 2 with `No such file` / `can't open file` in stderr → not-deployed; a `grazr: …` stderr line → engine with that line; else exit). `null` when `code === 0`.

- [ ] **Step 1: Write the failing tests** — local argv and env for darwin/linux; remote command string byte-exact for `swap` with `o'brien $x` (expected `swap 'o'"'"'brien $x'`); enrol command local/remote; classification for each kind with scripted results.
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Tests pass; `pnpm tc`; `oxlint` on the new files.**
- [ ] **Step 5: Commit** — `feat(grazr): build and classify engine invocations for local and SSH hosts`

---

### Task 4: Host resolver, service, IPC and preload bridge

**Files:**

- Create: `src/main/grazr/grazr-host-resolver.ts`, `src/main/grazr/grazr-service.ts`, `src/main/ipc/grazr.ts`, `src/preload/api/grazr-bridge.ts`
- Modify: `src/shared/grazr-api-types.ts` (add `GrazrApi`; the outcome/status/result/notice types already live there from Task 2), `src/preload/api-types.ts` (add `grazr: GrazrApi`), `src/preload/index.ts` (import `grazrApi`, add `grazr: grazrApi`), `src/main/ipc/register-core-handlers/register-core-handlers.ts` (call `registerGrazrHandlers(createGrazrService(...))` after `registerClaudeAccountHandlers(claudeAccounts)`), `src/renderer/src/web/web-preload-api.ts` only if the build's `satisfies`/fallback requires a key (check `withFallback`; add a fallback entry if a missing key fails typecheck).
- Test: `src/main/grazr/grazr-host-resolver.test.ts`, `src/main/grazr/grazr-service.test.ts`

**Interfaces:**

- Consumes Task 2 types, Task 3 runner/classifier, `listEnvironments` (`src/shared/runtime-environment-store.ts`), `getRuntimeSshAccess` (`src/shared/runtime-environments.ts`), `getSshConnectionManager` (`src/main/ssh/targets/ssh-target-registry.ts`), `getAppEnvironment().getPath('userData')` (`src/shared/app-environment.ts`), Task 1 `resolveGrazrEngineRoot`.
- `resolveGrazrHost(ref: GrazrHostRef, deps: { listEnvironments: () => readonly { id: string; name?: string; orcadDeployment?: unknown; sshAccess?: unknown }[]; getConnection: (sshTargetId: string) => { getState(): { status: string } } | undefined; platform: NodeJS.Platform }): GrazrResolvedHost` where `GrazrResolvedHost = { kind: 'local' } | { kind: 'ssh'; sshTargetId: string; label: string } | { kind: 'no-ssh-access'; label: string } | { kind: 'unsupported-platform' }` (local on `win32` → unsupported; environment without an SSH link or with a connection whose status is not `connected` → no-ssh-access; the type of `deps.listEnvironments` must be assignable from `listAppRuntimeEnvironments` in `src/main/ipc/shell-editor-ssh-host.ts`, reuse that export).
- Uses `GrazrHostStatus`, `GrazrHostOutcome`, `GrazrActionResult` (`foreignOwner` true when the engine's message contains `already belongs`) and `GrazrNotice` from Task 2's `src/shared/grazr-api-types.ts`.
- `GrazrApi` (added to `src/shared/grazr-api-types.ts`, imported by preload and renderer): `status(host): Promise<GrazrHostStatus>`, `refresh(host)`, `swap(host, name?: string)`, `setEnabled(host, enabled: boolean)`, `install(host, force: boolean)`, `uninstall(host)`, `deploy(host)` → `Promise<GrazrActionResult>` each, `enrolCommand(host): Promise<{ command: string } | { error: string }>`, `drainNotices(host): Promise<GrazrNotice[]>`.
- `createGrazrService(deps: { runner: GrazrEngineRunner; resolve: (ref) => GrazrResolvedHost; getConnection; engineRoot: string; copyDir: (from, to) => Promise<void>; homedir: () => string; platform }): GrazrService` implementing `GrazrApi`'s shape plus nothing else. Per-host serialization keyed by `grazrHostKey`. `deploy`: local → `copyDir(engineRoot, <homedir>/.local/share/orca-grazr/engine)` (`fs.cp` recursive, overwrite) ; ssh → `execCommand(conn, 'mkdir -p ~/.local/share/orca-grazr/engine')` then `connection.uploadDirectory(engineRoot, '~/.local/share/orca-grazr/engine')` — if `uploadDirectory` rejects `~`, resolve `$HOME` first with `execCommand(conn, 'printf %s "$HOME"')`. `install(force)` runs `install` or `install --force`; the engine's stdout lines form `message`. `setEnabled` runs `set ENABLED 1|0`. `drainNotices` runs `notices-drain` and parses JSONL (bad lines skipped).
- IPC channel names: `grazr:status`, `grazr:refresh`, `grazr:swap`, `grazr:setEnabled`, `grazr:install`, `grazr:uninstall`, `grazr:deploy`, `grazr:enrolCommand`, `grazr:drainNotices`; handlers validate `host` with a zod schema (`GrazrHostRefSchema` in `src/shared/grazr-host.ts`) and reject otherwise.

- [ ] **Step 1: Write the failing tests** — resolver: local darwin → local; local win32 → unsupported; environment with link + connected → ssh with the environment's name as label; link but connection missing / `connecting` → no-ssh-access; environment unknown → no-ssh-access. Service with a scripted runner: status ok parses the report; python exit 2 "No such file" → not-deployed; timeout → unreachable with message; two concurrent `status` calls for one host run sequentially (assert call order via the fake's log); `swap('x')` passes `['x']`; `install(true)` passes `['--force']`; a foreign-owner refusal sets `foreignOwner`.
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement resolver, service, IPC, bridge, types, wiring.**
- [ ] **Step 4: Tests pass; `pnpm tc` (all three targets via `pnpm tc`); `oxlint` on changed files.**
- [ ] **Step 5: Commit** — `feat(grazr): run the rotation engine per host from main and expose it to the renderer`

---

### Task 5: The Claude Accounts dialog

**Files:**

- Create: `src/renderer/src/components/grazr/GrazrAccountsDialog.tsx`, `src/renderer/src/components/grazr/GrazrClockRing.tsx`, `src/renderer/src/components/grazr/GrazrAccountRows.tsx`, `src/renderer/src/components/grazr/grazr-ring-geometry.ts`, `src/renderer/src/components/grazr/use-grazr-host-status.ts`, `src/renderer/src/components/grazr/grazr-enrol-terminal.ts`, `src/renderer/src/components/grazr/grazr-chip-copy.ts`
- Modify: `src/renderer/src/store/slices/ui/ui-slice-contract-contextual.ts` (add `'grazr-accounts'` to `activeModal`), `src/renderer/src/App.tsx` (mount `<GrazrAccountsDialog />` after `<ClaudeAccountSwitchDialog />`), `src/renderer/src/i18n/locales/en.json` (extracted keys)
- Test: `src/renderer/src/components/grazr/grazr-ring-geometry.test.ts`, `src/renderer/src/components/grazr/use-grazr-host-status.test.ts` (fake `window.api.grazr`, fake timers for the 60 s poll and the 200 ms spinner delay)

**Interfaces:**

- Consumes: Task 2 view model and chip, Task 4 `window.api.grazr`, `openModal`/`closeModal`/`modalData` from the store, `Dialog*`, `Button`, `Switch`, `Badge`, `DropdownMenu*`, `Tooltip`, `SettingsSegmentedControl` (`settings/SettingsFormControls.tsx`), `toast` from `sonner`, `useResetCountdownClock` if useful.
- `modalData` for `grazr-accounts`: `{ host: GrazrHostRef; label: string; worktreeId: string | null }` (`worktreeId` is where Add Account opens its terminal; null → the dialog's Add Account button is disabled with the tooltip `Open a workspace on this server first`).
- `useGrazrHostStatus(host, { pollMs: 60_000 })` → `{ status: GrazrHostStatus | null; loading: boolean; busy: boolean; run(action: () => Promise<GrazrActionResult>): Promise<void>; refresh(): Promise<void>; asOf: number | null }`; `run` ignores calls while `busy`, sets `busy` immediately, shows the spinner state only after 200 ms, toasts `message` on `ok: false`, drains notices after every action and toasts them `grazr · <label>`, then refreshes.
- `grazr-ring-geometry.ts`: `arcPath(cx, cy, r, startDeg, endDeg): string`, `ringSegments(segments: GrazrRingSegment[], { radius, gapDeg }): { index; d: string; fillD: string | null; badge: { x; y } ; state }[]` (port of `arcPath`/`ringSvg` maths in `/Users/deepdark/orca-plugins/account-autoswitch/lib/panel.mjs`, including the full-circle guard for a single account).
- `grazr-enrol-terminal.ts`: `openGrazrEnrolTerminal(args: { worktreeId: string; command: string; label: string }): { tabId: string } | null` — follows `run-quick-command-in-new-tab.ts:103-124`: `createTab(worktreeId, undefined, undefined, { quickCommandLabel: label, pendingStartup: { command } })`, `setActiveTabType('terminal', worktreeId)`, `persistAgentLaunchTabOrder(worktreeId, tab.id)`.
- Dialog body by `outcome.kind`: `ok` → header chip + segmented control + ring + rows + switch + footer; `not-deployed` → text and `Deploy engine` (then `Connect to Claude's status line`); `no-ssh-access` / `unsupported-platform` → explanation only; `engine-error` / `unreachable` → message + `Retry`. Footer buttons: `Refresh` (ghost), `Add Account…` (outline), `Swap to Next Account` (default, disabled when `centre.next` ends with `none`), `Done` (ghost). Row overflow menu: `Swap to this account` (parked, not blocked, not active), `Re-authenticate…` (blocked). `Connect/Disconnect` live in the header chip's menu when `ok` (`installed` false → Connect, true → Disconnect); a `foreignOwner` refusal re-shows Connect as `Take over the status line` which calls `install(host, true)`.
- Copy (English defaults): title `Claude Accounts`; subtitle `{{label}} · swaps below {{session}}% 5h · {{weekly}}% week`; segmented `5h` / `Week`; switch `Rotate automatically`; footer `as of {{time}}`; toasts `Finish the login in the terminal, then reopen Claude Accounts`; chip labels per `grazr-chip-copy.ts` keyed by chip kind.

- [ ] **Step 1: Write the failing tests** (geometry: arc for 90°, single-segment full circle, badge positions; hook: poll at 60 s with fake timers, `run` ignores a second call while busy, spinner flag only after 200 ms, `ok:false` toasts).
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement components, hook, geometry, modal id, App mount; extract i18n and update `en.json`.**
- [ ] **Step 4: Tests pass; `pnpm tc`; `oxlint`; `pnpm run check:code-quality:changed`; `node config/scripts/verify-localization-extraction.mjs`.**
- [ ] **Step 5: Commit** — `feat(grazr): add the Claude Accounts dialog with the rotation ring`

---

### Task 6: Entry points — Usage popover row and the worktree `grazr ▸` submenu

**Files:**

- Create: `src/renderer/src/components/sidebar/GrazrWorktreeMenuItems.tsx`, `src/renderer/src/components/sidebar/use-grazr-worktree-menu.ts`
- Modify: `src/renderer/src/components/status-bar/UsageRosterPanel.tsx` (new prop `onOpenGrazr: () => void`, row `Claude Accounts (rotation)…` with `ChevronRight` between `Usage details & history` and `Manage Accounts…`), `src/renderer/src/components/status-bar/use-status-bar-controller.ts` (`handleOpenGrazr`: close the menu, `openModal('grazr-accounts', { host: remoteOwner ? { kind: 'environment', environmentId } : { kind: 'local' }, label: remoteOwner?.label ?? <local label from getLocalExecutionHostLabel()>, worktreeId: <focused worktree id from the store or null> })`), `src/renderer/src/components/status-bar/StatusBarSurface.tsx` (pass the prop), `src/renderer/src/components/sidebar/WorktreeContextMenuView.tsx` (render `<GrazrWorktreeMenuItems worktree={worktree} disabled={isDeleting} />` after the `Copy Worktree Name` separator, only when `!isMultiContext`), `src/renderer/src/i18n/locales/en.json`
- Test: `src/renderer/src/components/sidebar/use-grazr-worktree-menu.test.ts` (host derivation from a worktree's execution host id: local, `ssh:<id>`, `runtime:<id>`, unresolved → hidden; menu item set for `installed` true/false; `Switch Shared Account` list excludes active and blocked and includes parked eligible names)

**Interfaces:**

- `useGrazrWorktreeMenu(worktreeId: string)` → `{ host: GrazrHostRef | null; label: string; status: GrazrHostStatus | null; load(): void; actions: { openAccounts(); swapTo(name); swapNext(); reauthenticate(); connect(); disconnect() } }` — `load` is called from the sub-trigger's `onPointerEnter`/`onFocus` once per open; actions call `window.api.grazr.*` then toast the message; `openAccounts` → `openModal('grazr-accounts', { host, label, worktreeId })`; `reauthenticate` → `window.api.grazr.enrolCommand(host)` then `openGrazrEnrolTerminal` from Task 5.
- Rows come from `buildGrazrRotationView(report, 'session', new Date())` (Task 2) on `status.outcome.report`.
- Items in order: `Accounts…`, separator, `Switch Shared Account ▸` (`DropdownMenuSub`, items from `status.outcome.kind === 'ok'` rows with `status !== 'active' && status !== 'blocked' && status !== 'not-enrolled'`, label `name` with `NEXT ▸` rows marked; while loading one disabled `Loading…`; empty → disabled `No other accounts`), `Re-authenticate {{email}}…` (active account's email or name; hidden when no active), separator, `Connect to Claude's status line` or `Disconnect from Claude's status line` (by `installed`; hidden unless `ok`), `Swap to the next account now`. The whole submenu is hidden when `host === null` or the host is local on Windows.

- [ ] **Step 1: Write the failing test.**
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement the hook, the menu component, the popover row, the controller handler; extract i18n.**
- [ ] **Step 4: Tests pass; `pnpm tc`; `oxlint`; `check:code-quality:changed`; localization verify.**
- [ ] **Step 5: Commit** — `feat(grazr): open Claude Accounts from the Usage popover and the worktree menu`

---

### Task 7: Dev-run verification and notes

**Files:**

- Create: `docs/superpowers/specs/2026-10-22-grazr-native-verification.md` (what was checked in the dev Orca and how)

- [ ] **Step 1:** `pnpm tc && oxlint src/main/grazr src/shared/grazr-*.ts src/renderer/src/components/grazr src/renderer/src/components/sidebar/GrazrWorktreeMenuItems.tsx && pnpm run check:code-quality:changed && node config/scripts/verify-localization-extraction.mjs && pnpm test src/main/grazr src/shared/grazr-rotation-view.test.ts src/shared/grazr-status-report.test.ts src/renderer/src/components/grazr src/renderer/src/components/sidebar/use-grazr-worktree-menu.test.ts` — all green.
- [ ] **Step 2:** Restart the dev Orca (`pnpm run dev` in the background; main-process changes need a restart) and record in the notes file: the Usage popover shows the new row; the dialog opens for `mac` with the four accounts and the ring; `grazr ▸` appears on a worktree; a remote worktree's dialog reports `not-deployed` or `ok`. Screenshots are the user's; the note records the commands and expected states only.
- [ ] **Step 3: Commit** — `docs(grazr): record the dev-run verification`
