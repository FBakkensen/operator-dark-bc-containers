const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const { fixturePath, repoRoot } = require('./test-utils');

const {
  createZebarShellActionRunner,
  createZebarShellDataLoader,
  initializeBcContainers,
  renderBcContainers
} = require('../src/widget/app');

const widgetIndexPath = path.join(repoRoot, 'src', 'widget', 'index.html');
const widgetStylePath = path.join(repoRoot, 'src', 'widget', 'style.css');
const widgetBrowserPath = path.join(repoRoot, 'src', 'widget', 'app.browser.js');

test('popup renders header summary, refresh state, rows, and PRD actions from fixture data', () => {
  const dom = createDom();
  const root = dom.window.document.querySelector('#app');

  renderBcContainers(root, loadWidgetFixture('mixed'));

  assert.match(root.querySelector('.metric-total')?.textContent ?? '', /3/);
  assert.match(root.querySelector('.metric-running')?.textContent ?? '', /2/);
  assert.match(root.querySelector('.metric-cpu')?.textContent ?? '', /18\.4%/);
  assert.match(root.querySelector('.metric-memory')?.textContent ?? '', /3\.4 GB/);
  assert.match(root.querySelector('.refresh-state')?.textContent ?? '', /2026-06-01T10:00:00\+02:00/);

  assert.deepEqual(rowNames(dom), [
    '234-rules-within-rules',
    'BC Name.With Spaces-01',
    'BC.Dev_26-A'
  ]);

  const runningRow = rowByName(dom, '234-rules-within-rules');
  assert.match(runningRow.textContent, /healthy/);
  assert.match(runningRow.textContent, /Up 7 hours \(healthy\)/);
  assert.match(runningRow.textContent, /9\.8%/);
  assert.match(runningRow.textContent, /2\.9 GB/);
  assert.match(runningRow.textContent, /bctest:snapshot/);
  assert.match(runningRow.textContent, /BC 26 \/ dk/);
  assert.deepEqual(actionLabels(runningRow), ['Open', 'Restart', 'Stop', 'Remove']);

  const stoppedRow = rowByName(dom, 'BC.Dev_26-A');
  assert.match(stoppedRow.textContent, /Exited \(0\) 2 hours ago/);
  assert.doesNotMatch(stoppedRow.textContent, /CPU/);
  assert.doesNotMatch(stoppedRow.textContent, /RAM/);
  assert.deepEqual(actionLabels(stoppedRow), ['Open', 'Start', 'Remove']);
  assert.equal(button(stoppedRow, 'open').disabled, true);
});

test('popup renders a backdrop that closes on outside click but not on card click', () => {
  const dom = createDom();
  const root = dom.window.document.querySelector('#app');
  let closeCalls = 0;

  renderBcContainers(root, loadWidgetFixture('mixed'), {
    handlers: { close: () => { closeCalls += 1; } }
  });

  const backdrop = root.querySelector('.bc-backdrop');
  const panel = root.querySelector('.bc-containers-panel');
  assert.ok(backdrop, 'backdrop should wrap the panel');
  assert.ok(panel, 'panel should render inside the backdrop');

  panel.click();
  assert.equal(closeCalls, 0, 'clicking the card must not close the popup');

  backdrop.click();
  assert.equal(closeCalls, 1, 'clicking the backdrop closes the popup');
});

