# Operator Dark BC Containers PRD

## Purpose

Operator Dark BC Containers is a Zebar popup widget for monitoring and controlling local Business Central containers from the Operator Dark topbar.

The widget gives the user a fast read on local BC container load, health, and lifecycle state, then exposes safe one-click actions for common development operations.

## Problem

Local BC development often involves multiple heavy containers. The user needs to know which BC containers are running, how much CPU and RAM they consume, whether they are healthy, and how to open, restart, stop, start, or remove them without switching to a terminal.

Generic Docker UI is too broad for this workflow. Removal must use BCContainerHelper so the operation follows the same BC container lifecycle semantics as the user's normal tooling.

## Goals

- Show all local BC containers, including running and stopped containers.
- Show real CPU and RAM usage for running BC containers.
- Show aggregate CPU and RAM usage in the topbar.
- Open the BC web client for a container at `http://<containername>/bc` in the default browser.
- Run lifecycle actions through BCContainerHelper:
  - `Start-BcContainer <container name>`
  - `Stop-BcContainer <container name>`
  - `Restart-BcContainer <container name>`
  - `Remove-BcContainer <container name>`
- Require confirmation for restart, stop, and remove.
- Run actions hidden, without opening a PowerShell window.
- Let the user inspect the latest command output from the popup.
- Surface exact command failures in the popup.

## Non-Goals

- Do not manage generic non-BC Docker containers.
- Do not create new containers.
- Do not remove images, volumes, host folders, or artifacts.
- Do not provide a full Docker Desktop replacement.
- Do not persist command logs beyond the active Zebar session.
- Do not run multiple lifecycle actions concurrently.
- Do not embed the BC web client inside Zebar.

## Users

The primary user is a Business Central AL developer running local BC containers on Windows with Docker and BCContainerHelper.

The widget is optimized for repeated development operations, not for administrative Docker fleet management.

## Product Shape

The existing Operator Dark topbar gets a compact BC container summary and trigger.

Example topbar states:

- `BC 2 CPU 18% RAM 5.4G`
- `BC 0`
- `BC !`

Clicking the summary opens a separate Zebar popup pack: `operator-dark-bc-containers`.

The popup shows running containers first, then stopped containers. Each row uses the exact container name reported by BCContainerHelper.

## Information Architecture

Topbar summary:

- Count of BC containers.
- Aggregate CPU usage across running BC containers.
- Aggregate RAM usage across running BC containers.
- Error indicator when helper refresh fails.

Popup header:

- Total BC containers.
- Running count.
- Aggregate CPU and RAM.
- Last refresh state.
- Helper error warning when present.

Running container row:

- Exact container name.
- Docker health/status: `healthy`, `unhealthy`, `starting`, `running`, `exited`, or raw fallback.
- CPU usage.
- RAM usage.
- Secondary metadata when cheap to retrieve: image tag, BC version, country, or artifact label.
- Actions: `Open`, `Restart`, `Stop`, `Remove`.

Stopped container row:

- Exact container name.
- Stopped/exited status.
- Secondary metadata when cheap to retrieve.
- Actions: `Start`, `Remove`.

Last output drawer:

- Latest command.
- Exit code.
- Started timestamp.
- Finished timestamp.
- Stdout.
- Stderr.

The last output drawer is in-memory only. It resets when Zebar restarts or the popup reloads.

## Behavior

### Container Detection

BCContainerHelper is the source of truth for BC container identity.

The helper lists BC containers through BCContainerHelper, using `Get-BcContainers` or the closest installed BCContainerHelper command available on the host.

Docker may be queried after identity is established to retrieve status, health, CPU, and RAM for those BC container names.

### Refresh

- Topbar summary refreshes every 10 seconds.
- Popup refreshes every 5 seconds while open.
- After any lifecycle action completes, the widget refreshes immediately.
- Refresh failures do not clear the last known successful data. They add a visible warning.

### CPU and RAM

CPU and RAM values must reflect real Docker runtime stats for running containers.

Stopped containers show no CPU/RAM usage.

Aggregate CPU is the sum of running BC container CPU percentages.

Aggregate RAM is the sum of running BC container memory usage, formatted as MB or GB.

### Web Client

`Open` launches the host default browser to:

```text
http://<containername>/bc
```

The URL uses the exact container name.

`Open` is visible for every BC container and disabled only when the container is stopped.

