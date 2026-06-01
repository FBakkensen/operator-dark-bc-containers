# Tasks: Operator Dark BC Containers V1

This plan is organized as vertical slices. Each implementation slice must leave the repo closer to a working BC container monitor/controller path, not just a detached layer. Use TDD for implementation slices: write the failing automated test or scripted verifier first, implement the smallest production change, refactor with tests green, then update this file.

No task may widen the product into a generic Docker UI. BCContainerHelper owns BC container identity and lifecycle actions. Docker is used only after BC container identity is known, for runtime status and resource stats.

## Status Legend

- `Ready`: next eligible work
- `Pending`: planned but not yet eligible
- `Blocked`: waiting on a prior slice or runtime evidence
- `Done`: implemented, verified, and documented

## TDD Rules

- Start every implementation slice with a red automated test or failing scripted verifier.
- Prefer Node's built-in test runner for repo tests: `node --test tests/*.test.js`.
- Keep the runtime helper in PowerShell; Node is only a practical test harness unless a later PRD changes that.
- Keep helper stdout JSON-clean for machine-readable operations; diagnostics belong in stderr or structured JSON fields.
- Use fixtures and mocks for BCContainerHelper, Docker, command failures, `.glzr`, and Zebar APIs before touching live host state.
- Keep Zebar UI code presentation-focused. Put PowerShell, BCContainerHelper, and Docker command execution behind the helper script.
- Do not add a frontend bundler. The widget remains buildless HTML, CSS, and JavaScript.
- After each implementation slice, run the focused test command named by that slice and update this file only when the evidence is current.

## Verification Rules

- Verification-only tasks use a Definition of Done instead of red tests.
- Live verification is reserved for behavior fixtures cannot prove: hidden PowerShell execution, real BCContainerHelper availability, Docker runtime stats, default-browser launch, and Zebar popup behavior.
- Verification notes must record the exact command or UI path used, the observed result, and any blocker with enough detail for the next agent to reproduce it.
- Before committing implementation work, run the repo's automated tests and `git diff --check`.

## Phase 1: Helper Contract And Host Data

### T001 - Test Harness And Fixtures

- Status: `Done`
- Kind: implementation
- Vertical outcome: The repo has a deterministic local test command and fixture layout that future helper, widget, pack, and install slices can use.
- PRD coverage: Focused contract tests, buildless widget direction, no frontend bundler, fixture-based verification before live host access.
- Red tests:
  - `npm test` fails because no package/test harness exists.
  - A placeholder helper contract test expects the future helper script path to be documented.
  - A placeholder pack/widget contract test expects fixture folders to exist.
- Implementation:
  - Add minimal `package.json` with `"test": "node --test tests/*.test.js"` and no build script.
  - Add fixture folders for helper, widget, pack, and install tests.
  - Add initial contract tests that can be expanded by later slices without hitting live Docker, BCContainerHelper, Zebar, or `.glzr`.
- Acceptance:
  - `npm test` runs deterministically.
  - Test fixtures live under `tests/fixtures`.
  - No frontend bundler, generated assets, or runtime product code is introduced beyond the test scaffold.
  - Evidence: 2026-06-01 `npm test` passed; scaffold tests verify the buildless package script, fixture folders, and quiet helper wrapper.

### T002 - Helper Refresh JSON Contract

- Status: `Done`
- Kind: implementation
- Vertical outcome: Running the PowerShell refresh helper with mocked host commands returns valid normalized JSON and no non-JSON stdout noise.
- PRD coverage: Helper refresh output, JSON-only stdout, refresh failure shape, exact failure details, timestamps.
- Red tests:
  - Refresh stdout parses as JSON for an empty BC container list.
  - Diagnostics written by mocked host commands do not appear outside the JSON protocol stream.
  - A mocked helper failure returns `ok: false`, the failing operation, exit code when available, and exact stderr/error text.
  - `refreshedAt` is present and parseable.
- Implementation:
  - Add `scripts/bc-containers.ps1` with a refresh operation and dependency seams for mocked BCContainerHelper/Docker calls.
  - Add `scripts/run-bc-containers-helper.cmd` as the Zebar shell entrypoint shape.
  - Normalize the refresh response to the PRD data contract.