test('popup renders latest output drawer and helper warning detail', () => {
  const outputDom = createDom();
  renderBcContainers(outputDom.window.document.querySelector('#app'), loadWidgetFixture('latest-output'));

  const drawer = outputDom.window.document.querySelector('.output-drawer');
  assert.match(drawer.textContent, /Restart-BcContainer 234-rules-within-rules/);
  assert.match(drawer.textContent, /Exit code 1/);
  assert.match(drawer.textContent, /2026-06-01T10:00:00\+02:00/);
  assert.match(drawer.textContent, /2026-06-01T10:00:18\+02:00/);
  assert.match(drawer.textContent, /Restarting container/);
  assert.match(drawer.textContent, /container not found/);

  const warningDom = createDom();
  renderBcContainers(warningDom.window.document.querySelector('#app'), loadWidgetFixture('warning'));

  const warning = warningDom.window.document.querySelector('[role="alert"]');
  assert.match(warning.textContent, /docker stats/);
  assert.match(warning.textContent, /exit code 1/i);
  assert.match(warning.textContent, /Docker Desktop is not running/);
  assert.ok(warningDom.window.document.body.textContent.includes('234-rules-within-rules'));
});

test('widget HTML stays buildless and renders fixture fallback in a browser DOM', async () => {
  const html = fs.readFileSync(widgetIndexPath, 'utf8');
  const browserApp = fs.readFileSync(widgetBrowserPath, 'utf8');

  assert.match(html, /app\.js/);
  assert.match(html, /fixture-data\.browser\.js/);
  assert.match(html, /app\.browser\.js/);
  assert.doesNotMatch(html, /bundle|webpack|vite/i);
  assert.match(html, /zebar@3\.3\.1/);
  assert.match(browserApp, /bootstrapBcContainers/);
  assert.match(browserApp, /createZebarHelperCommand/);
  assert.match(browserApp, /createZebarLifecycle/);
  assert.match(browserApp, /tauriWindow/);

  let dom;
  try {
    dom = await JSDOM.fromFile(widgetIndexPath, {
      resources: 'usable',
      runScripts: 'dangerously',
      pretendToBeVisual: true
    });

    await waitFor(() => dom.window.document.body.textContent.includes('234-rules-within-rules'));
    assert.match(dom.window.document.querySelector('.metric-total')?.textContent ?? '', /3/);

    let closed = false;
    const lifecycle = dom.window.BcContainersWidget.createZebarLifecycle({
      currentWidget: () => ({
        close: () => {
          closed = true;
        }
      })
    });
    await lifecycle.close();
    assert.equal(closed, true);

    let tauriClosed = false;
    const tauriLifecycle = dom.window.BcContainersWidget.createZebarLifecycle({
      currentWidget: () => ({
        tauriWindow: {
          close: () => {
            tauriClosed = true;
          }
        }
      })
    });
    await tauriLifecycle.close();
    assert.equal(tauriClosed, true);

    const configPathCommand = dom.window.BcContainersWidget.createZebarHelperCommand({
      currentWidget: () => ({
        configPath: 'C:\\Users\\FlemmingBK\\.glzr\\zebar\\operator-dark-bc-containers\\zpack.json'
      })
    });
    assert.equal(configPathCommand.program, 'cmd.exe');
    assert.deepEqual(Array.from(configPathCommand.args), [
      '/d',
      '/c',
      'C:\\Users\\FlemmingBK\\.glzr\\zebar\\operator-dark-bc-containers\\scripts\\run-bc-containers-helper.cmd'
    ]);

    const htmlPathCommand = dom.window.BcContainersWidget.createZebarHelperCommand({
      currentWidget: {
        htmlPath: 'file:///C:/Users/FlemmingBK/.glzr/zebar/operator-dark-bc-containers/index.html'
      }
    });
    assert.deepEqual(Array.from(htmlPathCommand.args), [
      '/d',
      '/c',
      'C:\\Users\\FlemmingBK\\.glzr\\zebar\\operator-dark-bc-containers\\scripts\\run-bc-containers-helper.cmd'
    ]);

    const locationDom = new JSDOM('<!doctype html><main id="app"></main>', {
      url: 'file:///C:/Users/FlemmingBK/.glzr/zebar/operator-dark-bc-containers/index.html',
      runScripts: 'dangerously'
    });
    locationDom.window.OperatorDarkBcContainers = require('../src/widget/app');
    locationDom.window.eval(browserApp);
    const locationCommand = locationDom.window.BcContainersWidget.createZebarHelperCommand(null);
    assert.deepEqual(Array.from(locationCommand.args), [
      '/d',
      '/c',
      'C:\\Users\\FlemmingBK\\.glzr\\zebar\\operator-dark-bc-containers\\scripts\\run-bc-containers-helper.cmd'
    ]);
  } finally {
    dom?.window.OperatorDarkBcContainersController?.destroy?.();
    dom?.window.close();
  }
});

