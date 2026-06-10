const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const { fixturePath, repoRoot } = require('./test-utils');

const packRoot = path.join(repoRoot, 'pack', 'operator-dark-bc-containers');
const packZpackPath = path.join(packRoot, 'zpack.json');
const installScriptPath = path.join(repoRoot, 'scripts', 'install-bc-containers.ps1');

test('zebar pack defines the BC containers popup and narrow helper shell privilege', () => {
  const zpack = JSON.parse(fs.readFileSync(packZpackPath, 'utf8'));
  const widget = zpack.widgets.find((candidate) => candidate.name === 'bc-containers');

  assert.equal(zpack.name, 'operator-dark-bc-containers');
  assert.ok(widget, 'missing bc-containers widget');
  assert.equal(widget.htmlPath, './index.html');
  assert.equal(widget.zOrder, 'top_most');
  assert.equal(widget.shownInTaskbar, false);
  assert.equal(widget.focused, true);
  assert.equal(widget.resizable, false);
  assert.equal(widget.transparent, true);
  assert.deepEqual(widget.includeFiles, [
    'index.html',
    'style.css',
    'fixture-data.browser.js',
    'app.js',
    'app.browser.js',
    'scripts/bc-containers.ps1',
    'scripts/run-bc-containers-helper.cmd'
  ]);

  const preset = widget.presets.find((candidate) => candidate.name === 'popup');
  assert.ok(preset, 'missing popup preset');
  assert.equal(preset.anchor, 'top_left');
  assert.equal(preset.offsetX, '0px');
  assert.equal(preset.offsetY, '0px');
  assert.equal(preset.width, '100%');
  assert.equal(preset.height, '100%');
  assert.deepEqual(preset.monitorSelection, { type: 'primary' });
  assert.equal(widget.caching.defaultDuration, 0);

  const shellCommands = widget.privileges.shellCommands;
  assert.equal(shellCommands.length, 1);
  assert.equal(shellCommands[0].program, 'cmd.exe');
  const helperRegex = new RegExp(shellCommands[0].argsRegex);
  assert.equal(helperRegex.test('/d /c scripts\\run-bc-containers-helper.cmd -Operation refresh'), true);
  assert.equal(helperRegex.test('/d /c C:\\Users\\FlemmingBK\\.glzr\\zebar\\operator-dark-bc-containers\\scripts\\run-bc-containers-helper.cmd -Operation action -Action start -ContainerName bc'), true);
  assert.equal(helperRegex.test('/d /c C:\\Users\\FlemmingBK\\.glzr\\zebar\\operator-dark-bc-containers\\scripts\\run-bc-containers-helper.cmd -Operation action -Action restart -ContainerName BC Name.With Spaces-01'), true);
  assert.equal(helperRegex.test('/d /c scripts\\run-bc-containers-helper.cmd -Operation open -Url http://233-configuration-attribute-copilot/bc'), true);
  assert.equal(helperRegex.test('/d /c C:\\Users\\FlemmingBK\\.glzr\\zebar\\operator-dark-bc-containers\\scripts\\run-bc-containers-helper.cmd -Operation open -Url http://bc/bc'), true);
  assert.equal(helperRegex.test('/d /c scripts\\run-bc-containers-helper.cmd -Operation open -Url file:///C:/windows/system32/calc.exe'), false);
  assert.equal(helperRegex.test('/d /c scripts\\run-bc-containers-helper.cmd -Operation open -Url http://bc/bc & docker rm bc'), false);
  assert.equal(helperRegex.test('/d /c docker rm bc'), false);
  assert.equal(helperRegex.test('/d /c powershell.exe -NoProfile'), false);
  assert.equal(helperRegex.test('/d /c scripts\\run-bc-containers-helper.cmd -Operation refresh & docker rm bc'), false);
  assert.equal(helperRegex.test('/d /c scripts\\run-bc-containers-helper.cmd -Operation refresh && powershell.exe -NoProfile'), false);
  assert.equal(helperRegex.test('/d /c scripts\\run-bc-containers-helper.cmd -Operation refresh | powershell.exe -NoProfile'), false);
  assert.equal(helperRegex.test('/d /c scripts\\run-bc-containers-helper.cmd -Operation refresh > out.txt'), false);
  assert.equal(helperRegex.test('/d /c scripts\\run-bc-containers-helper.cmd -Operation action -Action remove -ContainerName bc & docker rm bc'), false);
});