- Acceptance:
  - Focused helper contract tests pass.
  - Refresh output has `ok`, `refreshedAt`, `summary`, `containers`, and `error`.
  - Helper stdout remains valid JSON for success and failure paths.
  - Evidence: 2026-06-01 `npm test` passed; refresh tests parse raw stdout JSON for empty, success, BCContainerHelper failure, and Docker failure paths.

### T003 - BC Container Identity Source

- Status: `Done`
- Kind: implementation
- Vertical outcome: The helper identifies BC containers through BCContainerHelper and preserves exact container names for all later Docker queries and actions.
- PRD coverage: BCContainerHelper is source of truth, all local BC containers including stopped containers, exact names, no generic Docker container management.
- Red tests:
  - Mocked `Get-BcContainers` output returns running and stopped BC container names.
  - Exact names with punctuation, digits, and mixed case are preserved.
  - A mocked Docker-only container is excluded when BCContainerHelper does not report it.
  - Missing BCContainerHelper returns a structured refresh failure without clearing the response contract.
- Implementation:
  - Add BCContainerHelper discovery using `Get-BcContainers` or the closest installed BCContainerHelper command available on the host.
  - Keep command discovery behind a testable PowerShell procedure.
  - Produce container identity records before any Docker inspect/stats work runs.
- Acceptance:
  - Helper tests pass with BCContainerHelper fixtures.
  - The helper never treats Docker alone as the BC container identity source.
  - Container names used for downstream lookups remain exact.
  - Evidence: 2026-06-01 `npm test` passed; identity tests preserve mixed-case/punctuated names, exclude Docker-only containers, and assert Docker is queried only after BC identities are loaded.

### T004 - Docker Status And Stats Merge

- Status: `Done`
- Kind: implementation
- Vertical outcome: The helper enriches BC container identities with Docker runtime status, health, CPU, RAM, image, and aggregate summary values.
- PRD coverage: Real CPU/RAM for running containers, stopped containers with no fake usage, health/status fallback, aggregate CPU/RAM, image metadata when cheap.
- Red tests:
  - Running BC containers receive CPU percent and memory bytes from mocked Docker stats.
  - Stopped containers do not receive fake CPU or RAM usage.
  - Health values normalize to `healthy`, `unhealthy`, `starting`, `running`, `exited`, or raw fallback.
  - Aggregate CPU is the sum of running BC container CPU percentages.
  - Aggregate RAM is the sum of running BC container memory bytes.
  - Docker unavailable returns a structured refresh failure with the exact failing operation.
- Implementation:
  - Query Docker only for names returned by BCContainerHelper.
  - Parse Docker inspect/status and stats output through testable helpers.
  - Include image metadata when Docker inspect provides it cheaply; do not block v1 on BC version/country/artifact labels.
- Acceptance:
  - Focused Docker merge tests pass.
  - Running rows have real resource values from Docker fixtures.
  - Stopped rows omit CPU/RAM usage.
  - Summary values match the returned running containers.
  - Evidence: 2026-06-01 `npm test` passed; Docker merge tests cover running stats, stopped null usage, health fallback, image metadata, and aggregate CPU/RAM.

### T005 - Lifecycle Action Contract

- Status: `Done`
- Kind: implementation
- Vertical outcome: The helper executes only the four PRD lifecycle actions through BCContainerHelper with safe argument passing and structured action output.
- PRD coverage: `Start-BcContainer`, `Stop-BcContainer`, `Restart-BcContainer`, `Remove-BcContainer`, hidden action helper path, exact command failures, latest output drawer data.
- Red tests:
  - `start` maps to `Start-BcContainer <container name>`.
  - `stop` maps to `Stop-BcContainer <container name>`.
  - `restart` maps to `Restart-BcContainer <container name>`.
  - `remove` maps to `Remove-BcContainer <container name>`.
  - Unknown actions are rejected before shell execution.
  - Container names are passed as arguments, not concatenated into an unsafe command string.
  - Success and failure action responses include `ok`, `action`, `container`, `command`, `startedAt`, `finishedAt`, `exitCode`, `stdout`, and `stderr`.
- Implementation:
  - Add an action operation to `scripts/bc-containers.ps1`.
  - Add a command map limited to the four PRD actions.
  - Capture stdout, stderr, exit code, and timestamps into the action JSON response.