test('close control renders before refresh completes and Escape listener is cleaned up', async () => {
  const dom = createDom();
  const root = dom.window.document.querySelector('#app');
  let resolveRefresh;
  let closeCalls = 0;

  const controllerPromise = initializeBcContainers({
    document: dom.window.document,
    window: dom.window,
    root,
    dataLoader: async () => new Promise((resolve) => {
      resolveRefresh = resolve;
    }),
    lifecycle: {
      close: () => {
        closeCalls += 1;
      }
    },
    autoRefresh: false
  });

  const closeButton = root.querySelector('.close-button');
  assert.ok(closeButton, 'close button should render before helper refresh finishes');
  assert.equal(closeButton.getAttribute('aria-label'), 'Close BC containers');

  closeButton.click();
  assert.equal(closeCalls, 1);

  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(closeCalls, 2);

  resolveRefresh(loadWidgetFixture('empty'));
  const controller = await controllerPromise;
  controller.destroy();

  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(closeCalls, 2);
});

test('refresh loads helper data, keeps last success on failure, and surfaces invalid JSON without crashing', async () => {
  const dom = createDom();
  const root = dom.window.document.querySelector('#app');
  let calls = 0;

  const controller = await initializeBcContainers({
    document: dom.window.document,
    window: dom.window,
    root,
    dataLoader: async () => {
      calls += 1;
      if (calls === 1) return loadWidgetFixture('mixed');
      throw new Error('Helper returned invalid JSON');
    },
    autoRefresh: false
  });

  assert.equal(calls, 1);
  assert.ok(root.textContent.includes('234-rules-within-rules'));

  await controller.refresh();

  assert.equal(calls, 2);
  assert.ok(root.textContent.includes('234-rules-within-rules'));
  assert.match(root.querySelector('[role="alert"]')?.textContent ?? '', /Helper returned invalid JSON/);

  const freshDom = createDom();
  await initializeBcContainers({
    document: freshDom.window.document,
    window: freshDom.window,
    root: freshDom.window.document.querySelector('#app'),
    dataLoader: async () => {
      throw new Error('Helper returned invalid JSON');
    },
    autoRefresh: false
  });

  assert.match(freshDom.window.document.querySelector('[role="alert"]')?.textContent ?? '', /Helper returned invalid JSON/);
});

test('refresh schedules every 5 seconds and lifecycle completion refreshes immediately', async () => {
  const dom = createDom();
  const root = dom.window.document.querySelector('#app');
  let scheduledIntervalMs = null;
  let intervalHandler = null;
  let refreshCalls = 0;
  let actionCalls = 0;

  dom.window.setInterval = (handler, ms) => {
    intervalHandler = handler;
    scheduledIntervalMs = ms;
    return 41;
  };
  dom.window.clearInterval = () => {};

  const controller = await initializeBcContainers({
    document: dom.window.document,
    window: dom.window,
    root,
    dataLoader: async () => {
      refreshCalls += 1;
      return loadWidgetFixture('mixed');
    },
    actionRunner: async () => {
      actionCalls += 1;
      return actionSuccess('start', 'BC.Dev_26-A');
    }
  });

  assert.equal(scheduledIntervalMs, 5000);
  assert.equal(typeof intervalHandler, 'function');

  button(rowByName(dom, 'BC.Dev_26-A'), 'start').click();
  await controller.waitForIdle();

  assert.equal(actionCalls, 1);
  assert.equal(refreshCalls, 2);

  controller.destroy();
});

