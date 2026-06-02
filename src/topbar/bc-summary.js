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

  // CPU "hot" watchdog. Docker reports CPUPerc as a share of all host cores, so thresholds are
  // defined in cores and converted to a percentage against the real host core count at runtime.
  // The topbar is always mounted, so it owns the sustained ("for a long time") signal. Tunable here.
  const CONTAINER_HOT_CORES = 4;
  const AGGREGATE_HOT_FRACTION = 0.6;
  const HOT_SUSTAIN_MS = 60000;
  const DISPLAY_SMOOTH_SAMPLES = 2;

  const emptySummary = {
    label: 'BC 0',
    level: 'normal',
    title: 'No BC containers found',
    hot: false
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

    button.className = `bc-containers-trigger bc-containers-${summary.level}${summary.hot ? ' bc-containers-hot' : ''}`;
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
      timer: null,
      cpuHistory: new Map(),
      aggregateHistory: []
    };

    const open = () => openPopup(popupWidgetName, popupPresetName, { packId: popupPackId });
    const refresh = async () => {
      try {
        const model = await dataLoader();
        const flagged = applyHotFlag(formatBcContainersTopbarSummary(model), model, state, refreshIntervalMs);
        state.summary = stabilizeLabel(flagged, model, state.aggregateHistory);
      } catch (error) {
        state.cpuHistory.clear();
        state.aggregateHistory.length = 0;
        state.summary = {
          label: 'BC !',
          level: 'error',
          title: error?.message ?? String(error),
          hot: false
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
      title: summary?.title ?? 'BC container summary unavailable',
      hot: summary?.hot ?? false
    };
  }

  function hotPercentForCores(cores, coreCount) {
    const denominator = Number(coreCount) > 0 ? Number(coreCount) : 1;
    return (Number(cores) / denominator) * 100;
  }

  function resolveCoreCount(model) {
    return Number(model?.summary?.hostCpuCount)
      || Number(globalThis.navigator?.hardwareConcurrency)
      || 1;
  }

  function samplesForDuration(durationMs, intervalMs) {
    return Math.max(1, Math.ceil(Number(durationMs) / Math.max(1, Number(intervalMs))));
  }

  function countSustained(history, thresholdPercent) {
    if (!Array.isArray(history)) {
      return 0;
    }

    let sustained = 0;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const number = Number(history[index]);
      if (Number.isFinite(number) && number >= thresholdPercent) {
        sustained += 1;
      } else {
        break;
      }
    }

    return sustained;
  }

  function pushBounded(history, value, max) {
    history.push(Number(value) || 0);
    while (history.length > Math.max(1, max)) {
      history.shift();
    }
    return history;
  }

  function rollingMax(history, count) {
    if (!Array.isArray(history) || history.length === 0) {
      return 0;
    }

    return history.slice(-Math.max(1, count)).reduce((max, value) => {
      const number = Number(value);
      return Number.isFinite(number) && number > max ? number : max;
    }, 0);
  }

  // Rebuild the always-visible label from the recent peak aggregate so idle stops flickering to 0%.
  // The pure formatter stays raw; smoothing only happens here, in the controller, on history it owns.
  function stabilizeLabel(summary, model, aggregateHistory) {
    if (!summary || summary.level !== 'normal' || !aggregateHistory.length) {
      return summary;
    }

    const smoothedModel = {
      ...model,
      summary: { ...model.summary, cpuPercent: rollingMax(aggregateHistory, DISPLAY_SMOOTH_SAMPLES) }
    };
    return { ...summary, label: formatBcContainersTopbarSummary(smoothedModel).label };
  }

  // Update rolling history from the full refresh model and flag hot when the aggregate, OR any single
  // container, has stayed elevated for HOT_SUSTAIN_MS. Must be fed the raw model (with containers[]),
  // not the reduced {label, level, title} summary. `state` carries cpuHistory (Map) + aggregateHistory.
  function applyHotFlag(summary, model, state, refreshIntervalMs) {
    if (!summary || summary.level !== 'normal' || !model || model.ok === false || model.error) {
      state.cpuHistory.clear();
      state.aggregateHistory.length = 0;
      return { ...summary, hot: false };
    }

    const containers = Array.isArray(model.containers) ? model.containers : [];
    const coreCount = resolveCoreCount(model);
    const containerThreshold = hotPercentForCores(CONTAINER_HOT_CORES, coreCount);
    const aggregateThreshold = AGGREGATE_HOT_FRACTION * 100;
    const sustainSamples = samplesForDuration(HOT_SUSTAIN_MS, refreshIntervalMs);

    const running = new Set();
    for (const container of containers) {
      if (container.state !== 'running') continue;
      running.add(container.name);
      if (!state.cpuHistory.has(container.name)) {
        state.cpuHistory.set(container.name, []);
      }
      pushBounded(state.cpuHistory.get(container.name), container.cpuPercent, sustainSamples);
    }

    for (const name of [...state.cpuHistory.keys()]) {
      if (!running.has(name)) state.cpuHistory.delete(name);
    }

    pushBounded(state.aggregateHistory, model.summary?.cpuPercent, sustainSamples);

    const aggregateHot = countSustained(state.aggregateHistory, aggregateThreshold) >= sustainSamples;

    let hottest = null;
    for (const container of containers) {
      if (container.state !== 'running') continue;
      const history = state.cpuHistory.get(container.name) ?? [];
      if (countSustained(history, containerThreshold) >= sustainSamples) {
        if (!hottest || Number(container.cpuPercent) > Number(hottest.cpuPercent)) {
          hottest = container;
        }
      }
    }

    if (!aggregateHot && !hottest) {
      return { ...summary, hot: false };
    }

    const title = hottest
      ? `High CPU - ${hottest.name} - ${summary.title}`
      : `High CPU - ${summary.title}`;
    return { ...summary, hot: true, title };
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
    applyHotFlag,
    countSustained,
    createBcContainersTopbarController,
    cpuHotConfig: {
      CONTAINER_HOT_CORES,
      AGGREGATE_HOT_FRACTION,
      HOT_SUSTAIN_MS
    },
    formatBcContainersTopbarSummary,
    hotPercentForCores,
    renderBcContainersTopbarSummary,
    rollingMax,
    samplesForDuration
  };
}));
