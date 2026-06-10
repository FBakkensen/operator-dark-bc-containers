param(
  [string] $SourceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path,
  [string] $TargetRoot = (Join-Path $HOME ".glzr\zebar"),
  [string] $BarPackName = "operator-dark-bar",
  [switch] $Check
)

$ErrorActionPreference = "Stop"

function Resolve-ExistingPath([string] $Path, [string] $Label) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label does not exist: $Path"
  }

  return (Resolve-Path -LiteralPath $Path).Path
}

function Assert-UnderRoot([string] $Path, [string] $Root) {
  $resolvedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $rootPrefix = "$resolvedRoot$([System.IO.Path]::DirectorySeparatorChar)"

  if ($resolvedPath -ne $resolvedRoot -and -not $resolvedPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside target root: $resolvedPath"
  }
}

function Set-TextUtf8NoBom([string] $Path, [string] $Value) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Get-RequiredSourceFiles([string] $SourceRoot) {
  return @(
    "pack\operator-dark-bc-containers\zpack.json",
    "src\widget\index.html",
    "src\widget\style.css",
    "src\widget\fixture-data.browser.js",
    "src\widget\app.js",
    "src\widget\app.browser.js",
    "scripts\bc-containers.ps1",
    "scripts\run-bc-containers-helper.cmd"
  ) | ForEach-Object { Join-Path $SourceRoot $_ }
}

function Assert-SourceInputs([string] $SourceRoot) {
  foreach ($file in Get-RequiredSourceFiles $SourceRoot) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "Required source file is missing: $file"
    }
  }
}

function Copy-BcContainersPack([string] $SourceRoot, [string] $TargetRoot) {
  $targetPackRoot = Join-Path $TargetRoot "operator-dark-bc-containers"
  $targetScriptsRoot = Join-Path $targetPackRoot "scripts"
  Assert-UnderRoot $targetPackRoot $TargetRoot
  Assert-UnderRoot $targetScriptsRoot $TargetRoot

  New-Item -ItemType Directory -Force -Path $targetPackRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $targetScriptsRoot | Out-Null

  $copies = @(
    @{ From = Join-Path $SourceRoot "pack\operator-dark-bc-containers\zpack.json"; To = Join-Path $targetPackRoot "zpack.json" },
    @{ From = Join-Path $SourceRoot "src\widget\index.html"; To = Join-Path $targetPackRoot "index.html" },
    @{ From = Join-Path $SourceRoot "src\widget\style.css"; To = Join-Path $targetPackRoot "style.css" },
    @{ From = Join-Path $SourceRoot "src\widget\fixture-data.browser.js"; To = Join-Path $targetPackRoot "fixture-data.browser.js" },
    @{ From = Join-Path $SourceRoot "src\widget\app.js"; To = Join-Path $targetPackRoot "app.js" },
    @{ From = Join-Path $SourceRoot "src\widget\app.browser.js"; To = Join-Path $targetPackRoot "app.browser.js" },
    @{ From = Join-Path $SourceRoot "scripts\bc-containers.ps1"; To = Join-Path $targetScriptsRoot "bc-containers.ps1" },
    @{ From = Join-Path $SourceRoot "scripts\run-bc-containers-helper.cmd"; To = Join-Path $targetScriptsRoot "run-bc-containers-helper.cmd" }
  )

  foreach ($copy in $copies) {
    Assert-UnderRoot $copy.To $TargetRoot
    Copy-Item -LiteralPath $copy.From -Destination $copy.To -Force
  }
}