test('shell adapters parse refresh and action stdout and report shell or JSON failures', async () => {
  const shellCalls = [];
  const refreshLoader = createZebarShellDataLoader({
    shellExec: async (...args) => {
      shellCalls.push(args);
      return { stdout: JSON.stringify(loadWidgetFixture('empty')), stderr: '' };
    },
    command: { program: 'cmd.exe', args: ['/d', '/c', 'run-bc-containers-helper.cmd'] }
  });

  assert.equal((await refreshLoader()).ok, true);
  assert.deepEqual(shellCalls, [['cmd.exe', ['/d', '/c', 'run-bc-containers-helper.cmd', '-Operation', 'refresh']]]);

  const actionRunner = createZebarShellActionRunner({
    shellExec: async (...args) => {
      shellCalls.push(args);
      return { stdout: JSON.stringify(actionSuccess('restart', '234-rules-within-rules')), stderr: '' };
    },
    command: { program: 'cmd.exe', args: ['/d', '/c', 'run-bc-containers-helper.cmd'] }
  });

  await actionRunner('restart', '234-rules-within-rules');
  assert.deepEqual(shellCalls.at(-1), [
    'cmd.exe',
    ['/d', '/c', 'run-bc-containers-helper.cmd', '-Operation', 'action', '-Action', 'restart', '-ContainerName', '234-rules-within-rules']
  ]);

  await assert.rejects(
    createZebarShellDataLoader({
      shellExec: async () => ({ stdout: '', stderr: 'no shell permission', exitCode: 1 }),
      command: 'run-bc-containers-helper.cmd'
    })(),
    (error) => {
      assert.match(error.message, /no shell permission/);
      assert.equal(error.operation, 'refresh');
      assert.equal(error.command, 'run-bc-containers-helper.cmd -Operation refresh');
      assert.equal(error.exitCode, 1);
      assert.equal(error.stderr, 'no shell permission');
      return true;
    }
  );

  await assert.rejects(
    createZebarShellDataLoader({
      shellExec: async () => ({ stdout: 'not-json', stderr: '' }),
      command: 'run-bc-containers-helper.cmd'
    })(),
    (error) => {
      assert.match(error.message, /invalid JSON/);
      assert.equal(error.operation, 'refresh');
      assert.equal(error.command, 'run-bc-containers-helper.cmd -Operation refresh');
      assert.equal(error.exitCode, 0);
      return true;
    }
  );
});

test('shell refresh failures render helper command and exit code', async () => {
  const dom = createDom();
  const root = dom.window.document.querySelector('#app');
  let calls = 0;

  const loader = createZebarShellDataLoader({
    shellExec: async () => {
      calls += 1;
      if (calls === 1) {
        return { stdout: JSON.stringify(loadWidgetFixture('mixed')), stderr: '', exitCode: 0 };
      }

      return { stdout: '', stderr: 'shell denied helper access', exitCode: 5 };
    },
    command: { program: 'cmd.exe', args: ['/d', '/c', 'run-bc-containers-helper.cmd'] }
  });

  const controller = await initializeBcContainers({
    document: dom.window.document,
    window: dom.window,
    root,
    dataLoader: loader,
    autoRefresh: false
  });

  await controller.refresh();

  const warning = root.querySelector('[role="alert"]')?.textContent ?? '';
  assert.match(warning, /Operation refresh/);
  assert.match(warning, /cmd\.exe \/d \/c run-bc-containers-helper\.cmd -Operation refresh/);
  assert.match(warning, /Exit code 5/);
  assert.match(warning, /shell denied helper access/);
  assert.ok(root.textContent.includes('234-rules-within-rules'));
});