- Acceptance:
  - Lifecycle contract tests pass.
  - No generic Docker lifecycle command is introduced.
  - Lifecycle actions are launched through the helper path intended for hidden execution; live hidden-window proof remains in T013.
  - Failure output includes the exact command/helper operation and exact stderr/error text.
  - Evidence: 2026-06-01 `npm test` passed; action tests cover all four BCContainerHelper mappings, unknown action rejection before execution, failure output, shell-looking container names as a single argument, and anti-Docker lifecycle drift.

## Phase 2: Popup Experience

### T006 - Popup Static Rendering

- Status: `Done`
- Kind: implementation
- Blocked by: T001
- Vertical outcome: Opening the widget HTML with fixture data renders the BC container popup surface with header summary, running-first rows, actions, and output drawer.
- PRD coverage: Popup header, running containers before stopped containers, exact container names, running/stopped row fields, action availability, last output drawer.
- Red tests:
  - DOM rendering test fails until total count, running count, aggregate CPU, aggregate RAM, and refresh state are visible.
  - Running containers render before stopped containers.
  - Running rows show health/status, CPU, RAM, image/metadata when present, and `Open`, `Restart`, `Stop`, `Remove`.
  - Stopped rows show stopped/exited status, no CPU/RAM usage, and `Start`, `Remove`.
  - The latest output drawer renders command, exit code, started timestamp, finished timestamp, stdout, and stderr when fixture data includes it.
  - Helper warning markup renders when fixture data includes an error.
- Implementation:
  - Add buildless widget files: `index.html`, `style.css`, and `app.browser.js`.
  - Add fixture data for empty, running, stopped, mixed, warning, and latest-output states.
  - Keep rendering functions testable outside Zebar.
- Acceptance:
  - Widget rendering tests pass.
  - Fixture HTML renders the complete PRD popup surface.
  - Exact container names are displayed without prettifying.
  - Evidence: 2026-06-01 `npm test` passed; localhost smoke loaded the widget fixture, rendered running containers before stopped containers, and preserved exact container names.

### T007 - Popup Refresh And Stale Data Behavior

- Status: `Done`
- Kind: implementation
- Blocked by: T005 and T006
- Vertical outcome: The popup loads data through the helper adapter, refreshes while open, keeps last good data on refresh failure, and refreshes immediately after an action completes.
- PRD coverage: Popup refresh every 5 seconds while open, refresh after lifecycle action, failure warning without clearing last successful data, exact helper errors.
- Red tests:
  - A mocked helper success renders the returned data.
  - A mocked helper failure keeps previously rendered successful data and adds a visible warning.
  - Invalid helper JSON renders a structured error state without crashing.
  - The popup schedules a 5-second refresh interval while initialized.
  - An action completion triggers an immediate refresh.
- Implementation:
  - Add a thin Zebar shell adapter around the helper command.
  - Add refresh state management with last-successful data.
  - Keep fixture loading available for local browser tests.
- Acceptance:
  - Refresh behavior tests pass.
  - Refresh failures show failing operation, exact command/helper operation, exit code when available, and stderr/error text.
  - Last successful data remains visible after a failed refresh.
  - Evidence: 2026-06-01 `npm test` passed; tests cover helper adapter JSON parsing, structured shell failure command/exit-code rendering, invalid JSON, 5-second scheduling, last-successful-data retention, and immediate refresh after action completion.

### T008 - Open And Confirmation UX

- Status: `Done`
- Kind: implementation
- Blocked by: T005 and T006
- Vertical outcome: The popup launches BC web clients with exact container names and uses inline two-step confirmation for restart, stop, and remove.
- PRD coverage: `http://<containername>/bc`, disabled `Open` for stopped containers, inline confirmation, no modal dialogs, confirmation expiry and cancellation.
- Red tests:
  - `Open` launches `http://<exact-container-name>/bc` for a running container.
  - `Open` is disabled for stopped containers.
  - Running containers remain openable when health is `starting` or `unhealthy`.
  - First `Restart`, `Stop`, or `Remove` click arms the action and changes the label to `Confirm restart`, `Confirm stop`, or `Confirm remove`.
  - Second click executes the armed action.
  - Confirmation cancels after 8 seconds.
  - Selecting another action cancels the previous confirmation.
  - A refresh that makes the action invalid cancels the confirmation.
  - No modal dialog API is called.