function Get-BcContainersTopbarScript() {
  $template = @'

      // BEGIN operator-dark-bc-containers
      // Resolve the helper at runtime from the bar pack location instead of baking in an
      // absolute path. The bar and the BC containers pack are always installed as siblings
      // under the zebar root, so the install survives being moved between users or machines.
      function bcContainersToLocalPath(value) {
        if (!value) return null;
        const text = String(value);
        if (text.startsWith('file://')) {
          try {
            const url = new URL(text);
            return decodeURIComponent(url.pathname).replace(/^\/([a-zA-Z]:)/u, '$1');
          } catch {
            return null;
          }
        }
        if (/^[a-zA-Z]:[\\/]/u.test(text) || /^\\\\/u.test(text)) return text;
        return null;
      }

      function bcContainersPackRoot(value) {
        const localPath = bcContainersToLocalPath(value);
        if (!localPath) return null;
        const normalized = localPath.replace(/\//g, '\\').replace(/\\+$/u, '');
        if (/\\zpack\.json$/iu.test(normalized) || /\\[^\\]+\.html$/iu.test(normalized)) {
          return normalized.replace(/\\[^\\]+$/u, '');
        }
        return normalized;
      }

      function bcContainersCurrentWidget() {
        try {
          return typeof zebar?.currentWidget === 'function' ? zebar.currentWidget() : zebar?.currentWidget;
        } catch {
          return null;
        }
      }

      function bcContainersHelperCommand() {
        const widget = bcContainersCurrentWidget();
        const barRoot = bcContainersPackRoot(widget?.configPath)
          ?? bcContainersPackRoot(widget?.htmlPath)
          ?? bcContainersPackRoot(window.location?.href);
        const helperTail = 'operator-dark-bc-containers\\scripts\\run-bc-containers-helper.cmd';
        if (barRoot) {
          const zebarRoot = barRoot.replace(/\\[^\\]+$/u, '');
          return { program: 'cmd.exe', args: ['/d', '/c', `${zebarRoot}\\${helperTail}`] };
        }
        return { program: 'cmd.exe', args: ['/d', '/c', `..\\${helperTail}`] };
      }

      // CPU "hot" watchdog. Thresholds are defined in cores and converted to a percentage against the
      // real host core count at runtime, so a runaway trips regardless of how many cores the box has.
      const bcContainersRefreshIntervalMs = 10000;
      const BC_CONTAINERS_HOT_CORES = 4;
      const BC_CONTAINERS_AGGREGATE_HOT_FRACTION = 0.6;
      const BC_CONTAINERS_HOT_SUSTAIN_MS = 60000;
      const bcContainersCpuHistory = new Map();
      const bcContainersAggregateHistory = [];

      const bcContainersSummaryDefault = {
        label: 'BC ...',
        level: 'normal',
        title: 'BC containers refreshing',
        hot: false,
      };

      function BcContainersSummary({ summary, onOpen }) {
        const state = summary ?? bcContainersSummaryDefault;
        return (
          <button
            className={`bc-containers-trigger bc-containers-${state.level}${state.hot ? ' bc-containers-hot' : ''}`}
            title={state.title}
            onClick={onOpen}
          >
            {state.label}
          </button>
        );
      }
      BcContainersSummary.displayName = 'BC containers summary';

      async function openBcContainers() {
        try {
          await zebar.startWidgetPreset('bc-containers', 'popup', { packId: 'operator-dark-bc-containers' });
        } catch (error) {
          console.error('Unable to open BC containers', error);
        }
      }

      async function loadBcContainersSummary() {
        try {
          const shellExec = getBcContainersShellExec();
          if (!shellExec) {
            throw new Error('Zebar shell execution API is unavailable.');
          }

          const command = bcContainersHelperCommand();
          const result = await shellExec(command.program, [
            ...command.args,
            '-Operation',
            'refresh',
          ]);
          const stdout = typeof result === 'string' ? result : result?.stdout ?? '';
          const stderr = typeof result === 'string' ? '' : result?.stderr ?? '';
          const exitCode = typeof result === 'string' ? 0 : result?.exitCode ?? result?.code ?? 0;

          if (exitCode !== 0) {
            throw new Error(firstBcContainersLine(stderr) || `BC containers helper exited with code ${exitCode}`);
          }

          const model = JSON.parse(stdout);
          return applyBcContainersHotFlag(formatBcContainersSummary(model), model);
        } catch (error) {
          bcContainersCpuHistory.clear();
          bcContainersAggregateHistory.length = 0;
          return {
            label: 'BC !',
            level: 'error',
            title: error?.message ?? String(error),
            hot: false,
          };
        }
      }

      function getBcContainersShellExec() {
        if (typeof zebar?.shellExec === 'function') {
          return zebar.shellExec;
        }

        if (typeof zebar?.shell?.exec === 'function') {
          return zebar.shell.exec.bind(zebar.shell);
        }

        return null;
      }

      function formatBcContainersSummary(model) {
        if (!model || model.ok === false || model.error) {
          return {
            label: 'BC !',
            level: 'error',
            title: formatBcContainersErrorTitle(model?.error),
          };
        }

        const total = Number(model.summary?.total ?? 0);
        const running = Number(model.summary?.running ?? 0);
        if (total <= 0) {
          return {
            label: 'BC 0',
            level: 'normal',
            title: 'No BC containers found',
          };
        }

        return {
          label: `BC ${total} CPU ${formatBcContainersCpu(model.summary?.cpuPercent)} RAM ${formatBcContainersMemory(model.summary?.memoryBytes)}`,
          level: 'normal',
          title: `${running} running of ${total} BC containers`,
        };
      }

      function formatBcContainersCpu(value) {
        const number = Number(value);
        return Number.isFinite(number) ? `${Math.round(number)}%` : '0%';
      }

      function formatBcContainersMemory(value) {
        const bytes = Number(value);
        if (!Number.isFinite(bytes) || bytes <= 0) return '0M';
        const gib = bytes / 1073741824;
        if (gib >= 1) return `${formatBcContainersNumber(gib, 1)}G`;
        return `${formatBcContainersNumber(bytes / 1048576, 0)}M`;
      }

      function formatBcContainersNumber(value, digits) {
        return value.toFixed(digits).replace(/\.0$/, '');
      }

      function formatBcContainersErrorTitle(error) {
        if (!error) return 'BC container refresh failed';
        const operation = error.operation ?? 'refresh';
        const stderr = firstBcContainersLine(error.stderr);
        return stderr ? `${operation}: ${stderr}` : `${operation} failed`;
      }

      function firstBcContainersLine(value) {
        return String(value ?? '').split(/\r?\n/).find(line => line.trim())?.trim() ?? '';
      }

      function bcContainersHotPercentForCores(cores, coreCount) {
        const denominator = Number(coreCount) > 0 ? Number(coreCount) : 1;
        return (Number(cores) / denominator) * 100;
      }

      function bcContainersResolveCoreCount(model) {
        return Number(model?.summary?.hostCpuCount)
          || Number(globalThis.navigator?.hardwareConcurrency)
          || 1;
      }

      function bcContainersSamplesForDuration(durationMs, intervalMs) {
        return Math.max(1, Math.ceil(Number(durationMs) / Math.max(1, Number(intervalMs))));
      }

      function bcContainersCountSustained(history, thresholdPercent) {
        if (!Array.isArray(history)) return 0;
        let sustained = 0;
        for (let index = history.length - 1; index >= 0; index -= 1) {
          const number = Number(history[index]);
          if (Number.isFinite(number) && number >= thresholdPercent) sustained += 1;
          else break;
        }
        return sustained;
      }

      function bcContainersPushBounded(history, value, max) {
        history.push(Number(value) || 0);
        while (history.length > Math.max(1, max)) history.shift();
        return history;
      }

      // Flag hot when the aggregate OR any single container has stayed elevated for the sustain window.
      // Needs the raw model (with containers[]), tracked across refreshes in the module-level history.
      function applyBcContainersHotFlag(summary, model) {
        if (!summary || summary.level !== 'normal' || !model || model.ok === false || model.error) {
          bcContainersCpuHistory.clear();
          bcContainersAggregateHistory.length = 0;
          return { ...summary, hot: false };
        }

        const containers = Array.isArray(model.containers) ? model.containers : [];
        const coreCount = bcContainersResolveCoreCount(model);
        const containerThreshold = bcContainersHotPercentForCores(BC_CONTAINERS_HOT_CORES, coreCount);
        const aggregateThreshold = BC_CONTAINERS_AGGREGATE_HOT_FRACTION * 100;
        const sustainSamples = bcContainersSamplesForDuration(BC_CONTAINERS_HOT_SUSTAIN_MS, bcContainersRefreshIntervalMs);

        const running = new Set();
        for (const container of containers) {
          if (container.state !== 'running') continue;
          running.add(container.name);
          if (!bcContainersCpuHistory.has(container.name)) bcContainersCpuHistory.set(container.name, []);
          bcContainersPushBounded(bcContainersCpuHistory.get(container.name), container.cpuPercent, sustainSamples);
        }
        for (const name of [...bcContainersCpuHistory.keys()]) {
          if (!running.has(name)) bcContainersCpuHistory.delete(name);
        }
        bcContainersPushBounded(bcContainersAggregateHistory, model.summary?.cpuPercent, sustainSamples);

        const aggregateHot = bcContainersCountSustained(bcContainersAggregateHistory, aggregateThreshold) >= sustainSamples;

        let hottest = null;
        for (const container of containers) {
          if (container.state !== 'running') continue;
          const history = bcContainersCpuHistory.get(container.name) ?? [];
          if (bcContainersCountSustained(history, containerThreshold) >= sustainSamples) {
            if (!hottest || Number(container.cpuPercent) > Number(hottest.cpuPercent)) hottest = container;
          }
        }

        if (!aggregateHot && !hottest) return { ...summary, hot: false };

        const title = hottest
          ? `High CPU - ${hottest.name} - ${summary.title}`
          : `High CPU - ${summary.title}`;
        return { ...summary, hot: true, title };
      }
      // END operator-dark-bc-containers
'@

  return $template
}

function Ensure-BarHtml([string] $HtmlPath) {
  $html = Get-Content -LiteralPath $HtmlPath -Raw
  $changed = $false

  # Strip any prior injected block - the sentinel-wrapped current form or the legacy
  # sentinel-less one - so a moved or out-of-date install heals on every reinstall. The
  # block always sits directly before function App(); remove from its start up to that
  # anchor, then reinsert fresh below.
  $blockStart = '(?:// BEGIN operator-dark-bc-containers|const operatorDarkBcContainersHelperCommand)'
  if ($html -match $blockStart) {
    $removePattern = "(?s)\s*$blockStart.*?(?=\r?\n\s*function App\(\))"
    $stripped = [regex]::Replace($html, $removePattern, '', 1)
    if ($stripped -ne $html) {
      $html = $stripped
      $changed = $true
    }
  }

  if ($html -notmatch "function BcContainersSummary\(") {
    $script = Get-BcContainersTopbarScript
    if ($html.Contains("      function App()")) {
      $html = $html.Replace("      function App()", "$script`n      function App()")
    } elseif ($html.Contains("  function App()")) {
      $html = $html.Replace("  function App()", "$script`n  function App()")
    } else {
      throw "Unable to patch $HtmlPath because function App() was not found."
    }
    $changed = $true
  }

  if ($html -notmatch "const \[bcContainersSummary, setBcContainersSummary\]") {
    $statePattern = "const \[output, setOutput\] = useState\(providers\.outputMap\);"
    $stateMatch = [regex]::Match($html, $statePattern)
    if (-not $stateMatch.Success) {
      throw "Unable to patch $HtmlPath because the topbar output state was not found."
    }
    $insert = "$($stateMatch.Value)`n        const [bcContainersSummary, setBcContainersSummary] = useState(bcContainersSummaryDefault);"
    $html = $html.Remove($stateMatch.Index, $stateMatch.Length).Insert($stateMatch.Index, $insert)
    $changed = $true
  }

  if ($html -notmatch "setInterval\(refreshBcContainersSummary, 10000\)") {
    $effectPattern = "(?ms)^(\s*)useEffect\(\(\) => \{\r?\n\s*providers\.onOutput\(\(\) => setOutput\(\{ \.\.\.providers\.outputMap \}\)\);\r?\n\s*\}, \[\]\);"
    $effectMatch = [regex]::Match($html, $effectPattern)
    if (-not $effectMatch.Success) {
      throw "Unable to patch $HtmlPath because the provider refresh effect was not found."
    }

    $indent = $effectMatch.Groups[1].Value
    $effect = @"
$($effectMatch.Value)

$($indent)useEffect(() => {
$($indent)  let disposed = false;
$($indent)  async function refreshBcContainersSummary() {
$($indent)    const nextSummary = await loadBcContainersSummary();
$($indent)    if (!disposed) setBcContainersSummary(nextSummary);
$($indent)  }
$($indent)  refreshBcContainersSummary();
$($indent)  const timer = setInterval(refreshBcContainersSummary, 10000);
$($indent)  return () => {
$($indent)    disposed = true;
$($indent)    clearInterval(timer);
$($indent)  };
$($indent)}, []);
"@
    $html = $html.Remove($effectMatch.Index, $effectMatch.Length).Insert($effectMatch.Index, $effect)
    $changed = $true
  }

  if ($html -notmatch "<BcContainersSummary") {
    $html = [regex]::Replace(
      $html,
      '(<section\s+className="right">)',
      "`$1`n              <BcContainersSummary summary={bcContainersSummary} onOpen={openBcContainers} />",
      1
    )
    $changed = $true
  }

  if ($changed) {
    Set-TextUtf8NoBom $HtmlPath $html
  }
}

function Ensure-BarCss([string] $CssPath) {
  $css = Get-Content -LiteralPath $CssPath -Raw

  # Strip any prior injected block - the sentinel-wrapped current form or the legacy
  # sentinel-less trigger rules - so every reinstall carries the latest trigger CSS.
  $stripped = [regex]::Replace($css, '(?s)\s*/\* BEGIN operator-dark-bc-containers \*/.*?/\* END operator-dark-bc-containers \*/', '')
  $stripped = [regex]::Replace($stripped, '(?s)\s*\.bc-containers-trigger[^{}]*\{[^{}]*\}', '')

  $triggerCss = @"

/* BEGIN operator-dark-bc-containers */
.bc-containers-trigger {
  height: 22px;
  padding: 0 7px;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid #6cc9c740;
  border-radius: 3px;
  /* The trigger is the only wrappable item in the bar's right flex section, so it absorbs
     all compression and the fixed height clips the wrapped line. Never shrink or wrap. */
  white-space: nowrap;
  flex-shrink: 0;
}

.bc-containers-trigger:hover {
  color: var(--fg-bright);
  border-color: var(--accent);
}

.bc-containers-trigger.bc-containers-error {
  color: var(--error);
  background: #e89a951a;
  border-color: #e89a9566;
}

.bc-containers-trigger.bc-containers-error:hover {
  color: var(--fg-bright);
  border-color: var(--error);
}

.bc-containers-trigger.bc-containers-hot {
  color: #f0b35a;
  background: #f0b35a1a;
  border-color: #f0b35a66;
}

.bc-containers-trigger.bc-containers-hot:hover {
  color: var(--fg-bright);
  border-color: #f0b35a;
}
/* END operator-dark-bc-containers */
"@

  $next = "$($stripped.TrimEnd())`n$triggerCss"
  if ($next -ne $css) {
    Set-TextUtf8NoBom $CssPath $next
  }
}

function Ensure-BarZpack([string] $ZpackPath) {
  # Match backslash only (not a [\\/] class): Ensure-BarZpack replaces "shellCommands": [ ... ]
  # non-greedily, so a ']' inside this value would truncate the JSON on the next reinstall.
  $argsRegex = '^/d /c .*operator-dark-bc-containers\\scripts\\run-bc-containers-helper\.cmd -Operation refresh$'
  $jsonArgsRegex = $argsRegex | ConvertTo-Json -Compress
  $shellCommandJson = @(
    '"shellCommands": [',
    '          {',
    '            "program": "cmd.exe",',
    "            `"argsRegex`": $jsonArgsRegex",
    '          }',
    '        ]'
  ) -join "`n"
  $zpack = Get-Content -LiteralPath $ZpackPath -Raw
  $changed = $false

  if ($zpack -match '"defaultDuration":\s*(?!0\b)\d+') {
    $zpack = [regex]::Replace($zpack, '"defaultDuration":\s*\d+', '"defaultDuration": 0', 1)
    $changed = $true
  }

  if ($zpack -match 'operator-dark-bc-containers') {
    if ($zpack -notmatch [regex]::Escape($argsRegex)) {
      $zpack = [regex]::Replace(
        $zpack,
        '"shellCommands":\s*\[[\s\S]*?\]',
        $shellCommandJson,
        1
      )
      $changed = $true
    }
  } elseif ($zpack -match '"shellCommands":\s*\[\s*\]') {
    $zpack = [regex]::Replace(
      $zpack,
      '"shellCommands":\s*\[\s*\]',
      $shellCommandJson,
      1
    )
    $changed = $true
  } else {
    throw "Unable to patch $ZpackPath because privileges.shellCommands was not found."
  }

  if ($changed) {
    Set-TextUtf8NoBom $ZpackPath $zpack
  }
}

$SourceRoot = Resolve-ExistingPath $SourceRoot "Source root"
$TargetRoot = [System.IO.Path]::GetFullPath($TargetRoot)
$barRoot = Join-Path $TargetRoot $BarPackName
$barHtml = Join-Path $barRoot "index.html"
$barCss = Join-Path $barRoot "styles.css"
$barZpack = Join-Path $barRoot "zpack.json"

Assert-SourceInputs $SourceRoot

if (-not (Test-Path -LiteralPath $barHtml) -or -not (Test-Path -LiteralPath $barCss) -or -not (Test-Path -LiteralPath $barZpack)) {
  throw "Expected $BarPackName with index.html, styles.css, and zpack.json under $TargetRoot"
}

if ($Check) {
  Write-Output "OK: found $BarPackName and BC containers source inputs."
  exit 0
}

Assert-UnderRoot $barRoot $TargetRoot
Assert-UnderRoot $barHtml $TargetRoot
Assert-UnderRoot $barCss $TargetRoot
Assert-UnderRoot $barZpack $TargetRoot

New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
Copy-BcContainersPack $SourceRoot $TargetRoot

Ensure-BarHtml $barHtml
Ensure-BarCss $barCss
Ensure-BarZpack $barZpack

Write-Output "Installed operator-dark-bc-containers and checked $BarPackName integration."