test('shell action failures render helper invocation and exit code in latest output', async () => {
  const dom = createDom();
  const root = dom.window.document.querySelector('#app');
  const actionRunner = createZebarShellActionRunner({
    shellExec: async () => ({ stdout: '', stderr: 'shell denied action access', exitCode: 7 }),
    command: { program: 'cmd.exe', args: ['/d', '/c', 'run-bc-containers-helper.cmd'] }
  });

  const controller = await initializeBcContainers({
    document: dom.window.document,
    window: dom.window,
    root,
    dataLoader: async () => loadWidgetFixture('mixed'),
    actionRunner,
    autoRefresh: false
  });

  button(rowByName(dom, 'BC.Dev_26-A'), 'start').click();
  await controller.waitForIdle();

  const drawer = root.querySelector('.output-drawer')?.textContent ?? '';
  assert.match(drawer, /cmd\.exe \/d \/c run-bc-containers-helper\.cmd -Operation action -Action start -ContainerName BC\.Dev_26-A/);
  assert.match(drawer, /Exit code 7/);
  assert.match(drawer, /shell denied action access/);
});

test('open uses exact container names and confirmation is inline, expiring, and exclusive', async () => {
  const dom = createDom();
  const root = dom.window.document.querySelector('#app');
  const launchedUrls = [];
  const actions = [];
  let timeoutHandler = null;
  let timeoutMs = null;

  dom.window.confirm = () => assert.fail('modal confirm must not be called');
  dom.window.alert = () => assert.fail('modal alert must not be called');
  dom.window.prompt = () => assert.fail('modal prompt must not be called');
  dom.window.setTimeout = (handler, ms) => {
    timeoutHandler = handler;
    timeoutMs = ms;
    return 42;
  };
  dom.window.clearTimeout = () => {};

  const controller = await initializeBcContainers({
    document: dom.window.document,
    window: dom.window,
    root,
    dataLoader: async () => loadWidgetFixture('mixed'),
    browserLauncher: async (url) => {
      launchedUrls.push(url);
    },
    actionRunner: async (action, container) => {
      actions.push({ action, container });
      return actionSuccess(action, container);
    },
    autoRefresh: false
  });

  button(rowByName(dom, '234-rules-within-rules'), 'open').click();
  button(rowByName(dom, 'BC Name.With Spaces-01'), 'open').click();
  button(rowByName(dom, 'BC.Dev_26-A'), 'open').click();

  assert.deepEqual(launchedUrls, [
    'http://234-rules-within-rules/bc',
    'http://BC Name.With Spaces-01/bc'
  ]);

  button(rowByName(dom, '234-rules-within-rules'), 'restart').click();
  assert.equal(timeoutMs, 8000);
  assert.equal(button(rowByName(dom, '234-rules-within-rules'), 'restart').textContent.trim(), 'Confirm restart');
  assert.deepEqual(actions, []);

  button(rowByName(dom, '234-rules-within-rules'), 'restart').click();
  await controller.waitForIdle();
  assert.deepEqual(actions, [{ action: 'restart', container: '234-rules-within-rules' }]);

  button(rowByName(dom, '234-rules-within-rules'), 'stop').click();
  assert.equal(button(rowByName(dom, '234-rules-within-rules'), 'stop').textContent.trim(), 'Confirm stop');
  timeoutHandler();
  assert.equal(button(rowByName(dom, '234-rules-within-rules'), 'stop').textContent.trim(), 'Stop');

  button(rowByName(dom, '234-rules-within-rules'), 'stop').click();
  button(rowByName(dom, '234-rules-within-rules'), 'remove').click();
  assert.equal(button(rowByName(dom, '234-rules-within-rules'), 'stop').textContent.trim(), 'Stop');
  assert.equal(button(rowByName(dom, '234-rules-within-rules'), 'remove').textContent.trim(), 'Confirm remove');

  controller.destroy();
});

