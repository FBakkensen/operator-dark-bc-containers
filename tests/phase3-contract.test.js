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
  assert.equal(widget.transparent, false);
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
  assert.equal(preset.offsetX, '16px');
  assert.equal(preset.offsetY, '48px');
  assert.equal(preset.width, '980px');
  assert.equal(preset.height, '640px');
  assert.deepEqual(preset.monitorSelection, { type: 'primary' });
  assert.equal(widget.caching.defaultDuration, 0);

  const shellCommands = widget.privileges.shellCommands;
  assert.equal(shellCommands.length, 1);
  assert.equal(shellCommands[0].program, 'cmd.exe');
  const helperRegex = new RegExp(shellCommands[0].argsRegex);
  assert.equal(helperRegex.test('/d /c scripts\\run-bc-containers-helper.cmd -Operation refresh'), true);
  assert.equal(helperRegex.test('/d /c C:\\Users\\FlemmingBK\\.glzr\\zebar\\operator-dark-bc-containers\\scripts\\run-bc-containers-helper.cmd -Operation action -Action start -ContainerName bc'), true);
  assert.equal(helperRegex.test('/d /c C:\\Users\\FlemmingBK\\.glzr\\zebar\\operator-dark-bc-containers\\scripts\\run-bc-containers-helper.cmd -Operation action -Action restart -ContainerName BC Name.With Spaces-01'), true);
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

    const barCss = fs.readFileSync(path.join(barRoot, 'styles.css'), 'utf8');
    assert.equal((barCss.match(/\.bc-containers-trigger/g) ?? []).length, 4);
    assert.match(barCss, /\.right\s*{[^}]*gap:\s*16px;/s);

    const barZpack = JSON.parse(fs.readFileSync(path.join(barRoot, 'zpack.json'), 'utf8'));
    assert.equal(barZpack.widgets[0].caching.defaultDuration, 0);
    const shellCommands = barZpack.widgets[0].privileges.shellCommands;
    assert.equal(shellCommands.length, 1);
    assert.equal(shellCommands[0].program, 'cmd.exe');
    assert.match(shellCommands[0].argsRegex, /operator-dark-bc-containers/);
    assert.doesNotMatch(shellCommands[0].argsRegex, /docker/);
    const barHelperRegex = new RegExp(shellCommands[0].argsRegex);
    const helperLiteral = /args: \['\/d', '\/c', '([^']+)'\]/.exec(barHtml)?.[1];
    assert.ok(helperLiteral, 'missing injected helper command path');
    const targetHelper = helperLiteral.replaceAll('\\\\', '\\');
    assert.equal(barHelperRegex.test(`/d /c ${targetHelper} -Operation refresh`), true);
    assert.equal(barHelperRegex.test(`/d /c ${targetHelper} -Operation refresh & docker rm bc`), false);
    assert.equal(barHelperRegex.test(`/d /c ${targetHelper} -Operation refresh | powershell.exe -NoProfile`), false);
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