Running containers remain clickable even when health is `starting` or `unhealthy`, because the web client may still be reachable.

### Lifecycle Actions

Lifecycle actions run hidden through a PowerShell helper.

The helper must use safe argument passing for container names. It must not build command strings by concatenating untrusted container names.

Action mapping:

| UI action | Command |
| --- | --- |
| Start | `Start-BcContainer <container name>` |
| Stop | `Stop-BcContainer <container name>` |
| Restart | `Restart-BcContainer <container name>` |
| Remove | `Remove-BcContainer <container name>` |

Only one lifecycle action may run at a time.

While an action is running:

- Disable all lifecycle buttons.
- Keep `Open` available when the row is running.
- Show the active command and target container.

### Confirmation

`Restart`, `Stop`, and `Remove` use inline two-step confirmation.

First click arms the action and changes the button label:

- `Confirm restart`
- `Confirm stop`
- `Confirm remove`

Second click executes the action.

Confirmation cancels when:

- 8 seconds pass.
- Another action is selected.
- The popup refreshes to a state where the action is no longer valid.

No modal dialogs are used.

### Errors

When Docker, PowerShell, or BCContainerHelper is unavailable, the popup shows:

- The failing operation.
- The exact command or helper operation.
- Exit code when available.
- Stderr when available.
- A short user-facing state in the header.

The topbar shows `BC !` when the latest refresh failed.

## Technical Direction

The source repo owns the widget implementation. Installed runtime files are copied into the local Zebar configuration under `.glzr` when the widget is installed.

Expected installed shape:

```text
zebar/operator-dark-bc-containers/
  app.browser.js
  index.html
  style.css
  zpack.json
  scripts/
    bc-containers.ps1
    run-bc-containers-helper.cmd
```

The existing topbar pack integrates a compact trigger:

```text
zebar/operator-dark-bar/
  index.html
  styles.css
  zpack.json
```

The Zebar UI remains presentation-focused. PowerShell owns BCContainerHelper calls and Docker command execution.

The helper returns JSON only on stdout for machine-readable operations. Diagnostics and command output are captured and returned in structured fields, not mixed with the protocol stream.

## Data Contract

Helper refresh output:

```json
{
  "ok": true,
  "refreshedAt": "2026-06-01T12:00:00+02:00",
  "summary": {
    "total": 2,
    "running": 2,
    "cpuPercent": 18.4,
    "memoryBytes": 5798205849
  },
  "containers": [
    {
      "name": "234-rules-within-rules",
      "state": "running",
      "health": "healthy",
      "status": "Up 7 hours (healthy)",
      "cpuPercent": 9.8,
      "memoryBytes": 3125800960,
      "image": "bctest:snapshot",
      "metadata": "BC 26 / dk"
    }
  ],
  "error": null
}
```

Helper action output:

```json
{
  "ok": true,
  "action": "restart",
  "container": "234-rules-within-rules",
  "command": "Restart-BcContainer 234-rules-within-rules",
  "startedAt": "2026-06-01T12:00:00+02:00",
  "finishedAt": "2026-06-01T12:00:18+02:00",
  "exitCode": 0,
  "stdout": "...",
  "stderr": ""
}
```

On failure, `ok` is false and `stderr` or `error` contains the exact failure text.

## Acceptance Criteria

- The topbar shows BC container count plus aggregate CPU/RAM when refresh succeeds.
- The topbar shows `BC !` when refresh fails.
- The popup lists running BC containers before stopped BC containers.
- Running rows show real CPU and RAM values.
- Stopped rows do not show fake CPU/RAM values.
- `Open` launches `http://<containername>/bc` in the default browser.
- `Open` is disabled for stopped containers.
- `Restart`, `Stop`, and `Remove` require a second confirmation click.
- `Remove` invokes `Remove-BcContainer <container name>`.
- `Start`, `Stop`, and `Restart` invoke the matching BCContainerHelper command.
- Lifecycle actions run hidden.
- The popup exposes the latest command output.
- Only one lifecycle action can run at a time.
- Helper refresh output remains valid JSON on stdout.
- Errors show the exact failing command or helper operation.

## Future Considerations

- Optional quick filter when many BC containers exist.
- Optional stale-age indicator for the last successful refresh.
- Optional copy buttons for container name and web client URL.
- Optional link to container event log through BCContainerHelper.
- Optional visual warning when aggregate BC container RAM crosses a configured threshold.
