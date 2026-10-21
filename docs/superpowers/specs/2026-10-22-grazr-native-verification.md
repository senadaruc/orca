# grazr native GUI — dev-run verification (2026-10-22)

Branch `grazr-native` at `66ad7199`, cut from upstream main `de7a2d24`.
Spec: `docs/superpowers/specs/2026-10-22-grazr-native-design.md`.
Plan: `docs/superpowers/plans/2026-10-22-grazr-native.md`.

## Gates (run at 66ad7199, node@24)

| Gate                                                     | Result                          |
| -------------------------------------------------------- | ------------------------------- |
| `pnpm tc`                                                | clean (main, preload, renderer) |
| `pnpm exec oxlint`                                       | clean                           |
| `pnpm run check:code-quality:changed`                    | passed                          |
| `node config/scripts/verify-localization-extraction.mjs` | exit 0                          |
| `pnpm test` (grazr files)                                | 11 files, 117 tests passed      |
| `pnpm test` (full suite, at d9d72844)                    | 474 files, 3992 tests passed    |

## Dev app (`pnpm run dev`, `orca-dev` user data, CDP 9437)

Driven over CDP with Playwright from inside the repo (throwaway scripts, not
committed: connect to 127.0.0.1:9437, click the `Usage` button, click the
`Claude Accounts (rotation)` row, screenshot; right-click a worktree row, hover
`grazr`, screenshot).

### Usage popover → Claude Accounts dialog

- Status-bar `Usage` button opens the roster; the row `Claude Accounts (rotation)…`
  is present once, between Usage details and Manage Accounts.
- Clicking it opens the dialog on the local Mac host. Real engine state rendered:
  header "rotation on", subtitle "Local Mac · swaps below 15% 5h · 20% week",
  Week|5h segmented control, clock ring with four segments, active account
  `senad.aruc@icloud.com` 84% left, `next ▸ senad.aruc@imperum.io`.
- Rows: gmail (spent, resets Sat 13:00), icloud (84%, active), senad@imperum.io
  (spent, resets Mon 02:00), senad.aruc@imperum.io (NEXT ▸).
- Footer: "Rotate automatically" switch on, "as of 01:45 AM", buttons
  Refresh / Add Account… / Swap to Next Account / Done.
- Earlier run crashed the renderer ("Tooltip must be used within TooltipProvider")
  because the dialog mounts outside the app provider; fixed in 04cb2c84 by giving
  the dialog its own `TooltipProvider`. Verified gone at HEAD.

### Worktree context menu → grazr submenu

- Right-click on worktree `E task placeholder` (project herdrm): menu shows
  `… Copy Worktree Name | grazr ▸ | Pin …` with exactly one separator on each
  side of the grazr item.
- Submenu: `Accounts…`, `Switch Shared Account ▸`, `Re-authenticate
  senad.aruc@icloud.com…`, `Disconnect from Claude's status line`,
  `Swap to the next account now`.
- `Switch Shared Account ▸`: `senad.aruc@gmail.com`, `senad@imperum.io`,
  `senad.aruc@imperum.io · NEXT ▸` (the active account is excluded).
- Layout matches Herdr's `grazr ▸` submenu.

### Known cosmetic items (not blocking)

- In the dialog footer "as of 01:45 AM" wraps to two lines and "Done" drops to a
  second row at the default dialog width.

## Final review and fix round (commits c0a332d1, 9e1e073f, 29ea31eb, 1815d235)

Whole-branch review: 0 Critical, 2 Important, 10 Minor. Fixed in one round and
re-reviewed clean:

- Usage popover passes the focused worktree to the dialog only when it lives on
  the dialog's host (`grazr-enrol-worktree.ts`, tested for direct SSH).
- Deployed engines can be updated: `engineOutdated` / `bundledEngineVersion` on
  the status, `Update engine…` footer button runs deploy; a missing bundled
  VERSION file fails status with the path in the message.
- `managed_profile` accepts the path string the engine emits; non-ok Retry and
  Refresh re-fetch status instead of calling the engine `refresh` verb; notice
  toasts use the dialog's host label; local enrol command paths are quoted.
- Ring, centre and rows are coloured by state with `main.css` tokens
  (`status-success`, `status-warning`, `destructive`, `agent-question`): green
  for accounts with tokens (active brightest), red for spent or blocked, muted
  for parked or unknown, accent for next. Centre text is capped at 60% of the
  ring; footer timestamp on its own line, buttons in one row; dialog
  `sm:max-w-2xl`.
- Verified over CDP in the dev app at 1815d235: two spent accounts red, active
  green, next orange dotted, no overlap, footer on one row.

Follow-ups after the user's dev-run review (dd53ebfe, 16401a22, 49cb4a67,
re-reviewed clean):

- The "as of HH:MM" timestamp moved into the header subtitle; the footer is
  only the button row. The header chip row reserves room for the dialog's
  close button.
- Full suite at 1815d235 (13226 files): one real regression, the grazr IPC
  registration read `app.getAppPath()` eagerly inside `registerCoreHandlers`,
  which broke the upstream registrar test's electron mock. Fixed by resolving
  the engine root lazily and registering the grazr channels once from
  `registerMainProcessIpcHandlers` (main-process bootstrap). The remaining
  failures are in files this branch never touched and are environmental:
  cross-version-wire tests need release tags this clone lacks, zsh shell-ready
  marker tests, `/private/var` temp-path expectations, daemon and pty tests
  under a load average above 60. Registrar, startup and grazr suites: 88 files,
  796 tests passed at 49cb4a67.

Parked for a later round (reviewer minors): overall deadline for status calls
over a dead SSH link, draining notices on open and on each poll, translating the
view-model labels, stripping injected `CLAUDE_CONFIG_DIR` vars on local runs,
"unsupported" for Windows SSH targets, retrying a failed VERSION read.

## Not verified

- Packaging (`electron-builder` with `resources/grazr/**` as an extra resource)
  was never run; the engine path was only exercised from the dev tree.
- Remote hosts (ssh / environment) were exercised by unit tests only; no real
  remote install/swap was run from the dev app.
- Actions with side effects (swap, install, uninstall, enrol, set enabled) were
  not clicked in the dev app; only read paths (`status --json`) ran against the
  real Mac state.
