# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Buildless Zebar popup widget + topbar button that monitors and controls local **Business Central
containers** on Windows. Not a generic Docker UI. Read `docs/prd.md` (the product contract) before
changing behavior; `AGENTS.md` has the full product boundaries and the `operator-dark-keydeck` layout
reference.

## Commands

- Test: `npm test` (= `node --test tests/*.test.js`). Node `>=22`, npm. No lint/format/build step.
- Helper refresh, direct: `pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/bc-containers.ps1 -Operation refresh`
- Install dry-check: `pwsh -NoProfile -File scripts/install-bc-containers.ps1 -Check`
- Live host checks: `/bc-smoke`. Install to `~/.glzr`: `/install-widget`.

## BCContainerHelper vs Docker boundary

- BCContainerHelper owns container identity + lifecycle: `Start`/`Stop`/`Restart`/`Remove-BcContainer <name>`.
- Docker is queried only for runtime status + stats *after* identity is known.
- Do not add generic Docker cleanup, image/volume removal, or container creation unless the PRD changes.
- Container names stay exact — never prettify names used for actions or web-client URLs.

## Helper protocol

- `scripts/bc-containers.ps1` emits valid JSON on stdout *only*; diagnostics + command output live in
  structured fields / stderr, never mixed into the JSON stream.
- Run lifecycle commands hidden. One lifecycle action at a time. Inline confirmation for
  Restart/Stop/Remove — no modal dialogs.

## Testing

Fixture-based — tests never call live Docker/BCContainerHelper; fixtures under `tests/fixtures/`.
`node:assert/strict`, no external assertion lib. Source is copied as-is (no bundler) into
`~/.glzr/zebar/operator-dark-bc-containers/` by `scripts/install-bc-containers.ps1`, which also patches
the `operator-dark-bar` pack.

## Conventions

Before commit: `npm test` and `git diff --check`. Conventional Commits (`feat:`/`fix:`/`docs:`/`test:`/`chore:`).