test('shell browser launcher opens the web client through the privileged helper command', async () => {
  const { createZebarShellBrowserLauncher } = require('../src/widget/app');

  const calls = [];
  const launcher = createZebarShellBrowserLauncher({
    command: { program: 'cmd.exe', args: ['/d', '/c', 'C:\\pack\\scripts\\run-bc-containers-helper.cmd'] },
    shellExec: async (program, args) => {
      calls.push({ program, args });
      return { stdout: JSON.stringify({ ok: true, action: 'open', arguments: [args[args.length - 1]] }), stderr: '', exitCode: 0 };
    }
  });

  await launcher('http://234-rules-within-rules/bc');
  assert.deepEqual(calls, [{
    program: 'cmd.exe',
    args: ['/d', '/c', 'C:\\pack\\scripts\\run-bc-containers-helper.cmd', '-Operation', 'open', '-Url', 'http://234-rules-within-rules/bc']
  }]);

  // A helper that reports ok:false must reject so the popup surfaces the error and stays open.
  const failing = createZebarShellBrowserLauncher({
    command: { program: 'cmd.exe', args: ['/d', '/c', 'helper.cmd'] },
    shellExec: async () => ({ stdout: JSON.stringify({ ok: false, error: { stderr: 'no default browser' } }), stderr: '', exitCode: 0 })
  });
  await assert.rejects(() => failing('http://bc/bc'), /no default browser/);
});

test('browser launcher falls back to window.open outside the Zebar shell', async () => {
  const { createBrowserLauncher } = require('../src/widget/app');

  const windowCalls = [];
  const launcher = createBrowserLauncher({
    window: { open: (url, target, features) => { windowCalls.push([url, target, features]); } }
  });
  await launcher('http://234-rules-within-rules/bc');
  assert.deepEqual(windowCalls, [
    ['http://234-rules-within-rules/bc', '_blank', 'noopener']
  ]);
});

test('open launches the web client then closes the popup, and never closes from a disabled row', async () => {
  const dom = createDom();
  const root = dom.window.document.querySelector('#app');
  const launchedUrls = [];
  let closeCalls = 0;

  const controller = await initializeBcContainers({
    document: dom.window.document,
    window: dom.window,
    root,
    dataLoader: async () => loadWidgetFixture('mixed'),
    browserLauncher: async (url) => { launchedUrls.push(url); },
    lifecycle: { close: async () => { closeCalls += 1; } },
    autoRefresh: false
  });

  button(rowByName(dom, '234-rules-within-rules'), 'open').click();
  await flushMicrotasks();
  assert.deepEqual(launchedUrls, ['http://234-rules-within-rules/bc']);
  assert.equal(closeCalls, 1, 'a successful open closes the popup');

  // Stopped container: Open is disabled, so it neither launches nor closes.
  button(rowByName(dom, 'BC.Dev_26-A'), 'open').click();
  await flushMicrotasks();
  assert.deepEqual(launchedUrls, ['http://234-rules-within-rules/bc']);
  assert.equal(closeCalls, 1);

  controller.destroy();
});

test('refresh that invalidates an armed action cancels confirmation', async () => {
  const dom = createDom();
  const root = dom.window.document.querySelector('#app');
  let calls = 0;

  const controller = await initializeBcContainers({
    document: dom.window.document,
    window: dom.window,
    root,
    dataLoader: async () => {
      calls += 1;
      return calls === 1 ? loadWidgetFixture('mixed') : loadWidgetFixture('empty');
    },
    autoRefresh: false
  });

  button(rowByName(dom, '234-rules-within-rules'), 'stop').click();
  assert.equal(button(rowByName(dom, '234-rules-within-rules'), 'stop').textContent.trim(), 'Confirm stop');

  await controller.refresh();

  assert.equal(root.querySelector('[data-action="stop"]'), null);
  assert.doesNotMatch(root.textContent, /Confirm stop/);
});