test('pack manifest includes every runtime file referenced by the widget index', () => {
  const zpack = JSON.parse(fs.readFileSync(packZpackPath, 'utf8'));
  const includeFiles = new Set(zpack.widgets[0].includeFiles);
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'src', 'widget', 'index.html'), 'utf8');
  const scriptRefs = [...indexHtml.matchAll(/<script\s+src="([^"]+)"/g)]
    .map((match) => match[1].replace(/^\.\//, ''));
  const styleRefs = [...indexHtml.matchAll(/<link[^>]+href="([^"]+)"/g)]
    .map((match) => match[1].replace(/^\.\//, ''));

  for (const referencedFile of [...scriptRefs, ...styleRefs]) {
    assert.equal(includeFiles.has(referencedFile), true, `${referencedFile} must be included in the pack`);
  }

  assert.equal(includeFiles.has('scripts/bc-containers.ps1'), true);
  assert.equal(includeFiles.has('scripts/run-bc-containers-helper.cmd'), true);
});

test('topbar summary renders compact BC count, resource usage, and error states', () => {
  const {
    formatBcContainersTopbarSummary,
    renderBcContainersTopbarSummary
  } = require('../src/topbar/bc-summary');
  const dom = new JSDOM('<!doctype html><div id="slot"></div>');
  const slot = dom.window.document.querySelector('#slot');
  const opened = [];

  assert.equal(formatBcContainersTopbarSummary(loadWidgetFixture('empty')).label, 'BC 0');
  assert.equal(formatBcContainersTopbarSummary(loadWidgetFixture('mixed')).label, 'BC 3 CPU 18% RAM 3.4G');
  assert.equal(formatBcContainersTopbarSummary(loadWidgetFixture('warning')).label, 'BC !');

  renderBcContainersTopbarSummary(slot, loadWidgetFixture('mixed'), {
    onOpen: () => opened.push('popup')
  });

  const button = slot.querySelector('.bc-containers-trigger');
  assert.equal(button.textContent, 'BC 3 CPU 18% RAM 3.4G');
  assert.match(button.title, /2 running of 3/);
  button.click();
  assert.deepEqual(opened, ['popup']);
});

test('topbar summary controller refreshes every 10 seconds and opens the BC popup preset', async () => {
  const { createBcContainersTopbarController } = require('../src/topbar/bc-summary');
  const dom = new JSDOM('<!doctype html><div id="slot"></div>');
  const slot = dom.window.document.querySelector('#slot');
  const opened = [];
  let scheduledMs = null;
  let scheduledHandler = null;
  let refreshCalls = 0;

  const controller = await createBcContainersTopbarController({
    root: slot,
    dataLoader: async () => {
      refreshCalls += 1;
      return refreshCalls === 1 ? loadWidgetFixture('empty') : loadWidgetFixture('mixed');
    },
    openPopup: async (...args) => opened.push(args),
    setInterval: (handler, ms) => {
      scheduledHandler = handler;
      scheduledMs = ms;
      return 72;
    },
    clearInterval: () => {}
  });

  assert.equal(slot.textContent, 'BC 0');
  assert.equal(scheduledMs, 10000);

  await scheduledHandler();
  assert.equal(slot.textContent, 'BC 3 CPU 18% RAM 3.4G');

  slot.querySelector('button').click();
  assert.deepEqual(opened, [['bc-containers', 'popup', { packId: 'operator-dark-bc-containers' }]]);

  controller.destroy();
});

test('topbar hot trip is core-relative: a 4-core runaway trips on any host, 1 core never does', () => {
  const { applyHotFlag } = require('../src/topbar/bc-summary');
  const intervalMs = 10000; // 60s sustain -> 6 samples

  const feed = (coreCount, cpuPercent, samples) => {
    const state = { cpuHistory: new Map(), aggregateHistory: [] };
    const model = {
      ok: true,
      summary: { total: 1, running: 1, cpuPercent, hostCpuCount: coreCount },
      containers: [{ name: 'runner', state: 'running', cpuPercent }]
    };
    let summary;
    for (let i = 0; i < samples; i += 1) {
      summary = applyHotFlag({ label: 'BC 1', level: 'normal', title: '1 running of 1' }, model, state, intervalMs);
    }
    return summary.hot;
  };

  const coresAsPercent = (cores, coreCount) => (cores / coreCount) * 100;

  // A sustained ~4-core runaway trips regardless of how many cores the host has.
  assert.equal(feed(8, coresAsPercent(4, 8), 6), true);
  assert.equal(feed(64, coresAsPercent(4, 64), 6), true);
  // A single busy core never trips on either host - the threshold is cores, not a fixed %.
  assert.equal(feed(8, coresAsPercent(1, 8), 6), false);
  assert.equal(feed(64, coresAsPercent(1, 64), 6), false);
  // Not hot before the sustain window: a single high sample is ignored.
  assert.equal(feed(8, coresAsPercent(4, 8), 1), false);
});

test('topbar flags a single sustained-hot container while the aggregate stays calm, and names it', () => {
  const { applyHotFlag } = require('../src/topbar/bc-summary');
  const model = loadWidgetFixture('high-cpu'); // hostCpuCount 32, one container 25% (>12.5%), aggregate 26% (<60%)
  const state = { cpuHistory: new Map(), aggregateHistory: [] };

  let summary;
  for (let i = 0; i < 6; i += 1) {
    summary = applyHotFlag({ label: 'BC 2', level: 'normal', title: '2 running of 2' }, model, state, 10000);
  }

  assert.equal(summary.hot, true);
  assert.match(summary.title, /High CPU/);
  assert.match(summary.title, /234-rules-within-rules/);
});

test('topbar flags sustained aggregate load even when no single container is hot', () => {
  const { applyHotFlag } = require('../src/topbar/bc-summary');
  const containers = Array.from({ length: 6 }, (unused, index) => ({
    name: `bc-${index}`,
    state: 'running',
    cpuPercent: 11 // below the 12.5% per-container threshold on a 32-core host
  }));
  const model = {
    ok: true,
    summary: { total: 6, running: 6, cpuPercent: 66, hostCpuCount: 32 }, // 66% >= 60% aggregate threshold
    containers
  };
  const state = { cpuHistory: new Map(), aggregateHistory: [] };

  let summary;
  for (let i = 0; i < 6; i += 1) {
    summary = applyHotFlag({ label: 'BC 6', level: 'normal', title: '6 running of 6' }, model, state, 10000);
  }

  assert.equal(summary.hot, true);
  assert.match(summary.title, /High CPU/);
  assert.doesNotMatch(summary.title, /bc-\d/); // aggregate trip names no single container
});

test('topbar clears hot state on a helper error', () => {
  const { applyHotFlag } = require('../src/topbar/bc-summary');
  const state = { cpuHistory: new Map(), aggregateHistory: [] };
  const errorSummary = applyHotFlag({ label: 'BC !', level: 'error', title: 'boom' }, { ok: false, error: {} }, state, 10000);

  assert.equal(errorSummary.hot, false);
  assert.equal(state.aggregateHistory.length, 0);
  assert.equal(state.cpuHistory.size, 0);
});

test('topbar label shows the recent peak so idle does not flicker to 0%', async () => {
  const { createBcContainersTopbarController } = require('../src/topbar/bc-summary');
  const dom = new JSDOM('<!doctype html><div id="slot"></div>');
  const slot = dom.window.document.querySelector('#slot');
  const cpus = [12, 0]; // a brief burst, then an idle trough
  let index = 0;
  const model = (cpu) => ({
    ok: true,
    summary: { total: 1, running: 1, cpuPercent: cpu, memoryBytes: 1073741824, hostCpuCount: 32 },
    containers: [{ name: 'bc', state: 'running', cpuPercent: cpu }]
  });
  let scheduledHandler = null;

  const controller = await createBcContainersTopbarController({
    root: slot,
    dataLoader: async () => model(cpus[Math.min(index++, cpus.length - 1)]),
    openPopup: async () => {},
    setInterval: (handler) => { scheduledHandler = handler; return 1; },
    clearInterval: () => {}
  });

  assert.match(slot.textContent, /CPU 12%/);
  await scheduledHandler(); // raw CPU is now 0, but the recent peak keeps the label at 12%
  assert.match(slot.textContent, /CPU 12%/);

  controller.destroy();
});

test('install script copies only expected pack files and patches the topbar idempotently', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-containers-install-'));

  try {
    const barRoot = path.join(tempRoot, 'operator-dark-bar');
    writeBarFixture(barRoot);

    runInstall(tempRoot);
    runInstall(tempRoot);

    const targetPackRoot = path.join(tempRoot, 'operator-dark-bc-containers');
    assert.deepEqual(listRelativeFiles(targetPackRoot), [
      'app.browser.js',
      'app.js',
      'fixture-data.browser.js',
      'index.html',
      'scripts/bc-containers.ps1',
      'scripts/run-bc-containers-helper.cmd',
      'style.css',
      'zpack.json'
    ]);

    const barHtml = fs.readFileSync(path.join(barRoot, 'index.html'), 'utf8');
    assert.equal((barHtml.match(/openBcContainers/g) ?? []).length, 2);
    assert.equal((barHtml.match(/function BcContainersSummary\(/g) ?? []).length, 1);
    assert.equal((barHtml.match(/<BcContainersSummary/g) ?? []).length, 1);
    assert.equal((barHtml.match(/const \[bcContainersSummary, setBcContainersSummary\]/g) ?? []).length, 1);
    assert.equal((barHtml.match(/bc-containers-trigger/g) ?? []).length, 1);
    assert.match(barHtml, /startWidgetPreset\('bc-containers', 'popup', \{ packId: 'operator-dark-bc-containers' \}\)/);
    assert.match(barHtml, /setInterval\(refreshBcContainersSummary, 10000\)/);
    assert.match(barHtml, /Status label="CPU"/);
    assert.match(barHtml, /className="keydeck-trigger"/);

    // Sustained "hot" watchdog: aggregate + per-container history, core-relative threshold, hot class.
    assert.equal((barHtml.match(/function applyBcContainersHotFlag\(/g) ?? []).length, 1);
    assert.match(barHtml, /bcContainersCpuHistory/);
    assert.match(barHtml, /bcContainersAggregateHistory/);
    assert.match(barHtml, /bcContainersResolveCoreCount/);
    assert.match(barHtml, /\$\{state\.hot \? ' bc-containers-hot' : ''\}/);

    const barCss = fs.readFileSync(path.join(barRoot, 'styles.css'), 'utf8');
    assert.equal((barCss.match(/\.bc-containers-trigger/g) ?? []).length, 6);
    assert.match(barCss, /\.bc-containers-trigger\.bc-containers-hot\s*{/s);
    assert.match(barCss, /\.right\s*{[^}]*gap:\s*16px;/s);
    // The trigger never wraps or shrinks: a squeezed bar must not clip the label to two lines.
    assert.match(barCss, /\.bc-containers-trigger\s*{[^}]*white-space:\s*nowrap;/s);
    assert.match(barCss, /\.bc-containers-trigger\s*{[^}]*flex-shrink:\s*0;/s);
    assert.equal((barCss.match(/\/\* BEGIN operator-dark-bc-containers \*\//g) ?? []).length, 1);
    assert.equal((barCss.match(/\/\* END operator-dark-bc-containers \*\//g) ?? []).length, 1);

    const barZpack = JSON.parse(fs.readFileSync(path.join(barRoot, 'zpack.json'), 'utf8'));
    assert.equal(barZpack.widgets[0].caching.defaultDuration, 0);
    const shellCommands = barZpack.widgets[0].privileges.shellCommands;
    assert.equal(shellCommands.length, 1);
    assert.equal(shellCommands[0].program, 'cmd.exe');
    assert.match(shellCommands[0].argsRegex, /operator-dark-bc-containers/);
    assert.doesNotMatch(shellCommands[0].argsRegex, /docker/);
    const barHelperRegex = new RegExp(shellCommands[0].argsRegex);
    // The helper path is resolved at runtime, so no absolute profile path is baked into the bar.
    assert.match(barHtml, /function bcContainersHelperCommand\(/);
    assert.doesNotMatch(barHtml, /[A-Za-z]:\\\\Users/);
    assert.equal((barHtml.match(/\/\/ BEGIN operator-dark-bc-containers/g) ?? []).length, 1);
    assert.equal((barHtml.match(/\/\/ END operator-dark-bc-containers/g) ?? []).length, 1);
    // The home-agnostic regex admits the helper under any zebar root and rejects shell chaining.
    const sampleHelper = 'C:\\Users\\anyone\\.glzr\\zebar\\operator-dark-bc-containers\\scripts\\run-bc-containers-helper.cmd';
    assert.equal(barHelperRegex.test(`/d /c ${sampleHelper} -Operation refresh`), true);
    assert.equal(barHelperRegex.test(`/d /c ${sampleHelper} -Operation refresh & docker rm bc`), false);
    assert.equal(barHelperRegex.test(`/d /c ${sampleHelper} -Operation refresh | powershell.exe -NoProfile`), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('reinstall heals a stale foreign-profile topbar block and bakes no path', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-containers-stale-'));

  try {
    const barRoot = path.join(tempRoot, 'operator-dark-bar');
    writeLegacyBarFixture(barRoot);

    runInstall(tempRoot);

    const barHtml = fs.readFileSync(path.join(barRoot, 'index.html'), 'utf8');
    // The legacy baked-path block is gone, replaced by the runtime resolver exactly once.
    assert.doesNotMatch(barHtml, /FlemmingBK/);
    assert.doesNotMatch(barHtml, /operatorDarkBcContainersHelperCommand/);
    assert.doesNotMatch(barHtml, /[A-Za-z]:\\\\Users/);
    assert.equal((barHtml.match(/function bcContainersHelperCommand\(/g) ?? []).length, 1);
    assert.equal((barHtml.match(/function BcContainersSummary\(/g) ?? []).length, 1);
    assert.equal((barHtml.match(/\/\/ BEGIN operator-dark-bc-containers/g) ?? []).length, 1);
    assert.equal((barHtml.match(/\/\/ END operator-dark-bc-containers/g) ?? []).length, 1);
    // Wiring inserted around the block survives and is not duplicated.
    assert.equal((barHtml.match(/<BcContainersSummary/g) ?? []).length, 1);
    assert.equal((barHtml.match(/const \[bcContainersSummary, setBcContainersSummary\]/g) ?? []).length, 1);
    assert.equal((barHtml.match(/setInterval\(refreshBcContainersSummary, 10000\)/g) ?? []).length, 1);

    const barZpack = JSON.parse(fs.readFileSync(path.join(barRoot, 'zpack.json'), 'utf8'));
    const argsRegex = barZpack.widgets[0].privileges.shellCommands[0].argsRegex;
    assert.doesNotMatch(argsRegex, /FlemmingBK/);
    const otherUserHelper = 'C:\\Users\\someone-else\\.glzr\\zebar\\operator-dark-bc-containers\\scripts\\run-bc-containers-helper.cmd';
    assert.equal(new RegExp(argsRegex).test(`/d /c ${otherUserHelper} -Operation refresh`), true);

    // The legacy sentinel-less trigger CSS is replaced by the current block, other rules untouched.
    const barCss = fs.readFileSync(path.join(barRoot, 'styles.css'), 'utf8');
    assert.equal((barCss.match(/\/\* BEGIN operator-dark-bc-containers \*\//g) ?? []).length, 1);
    assert.equal((barCss.match(/\/\* END operator-dark-bc-containers \*\//g) ?? []).length, 1);
    assert.equal((barCss.match(/\.bc-containers-trigger/g) ?? []).length, 6);
    assert.match(barCss, /\.bc-containers-trigger\s*{[^}]*white-space:\s*nowrap;/s);
    assert.match(barCss, /\.bc-containers-trigger\s*{[^}]*flex-shrink:\s*0;/s);
    assert.match(barCss, /\.keydeck-trigger\s*{/s);
    assert.match(barCss, /\.right\s*{[^}]*gap:\s*16px;/s);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('install check mode validates inputs without writes and missing bar fails before copying', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-containers-check-'));

  try {
    const barRoot = path.join(tempRoot, 'operator-dark-bar');
    writeBarFixture(barRoot);

    const checkOutput = runInstall(tempRoot, '-Check');
    assert.match(checkOutput, /OK: found operator-dark-bar and BC containers source inputs/);
    assert.equal(fs.existsSync(path.join(tempRoot, 'operator-dark-bc-containers')), false);

    fs.rmSync(barRoot, { recursive: true, force: true });
    const missingBar = runInstallFailure(tempRoot);
    assert.notEqual(missingBar.status, 0);
    assert.match(`${missingBar.stdout}${missingBar.stderr}`, /operator-dark-bar/);
    assert.equal(fs.existsSync(path.join(tempRoot, 'operator-dark-bc-containers')), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function loadWidgetFixture(name) {
  return JSON.parse(fs.readFileSync(fixturePath('widget', `${name}.json`), 'utf8'));
}

function runInstall(targetRoot, ...extraArgs) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    installScriptPath,
    '-SourceRoot',
    repoRoot,
    '-TargetRoot',
    targetRoot,
    ...extraArgs
  ];

  return execFileSync('pwsh.exe', args, { encoding: 'utf8' });
}

function runInstallFailure(targetRoot, ...extraArgs) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    installScriptPath,
    '-SourceRoot',
    repoRoot,
    '-TargetRoot',
    targetRoot,
    ...extraArgs
  ];

  return spawnSync('pwsh.exe', args, { encoding: 'utf8', windowsHide: true });
}

function writeBarFixture(barRoot) {
  fs.mkdirSync(barRoot, { recursive: true });
  fs.writeFileSync(path.join(barRoot, 'index.html'), [
    '<script type="text/babel" data-type="module">',
    "  import * as zebar from 'https://esm.sh/zebar@3.0';",
    '  function App() {',
    '    const [output, setOutput] = useState(providers.outputMap);',
    '    useEffect(() => {',
    '      providers.onOutput(() => setOutput({ ...providers.outputMap }));',
    '    }, []);',
    '    return (',
    '      <section className="right">',
    '        <button className="keydeck-trigger" title="Open Keydeck" onClick={openKeydeck}>KEYS</button>',
    '        <Status label="CPU" value={percent(output.cpu?.usage)} />',
    '        <Status label="RAM" value={percent(output.memory?.usage)} />',
    '      </section>',
    '    );',
    '  }',
    '  async function openKeydeck() {',
    "    await zebar.startWidgetPreset('keydeck', 'popup', { packId: 'operator-dark-keydeck' });",
    '  }',
    '</script>'
  ].join('\n'));
  fs.writeFileSync(path.join(barRoot, 'styles.css'), [
    '.right {',
    '  justify-content: flex-end;',
    '  gap: 16px;',
    '}',
    '.keydeck-trigger {',
    '  height: 22px;',
    '}'
  ].join('\n'));
  fs.writeFileSync(path.join(barRoot, 'zpack.json'), JSON.stringify({
    name: 'operator-dark-bar',
    widgets: [
      {
        name: 'topbar',
        caching: {
          defaultDuration: 604800,
          rules: []
        },
        privileges: {
          shellCommands: []
        }
      }
    ]
  }, null, 2));
}

// A bar already patched by a prior installer, then copied from the FlemmingBK profile:
// a sentinel-less block with a baked absolute path that no longer exists on this machine.
function writeLegacyBarFixture(barRoot) {
  fs.mkdirSync(barRoot, { recursive: true });
  fs.writeFileSync(path.join(barRoot, 'index.html'), [
    '<script type="text/babel" data-type="module">',
    "  import * as zebar from 'https://esm.sh/zebar@3.0';",
    '',
    '      const operatorDarkBcContainersHelperCommand = {',
    "        program: 'cmd.exe',",
    "        args: ['/d', '/c', 'C:\\\\Users\\\\FlemmingBK\\\\.glzr\\\\zebar\\\\operator-dark-bc-containers\\\\scripts\\\\run-bc-containers-helper.cmd'],",
    '      };',
    '',
    '      function BcContainersSummary({ summary, onOpen }) {',
    '        return null;',
    '      }',
    '',
    '      async function openBcContainers() {',
    "        await zebar.startWidgetPreset('bc-containers', 'popup', { packId: 'operator-dark-bc-containers' });",
    '      }',
    '',
    '      async function loadBcContainersSummary() {',
    '        return await shellExec(operatorDarkBcContainersHelperCommand.program, operatorDarkBcContainersHelperCommand.args);',
    '      }',
    '',
    '      function applyBcContainersHotFlag(summary, model) {',
    '        return { ...summary, hot: false };',
    '      }',
    '  function App() {',
    '    const [output, setOutput] = useState(providers.outputMap);',
    '        const [bcContainersSummary, setBcContainersSummary] = useState(bcContainersSummaryDefault);',
    '    useEffect(() => {',
    '      providers.onOutput(() => setOutput({ ...providers.outputMap }));',
    '    }, []);',
    '',
    '    useEffect(() => {',
    '      let disposed = false;',
    '      async function refreshBcContainersSummary() {',
    '        const nextSummary = await loadBcContainersSummary();',
    '        if (!disposed) setBcContainersSummary(nextSummary);',
    '      }',
    '      refreshBcContainersSummary();',
    '      const timer = setInterval(refreshBcContainersSummary, 10000);',
    '      return () => {',
    '        disposed = true;',
    '        clearInterval(timer);',
    '      };',
    '    }, []);',
    '    return (',
    '      <section className="right">',
    '              <BcContainersSummary summary={bcContainersSummary} onOpen={openBcContainers} />',
    '        <button className="keydeck-trigger" title="Open Keydeck" onClick={openKeydeck}>KEYS</button>',
    '        <Status label="CPU" value={percent(output.cpu?.usage)} />',
    '        <Status label="RAM" value={percent(output.memory?.usage)} />',
    '      </section>',
    '    );',
    '  }',
    '  async function openKeydeck() {',
    "    await zebar.startWidgetPreset('keydeck', 'popup', { packId: 'operator-dark-keydeck' });",
    '  }',
    '</script>'
  ].join('\n'));
  fs.writeFileSync(path.join(barRoot, 'styles.css'), [
    '.right {',
    '  justify-content: flex-end;',
    '  gap: 16px;',
    '}',
    '.keydeck-trigger {',
    '  height: 22px;',
    '}',
    '.bc-containers-trigger {',
    '  height: 22px;',
    '}'
  ].join('\n'));
  fs.writeFileSync(path.join(barRoot, 'zpack.json'), JSON.stringify({
    name: 'operator-dark-bar',
    widgets: [
      {
        name: 'topbar',
        caching: { defaultDuration: 0, rules: [] },
        privileges: {
          shellCommands: [
            {
              program: 'cmd.exe',
              argsRegex: '^/d /c C:\\\\Users\\\\FlemmingBK\\\\.glzr\\\\zebar\\\\operator-dark-bc-containers\\\\scripts\\\\run-bc-containers-helper.cmd -Operation refresh$'
            }
          ]
        }
      }
    ]
  }, null, 2));
}

function listRelativeFiles(root) {
  const files = [];
  collectFiles(root, '', files);
  return files.sort();
}

function collectFiles(root, relativeRoot, files) {
  for (const entry of fs.readdirSync(path.join(root, relativeRoot))) {
    const relativePath = relativeRoot ? path.join(relativeRoot, entry) : entry;
    const fullPath = path.join(root, relativePath);

    if (fs.statSync(fullPath).isDirectory()) {
      collectFiles(root, relativePath, files);
    } else {
      files.push(relativePath.replaceAll('\\', '/'));
    }
  }
}