- Implementation:
  - Add browser-launch adapter for `Open`.
  - Add confirmation state scoped to the popup session.
  - Wire confirmation to the action helper adapter only on the second click.
- Acceptance:
  - Confirmation and open tests pass.
  - Exact container names are used for URLs and action targets.
  - No modal confirmation behavior is introduced.
  - Evidence: 2026-06-01 `npm test` passed; localhost smoke changed `Restart` to `Confirm restart` inline with no modal and exact row order intact.

### T009 - Single Action State And Latest Output

- Status: `Done`
- Kind: implementation
- Blocked by: T005, T007, and T008
- Vertical outcome: Only one lifecycle action can run at a time, active command state is visible, and the popup exposes the latest action output.
- PRD coverage: One lifecycle action at a time, lifecycle buttons disabled while running, `Open` stays available for running rows, active command/target display, latest command output drawer.
- Red tests:
  - Starting an action disables all lifecycle buttons.
  - `Open` remains available for running rows while an action is active.
  - Starting a second lifecycle action while one is active is rejected or ignored without invoking the helper.
  - Active command and target container are visible during action execution.
  - Action success replaces the latest output drawer data.
  - Action failure replaces the latest output drawer data and shows exact stderr/error text.
- Implementation:
  - Add popup-level action state.
  - Wire lifecycle buttons through the single-action guard.
  - Store only the latest action output in memory.
- Acceptance:
  - Single-action tests pass.
  - The output drawer resets only when Zebar reloads or the popup session restarts.
  - The widget never starts multiple lifecycle actions concurrently from one popup session.
  - Evidence: 2026-06-01 `npm test` passed; tests cover disabled lifecycle buttons, open staying available, ignored concurrent action, active command display, shell action failure command/exit-code rendering, and latest success/failure output replacement.

## Phase 3: Packaging And Topbar Integration

### T010 - Topbar Summary Integration

- Status: `Done`
- Kind: implementation
- Blocked by: T002 and T011
- Vertical outcome: The existing Operator Dark topbar can show the compact BC container summary and open the popup with narrow local changes.
- PRD coverage: Topbar summary count, aggregate CPU/RAM, `BC !` error state, 10-second refresh, popup trigger from `operator-dark-bar`.
- Red tests:
  - Fixture topbar renders `BC 0` for zero BC containers.
  - Fixture topbar renders count plus aggregate CPU/RAM for successful refresh data.
  - Fixture topbar renders `BC !` when the latest refresh failed.
  - Topbar refresh is scheduled every 10 seconds.
  - Trigger handler calls Zebar's widget/preset start API for `operator-dark-bc-containers`.
  - Existing unrelated bar markup and styling are preserved by install/patch logic.
- Implementation:
  - Add or patch only the right-side topbar trigger/summary area.
  - Reuse the helper refresh adapter for summary data.
  - Keep summary formatting compact: examples include `BC 2 CPU 18% RAM 5.4G`, `BC 0`, and `BC !`.
- Acceptance:
  - Topbar fixture tests pass.
  - Bar changes are narrow and local to the BC trigger/summary integration.
  - The topbar does not expose generic Docker controls.
  - Evidence: 2026-06-01 `npm test` passed; topbar summary tests cover `BC 0`, compact CPU/RAM, `BC !`, 10-second refresh scheduling, and popup launch via `zebar.startWidgetPreset('bc-containers', 'popup', { packId: 'operator-dark-bc-containers' })`.

### T011 - Zebar Pack Contract

- Status: `Done`
- Kind: implementation
- Blocked by: T002 and T006
- Vertical outcome: The repo contains an installable `operator-dark-bc-containers` Zebar pack with the expected files and narrowly scoped shell helper privilege.
- PRD coverage: Installed pack shape, popup widget files, helper scripts, shell entrypoint, source repo owns implementation.
- Red tests:
  - Static pack validator fails until `zpack.json` exists for `operator-dark-bc-containers`.
  - Validator requires `app.browser.js`, `index.html`, `style.css`, `zpack.json`, `scripts/bc-containers.ps1`, and `scripts/run-bc-containers-helper.cmd` in the installed shape.
  - Validator requires shell privilege limited to the helper command path shape.
  - Validator rejects unexpected generic Docker management privileges or unrelated files.