test('single action guard disables lifecycle buttons, keeps open available, and stores latest output', async () => {
  const dom = createDom();
  const root = dom.window.document.querySelector('#app');
  let actionCalls = 0;
  let resolveAction;

  const controller = await initializeBcContainers({
    document: dom.window.document,
    window: dom.window,
    root,
    dataLoader: async () => loadWidgetFixture('mixed'),
    actionRunner: async (action, container) => {
      actionCalls += 1;
      return new Promise((resolve) => {
        resolveAction = () => resolve(actionSuccess(action, container));
      });
    },
    autoRefresh: false
  });

  button(rowByName(dom, 'BC.Dev_26-A'), 'start').click();
  await Promise.resolve();

  assert.equal(actionCalls, 1);
  assert.match(root.querySelector('.active-command')?.textContent ?? '', /start/);
  assert.match(root.querySelector('.active-command')?.textContent ?? '', /BC.Dev_26-A/);
  for (const lifecycleButton of root.querySelectorAll('[data-lifecycle-action="true"]')) {
    assert.equal(lifecycleButton.disabled, true);
  }
  assert.equal(button(rowByName(dom, '234-rules-within-rules'), 'open').disabled, false);

  button(rowByName(dom, '234-rules-within-rules'), 'remove').click();
  assert.equal(actionCalls, 1);

  resolveAction();
  await controller.waitForIdle();

  assert.match(root.querySelector('.output-drawer')?.textContent ?? '', /Start-BcContainer BC.Dev_26-A/);
  assert.match(root.querySelector('.output-drawer')?.textContent ?? '', /action completed/);

  controller.destroy();
});

test('action failure replaces latest output and shows exact stderr', async () => {
  const dom = createDom();
  const root = dom.window.document.querySelector('#app');

  const controller = await initializeBcContainers({
    document: dom.window.document,
    window: dom.window,
    root,
    dataLoader: async () => loadWidgetFixture('mixed'),
    actionRunner: async (action, container) => actionFailure(action, container),
    autoRefresh: false
  });

  button(rowByName(dom, 'BC.Dev_26-A'), 'start').click();
  await controller.waitForIdle();

  assert.match(root.querySelector('.output-drawer')?.textContent ?? '', /Start-BcContainer BC.Dev_26-A/);
  assert.match(root.querySelector('.output-drawer')?.textContent ?? '', /container not found/);

  controller.destroy();
});

