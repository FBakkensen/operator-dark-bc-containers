---
name: install-widget
description: Install the BC containers widget into the live ~/.glzr/zebar location and verify the idempotent copy + bar integration. User-triggered only — writes to the live Zebar install and patches the operator-dark-bar pack.
disable-model-invocation: true
---

# install-widget

Runs the idempotent installer and verifies the result. Writes to the live `~/.glzr/zebar` — only the
user triggers this. Pass any installer args through `$ARGUMENTS` (e.g. `-Check` for a dry run,
`-TargetRoot <path>` to override the destination).

## Prerequisites

- `pwsh` 7+ on PATH.
- `operator-dark-bar` already installed under `~/.glzr/zebar` (the installer patches it; it throws if
  the bar pack's `index.html`, `styles.css`, and `zpack.json` are missing).

## Steps

1. Run the installer from the repo root:

   ```
   pwsh -NoProfile -File scripts/install-bc-containers.ps1 $ARGUMENTS
   ```

2. If `-Check` was passed, report the dry-check result and stop (nothing was written).

3. On a real install, verify these eight files exist under
   `~/.glzr/zebar/operator-dark-bc-containers/` (last two under `scripts/`):
   `zpack.json`, `index.html`, `style.css`, `fixture-data.browser.js`, `app.js`, `app.browser.js`,
   `scripts/bc-containers.ps1`, `scripts/run-bc-containers-helper.cmd`.

4. Confirm the bar pack got the integration: `~/.glzr/zebar/operator-dark-bar/index.html` contains
   `function BcContainersSummary(` and its `zpack.json` has the BC containers `shellCommands` entry.

5. Report what was installed/patched, and whether the bar already had the patch (idempotent — a
   re-run changes nothing).
