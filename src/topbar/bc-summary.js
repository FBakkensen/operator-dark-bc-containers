(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OperatorDarkBcContainersTopbar = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const popupWidgetName = 'bc-containers';
  const popupPresetName = 'popup';
  const popupPackId = 'operator-dark-bc-containers';
  const defaultRefreshIntervalMs = 10000;

  const emptySummary = {
    label: 'BC 0',
    level: 'normal',
    title: 'No BC containers found'
  };

  function formatBcContainersTopbarSummary(model) {
    if (!model || model.ok === false || model.error) {
      return {
        label: 'BC !',
        level: 'error',
        title: formatErrorTitle(model?.error)
      };
    }

    const summary = model.summary ?? {};
    const total = Number(summary.total ?? 0);
    const running = Number(summary.running ?? 0);

    if (total <= 0) {
      return { ...emptySummary };
    }

    return {
      label: `BC ${total} CPU ${formatCpu(summary.cpuPercent)} RAM ${formatCompactMemory(summary.memoryBytes)}`,
      level: 'normal',
      title: `${running} running of ${total} BC containers`
    };
  }

  function renderBcContainersTopbarSummary(root, model, options = {}) {
    if (!root) {
      throw new Error('A root element is required.');
    }

    const document = root.ownerDocument;
    const summary = normalizeSummary(options.summary ?? formatBcContainersTopbarSummary(model));
    const button = document.createElement('button');

    button.className = `bc-containers-trigger bc-containers-${summary.level}`;
    button.type = 'button';
    button.title = summary.title;
    button.textContent = summary.label;
    button.addEventListener('click', () => {
      options.onOpen?.();
    });

    root.replaceChildren(button);
    return button;
  }

  async function createBcContainersTopbarController(options = {}) {
    const root = options.root;
    const dataLoader = options.dataLoader ?? createMissingDataLoader();
    const openPopup = options.openPopup ?? createMissingPopupOpener();
    const refreshIntervalMs = options.refreshIntervalMs ?? defaultRefreshIntervalMs;
    const setIntervalFn = options.setInterval ?? globalThis.setInterval;
    const clearIntervalFn = options.clearInterval ?? globalThis.clearInterval;
    const state = {
      summary: { ...emptySummary },
      timer: null
    };

    const open = () => openPopup(popupWidgetName, popupPresetName, { packId: popupPackId });
    const refresh = async () => {
      try {
        state.summary = formatBcContainersTopbarSummary(await dataLoader());
      } catch (error) {
        state.summary = {
          label: 'BC !',
          level: 'error',
          title: error?.message ?? String(error)
        };
      }

      renderBcContainersTopbarSummary(root, null, {
        summary: state.summary,
        onOpen: open
      });
    };

    await refresh();

    if (typeof setIntervalFn === 'function') {
      state.timer = setIntervalFn(refresh, refreshIntervalMs);
    }

    return {
      refresh,
      destroy: () => {
        if (state.timer && typeof clearIntervalFn === 'function') {
          clearIntervalFn(state.timer);
        }
      },
      getState: () => ({ ...state })
    };
  }

  function normalizeSummary(summary) {
    return {
      label: summary?.label ?? 'BC !',
      level: summary?.level ?? 'error',
      title: summary?.title ?? 'BC container summary unavailable'
    };
  }

  function formatCpu(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${Math.round(number)}%` : '0%';
  }

  function formatCompactMemory(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0M';
    }

    const gib = bytes / 1073741824;
    if (gib >= 1) {
      return `${formatNumber(gib, 1)}G`;
    }

    return `${formatNumber(bytes / 1048576, 0)}M`;
  }

  function formatNumber(value, digits) {
    return value.toFixed(digits).replace(/\.0$/, '');
  }

  function formatErrorTitle(error) {
    if (!error) {
      return 'BC container refresh failed';
    }

    const operation = error.operation ?? 'refresh';
    const stderr = firstLine(error.stderr);
    return stderr ? `${operation}: ${stderr}` : `${operation} failed`;
  }

  function firstLine(value) {
    return String(value ?? '').split(/\r?\n/).find((line) => line.trim())?.trim() ?? '';
  }

  function createMissingDataLoader() {
    return async () => {
      throw new Error('BC containers helper is unavailable.');
    };
  }

  function createMissingPopupOpener() {
    return async () => {
      throw new Error('Zebar popup API is unavailable.');
    };
  }

  return {
    createBcContainersTopbarController,
    formatBcContainersTopbarSummary,
    renderBcContainersTopbarSummary
  };
}));
