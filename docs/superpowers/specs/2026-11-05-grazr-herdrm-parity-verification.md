# grazr HerdrM parity — verification (2026-11-05)

Branch `grazr-native` at `2c335fde3d`.
Design: `docs/superpowers/specs/2026-11-05-grazr-herdrm-parity-design.md`.
Plan: `docs/superpowers/plans/2026-11-05-grazr-herdrm-parity.md`.

## Commits

| Commit       | What                                                                            |
| ------------ | ------------------------------------------------------------------------------- |
| `61b5703c4b` | vendor engine 0.4.7+fork.13 (`changed_at` covers a config write)                |
| `bb688c9eaa` | per-window bars, plan badge, organization, reading age; inner Fable ring        |
| `1e29cb3572` | usage-credits dialog recogniser (port of `ModelSwitchPrompt`)                   |
| `16d32f45f2` | model switch watcher, setting `grazrAutoModelSwitch`, dialog checkbox           |
| `324c41ff64` | screen read from `buffer.baseY`, not the scrolled viewport (security review)    |
| `760e73be46` | account sync: planner, coordinator, devices, lines, IPC, bridge, dialog section |
| `2c335fde3d` | `Progress` tone variant (design-system gate)                                    |

## Gates (at 2c335fde3d)

| Gate                                                              | Result                             |
| ----------------------------------------------------------------- | ---------------------------------- |
| `pnpm tc`                                                         | exit 0                             |
| `oxlint` + react-doctor config on every changed `.ts`/`.tsx`      | clean                              |
| `pnpm run check:code-quality:changed`                             | passed, 0 findings across 86 files |
| `pnpm run verify:localization-extraction`                         | exit 0                             |
| `pnpm test` grazr, pane-connection, settings, worktree-menu files | 77 files, 1136 tests passed        |
| engine `python3 -m unittest test_grazr` (herdr-grazr `orca-port`) | 581 tests OK                       |

Ported test suites: `ModelSwitchPromptTests` (14 cases, all kept) in
`src/shared/grazr-model-switch-prompt.test.ts`; `GrazrSyncTests` (16 cases) in
`src/main/grazr/grazr-sync-planner.test.ts`. Two HerdrM cases were not ported
because Orca's report has no pins and no block expiry (`pinned`, `expired block`).

## Dev app over CDP (`ORCA_BACKGROUND_LAUNCH=1 REMOTE_DEBUGGING_PORT=9437 pnpm run dev`)

Driven with Playwright from the repo's `node_modules` (throwaway scripts in the
session scratchpad, not committed). The dev profile shows no usage pill, so the
dialog was opened from the worktree context menu: right-click `E task
placeholder` → `grazr ▸` → `Accounts…`. Real local engine state (fork.12
deployed, the dialog offers the update to fork.13).

### Per-model windows

- Week view: outer ring plus one inner Fable ring per segment, legend
  "Outer ring: all models · inner: Fable", centre "69% left" with the line
  "Fable 76% left" under it. 5h view: no inner ring, no legend, no model line.
- Each row: plan badge (`Max 20x`, `Team 5x`), organization under the email
  where it is not the default "<name>'s Organization", one bar per window
  (`5h`, `Week`, `Fable week`) with percent and reset time, green/orange/red by
  tone, and "Reading from 6 hr. ago" / "just now".
- Spent accounts keep their green Fable bar (60%): the Fable allowance is its
  own window, as in HerdrM.

### Model switch

- Checkbox "When Fable runs out, switch model and continue" with the subtitle
  "Agents keep working on the fallback model. Never spends credits." sits under
  "Rotate automatically". Ticking it writes `grazrAutoModelSwitch` through the
  settings store (`aria-checked` true after the click, false after the second).
- The watcher is unit-tested with scripted screens (press once the switch
  option reads the same on two looks, re-press a swallowed key at most three
  times, never press on another focused option). A live Fable-exhausted dialog
  was not available during this run, so the end-to-end keystroke was not
  exercised in the app.

### Sync

- Checkbox "Keep accounts in sync across devices" with "Last change wins. Pins
  and thresholds stay per device." Ticking it: the main process ran the first
  round, the row "Devices in the sync ☑ This computer" appeared, and the status
  read "Only This computer is in the sync, nothing to sync yet" (no SSH host is
  connected in the dev profile). The state file
  `<userData>/grazr-sync.json` was written and read back; unticking restored
  `{"enabled":false,…}`.
- Preview/Apply, pushes, needs-update and restart continuation are covered by
  `grazr-sync-coordinator.test.ts` against a fake engine; a two-host run over SSH
  was not possible in this session.

## Security review note

The automated commit review flagged the screen read for the model switch. Fixed
in `324c41ff64`: rows are read from `buffer.baseY` (where the program draws),
not `viewportY` (where the user scrolled). The dialog match itself is the
HerdrM shape check (title, exact footer, one focused line, known second option),
and every look re-reads the screen immediately before the key goes in.
