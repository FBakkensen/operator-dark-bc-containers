---
name: bc-smoke
description: Live read-only smoke test of the BC containers helper against the real host. Use to confirm BCContainerHelper + Docker integration works end-to-end on this machine — something the fixture-only test suite never exercises. Runs only the read-only refresh and the installer dry-check; never starts/stops/restarts/removes containers.
---

# bc-smoke

Read-only check that the helper talks to the real host correctly. Complements `npm test`
(fixture-only, no live host calls).

## Prerequisites

- `pwsh` 7+ on PATH (PowerShell 7, not Windows PowerShell 5.1).
- BCContainerHelper module installed and importable.
- Docker running (needed for stats once container identity is known).

If a prerequisite is missing, report it plainly and stop — do not fake a result.

## Steps

1. Run the helper refresh from the repo root:

   ```
   pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/bc-containers.ps1 -Operation refresh
   ```

2. Parse **stdout** as JSON (stdout must be JSON only). On non-zero exit or unparseable stdout, report
   `exitCode` and the first non-empty `stderr` line, then stop.

3. Assert `ok !== false` and no top-level `error`. Report `summary`: `total`, `running`, `cpuPercent`,
   `memoryBytes`. If `total` is 0, say "no BC containers found" (not a failure).

4. Run the installer dry-check (verifies source inputs + bar pack, writes nothing):

   ```
   pwsh -NoProfile -File scripts/install-bc-containers.ps1 -Check
   ```

5. Summarize: helper reachable? JSON well-formed? container summary; install `-Check` OK?

## Boundary

Do not run lifecycle actions (`-Operation action -Action start|stop|restart|remove ...`). This skill is
strictly read-only. Lifecycle/install belongs to `/install-widget` and manual operation.