- Implementation:
  - Add `pack/operator-dark-bc-containers/zpack.json`.
  - Define the popup widget/preset and include files needed at runtime.
  - Configure shell privilege for `cmd.exe /c ...operator-dark-bc-containers...run-bc-containers-helper.cmd`.
  - Include `app.js` and `fixture-data.browser.js` because the buildless widget index loads them at runtime.
- Acceptance:
  - Pack contract tests pass.
  - Pack can be copied to `.glzr\zebar\operator-dark-bc-containers`.
  - The pack remains buildless and source-controlled outside the live `.glzr` install.
  - Evidence: 2026-06-01 `npm test` passed; pack tests validate the popup preset, runtime include files, helper scripts, narrow helper shell privilege, and rejection of Docker/PowerShell broad shell command shapes plus command chaining.

### T012 - Idempotent Install Script

- Status: `Done`
- Kind: implementation
- Blocked by: T010 and T011
- Vertical outcome: A PowerShell install/update script copies the BC containers pack into a fixture `.glzr` tree and applies or verifies the topbar integration without broad rewrites.
- PRD coverage: Expected installed shape, source repo separate from live install, topbar trigger integration, narrow bar changes, copy verification.
- Red tests:
  - Fixture install copies only the expected `operator-dark-bc-containers` files.
  - Running install twice produces no duplicate pack files or duplicate topbar trigger entries.
  - Missing `operator-dark-bar` reports a clear actionable error and does not copy partial files.
  - Existing unrelated bar config content is preserved.
  - Install check mode verifies source inputs and target bar files without writing.
- Implementation:
  - Add `scripts/install-bc-containers.ps1` with `-SourceRoot`, `-TargetRoot`, `-BarPackName`, and `-Check`.
  - Copy widget and script files into `.glzr\zebar\operator-dark-bc-containers`.
  - Patch or validate only the BC summary/trigger area in `operator-dark-bar`.
  - Verify resolved target paths remain under the target root before writing.
- Acceptance:
  - Install fixture tests pass twice in a row.
  - The source files copy into `.glzr\zebar\operator-dark-bc-containers` in fixture mode.
  - No unrelated `.glzr` or bar formatting is rewritten.
  - Evidence: 2026-06-01 `npm test` passed; fixture install copied only the expected pack files, ran idempotently, preserved existing Keydeck and CPU/RAM bar markup, patched bar CSS/zpack narrowly, and `-Check` verified inputs without writes.

## Phase 4: Runtime Verification And V1 Closeout

### T013 - Live Helper Smoke

- Status: `Done`
- Kind: verification
- Blocked by: T002, T003, T004, and T005
- Vertical outcome: The helper is proven against the real host tooling or the exact host blocker is documented.
- PRD coverage: Real BCContainerHelper discovery, real Docker status/stats, hidden lifecycle helper path, exact failure surfacing.
- Verification steps:
  - Run the refresh helper directly from the repo and confirm stdout parses as JSON.
  - Confirm refresh uses BCContainerHelper for identity before Docker status/stats.
  - Confirm running local BC containers, if present, show real Docker CPU/RAM values.
  - Confirm stopped local BC containers, if present, show no fake CPU/RAM usage.
  - Force or observe a BCContainerHelper/Docker failure and record the exact structured error.
  - Run a non-destructive lifecycle action only when an appropriate disposable BC container exists; otherwise document why lifecycle execution was not attempted.
  - Confirm hidden execution behavior through the same command path Zebar will use, or document the observed blocker.
- Definition of Done:
  - A dated runtime evidence note is recorded in this file or a linked verification artifact.
  - The exact helper command, JSON parse result, and any failure text are recorded.
  - Any skipped lifecycle action names the risk and the missing safe target.
  - Evidence: 2026-06-01 live helper smoke passed after switching the wrapper to PowerShell Core (`pwsh.exe`) and suppressing BcContainerHelper import noise so stdout starts with `{`.
  - Evidence: `cmd.exe /d /c scripts\run-bc-containers-helper.cmd -Operation refresh` parsed as JSON with `ok=true`, `total=2`, `running=2`, containers `234-rules-within-rules` and `233-configuration-attribute-copilot`, and real Docker memory values.
  - Evidence: controlled Docker failure using a mocked `docker` function plus live BCContainerHelper identity returned JSON with `ok=false`, `operation=docker inspect`, `exitCode=42`, and stderr `controlled docker failure`.
  - Evidence: with user-approved target `233-configuration-attribute-copilot`, `cmd.exe /d /c scripts\run-bc-containers-helper.cmd -Operation action -Action restart -ContainerName 233-configuration-attribute-copilot` parsed as JSON with `ok=true`, `exitCode=0`, stdout containing `Ready for connections!`, and empty stderr.
  - Evidence: post-action refresh at 2026-06-01T18:00:40+02:00 parsed as JSON with target state `running`, health `healthy`, status `running`, and memory bytes `3300682367`.
  - Note: no stopped BC containers were present on the host during smoke, so stopped-container no-fake-usage remains covered by fixture tests from T004.
  - Note: hidden execution was exercised through the same wrapper path used by Zebar; visual no-window behavior remains part of installed Zebar runtime smoke in T014.