test('widget CSS keeps the popup compact, stable, and action-focused', () => {
  const css = fs.readFileSync(widgetStylePath, 'utf8');

  assert.match(css, /html,\s*body,\s*#app\s*{[^}]*height:\s*100%;/s);
  assert.match(css, /\.bc-backdrop\s*{[^}]*place-items:\s*center;/s);
  assert.match(css, /\.bc-containers-panel\s*{[^}]*max-height:\s*min\(/s);
  assert.doesNotMatch(css, /\.bc-containers-panel\s*{[^}]*height:\s*100%;/s);
  assert.match(css, /\.close-button\s*{[^}]*width:\s*32px;/s);
  assert.match(css, /\.bc-container-row\s*{[^}]*grid-template-columns:/s);
  assert.match(css, /\.actions\s*{[^}]*display:\s*flex;/s);
  assert.match(css, /\.actions\s*{[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(css, /\.action-button\s*{[^}]*min-height:\s*32px;/s);
  // The confirmable actions keep a fixed width basis so arming ("Confirm ...")
  // never resizes a button or reflows the row.
  assert.match(css, /\.action-restart,\s*\.action-stop,\s*\.action-remove\s*{[^}]*flex:\s*0 0 132px;/s);
  assert.doesNotMatch(css, /\.action-button\.confirm\s*{[^}]*(?:min-)?width:/s);
  assert.match(css, /\.output-drawer\s*{[^}]*max-height:/s);
  assert.doesNotMatch(css, /border-radius:\s*(1[2-9]|[2-9][0-9])px/);
});

test('CPU trend helpers scale thresholds to core count and detect sustained load', () => {
  const { hotPercentForCores, countSustained, rollingMax, samplesForDuration } = require('../src/widget/app');

  assert.equal(hotPercentForCores(4, 32), 12.5);
  assert.equal(hotPercentForCores(4, 8), 50);
  assert.equal(hotPercentForCores(4, 0), 400); // divide-by-zero guard treats coreCount as 1

  assert.equal(countSustained([0, 60, 60, 60], 50), 3);
  assert.equal(countSustained([60, 0, 60], 50), 1);
  assert.equal(countSustained([10, 20], 50), 0);

  assert.equal(rollingMax([0, 12, 0], 2), 12); // recent peak keeps the display off 0 between bursts
  assert.equal(rollingMax([], 2), 0);

  assert.equal(samplesForDuration(60000, 5000), 12);
});

test('popup marks a container busy when its current CPU crosses the per-core threshold', async () => {
  const dom = createDom();
  const root = dom.window.document.querySelector('#app');

  const controller = await initializeBcContainers({
    document: dom.window.document,
    window: dom.window,
    root,
    dataLoader: async () => loadWidgetFixture('high-cpu'),
    autoRefresh: false
  });

  // high-cpu fixture: hostCpuCount 32 -> per-container threshold = 4/32*100 = 12.5%.
  const hotRow = rowByName(dom, '234-rules-within-rules'); // 25% -> busy
  const idleRow = rowByName(dom, 'BC Name.With Spaces-01'); // 1% -> not busy

  assert.ok(hotRow.className.includes('busy'), 'hot container row should be marked busy');
  assert.match(hotRow.querySelector('.cpu-hot-flag')?.textContent ?? '', /busy/);
  assert.equal(idleRow.className.includes('busy'), false);
  assert.equal(idleRow.querySelector('.cpu-hot-flag'), null);
  // aggregate 26% < 60% of the 32-core box -> summary CPU is not flagged hot
  assert.equal(root.querySelector('.metric-cpu')?.className.includes('hot'), false);

  controller.destroy();
});

function createDom() {
  return new JSDOM('<!doctype html><main id="app"></main>', {
    url: 'file:///bc-containers/index.html',
    pretendToBeVisual: true
  });
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadWidgetFixture(name) {
  return JSON.parse(fs.readFileSync(fixturePath('widget', `${name}.json`), 'utf8'));
}

function rowNames(dom) {
  return [...dom.window.document.querySelectorAll('.container-name')].map((node) => node.textContent.trim());
}

function rowByName(dom, name) {
  const row = [...dom.window.document.querySelectorAll('.bc-container-row')]
    .find((candidate) => candidate.querySelector('.container-name')?.textContent.trim() === name);
  assert.ok(row, `missing row for ${name}`);
  return row;
}

function actionLabels(row) {
  return [...row.querySelectorAll('button')].map((node) => node.textContent.trim());
}

function button(root, action) {
  const found = root.querySelector(`[data-action="${action}"]`);
  assert.ok(found, `missing ${action} button`);
  return found;
}

function actionSuccess(action, container) {
  return {
    ok: true,
    action,
    container,
    command: `${commandForAction(action)} ${container}`,
    startedAt: '2026-06-01T10:00:00+02:00',
    finishedAt: '2026-06-01T10:00:18+02:00',
    exitCode: 0,
    stdout: 'action completed',
    stderr: ''
  };
}

function actionFailure(action, container) {
  return {
    ok: false,
    action,
    container,
    command: `${commandForAction(action)} ${container}`,
    startedAt: '2026-06-01T10:00:00+02:00',
    finishedAt: '2026-06-01T10:00:18+02:00',
    exitCode: 1,
    stdout: '',
    stderr: 'container not found'
  };
}

function commandForAction(action) {
  return {
    start: 'Start-BcContainer',
    stop: 'Stop-BcContainer',
    restart: 'Restart-BcContainer',
    remove: 'Remove-BcContainer'
  }[action];
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.fail('timed out waiting for condition');
}
