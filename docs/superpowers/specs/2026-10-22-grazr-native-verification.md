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

Driven over CDP with Playwright from inside the repo
(`.superpowers/sdd/2026-10-22-grazr-native/cdp-grazr-check.mjs` and
`cdp-grazr-menu-check.mjs`, both git-ignored scratch).

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

## Not verified

- Packaging (`electron-builder` with `resources/grazr/**` as an extra resource)
  was never run; the engine path was only exercised from the dev tree.
- Remote hosts (ssh / environment) were exercised by unit tests only; no real
  remote install/swap was run from the dev app.
- Actions with side effects (swap, install, uninstall, enrol, set enabled) were
  not clicked in the dev app; only read paths (`status --json`) ran against the
  real Mac state.
