(function () {
  const app = window.OperatorDarkBcContainers;

  if (!app) {
    throw new Error('OperatorDarkBcContainers app API was not loaded.');
  }

  const relativeHelperCommand = {
    program: 'cmd.exe',
    args: ['/d', '/c', 'scripts\\run-bc-containers-helper.cmd']
  };

  function createShellExec(zebar) {
    if (!isTauriRuntime()) {
      return null;
    }

    if (typeof zebar?.shellExec === 'function') {
      return zebar.shellExec;
    }

    if (typeof zebar?.shell?.exec === 'function') {
      return zebar.shell.exec.bind(zebar.shell);
    }

    return null;
  }

  function createZebarLifecycle(zebar) {
    const currentWidget = getCurrentWidget(zebar);

    return {
      close: async () => {
        if (typeof currentWidget?.close === 'function') {
          return currentWidget.close();
        }

        if (typeof currentWidget?.tauriWindow?.close === 'function') {
          return currentWidget.tauriWindow.close();
        }

        if (typeof currentWidget?.window?.tauri?.close === 'function') {
          return currentWidget.window.tauri.close();
        }

        return false;
      }
    };
  }

  function createZebarHelperCommand(zebar) {
    const currentWidget = getCurrentWidget(zebar);
    const packRoot = getPackRoot(currentWidget?.configPath)
      ?? getPackRoot(currentWidget?.htmlPath)
      ?? getPackRoot(window.location?.href);

    if (!packRoot) {
      return null;
    }

    return {
      program: 'cmd.exe',
      args: ['/d', '/c', `${packRoot}\\scripts\\run-bc-containers-helper.cmd`]
    };
  }

  async function bootstrapBcContainers(options = {}) {
    const zebar = options.zebar ?? window.zebar ?? window.OperatorDarkBcContainersZebar;
    const shellExec = options.shellExec ?? createShellExec(zebar);
    const root = options.root ?? window.document.querySelector('#app');
    const lifecycle = options.lifecycle ?? createZebarLifecycle(zebar);
    const helperCommand = options.helperCommand
      ?? window.OPERATOR_DARK_BC_CONTAINERS_HELPER_COMMAND
      ?? createZebarHelperCommand(zebar)
      ?? relativeHelperCommand;

    if (window.OperatorDarkBcContainersController) {
      window.OperatorDarkBcContainersController.destroy?.();
    }

    const dataLoader = shellExec
      ? app.createZebarShellDataLoader({ shellExec, command: helperCommand })
      : async () => window.OperatorDarkBcContainersFixture;
    const actionRunner = shellExec
      ? app.createZebarShellActionRunner({ shellExec, command: helperCommand })
      : async (action, container) => ({
          ok: false,
          action,
          container,
          command: `${action} ${container}`,
          startedAt: '',
          finishedAt: '',
          exitCode: null,
          stdout: '',
          stderr: 'Zebar shell execution API is unavailable.'
        });
    const browserLauncher = shellExec
      ? app.createZebarShellBrowserLauncher({ shellExec, command: helperCommand })
      : app.createBrowserLauncher({ window });

    window.OperatorDarkBcContainersController = await app.initializeBcContainers({
      window,
      document: window.document,
      root,
      dataLoader,
      actionRunner,
      lifecycle,
      browserLauncher,
      autoRefresh: Boolean(shellExec)
    });

    return window.OperatorDarkBcContainersController;
  }

  window.BcContainersWidget = {
    ...app,
    bootstrapBcContainers,
    createZebarHelperCommand,
    createZebarLifecycle
  };

  function isTauriRuntime() {
    return Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__);
  }

  function getCurrentWidget(zebar) {
    try {
      return typeof zebar?.currentWidget === 'function'
        ? zebar.currentWidget()
        : zebar?.currentWidget;
    } catch {
      return null;
    }
  }

  function getPackRoot(value) {
    const localPath = toLocalPath(value);
    if (!localPath) {
      return null;
    }

    const normalized = localPath.replace(/\//g, '\\').replace(/\\+$/u, '');
    if (/\\zpack\.json$/iu.test(normalized) || /\\[^\\]+\.html$/iu.test(normalized)) {
      return normalized.replace(/\\[^\\]+$/u, '');
    }

    return normalized;
  }

  function toLocalPath(value) {
    if (!value) {
      return null;
    }

    const text = String(value);
    if (text.startsWith('file://')) {
      try {
        const url = new URL(text);
        return decodeURIComponent(url.pathname).replace(/^\/([a-zA-Z]:)/u, '$1');
      } catch {
        return null;
      }
    }

    if (/^[a-zA-Z]:[\\/]/u.test(text) || /^\\\\/u.test(text)) {
      return text;
    }

    return null;
  }
}());
