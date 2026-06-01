(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OperatorDarkBcContainers = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const emptyRefresh = {
    ok: true,
    refreshedAt: '',
    summary: {
      total: 0,
      running: 0,
      cpuPercent: 0,
      memoryBytes: 0
    },
    containers: [],
    error: null
  };

  const actionCommands = {
    start: 'Start-BcContainer',
    stop: 'Stop-BcContainer',
    restart: 'Restart-BcContainer',
    remove: 'Remove-BcContainer'
  };

  const actionLabels = {
    open: 'Open',
    start: 'Start',
    stop: 'Stop',
    restart: 'Restart',
    remove: 'Remove'
  };

  const confirmActions = new Set(['restart', 'stop', 'remove']);

  function renderBcContainers(root, model, options = {}) {
    if (!root) {
      throw new Error('A root element is required.');
    }

    const document = root.ownerDocument;
    const data = normalizeRefreshModel(model);
    const warning = options.warning ?? data.error;
    const latestOutput = options.latestOutput ?? data.latestOutput ?? null;
    const activeAction = options.activeAction ?? null;
    const armedAction = options.armedAction ?? null;
    const handlers = options.handlers ?? {};
    const containers = sortContainers(data.containers);

    const panel = element(document, 'section', {
      className: 'bc-containers-panel',
      role: 'dialog',
      'aria-label': 'BC containers'
    }, [
      renderHeader(document, data, warning, handlers),
      warning ? renderWarning(document, warning) : null,
      activeAction ? renderActiveCommand(document, activeAction) : null,
      renderContainerList(document, containers, {
        activeAction,
        armedAction,
        handlers
      }),
      renderOutputDrawer(document, latestOutput)
    ]);

    const backdrop = element(document, 'div', { className: 'bc-backdrop' }, [panel]);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        handlers.close?.();
      }
    });

    root.replaceChildren(backdrop);
  }

  async function initializeBcContainers(options = {}) {
    const windowObject = options.window ?? globalThis.window;
    const documentObject = options.document ?? windowObject?.document;
    const root = options.root ?? documentObject?.querySelector('#app');
    const dataLoader = options.dataLoader ?? createFixtureDataLoader(windowObject);
    const actionRunner = options.actionRunner ?? createMissingActionRunner();
    const browserLauncher = options.browserLauncher ?? createBrowserLauncher({ window: windowObject });
    const lifecycle = options.lifecycle ?? createMissingLifecycle();
    const refreshIntervalMs = options.refreshIntervalMs ?? 5000;
    const confirmationMs = options.confirmationMs ?? 8000;

    if (!documentObject || !root) {
      throw new Error('A document and #app root are required.');
    }

    const state = {
      lastSuccessfulData: null,
      warning: null,
      latestOutput: null,
      activeAction: null,
      armedAction: null,
      confirmTimer: null,
      refreshTimer: null,
      currentTask: Promise.resolve()
    };

    const rerender = () => {
      renderBcContainers(root, state.lastSuccessfulData ?? emptyRefresh, {
        warning: state.warning,
        latestOutput: state.latestOutput,
        activeAction: state.activeAction,
        armedAction: state.armedAction,
        handlers: {
          close: () => closePopup(),
          open: (container) => openContainer(container),
          lifecycle: (action, container) => handleLifecycleAction(action, container)
        }
      });
    };

    const clearConfirmation = () => {
      if (state.confirmTimer && typeof windowObject?.clearTimeout === 'function') {
        windowObject.clearTimeout(state.confirmTimer);
      }

      state.confirmTimer = null;
      state.armedAction = null;
    };

    const closePopup = () => {
      clearConfirmation();

      if (typeof lifecycle.close === 'function') {
        return lifecycle.close();
      }

      return false;
    };

    const cancelInvalidConfirmation = () => {
      if (!state.armedAction) return;

      if (!isLifecycleActionAvailable(state.armedAction.action, state.armedAction.container, state.lastSuccessfulData)) {
        clearConfirmation();
      }
    };

    const armAction = (action, container) => {
      clearConfirmation();
      state.armedAction = {
        action,
        container
      };

      if (typeof windowObject?.setTimeout === 'function') {
        state.confirmTimer = windowObject.setTimeout(() => {
          clearConfirmation();
          rerender();
        }, confirmationMs);
      }

      rerender();
    };

    const refresh = async () => {
      try {
        const payload = normalizeRefreshModel(await dataLoader());
        if (payload.ok === false || payload.error) {
          state.warning = payload.error ?? newProtocolError('refresh', null, null, 'Helper refresh failed.');

          if (!state.lastSuccessfulData && payload.containers.length > 0) {
            state.lastSuccessfulData = {
              ...payload,
              ok: true,
              error: null
            };
          }
        } else {
          state.lastSuccessfulData = payload;
          state.warning = null;
        }
      } catch (error) {
        state.warning = protocolErrorFromError(error, 'refresh');
      }

      cancelInvalidConfirmation();
      rerender();
    };

    const runLifecycleAction = (action, container) => {
      if (state.activeAction) {
        return false;
      }

      clearConfirmation();
      state.activeAction = {
        action,
        container,
        command: formatActionCommand(action, container)
      };
      rerender();

      const task = (async () => {
        try {
          state.latestOutput = normalizeActionOutput(await actionRunner(action, container), action, container);
        } catch (error) {
          state.latestOutput = actionErrorOutput(action, container, error);
        } finally {
          state.activeAction = null;
          rerender();
          await refresh();
        }
      })();

      state.currentTask = task.catch(() => {});
      return true;
    };

    const handleLifecycleAction = (action, container) => {
      if (state.activeAction) {
        return false;
      }

      if (!isLifecycleActionAvailable(action, container, state.lastSuccessfulData)) {
        clearConfirmation();
        rerender();
        return false;
      }

      if (confirmActions.has(action)) {
        if (state.armedAction?.action === action && state.armedAction?.container === container) {
          return runLifecycleAction(action, container);
        }

        armAction(action, container);
        return false;
      }

      return runLifecycleAction(action, container);
    };

    const openContainer = (container) => {
      if (!isContainerOpenable(container)) {
        return false;
      }

      return browserLauncher(`http://${container.name}/bc`);
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      event.preventDefault();
      closePopup();
    };

    documentObject.addEventListener('keydown', handleKeyDown);
    rerender();

    await refresh();

    if (options.autoRefresh !== false && typeof windowObject?.setInterval === 'function') {
      state.refreshTimer = windowObject.setInterval(refresh, refreshIntervalMs);
    }

    return {
      refresh,
      destroy: () => {
        clearConfirmation();
        documentObject.removeEventListener('keydown', handleKeyDown);
        if (state.refreshTimer && typeof windowObject?.clearInterval === 'function') {
          windowObject.clearInterval(state.refreshTimer);
        }
      },
      getState: () => ({ ...state }),
      waitForIdle: () => state.currentTask
    };
  }

  function createZebarShellDataLoader(options = {}) {
    const shellExec = options.shellExec;
    const command = options.command ?? {
      program: 'cmd.exe',
      args: ['/d', '/c', 'scripts\\run-bc-containers-helper.cmd']
    };

    return async () => runHelperJson(shellExec, command, ['-Operation', 'refresh']);
  }

  function createZebarShellActionRunner(options = {}) {
    const shellExec = options.shellExec;
    const command = options.command ?? {
      program: 'cmd.exe',
      args: ['/d', '/c', 'scripts\\run-bc-containers-helper.cmd']
    };

    return async (action, container) => runHelperJson(shellExec, command, [
      '-Operation',
      'action',
      '-Action',
      action,
      '-ContainerName',
      container
    ]);
  }

  function createBrowserLauncher(options = {}) {
    const windowObject = options.window ?? globalThis.window;

    return async (url) => {
      if (typeof options.open === 'function') {
        return options.open(url);
      }

      if (typeof windowObject?.open === 'function') {
        return windowObject.open(url, '_blank', 'noopener');
      }

      throw new Error('Browser launch API is unavailable.');
    };
  }

  function renderHeader(document, data, warning, handlers = {}) {
    const summary = data.summary ?? emptyRefresh.summary;

    const closeButton = element(document, 'button', {
      className: 'close-button',
      type: 'button',
      'aria-label': 'Close BC containers',
      title: 'Close'
    }, ['X']);

    if (typeof handlers.close === 'function') {
      closeButton.addEventListener('click', () => handlers.close());
    }

    return element(document, 'header', { className: 'panel-header' }, [
      element(document, 'div', { className: 'title-block' }, [
        element(document, 'h1', { className: 'panel-title' }, ['BC containers']),
        element(document, 'div', { className: 'refresh-state', 'aria-live': 'polite' }, [
          warning ? `Refresh warning - ${formatErrorSummary(warning)}` : `Refreshed at ${data.refreshedAt || 'not yet'}`
        ])
      ]),
      element(document, 'dl', { className: 'summary-grid' }, [
        renderMetric(document, 'Total', summary.total ?? 0, 'metric-total'),
        renderMetric(document, 'Running', summary.running ?? 0, 'metric-running'),
        renderMetric(document, 'CPU', formatCpu(summary.cpuPercent), 'metric-cpu'),
        renderMetric(document, 'RAM', formatMemory(summary.memoryBytes), 'metric-memory')
      ]),
      closeButton
    ]);
  }

  function renderMetric(document, label, value, valueClass) {
    return element(document, 'div', { className: 'summary-metric' }, [
      element(document, 'dt', {}, [label]),
      element(document, 'dd', { className: valueClass }, [value])
    ]);
  }

  function renderWarning(document, warning) {
    return element(document, 'section', { className: 'helper-warning', role: 'alert' }, [
      element(document, 'strong', {}, ['Helper warning']),
      element(document, 'div', {}, [`Operation ${warning.operation ?? 'unknown'}`]),
      warning.command ? element(document, 'div', {}, [`Command ${warning.command}`]) : null,
      warning.exitCode !== null && warning.exitCode !== undefined
        ? element(document, 'div', {}, [`Exit code ${warning.exitCode}`])
        : null,
      warning.stderr ? element(document, 'pre', {}, [warning.stderr]) : null
    ]);
  }

  function renderActiveCommand(document, activeAction) {
    return element(document, 'section', { className: 'active-command', 'aria-live': 'polite' }, [
      element(document, 'strong', {}, ['Action running']),
      element(document, 'span', {}, [`${activeAction.action} ${activeAction.container}`])
    ]);
  }

  function renderContainerList(document, containers, options) {
    if (containers.length === 0) {
      return element(document, 'section', { className: 'empty-state' }, ['No BC containers found']);
    }

    return element(document, 'section', { className: 'container-list', 'aria-label': 'BC container list' },
      containers.map((container) => renderContainerRow(document, container, options))
    );
  }

  function renderContainerRow(document, container, options) {
    return element(document, 'article', {
      className: `bc-container-row state-${container.state || 'unknown'}`,
      'data-container-name': container.name
    }, [
      element(document, 'div', { className: 'container-main' }, [
        element(document, 'h2', { className: 'container-name' }, [container.name]),
        element(document, 'div', { className: 'container-status' }, [
          container.health || container.state || 'unknown',
          container.status ? ` - ${container.status}` : ''
        ]),
        renderMetadata(document, container)
      ]),
      renderResources(document, container),
      renderActions(document, container, options)
    ]);
  }

  function renderMetadata(document, container) {
    const items = [container.image, container.metadata].filter(Boolean);
    if (items.length === 0) {
      return element(document, 'div', { className: 'container-meta muted' }, ['No image metadata']);
    }

    return element(document, 'div', { className: 'container-meta' }, [items.join(' - ')]);
  }

  function renderResources(document, container) {
    if (!isContainerRunning(container)) {
      return element(document, 'dl', { className: 'resource-grid stopped' }, [
        renderMetric(document, 'State', container.state || 'unknown', 'resource-state')
      ]);
    }

    return element(document, 'dl', { className: 'resource-grid' }, [
      renderMetric(document, 'CPU', formatCpu(container.cpuPercent), 'resource-cpu'),
      renderMetric(document, 'RAM', formatMemory(container.memoryBytes), 'resource-memory')
    ]);
  }

  function renderActions(document, container, options) {
    const actions = isContainerRunning(container)
      ? ['open', 'restart', 'stop', 'remove']
      : ['open', 'start', 'remove'];

    return element(document, 'div', { className: 'actions' },
      actions.map((action) => renderActionButton(document, container, action, options))
    );
  }

  function renderActionButton(document, container, action, options) {
    const isOpen = action === 'open';
    const isLifecycle = !isOpen;
    const isArmed = options.armedAction?.action === action && options.armedAction?.container === container.name;
    const label = isArmed ? `Confirm ${action}` : actionLabels[action];
    const disabled = isOpen
      ? !isContainerOpenable(container)
      : Boolean(options.activeAction);
    const button = element(document, 'button', {
      className: `action-button action-${action}${isArmed ? ' confirm' : ''}`,
      type: 'button',
      'data-action': action,
      'data-container': container.name,
      'data-lifecycle-action': String(isLifecycle),
      disabled: disabled ? '' : null
    }, [label]);

    if (isOpen && typeof options.handlers.open === 'function') {
      button.addEventListener('click', () => {
        if (!button.disabled) options.handlers.open(container);
      });
    } else if (isLifecycle && typeof options.handlers.lifecycle === 'function') {
      button.addEventListener('click', () => {
        if (!button.disabled) options.handlers.lifecycle(action, container.name);
      });
    }

    return button;
  }

  function renderOutputDrawer(document, latestOutput) {
    if (!latestOutput) {
      return element(document, 'section', { className: 'output-drawer empty' }, [
        element(document, 'h2', {}, ['Latest output']),
        element(document, 'div', { className: 'muted' }, ['No lifecycle action has run in this popup session'])
      ]);
    }

    return element(document, 'section', { className: 'output-drawer' }, [
      element(document, 'h2', {}, ['Latest output']),
      element(document, 'dl', { className: 'output-grid' }, [
        renderMetric(document, 'Command', latestOutput.command ?? '', 'output-command'),
        renderMetric(document, 'Exit', `Exit code ${latestOutput.exitCode ?? 'unknown'}`, 'output-exit'),
        renderMetric(document, 'Started', latestOutput.startedAt ?? '', 'output-started'),
        renderMetric(document, 'Finished', latestOutput.finishedAt ?? '', 'output-finished')
      ]),
      element(document, 'section', { className: 'output-stream' }, [
        element(document, 'h3', {}, ['Stdout']),
        element(document, 'pre', {}, [latestOutput.stdout ?? ''])
      ]),
      element(document, 'section', { className: 'output-stream' }, [
        element(document, 'h3', {}, ['Stderr']),
        element(document, 'pre', {}, [latestOutput.stderr ?? ''])
      ])
    ]);
  }

  function normalizeRefreshModel(model) {
    if (!model || typeof model !== 'object') {
      return { ...emptyRefresh, containers: [] };
    }

    return {
      ok: model.ok !== false,
      refreshedAt: model.refreshedAt ?? '',
      summary: {
        total: Number(model.summary?.total ?? model.containers?.length ?? 0),
        running: Number(model.summary?.running ?? countRunning(model.containers)),
        cpuPercent: Number(model.summary?.cpuPercent ?? 0),
        memoryBytes: Number(model.summary?.memoryBytes ?? 0)
      },
      containers: Array.isArray(model.containers) ? model.containers.map(normalizeContainer) : [],
      error: model.error ?? null,
      latestOutput: model.latestOutput ?? null
    };
  }

  function normalizeContainer(container) {
    return {
      name: String(container.name ?? ''),
      state: String(container.state ?? 'unknown').toLowerCase(),
      health: container.health ? String(container.health) : '',
      status: container.status ? String(container.status) : '',
      cpuPercent: container.cpuPercent ?? null,
      memoryBytes: container.memoryBytes ?? null,
      image: container.image ? String(container.image) : '',
      metadata: container.metadata ? String(container.metadata) : ''
    };
  }

  function normalizeActionOutput(output, action, container) {
    if (!output || typeof output !== 'object') {
      throw new Error('Helper action returned invalid JSON.');
    }

    return {
      ok: output.ok !== false,
      action: output.action ?? action,
      container: output.container ?? container,
      command: output.command ?? formatActionCommand(action, container),
      startedAt: output.startedAt ?? '',
      finishedAt: output.finishedAt ?? '',
      exitCode: output.exitCode ?? null,
      stdout: output.stdout ?? '',
      stderr: output.stderr ?? output.error?.stderr ?? ''
    };
  }

  function actionErrorOutput(action, container, error) {
    const stderr = error?.stderr ?? error?.message ?? String(error);

    return {
      ok: false,
      action,
      container,
      command: error?.command ?? formatActionCommand(action, container),
      startedAt: '',
      finishedAt: '',
      exitCode: error?.exitCode ?? null,
      stdout: error?.stdout ?? '',
      stderr
    };
  }

  function sortContainers(containers) {
    return [...containers]
      .map((container, index) => ({ container, index }))
      .sort((left, right) => {
        const leftRank = isContainerRunning(left.container) ? 0 : 1;
        const rightRank = isContainerRunning(right.container) ? 0 : 1;

        return leftRank - rightRank || left.index - right.index;
      })
      .map((entry) => entry.container);
  }

  function isContainerRunning(container) {
    return container?.state === 'running';
  }

  function isContainerOpenable(container) {
    return isContainerRunning(container);
  }

  function isLifecycleActionAvailable(action, containerName, model) {
    const container = model?.containers?.find((candidate) => candidate.name === containerName);
    if (!container) return false;

    if (action === 'remove') return true;
    if (action === 'start') return !isContainerRunning(container);
    if (action === 'stop' || action === 'restart') return isContainerRunning(container);

    return false;
  }

  function countRunning(containers) {
    return Array.isArray(containers)
      ? containers.filter((container) => container?.state === 'running').length
      : 0;
  }

  function formatCpu(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return '-';
    }

    return `${formatNumber(Number(value), 1)}%`;
  }

  function formatMemory(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return '-';
    }

    const bytes = Number(value);
    if (bytes <= 0) {
      return '0 MB';
    }

    const gib = bytes / 1073741824;
    if (gib >= 1) {
      return `${formatNumber(gib, 1)} GB`;
    }

    return `${formatNumber(bytes / 1048576, 0)} MB`;
  }

  function formatNumber(value, digits) {
    const rounded = value.toFixed(digits);
    return rounded.replace(/\.0$/, '');
  }

  function formatActionCommand(action, container) {
    return `${actionCommands[action] ?? action} ${container}`;
  }

  function formatErrorSummary(error) {
    const operation = error?.operation ?? 'refresh';
    const stderr = error?.stderr ? `: ${firstLine(error.stderr)}` : '';
    return `${operation}${stderr}`;
  }

  function newProtocolError(operation, command, exitCode, stderr) {
    return {
      operation,
      command,
      exitCode,
      stderr
    };
  }

  function protocolErrorFromError(error, fallbackOperation) {
    return newProtocolError(
      error?.operation ?? fallbackOperation,
      error?.command ?? null,
      error?.exitCode ?? null,
      error?.stderr ?? error?.message ?? String(error)
    );
  }

  async function runHelperJson(shellExec, command, extraArgs) {
    if (typeof shellExec !== 'function') {
      throw new Error('Zebar shell execution API is unavailable.');
    }

    const normalized = normalizeShellCommand(command);
    const args = [...normalized.args, ...extraArgs];
    const commandText = formatShellCommand(normalized.program, args);
    const operation = getHelperOperation(extraArgs);
    const result = await shellExec(normalized.program, args);
    const stdout = typeof result === 'string' ? result : result?.stdout ?? '';
    const stderr = typeof result === 'string' ? '' : result?.stderr ?? '';
    const exitCode = typeof result === 'string' ? 0 : result?.exitCode ?? result?.code ?? 0;

    if (exitCode !== 0) {
      throw helperError({
        operation,
        command: commandText,
        exitCode,
        stdout,
        stderr: stderr || firstLine(stdout) || `Helper exited with code ${exitCode}`
      });
    }

    try {
      return JSON.parse(stdout);
    } catch {
      throw helperError({
        operation,
        command: commandText,
        exitCode,
        stdout,
        stderr: 'Helper returned invalid JSON.'
      });
    }
  }

  function helperError(details) {
    const error = new Error(firstLine(details.stderr) || `Helper ${details.operation} failed.`);
    error.operation = details.operation;
    error.command = details.command;
    error.exitCode = details.exitCode;
    error.stdout = details.stdout;
    error.stderr = details.stderr;
    return error;
  }

  function getHelperOperation(args) {
    const operationIndex = args.findIndex((arg) => String(arg).toLowerCase() === '-operation');
    if (operationIndex >= 0 && args[operationIndex + 1]) {
      return String(args[operationIndex + 1]);
    }

    return 'helper';
  }

  function formatShellCommand(program, args) {
    return [program, ...args].map(quoteShellDisplayArg).join(' ');
  }

  function quoteShellDisplayArg(value) {
    const text = String(value ?? '');
    if (text === '') {
      return '""';
    }

    if (/[\s"]/u.test(text)) {
      return `"${text.replace(/"/g, '\\"')}"`;
    }

    return text;
  }

  function normalizeShellCommand(command) {
    if (command && typeof command === 'object') {
      return {
        program: command.program,
        args: Array.isArray(command.args) ? command.args : []
      };
    }

    const parts = splitCommandLine(String(command ?? ''));
    return {
      program: parts[0] ?? '',
      args: parts.slice(1)
    };
  }

  function splitCommandLine(command) {
    const parts = [];
    const pattern = /"([^"]+)"|(\S+)/g;
    let match;

    while ((match = pattern.exec(command)) !== null) {
      parts.push(match[1] ?? match[2]);
    }

    return parts;
  }

  function createFixtureDataLoader(windowObject) {
    return async () => {
      if (windowObject?.OperatorDarkBcContainersFixture) {
        return windowObject.OperatorDarkBcContainersFixture;
      }

      return emptyRefresh;
    };
  }

  function createMissingActionRunner() {
    return async () => {
      throw new Error('Lifecycle action helper is unavailable.');
    };
  }

  function createMissingLifecycle() {
    return {
      close: async () => false
    };
  }

  function firstLine(value) {
    return String(value ?? '').split(/\r?\n/).find((line) => line.trim())?.trim() ?? '';
  }

  function element(document, tagName, attributes = {}, children = []) {
    const node = document.createElement(tagName);

    for (const [key, value] of Object.entries(attributes)) {
      if (value === null || value === undefined || value === false) {
        continue;
      }

      if (key === 'className') {
        node.className = value;
      } else if (key === 'disabled') {
        node.disabled = true;
      } else {
        node.setAttribute(key, value);
      }
    }

    for (const child of children) {
      if (child === null || child === undefined) {
        continue;
      }

      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }

    return node;
  }

  return {
    createBrowserLauncher,
    createZebarShellActionRunner,
    createZebarShellDataLoader,
    formatMemory,
    initializeBcContainers,
    renderBcContainers
  };
}));
