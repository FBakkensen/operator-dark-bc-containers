# Repo Instructions

This repo contains the source for the Operator Dark BC Containers Zebar widget.

Read `docs/prd.md` before changing behavior. The PRD is the product contract.

## Product Boundaries

- This is a Business Central container widget, not a generic Docker UI.
- BCContainerHelper owns BC container identity and lifecycle actions.
- Docker is used only for runtime status and resource stats after BC container identity is known.
- Keep lifecycle actions mapped to BCContainerHelper:
  - `Start-BcContainer <container name>`
  - `Stop-BcContainer <container name>`
  - `Restart-BcContainer <container name>`
  - `Remove-BcContainer <container name>`
- Do not add generic Docker cleanup, image removal, volume removal, or container creation unless the PRD changes.
- Container names must stay exact. Do not prettify names used for actions or web client URLs.

## Reference Implementation

There is another local Zebar widget implementation here:

```text
C:\Users\FlemmingBK\repo\operator-dark-keydeck
```

Use it as the nearest implementation reference for:

- Buildless Zebar widget source layout.
- Separate source repo and live `.glzr\zebar` install layout.
- Popup widget launched from `operator-dark-bar`.
- `zpack.json` shape.
- Idempotent PowerShell install script pattern.
- Helper contract tests.
- Bar trigger integration.

Do not copy Keydeck product behavior. It is a shortcut reference overlay. This repo is a BC container monitor and controller.

Useful Keydeck reference paths:

```text
C:\Users\FlemmingBK\repo\operator-dark-keydeck\src\widget
C:\Users\FlemmingBK\repo\operator-dark-keydeck\src\helper
C:\Users\FlemmingBK\repo\operator-dark-keydeck\pack\operator-dark-keydeck\zpack.json
C:\Users\FlemmingBK\repo\operator-dark-keydeck\scripts\install-keydeck.ps1
C:\Users\FlemmingBK\repo\operator-dark-keydeck\tests
```

## Implementation Rules

- Keep Zebar UI code presentation-focused.
- Put PowerShell, BCContainerHelper, and Docker command execution behind a helper script.
- Helper refresh output must be valid JSON on stdout.
- Keep diagnostics and lifecycle command output in structured fields, not mixed into the JSON protocol stream.
- Run lifecycle commands hidden.
- Capture the latest command, exit code, timestamps, stdout, and stderr for the popup output drawer.
- Allow only one lifecycle action at a time.
- Use inline confirmation for `Restart`, `Stop`, and `Remove`; no modal dialogs.
- Keep topbar changes small and local to the existing `operator-dark-bar` integration.

## Verification

- Prefer focused contract tests around helper JSON, command mapping, and widget rendering.
- For install work, verify the source files copy into `.glzr\zebar\operator-dark-bc-containers`.
- Verify `operator-dark-bar` trigger integration without rewriting unrelated bar formatting.
- Before committing, run the repo's tests and `git diff --check` when this repo becomes a git repo.