### T014 - Installed Zebar Runtime Smoke

- Status: `Ready`
- Kind: verification
- Blocked by: T006, T007, T008, T009, T010, T011, and T012
- Vertical outcome: The installed widget opens from the real Operator Dark topbar and either passes the runtime checklist or documents exact Zebar/runtime limitations.
- PRD coverage: Live topbar trigger, popup rendering, refresh cadence, web client launch, confirmations, output drawer, error state, install shape.
- Verification steps:
  - Run the install/update script against the live `.glzr` tree.
  - Verify source files copied into `.glzr\zebar\operator-dark-bc-containers`.
  - Restart or reload Zebar as needed.
  - Confirm the topbar shows a BC summary or `BC !`.
  - Click the BC summary/trigger in `operator-dark-bar` and confirm the popup opens.
  - Confirm running containers appear before stopped containers.
  - Confirm `Open` launches the default browser to `http://<exact-container-name>/bc` for a running container.
  - Confirm `Open` is disabled for stopped containers.
  - Confirm restart, stop, and remove use inline confirmation and no modal dialog.
  - Confirm only one lifecycle action can run at a time.
  - Confirm the latest output drawer updates after an action or controlled failure.
  - Confirm the popup warning state preserves last successful data after a controlled refresh failure.
  - Confirm topbar `BC !` behavior through an observed or controlled helper failure.
- Definition of Done:
  - Runtime checklist evidence is recorded with date, host path, and observed results.
  - Any Zebar API limitation is specific, reproducible, and tied to observed behavior.
  - No unrelated live `.glzr` changes are left unexplained.
  - Note: 2026-06-01 first live install attempt was rolled back because the popup preset was full-screen and the popup had no close control; the live `.glzr` tree was restored before continuing.
  - Evidence: 2026-06-01 repo fix changed the popup preset to a bounded `980px` by `640px` window, added a close button available before helper refresh completes, added Escape close cleanup, and kept live reinstall/restart pending user approval.

### T015 - V1 Closeout Gate

- Status: `Blocked`
- Kind: verification
- Blocked by: T013 and T014
- Vertical outcome: V1 has a repeatable local gate, current runtime evidence, and task statuses that match reality.
- PRD coverage: Acceptance criteria, non-goals, helper tests, runtime verification, install verification.
- Verification steps:
  - Run the full automated test suite.
  - Run install/update script in fixture mode.
  - Run `git diff --check`.
  - Read back T013 and T014 runtime evidence.
  - Compare implemented behavior against `docs/prd.md`.
  - Confirm non-goals remain out of scope: no generic Docker cleanup, image removal, volume removal, host folder removal, container creation, or embedded BC web client.
  - Update task statuses to reflect completed and deferred work.
- Definition of Done:
  - Automated gate passes.
  - Fixture install passes.
  - Runtime evidence is current.
  - `docs/tasks.md` statuses are accurate.
  - Residual risks or deferred work are explicitly recorded.

## Deferred Beyond V1

- Creating BC containers.
- Generic Docker container management.
- Docker image, volume, host folder, or artifact cleanup.
- Embedded BC web client inside Zebar.
- Persisted command logs beyond the active Zebar session.
- Multiple concurrent lifecycle actions.
- Full Docker Desktop replacement behavior.
- Optional quick filter for many BC containers.
- Optional stale-age indicator for last successful refresh.
- Optional copy buttons for container name or web client URL.
- Optional link to container event logs through BCContainerHelper.
- Optional aggregate RAM threshold warning.
