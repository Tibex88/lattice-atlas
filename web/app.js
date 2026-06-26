const state = {
  dataset: "lat",
  level: 6,
  trendMode: "counts",
  pageSize: 50,
  offset: 0,
  total: 0,
  summaryRows: [],
  appendixData: null,
  cooccurrenceData: null,
  primaryEntry: null,
  secondaryEntry: null,
  filterBounds: null,
  propertyOptions: [],
  filters: {
    widthMin: "",
    widthMax: "",
    heightMin: "",
    heightMax: "",
    countMin: "",
    countMax: "",
    properties: [],
  },
};

const byId = (id) => document.getElementById(id);

class AppError extends Error {
  constructor(message, { kind = "runtime", status = null, requestId = null, context = {}, cause = null } = {}) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
    this.status = status;
    this.requestId = requestId;
    this.context = context;
    this.cause = cause;
  }
}

const Logger = (() => {
  let instance;

  class BrowserLogger {
    _emit(level, event, details = {}) {
      const stamp = new Date().toISOString();
      const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
      const prefix = `[Residuals][${level.toUpperCase()}][${stamp}] ${event}`;
      const payload = Object.fromEntries(Object.entries(details).filter(([, value]) => value != null));
      if (Object.keys(payload).length) {
        console[method](prefix, payload);
      } else {
        console[method](prefix);
      }
    }

    info(event, details) {
      this._emit("info", event, details);
    }

    warn(event, details) {
      this._emit("warn", event, details);
    }

    error(event, details) {
      this._emit("error", event, details);
    }
  }

  return {
    get() {
      if (!instance) {
        instance = new BrowserLogger();
      }
      return instance;
    },
  };
})();

const logger = Logger.get();

const ErrorHub = (() => {
  let instance;

  class BrowserErrorHub {
    constructor() {
      this.globalHandlersInstalled = false;
    }

    installGlobalHandlers() {
      if (this.globalHandlersInstalled) {
        return;
      }
      this.globalHandlersInstalled = true;
      window.addEventListener("error", (event) => {
        this.handle(event.error || new Error(event.message), { source: "window.error", kind: "runtime" });
      });
      window.addEventListener("unhandledrejection", (event) => {
        this.handle(event.reason || new Error("Unhandled promise rejection"), {
          source: "window.unhandledrejection",
          kind: "runtime",
        });
      });
    }

    normalize(error, context = {}) {
      if (error instanceof AppError) {
        return error;
      }
      if (context.kind) {
        return new AppError(error?.message || "Application error.", {
          kind: context.kind,
          context,
          cause: error,
        });
      }
      if (error instanceof TypeError && /fetch/i.test(error.message)) {
        return new AppError(error.message, {
          kind: "network",
          context,
          cause: error,
        });
      }
      if (context.source && /render|viewer|controls|boot/.test(context.source)) {
        return new AppError(error?.message || "Interface error.", {
          kind: "ui",
          context,
          cause: error,
        });
      }
      return new AppError(error?.message || "Unexpected runtime error.", {
        kind: "runtime",
        context,
        cause: error,
      });
    }

    ensureNotice() {
      let notice = byId("globalNotice");
      if (notice || !document.body) {
        return notice;
      }
      notice = document.createElement("div");
      notice.id = "globalNotice";
      notice.className = "global-notice";

      const text = document.createElement("div");
      text.className = "global-notice-copy";

      const title = document.createElement("strong");
      title.id = "globalNoticeTitle";

      const body = document.createElement("span");
      body.id = "globalNoticeBody";

      text.append(title, body);

      const close = document.createElement("button");
      close.type = "button";
      close.className = "global-notice-close";
      close.textContent = "Dismiss";
      close.addEventListener("click", () => this.clear());

      notice.append(text, close);
      document.body.prepend(notice);
      return notice;
    }

    present(error) {
      const notice = this.ensureNotice();
      if (!notice) {
        return;
      }
      const titleMap = {
        network: "Data request failed",
        ui: "Interface error",
        runtime: "Unexpected error",
      };
      notice.dataset.kind = error.kind;
      byId("globalNoticeTitle").textContent = `${titleMap[error.kind] || "Application error"}: `;
      byId("globalNoticeBody").textContent = error.requestId
        ? `${error.message} Request ${error.requestId}.`
        : error.message;
    }

    clear() {
      const notice = byId("globalNotice");
      if (notice) {
        notice.remove();
      }
    }

    handle(error, context = {}) {
      const appError = this.normalize(error, context);
      const log = appError.kind === "network" && appError.status && appError.status < 500 ? "warn" : "error";
      logger[log]("error.captured", {
        kind: appError.kind,
        status: appError.status,
        requestId: appError.requestId,
        message: appError.message,
        source: context.source,
        context: appError.context,
        cause: appError.cause?.message,
      });
      if (!context.silent) {
        this.present(appError);
      }
      return appError;
    }
  }

  return {
    get() {
      if (!instance) {
        instance = new BrowserErrorHub();
      }
      return instance;
    },
  };
})();

const errors = ErrorHub.get();

function protect(source, fn, baseContext = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      errors.handle(error, { ...baseContext, source });
      return null;
    }
  };
}

const LoadingHub = (() => {
  let instance;

  class Loader {
    constructor() {
      this.regions = new Map();
    }

    ensureRegion(name) {
      if (this.regions.has(name)) {
        return this.regions.get(name);
      }
      const configs = {
        summary: { element: byId("summary") },
        controls: { element: byId("controlsPanel"), disable: "button, input, select" },
        entries: { element: byId("entriesPanel"), disable: "button, input, select" },
        analysis: { element: byId("analysisShell"), disable: "button, input, select" },
        appendix: { element: byId("appendixShell"), disable: "button, input, select" },
        primary: { element: byId("primaryCard"), disable: "button, input, select" },
        secondary: { element: byId("secondaryCard"), disable: "button, input, select" },
        family: { element: byId("familyShell"), disable: "button, input, select" },
      };
      const config = configs[name];
      if (!config?.element) {
        return null;
      }
      const region = {
        ...config,
        count: 0,
        disabled: new Map(),
      };
      this.regions.set(name, region);
      return region;
    }

    set(name, label) {
      const region = this.ensureRegion(name);
      if (!region) {
        return;
      }
      region.count += 1;
      region.element.dataset.loading = "true";
      region.element.dataset.loadingLabel = label || "Loading...";
      if (!region.overlay) {
        const overlay = document.createElement("div");
        overlay.className = "loading-overlay";
        overlay.innerHTML = `
          <div class="loading-overlay-card">
            <div class="loading-spinner" aria-hidden="true"></div>
            <div class="loading-text"></div>
          </div>
        `;
        region.overlay = overlay;
      }
      region.overlay.querySelector(".loading-text").textContent = region.element.dataset.loadingLabel;
      if (!region.overlay.isConnected) {
        region.element.append(region.overlay);
      }
      if (region.disable) {
        region.element.querySelectorAll(region.disable).forEach((node) => {
          if (!region.disabled.has(node)) {
            region.disabled.set(node, !!node.disabled);
          }
          node.disabled = true;
        });
      }
    }

    clear(name) {
      const region = this.ensureRegion(name);
      if (!region) {
        return;
      }
      region.count = Math.max(region.count - 1, 0);
      if (region.count > 0) {
        return;
      }
      delete region.element.dataset.loading;
      delete region.element.dataset.loadingLabel;
      region.overlay?.remove();
      region.disabled.forEach((wasDisabled, node) => {
        node.disabled = wasDisabled;
      });
      region.disabled.clear();
    }

    async run(name, label, fn) {
      this.set(name, label);
      try {
        return await fn();
      } finally {
        this.clear(name);
      }
    }
  }

  return {
    get() {
      if (!instance) {
        instance = new Loader();
      }
      return instance;
    },
  };
})();

const loading = LoadingHub.get();

async function fetchPropertyFilters() {
  return loading.run("controls", "Loading property filters...", async () => {
    const payload = await fetchJson(`/api/filter-options?dataset=${state.dataset}`);
    renderPropertyFilters(payload);
    return payload;
  });
}

async function loadSummary() {
  return loading.run("summary", "Loading summary...", async () => {
    state.summaryRows = await fetchJson("/api/summary");
    renderSummary(state.summaryRows);
    return state.summaryRows;
  });
}

async function fetchJson(url) {
  const candidates = [url];
  if (window.location.port !== "8000") {
    candidates.push(`${window.location.protocol}//${window.location.hostname || "127.0.0.1"}:8000${url}`);
  }
  let lastError;
  for (const candidate of candidates) {
    const started = performance.now();
    try {
      const res = await fetch(candidate);
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new AppError(
          payload?.error?.message || `Request failed with status ${res.status}.`,
          {
            kind: "network",
            status: res.status,
            requestId: payload?.error?.request_id || null,
            context: {
              url: candidate,
              errorKind: payload?.error?.kind || null,
            },
          },
        );
      }
      logger.info("api.request", {
        url: candidate,
        status: res.status,
        durationMs: Math.round(performance.now() - started),
      });
      return payload;
    } catch (error) {
      lastError = error instanceof AppError
        ? error
        : new AppError(error.message || "Fetch failed.", {
          kind: "network",
          context: { url: candidate },
          cause: error,
        });
      logger.warn("api.request_failed", {
        url: candidate,
        status: lastError.status,
        requestId: lastError.requestId,
        message: lastError.message,
      });
    }
  }
  throw lastError;
}

function optionMarkup(values, selected) {
  return values.map((value) => `<option value="${value}" ${String(value) === String(selected) ? "selected" : ""}>${value}</option>`).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function numberFmt(value, digits = 0) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function distinct(values) {
  return [...new Set(values)];
}

function buildSummaryIndex(rows) {
  const index = new Map();
  rows.forEach((row) => index.set(`${row.dataset}:${row.n}`, row));
  return index;
}

function summaryRow(index, dataset, n) {
  return index.get(`${dataset}:${n}`) || null;
}

function renderSummary(rows) {
  const box = byId("summary");
  box.innerHTML = rows.map((row) => {
    const max = row.max_count ? `, max expansions ${row.max_count.toLocaleString()}` : "";
    return `<div class="summary-row"><span>${row.dataset}${row.n}</span><span>${row.entries.toLocaleString()} entries${max}</span></div>`;
  }).join("");
}

function currentFilterQuery() {
  const params = new URLSearchParams();
  if (state.filters.widthMin && Number(state.filters.widthMin) !== state.filterBounds.width_min) params.set("width_min", state.filters.widthMin);
  if (state.filters.widthMax && Number(state.filters.widthMax) !== state.filterBounds.width_max) params.set("width_max", state.filters.widthMax);
  if (state.filters.heightMin && Number(state.filters.heightMin) !== state.filterBounds.height_min) params.set("height_min", state.filters.heightMin);
  if (state.filters.heightMax && Number(state.filters.heightMax) !== state.filterBounds.height_max) params.set("height_max", state.filters.heightMax);
  if (state.dataset === "extlat") {
    if (state.filters.countMin) params.set("count_min", state.filters.countMin);
    if (state.filters.countMax) params.set("count_max", state.filters.countMax);
  }
  state.filters.properties.forEach((value) => params.append("prop", value));
  return params.toString();
}

function currentQueryParamsObject() {
  const params = new URLSearchParams();
  params.set("dataset", state.dataset);
  params.set("n", String(state.level));
  params.set("page_size", String(state.pageSize));
  if (state.offset) params.set("offset", String(state.offset));
  if (state.trendMode !== "counts") params.set("trend", state.trendMode);
  const filterParams = new URLSearchParams(currentFilterQuery());
  filterParams.forEach((value, key) => params.append(key, value));
  const primaryIndex = byId("primaryIndex")?.value;
  if (primaryIndex && Number(primaryIndex) !== 0) params.set("primary_index", primaryIndex);
  const secondaryDataset = byId("secondaryDataset")?.value;
  const secondaryLevel = byId("secondaryLevel")?.value;
  const secondaryIndex = byId("secondaryIndex")?.value;
  if (secondaryDataset && secondaryDataset !== "reslat") params.set("secondary_dataset", secondaryDataset);
  if (secondaryLevel && Number(secondaryLevel) !== state.level) params.set("secondary_n", secondaryLevel);
  if (secondaryIndex && Number(secondaryIndex) !== 0) params.set("secondary_index", secondaryIndex);
  return params;
}

function syncUrlState() {
  const params = currentQueryParamsObject();
  const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  window.history.replaceState(null, "", next);
}

function restoreStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const dataset = params.get("dataset");
  if (dataset) state.dataset = dataset;
  const level = params.get("n");
  if (level) state.level = Number(level);
  const pageSize = params.get("page_size");
  if (pageSize) state.pageSize = Number(pageSize);
  const offset = params.get("offset");
  if (offset) state.offset = Number(offset);
  const trend = params.get("trend");
  if (trend === "ratios") state.trendMode = "ratios";
  state.filters = {
    widthMin: params.get("width_min") || "",
    widthMax: params.get("width_max") || "",
    heightMin: params.get("height_min") || "",
    heightMax: params.get("height_max") || "",
    countMin: params.get("count_min") || "",
    countMax: params.get("count_max") || "",
    properties: params.getAll("prop"),
  };
  return {
    primaryIndex: params.get("primary_index") || "0",
    secondaryDataset: params.get("secondary_dataset") || "reslat",
    secondaryLevel: params.get("secondary_n") || String(state.level),
    secondaryIndex: params.get("secondary_index") || "0",
  };
}

function applyFilterInputsFromState() {
  if (state.filterBounds) {
    byId("filterWidthMin").value = state.filters.widthMin || state.filterBounds.width_min;
    byId("filterWidthMax").value = state.filters.widthMax || state.filterBounds.width_max;
    byId("filterHeightMin").value = state.filters.heightMin || state.filterBounds.height_min;
    byId("filterHeightMax").value = state.filters.heightMax || state.filterBounds.height_max;
  }
  byId("filterCountMin").value = state.filters.countMin || "";
  byId("filterCountMax").value = state.filters.countMax || "";
  document.querySelectorAll(".property-check").forEach((input) => {
    input.checked = state.filters.properties.includes(input.value);
  });
  updateDoubleSlider("Width");
  updateDoubleSlider("Height");
}

function boundFilterValue(value, min, max) {
  if (value === "" || value == null) {
    return "";
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return "";
  }
  return String(Math.min(Math.max(numeric, min), max));
}

function ensureFilterValuesWithinBounds() {
  if (!state.filterBounds) {
    return;
  }
  state.filters.widthMin = boundFilterValue(state.filters.widthMin, state.filterBounds.width_min, state.filterBounds.width_max);
  state.filters.widthMax = boundFilterValue(state.filters.widthMax, state.filterBounds.width_min, state.filterBounds.width_max);
  state.filters.heightMin = boundFilterValue(state.filters.heightMin, state.filterBounds.height_min, state.filterBounds.height_max);
  state.filters.heightMax = boundFilterValue(state.filters.heightMax, state.filterBounds.height_min, state.filterBounds.height_max);
  if (state.filters.widthMin && state.filters.widthMax && Number(state.filters.widthMin) > Number(state.filters.widthMax)) {
    state.filters.widthMax = state.filters.widthMin;
  }
  if (state.filters.heightMin && state.filters.heightMax && Number(state.filters.heightMin) > Number(state.filters.heightMax)) {
    state.filters.heightMax = state.filters.heightMin;
  }
}

function renderConstraintSummary() {
  const bits = [];
  if (state.filterBounds) {
    const widthChanged = (state.filters.widthMin && Number(state.filters.widthMin) !== state.filterBounds.width_min)
      || (state.filters.widthMax && Number(state.filters.widthMax) !== state.filterBounds.width_max);
    const heightChanged = (state.filters.heightMin && Number(state.filters.heightMin) !== state.filterBounds.height_min)
      || (state.filters.heightMax && Number(state.filters.heightMax) !== state.filterBounds.height_max);
    if (widthChanged) bits.push(`w ${state.filters.widthMin || "min"}-${state.filters.widthMax || "max"}`);
    if (heightChanged) bits.push(`h ${state.filters.heightMin || "min"}-${state.filters.heightMax || "max"}`);
  }
  if (state.dataset === "extlat" && (state.filters.countMin || state.filters.countMax)) {
    bits.push(`count ${state.filters.countMin || "min"}-${state.filters.countMax || "max"}`);
  }
  if (state.filters.properties.length) bits.push(`${state.filters.properties.length} properties`);
  bits.push(`${state.dataset}${state.level}`);
  byId("constraintSummary").textContent = bits.length ? bits.join(" • ") : "No active query constraints.";
}

function syncFilterStateFromInputs() {
  state.filters.widthMin = byId("filterWidthMin").value.trim();
  state.filters.widthMax = byId("filterWidthMax").value.trim();
  state.filters.heightMin = byId("filterHeightMin").value.trim();
  state.filters.heightMax = byId("filterHeightMax").value.trim();
  state.filters.countMin = byId("filterCountMin").value.trim();
  state.filters.countMax = byId("filterCountMax").value.trim();
  state.filters.properties = [...document.querySelectorAll(".property-check:checked")].map((input) => input.value);
}

function clearFilterInputs() {
  if (state.filterBounds) {
    byId("filterWidthMin").value = state.filterBounds.width_min;
    byId("filterWidthMax").value = state.filterBounds.width_max;
    byId("filterHeightMin").value = state.filterBounds.height_min;
    byId("filterHeightMax").value = state.filterBounds.height_max;
  }
  ["filterCountMin", "filterCountMax"].forEach((id) => {
    byId(id).value = "";
  });
  document.querySelectorAll(".property-check").forEach((input) => {
    input.checked = false;
  });
  state.filters = {
    widthMin: state.filterBounds ? String(state.filterBounds.width_min) : "",
    widthMax: state.filterBounds ? String(state.filterBounds.width_max) : "",
    heightMin: state.filterBounds ? String(state.filterBounds.height_min) : "",
    heightMax: state.filterBounds ? String(state.filterBounds.height_max) : "",
    countMin: "",
    countMax: "",
    properties: [],
  };
  updateDoubleSlider("Width");
  updateDoubleSlider("Height");
  renderConstraintSummary();
}

function renderPropertyFilters(payload) {
  state.propertyOptions = payload.properties;
  byId("countFilterRow").style.display = state.dataset === "extlat" ? "grid" : "none";
  byId("propertyFilters").innerHTML = payload.properties.map((prop) => `
    <label class="property-item">
      <input class="property-check" type="checkbox" value="${prop.key}">
      <span>${prop.label}</span>
    </label>
  `).join("");
  const infoButton = byId("propertyFiltersInfo");
  if (infoButton) {
    const definitions = payload.properties.map((prop) => `
      <div class="info-definition-item">
        <div class="info-definition-head">
          <strong>${escapeHtml(prop.label)}</strong>
          <span class="info-definition-kind">${escapeHtml(prop.kind)}</span>
        </div>
        <div class="meta">${escapeHtml(prop.description || "")}</div>
      </div>
    `).join("");
    infoButton.dataset.infoBodyHtml = `
      <div class="meta">These filters come from the current dataset's property schema.</div>
      <div class="info-definition-list">${definitions}</div>
    `;
  }
}

function updateDoubleSlider(name) {
  const minInput = byId(`filter${name}Min`);
  const maxInput = byId(`filter${name}Max`);
  if (!minInput || !maxInput) {
    return;
  }
  const lower = name.toLowerCase();
  const active = byId(`${lower}SliderActive`);
  const label = byId(`${lower}RangeLabel`);
  if (!active || !label) {
    return;
  }
  const min = Number(minInput.min);
  const max = Number(maxInput.max);
  const currentMin = Number(minInput.value);
  const currentMax = Number(maxInput.value);
  const left = ((currentMin - min) / Math.max(max - min, 1)) * 100;
  const right = ((currentMax - min) / Math.max(max - min, 1)) * 100;
  active.style.left = `${left}%`;
  active.style.width = `${Math.max(right - left, 0)}%`;
  label.textContent = `${currentMin} to ${currentMax}`;
}

function wireDoubleSlider(name) {
  const minInput = byId(`filter${name}Min`);
  const maxInput = byId(`filter${name}Max`);
  if (!minInput || !maxInput) {
    return;
  }
  const handler = (source) => {
    const minValue = Number(minInput.value);
    const maxValue = Number(maxInput.value);
    if (minValue > maxValue) {
      if (source === "min") {
        maxInput.value = minInput.value;
      } else {
        minInput.value = maxInput.value;
      }
    }
    updateDoubleSlider(name);
  };
  minInput.addEventListener("input", () => handler("min"));
  maxInput.addEventListener("input", () => handler("max"));
}

async function loadFilterBounds() {
  return loading.run("controls", "Loading filter bounds...", async () => {
    state.filterBounds = await fetchJson(`/api/filter-bounds?dataset=${state.dataset}&n=${state.level}`);
    const widthMin = byId("filterWidthMin");
    const widthMax = byId("filterWidthMax");
    const heightMin = byId("filterHeightMin");
    const heightMax = byId("filterHeightMax");
    widthMin.min = state.filterBounds.width_min;
    widthMin.max = state.filterBounds.width_max;
    widthMax.min = state.filterBounds.width_min;
    widthMax.max = state.filterBounds.width_max;
    heightMin.min = state.filterBounds.height_min;
    heightMin.max = state.filterBounds.height_max;
    heightMax.min = state.filterBounds.height_min;
    heightMax.max = state.filterBounds.height_max;
    ensureFilterValuesWithinBounds();
    applyFilterInputsFromState();
    renderConstraintSummary();
  });
}

function renderMetricCards(metrics) {
  byId("metricCards").innerHTML = `
    <article class="metric-card">
      <div class="metric-label">Lattices</div>
      <div class="metric-value">${numberFmt(metrics.lattices)}</div>
      <div class="metric-note">Base lattice shapes at n = ${metrics.n}</div>
    </article>
    <article class="metric-card">
      <div class="metric-label">Reducts</div>
      <div class="metric-value">${numberFmt(metrics.reducts)}</div>
      <div class="metric-note">${numberFmt(metrics.reduct_ratio * 100, 1)}% of lattices admit expansions</div>
    </article>
    <article class="metric-card">
      <div class="metric-label">Residuated</div>
      <div class="metric-value">${numberFmt(metrics.residuated_lattices)}</div>
      <div class="metric-note">${numberFmt(metrics.expansions_per_reduct, 1)} expansions per reduct on average</div>
    </article>
    <article class="metric-card">
      <div class="metric-label">Peak extlat</div>
      <div class="metric-value">${numberFmt(metrics.max_expansions)}</div>
      <div class="metric-note">Largest expansion count for one base lattice</div>
    </article>
  `;
}

function renderTrendChart() {
  const toggleButtons = [
    ["trendCounts", state.trendMode === "counts"],
    ["trendRatios", state.trendMode === "ratios"],
  ];
  toggleButtons.forEach(([id, active]) => {
    const button = byId(id);
    if (button) {
      button.classList.toggle("is-active", active);
    }
  });
  const width = 760;
  const height = 280;
  const margin = { top: 18, right: 16, bottom: 34, left: 56 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  const summaryIndex = buildSummaryIndex(state.summaryRows);
  let series;
  let yTicks;
  let y;
  let gridLines = [];
  let legend = "";
  const x = (n) => margin.left + ((n - 1) / 11) * chartW;

  if (state.trendMode === "counts") {
    const datasets = [
      { key: "lat", color: "#0f766e", label: "lattices" },
      { key: "extlat", color: "#c2410c", label: "reducts" },
      { key: "reslat", color: "#2563eb", label: "residuated" },
    ];
    series = datasets.map((dataset) => ({
      ...dataset,
      points: Array.from({ length: 12 }, (_, offset) => {
        const n = offset + 1;
        if (dataset.key === "extlat") {
          const row = summaryRow(summaryIndex, "extlat", n);
          return { n, value: row ? row.reducts || 0 : 0 };
        }
        const row = summaryRow(summaryIndex, dataset.key, n);
        return { n, value: row ? row.entries : 0 };
      }),
    }));
    const values = series.flatMap((item) => item.points.map((point) => Math.max(point.value, 1)));
    const minLog = Math.log10(Math.min(...values));
    const maxLog = Math.log10(Math.max(...values));
    y = (value) => {
      const lv = Math.log10(Math.max(value, 1));
      return margin.top + (maxLog - lv) / Math.max(maxLog - minLog, 1) * chartH;
    };
    for (let p = Math.floor(minLog); p <= Math.ceil(maxLog); p += 1) {
      const yy = y(10 ** p);
      gridLines.push(`<line x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}" class="chart-grid"></line>`);
      gridLines.push(`<text x="${margin.left - 10}" y="${yy + 4}" text-anchor="end" class="chart-axis">1e${p}</text>`);
    }
  } else {
    series = [
      {
        key: "reduct_ratio",
        color: "#c2410c",
        label: "reducts / lattices",
        points: Array.from({ length: 12 }, (_, offset) => {
          const n = offset + 1;
          const lat = summaryRow(summaryIndex, "lat", n)?.entries || 0;
          const reducts = summaryRow(summaryIndex, "extlat", n)?.reducts || 0;
          return { n, value: lat ? reducts / lat : 0 };
        }),
      },
      {
        key: "reslat_ratio",
        color: "#2563eb",
        label: "residuated / lattices",
        points: Array.from({ length: 12 }, (_, offset) => {
          const n = offset + 1;
          const lat = summaryRow(summaryIndex, "lat", n)?.entries || 0;
          const reslat = summaryRow(summaryIndex, "reslat", n)?.entries || 0;
          return { n, value: lat ? reslat / lat : 0 };
        }),
      },
      {
        key: "expansion_ratio",
        color: "#0f766e",
        label: "residuated / reducts",
        points: Array.from({ length: 12 }, (_, offset) => {
          const n = offset + 1;
          const reducts = summaryRow(summaryIndex, "extlat", n)?.reducts || 0;
          const reslat = summaryRow(summaryIndex, "reslat", n)?.entries || 0;
          return { n, value: reducts ? reslat / reducts : 0 };
        }),
      },
    ];
    const maxValue = Math.max(...series.flatMap((item) => item.points.map((point) => point.value)), 1);
    yTicks = 5;
    y = (value) => margin.top + (1 - (value / Math.max(maxValue, 1))) * chartH;
    for (let i = 0; i <= yTicks; i += 1) {
      const value = (maxValue / yTicks) * i;
      const yy = y(value);
      gridLines.push(`<line x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}" class="chart-grid"></line>`);
      gridLines.push(`<text x="${margin.left - 10}" y="${yy + 4}" text-anchor="end" class="chart-axis">${numberFmt(value, 2)}</text>`);
    }
  }
  const xTicks = Array.from({ length: 12 }, (_, offset) => {
    const n = offset + 1;
    return `<text x="${x(n)}" y="${height - 10}" text-anchor="middle" class="chart-axis">${n}</text>`;
  }).join("");
  const lines = series.map((item) => {
    const pts = item.points.map((point) => `${x(point.n)},${y(point.value)}`).join(" ");
    const highlight = item.points.find((point) => point.n === state.level);
    return `
      <polyline fill="none" stroke="${item.color}" stroke-width="3" points="${pts}"></polyline>
      <circle cx="${x(highlight.n)}" cy="${y(highlight.value)}" r="5" fill="${item.color}"></circle>
    `;
  }).join("");
  legend = series.map((item, index) => `
    <g transform="translate(${margin.left + index * 150}, ${height - 2})">
      <circle cx="0" cy="0" r="5" fill="${item.color}"></circle>
      <text x="10" y="4" class="chart-axis">${item.label}</text>
    </g>
  `).join("");
  byId("trendChart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="280" class="chart-svg" aria-label="count trends">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      ${gridLines.join("")}
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="chart-axis-line"></line>
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="chart-axis-line"></line>
      ${xTicks}
      ${lines}
      ${legend}
    </svg>
  `;
}

function renderWidthHeight(panel) {
  if (!panel.cells.length) {
    byId("widthHeightPanel").innerHTML = `<div class="empty">No precomputed width/height context for this dataset.</div>`;
    return;
  }
  const widths = panel.widths.map((item) => item.value);
  const heights = panel.heights.map((item) => item.value);
  const max = Math.max(...panel.cells.map((cell) => cell.count));
  const cellMap = new Map(panel.cells.map((cell) => [`${cell.height}:${cell.width}`, cell.count]));
  const rows = heights.map((height) => {
    const cells = widths.map((width) => {
      const count = cellMap.get(`${height}:${width}`) || 0;
      const alpha = count ? 0.15 + 0.75 * (count / max) : 0.06;
      return `<td style="background: rgba(15,118,110,${alpha})">${count ? numberFmt(count) : ""}</td>`;
    }).join("");
    return `<tr><th>${height}</th>${cells}</tr>`;
  }).join("");
  byId("widthHeightPanel").innerHTML = `
    <div class="subtle-label">${panel.dataset === "lat" ? "lattices" : "residuated lattices"} at n = ${panel.n}</div>
    <table class="heatmap-table">
      <thead>
        <tr><th>h \\ w</th>${widths.map((width) => `<th>${width}</th>`).join("")}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderRankingPanel(payload) {
  const rows = payload.items.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${numberFmt(item.count)}</td>
      <td>${item.width}</td>
      <td>${item.height}</td>
      <td><code>${item.encoding.slice(0, 18)}...</code></td>
    </tr>
  `).join("");
  byId("rankingPanel").innerHTML = `
    <table>
      <thead>
        <tr><th>#</th><th>expansions</th><th>width</th><th>height</th><th>encoding</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderAppendixTables(payload) {
  state.appendixData = payload;
  const propertySections = payload.property_groups.map((group) => `
    <section class="appendix-block">
      <div class="appendix-block-head">
        <h4>${group.title}</h4>
        <div class="meta">${numberFmt(group.total)} total structures</div>
      </div>
      <table class="appendix-table">
        <thead>
          <tr><th>name</th><th>count</th><th>percent</th><th>meaning</th></tr>
        </thead>
        <tbody>
          ${group.rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.label)}</td>
              <td>${numberFmt(row.count)}</td>
              <td>${numberFmt(row.ratio * 100, 2)}%</td>
              <td class="appendix-description">${escapeHtml(row.description)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `).join("");
  const dimensions = payload.dimensions;
  const widthHeader = dimensions.widths.map((item) => `<th>${item.value}</th>`).join("");
  const widthTotals = dimensions.widths.map((item) => `<td>${numberFmt(item.count)}</td>`).join("");
  const dimensionRows = dimensions.rows.map((row) => `
    <tr>
      <th>${row.height}</th>
      ${row.cells.map((cell) => `<td>${cell.count ? numberFmt(cell.count) : ""}</td>`).join("")}
      <td>${numberFmt(row.total)}</td>
    </tr>
  `).join("");
  byId("appendixPanel").innerHTML = `
    <div class="appendix-shell">
      ${propertySections}
      <section class="appendix-block">
        <div class="appendix-block-head">
          <h4>Width × Height Counts</h4>
          <div class="meta">${numberFmt(dimensions.total)} total structures</div>
        </div>
        <div class="appendix-table-wrap">
          <table class="appendix-table sticky-table">
            <thead>
              <tr><th>h \\ w</th>${widthHeader}<th>total</th></tr>
            </thead>
            <tbody>
              ${dimensionRows}
              <tr>
                <th>total</th>
                ${widthTotals}
                <td>${numberFmt(dimensions.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function exportAppendixProperties() {
  if (!state.appendixData) {
    return;
  }
  const rows = [["group", "name", "count", "percent", "meaning"]];
  state.appendixData.property_groups.forEach((group) => {
    group.rows.forEach((row) => {
      rows.push([
        group.kind,
        row.label,
        row.count,
        (row.ratio * 100).toFixed(4),
        row.description,
      ]);
    });
  });
  downloadCsv(`appendix-properties-${state.dataset}${state.level}.csv`, rows);
}

function exportAppendixDimensions() {
  if (!state.appendixData) {
    return;
  }
  const dims = state.appendixData.dimensions;
  const rows = [["height", "width", "count"]];
  dims.rows.forEach((row) => {
    row.cells.forEach((cell) => {
      rows.push([row.height, cell.width, cell.count]);
    });
  });
  downloadCsv(`appendix-dimensions-${state.dataset}${state.level}.csv`, rows);
}

function renderCooccurrence(payload) {
  state.cooccurrenceData = payload;
  if (!payload.labels.length) {
    byId("cooccurrencePanel").innerHTML = `<div class="empty">No property matrix for this dataset.</div>`;
    return;
  }
  const size = payload.labels.length;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  payload.cells.forEach((cell) => {
    matrix[cell.row][cell.col] = cell.count;
    matrix[cell.col][cell.row] = cell.count;
  });
  const max = Math.max(...payload.cells.map((cell) => cell.count), 1);
  const header = payload.labels.map((label, index) => `
    <th title="${escapeHtml(label.label)}">${index + 1}</th>
  `).join("");
  const rows = payload.labels.map((label, rowIndex) => `
    <tr>
      <th title="${escapeHtml(label.label)}">${indexLabel(rowIndex, label.label)}</th>
      ${payload.labels.map((other, colIndex) => {
        const count = matrix[rowIndex][colIndex];
        const alpha = count ? 0.14 + 0.76 * (count / max) : 0.05;
        return `<td>
          <button
            class="cooccurrence-cell"
            type="button"
            data-row="${rowIndex}"
            data-col="${colIndex}"
            style="background: rgba(15,118,110,${alpha})"
            title="${escapeHtml(label.label)} × ${escapeHtml(other.label)}"
          >${count ? numberFmt(count) : ""}</button>
        </td>`;
      }).join("")}
    </tr>
  `).join("");
  const legend = payload.labels.map((label, index) => `
    <div class="legend-row"><strong>${index + 1}</strong><span>${escapeHtml(label.label)}</span><span class="meta">${escapeHtml(label.kind)}</span></div>
  `).join("");
  byId("cooccurrencePanel").innerHTML = `
    <div class="appendix-shell">
      <div class="appendix-table-wrap">
        <table class="appendix-table sticky-table cooccurrence-table">
          <thead>
            <tr><th>#</th>${header}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="cooccurrence-legend">${legend}</div>
    </div>
  `;
  byId("cooccurrencePanel").querySelectorAll(".cooccurrence-cell").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = payload.labels[Number(button.dataset.row)];
      const col = payload.labels[Number(button.dataset.col)];
      const keys = distinct([row.key, col.key]);
      document.querySelectorAll(".property-check").forEach((input) => {
        input.checked = keys.includes(input.value);
      });
      syncFilterStateFromInputs();
      renderConstraintSummary();
      state.offset = 0;
      syncUrlState();
      await loadEntries();
    });
  });
}

function indexLabel(index, label) {
  return `<span class="cooccurrence-index">${index + 1}</span>`;
}

function exportCooccurrenceCsv() {
  if (!state.cooccurrenceData?.labels.length) {
    return;
  }
  const labels = state.cooccurrenceData.labels;
  const size = labels.length;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  state.cooccurrenceData.cells.forEach((cell) => {
    matrix[cell.row][cell.col] = cell.count;
    matrix[cell.col][cell.row] = cell.count;
  });
  const rows = [["property", ...labels.map((label) => label.label)]];
  labels.forEach((label, rowIndex) => {
    rows.push([label.label, ...matrix[rowIndex]]);
  });
  downloadCsv(`cooccurrence-${state.dataset}${state.level}.csv`, rows);
}

async function exportCurrentList(format) {
  return loading.run("entries", `Exporting list ${format.toUpperCase()}...`, async () => {
    const query = currentFilterQuery();
    const payload = await fetchJson(`/api/items?dataset=${state.dataset}&n=${state.level}&limit=${state.pageSize}&offset=${state.offset}${query ? `&${query}` : ""}`);
    const filename = `entries-${state.dataset}${state.level}.${format}`;
    if (format === "csv") {
      const rows = [["index", "encoding", "count", "width", "height"]];
      payload.items.forEach((item) => rows.push([item.index, item.encoding, item.count ?? "", item.width, item.height]));
      downloadCsv(filename, rows);
    } else {
      downloadJson(filename, payload);
    }
  });
}

function exportViewerEntry(target) {
  const entry = target === "primary" ? state.primaryEntry : state.secondaryEntry;
  if (!entry) {
    return;
  }
  downloadJson(`${target}-${entry.dataset}${entry.n}-${entry.index}.json`, entry);
}

function renderEntryList(payload) {
  state.total = payload.total;
  const list = byId("entryList");
  if (!payload.items.length) {
    list.innerHTML = `<div class="empty">No entries.</div>`;
    return;
  }
  list.innerHTML = payload.items.map((item) => {
    const extra = item.count != null ? `count ${item.count}` : "";
    return `
      <div class="entry-row">
        <div>
          <div><strong>#${item.index}</strong> ${extra}</div>
          <div class="meta">w=${item.width}, h=${item.height}</div>
          <div class="meta"><code>${item.encoding.slice(0, 24)}${item.encoding.length > 24 ? "..." : ""}</code></div>
        </div>
        <div class="entry-actions">
          <button data-index="${item.index}" class="pick-primary">Primary</button>
          <button data-index="${item.index}" class="pick-secondary">Secondary</button>
        </div>
      </div>
    `;
  }).join("");
  const pageEnd = Math.min(state.offset + state.pageSize, state.total);
  byId("pageMeta").textContent = `${state.offset}-${pageEnd - 1} of ${state.total}`;
  list.querySelectorAll(".pick-primary").forEach((button) => {
    button.addEventListener("click", () => {
      byId("primaryIndex").value = button.dataset.index;
      loadViewer("primary");
    });
  });
  list.querySelectorAll(".pick-secondary").forEach((button) => {
    button.addEventListener("click", () => {
      byId("secondaryDataset").value = state.dataset;
      byId("secondaryLevel").value = state.level;
      byId("secondaryIndex").value = button.dataset.index;
      loadViewer("secondary");
    });
  });
}

function rankGroups(levels) {
  const groups = new Map();
  levels.forEach((level, node) => {
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(node);
  });
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

function renderDiagram(entry) {
  const width = 480;
  const height = 320;
  const paddingX = 48;
  const paddingY = 34;
  const groups = rankGroups(entry.levels);
  const positions = new Map();

  groups.forEach(([_, nodes], rowIndex) => {
    const y = paddingY + rowIndex * ((height - paddingY * 2) / Math.max(groups.length - 1, 1));
    nodes.forEach((node, colIndex) => {
      const x = paddingX + (colIndex + 1) * ((width - paddingX * 2) / (nodes.length + 1));
      positions.set(node, { x, y });
    });
  });

  const edges = entry.edges.map(([a, b]) => {
    const p1 = positions.get(a);
    const p2 = positions.get(b);
    return `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#7c6f5b" stroke-width="2" />`;
  }).join("");

  const nodes = [...positions.entries()].map(([node, pos]) => `
    <g>
      <circle cx="${pos.x}" cy="${pos.y}" r="16" fill="#0f766e" />
      <text x="${pos.x}" y="${pos.y + 5}" text-anchor="middle" fill="white" font-size="12" font-family="Georgia">${node}</text>
    </g>
  `).join("");

  return `
    <div class="diagram-wrap">
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="320" aria-label="Hasse diagram">
        <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
        ${edges}
        ${nodes}
      </svg>
    </div>
  `;
}

function renderMatrix(title, matrix) {
  const headers = matrix[0].map((_, i) => `<th>${i}</th>`).join("");
  const rows = matrix.map((row, i) => `<tr><th>${i}</th>${row.map((value) => `<td>${value}</td>`).join("")}</tr>`).join("");
  return `<div><h4>${title}</h4><table><thead><tr><th></th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderNegationTable(negation) {
  const cells = negation.map((value, index) => `<tr><th>${index}</th><td>${value}</td></tr>`).join("");
  return `
    <div>
      <h4>Negation</h4>
      <table>
        <thead><tr><th>a</th><th>¬a</th></tr></thead>
        <tbody>${cells}</tbody>
      </table>
    </div>
  `;
}

function renderPropertyChecker(entry) {
  if (!entry.property_items?.length) {
    return "";
  }
  const groups = distinct(entry.property_items.map((item) => item.kind)).map((kind) => ({
    kind,
    rows: entry.property_items.filter((item) => item.kind === kind),
  }));
  return `
    <section class="checker-shell">
      <div class="inline-info-title">
        <h4>Property Checker</h4>
        <button class="info-button" type="button" data-info-title="Property Checker" data-info-body="These truth values are computed directly from the current decoded structure using the same property definitions that drive filters and aggregate tables.">i</button>
      </div>
      ${groups.map((group) => `
        <div class="checker-group">
          <div class="checker-group-title">${group.kind}</div>
          <div class="checker-grid">
            ${group.rows.map((item) => `
              <div class="checker-item ${item.value ? "is-true" : "is-false"}">
                <div class="checker-item-head">
                  <span>${escapeHtml(item.label)}</span>
                  <span class="checker-value">${item.value ? "true" : "false"}</span>
                </div>
                <div class="meta">${escapeHtml(item.description)}</div>
              </div>
            `).join("")}
          </div>
        </div>
      `).join("")}
    </section>
  `;
}

function renderDerivedOperations(entry) {
  if (!entry.arrow_table) {
    return "";
  }
  return `
    <details class="derived-shell">
      <summary>Derived Operations</summary>
      <div class="matrix-grid derived-grid">
        ${renderMatrix("Residuum Table", entry.arrow_table)}
        ${renderNegationTable(entry.negation)}
      </div>
    </details>
  `;
}

function renderDiffMatrix(title, matrix, reference) {
  const headers = matrix[0].map((_, i) => `<th>${i}</th>`).join("");
  const rows = matrix.map((row, i) => `<tr><th>${i}</th>${row.map((value, j) => {
    const changed = reference && reference[i][j] !== value;
    return `<td class="${changed ? "cell-diff" : ""}">${value}</td>`;
  }).join("")}</tr>`).join("");
  return `<div><h4>${title}</h4><table><thead><tr><th></th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderViewer(target, entry) {
  const box = byId(`${target}View`);
  box.innerHTML = `
    <div class="fact-row">
      <span class="pill">${entry.dataset}${entry.n}</span>
      <span class="pill">index ${entry.index}</span>
      <span class="pill">height ${entry.height}</span>
      <span class="pill">width ${entry.width}</span>
      ${entry.count !== null ? `<span class="pill">count ${entry.count}</span>` : ""}
    </div>
    ${renderDiagram(entry)}
    <div class="matrix-grid">
      ${renderMatrix("Order Matrix", entry.order_matrix)}
      ${entry.mult_table ? renderMatrix("Multiplication Table", entry.mult_table) : ""}
    </div>
    ${renderDerivedOperations(entry)}
    ${renderPropertyChecker(entry)}
    <div>
      <div class="inline-info-title">
        <h4>Encoding</h4>
        <button class="info-button" type="button" data-info-title="Encoding" data-info-body="Encoding is the raw compact byte representation of the stored structure, displayed in hexadecimal. For lat it encodes the lattice order, for reslat it encodes the lattice order plus the multiplication table, and for extlat it is the base lattice key used in the count dictionary.">i</button>
      </div>
      <code>${entry.encoding}</code>
    </div>
  `;
  wireInfoButtons(box);
}

function hideFamilyPanel() {
  const shell = byId("familyShell");
  const panel = byId("familyPanel");
  shell.hidden = true;
  panel.innerHTML = "";
}

function renderFamilyPanel(payload, selectedEntry) {
  const shell = byId("familyShell");
  const panel = byId("familyPanel");
  shell.hidden = false;
  const summary = payload.shown < payload.total_expansions
    ? `Showing ${payload.shown} of ${numberFmt(payload.total_expansions)} expansions`
    : `${numberFmt(payload.total_expansions)} expansions`;
  const cards = payload.items.map((item) => {
    const diffCount = item.mult_table.flatMap((row, i) => row.map((value, j) => (
      selectedEntry.mult_table[i][j] !== value ? 1 : 0
    ))).reduce((sum, value) => sum + value, 0);
    const status = item.index === selectedEntry.index ? "Selected" : `${diffCount} differing cells`;
    return `
      <article class="family-card ${item.index === selectedEntry.index ? "is-selected" : ""}">
        <div class="family-card-head">
          <div>
            <div><strong>#${item.index}</strong></div>
            <div class="meta">${status}</div>
          </div>
          <div class="family-actions">
            <button class="ghost-button family-primary" data-index="${item.index}" type="button">Primary</button>
            <button class="ghost-button family-secondary" data-index="${item.index}" type="button">Secondary</button>
          </div>
        </div>
        ${renderDiffMatrix("Multiplication Table", item.mult_table, selectedEntry.mult_table)}
      </article>
    `;
  }).join("");
  panel.innerHTML = `
    <div class="family-summary">
      <div class="subtle-label">Base lattice <code>${payload.base_encoding.slice(0, 24)}${payload.base_encoding.length > 24 ? "..." : ""}</code></div>
      <div class="family-meta">${summary}</div>
    </div>
    <div class="family-grid">${cards}</div>
  `;
  panel.querySelectorAll(".family-primary").forEach((button) => {
    button.addEventListener("click", async () => {
      byId("dataset").value = "reslat";
      state.dataset = "reslat";
      byId("level").value = payload.n;
      state.level = Number(payload.n);
      byId("primaryIndex").value = button.dataset.index;
      await fetchPropertyFilters();
      await syncPrimaryContext({ resetIndex: false });
    });
  });
  panel.querySelectorAll(".family-secondary").forEach((button) => {
    button.addEventListener("click", () => {
      byId("secondaryDataset").value = "reslat";
      byId("secondaryLevel").value = payload.n;
      byId("secondaryIndex").value = button.dataset.index;
      loadViewer("secondary");
    });
  });
}

async function loadFamilyComparison(entry) {
  if (entry.dataset !== "reslat") {
    hideFamilyPanel();
    return;
  }
  byId("familyShell").hidden = false;
  return loading.run("family", "Loading expansions for this lattice...", async () => {
    const payload = await fetchJson(`/api/reslat-family?n=${entry.n}&index=${entry.index}&limit=12`);
    renderFamilyPanel(payload, entry);
  });
}

function wireInfoButtons(scope = document) {
  const dialog = byId("infoDialog");
  const title = byId("infoDialogTitle");
  const body = byId("infoDialogBody");
  scope.querySelectorAll(".info-button").forEach((button) => {
    if (button.dataset.infoWired === "1") {
      return;
    }
    button.dataset.infoWired = "1";
    button.addEventListener("click", () => {
      title.textContent = button.dataset.infoTitle || "Info";
      if (button.dataset.infoBodyHtml) {
        body.innerHTML = button.dataset.infoBodyHtml;
      } else {
        body.textContent = button.dataset.infoBody || "";
      }
      dialog.showModal();
    });
  });
  const closeButton = byId("closeInfoDialog");
  if (!closeButton.dataset.infoWired) {
    closeButton.dataset.infoWired = "1";
    closeButton.addEventListener("click", () => dialog.close());
  }
  if (!dialog.dataset.infoWired) {
    dialog.dataset.infoWired = "1";
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
  }
}

function wireSummaryDialog() {
  const dialog = byId("summaryDialog");
  byId("summaryFab").addEventListener("click", () => dialog.showModal());
  byId("closeSummaryDialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
}

async function loadAnalysis() {
  return Promise.all([
    loading.run("analysis", "Loading analysis...", async () => {
      const [metrics, widthHeight, rankings] = await Promise.all([
        fetchJson(`/api/level-metrics?n=${state.level}`),
        fetchJson(`/api/width-height?dataset=${state.dataset}&n=${state.level}`),
        fetchJson(`/api/extlat-rankings?n=${state.level}&limit=10`),
      ]);
      renderMetricCards(metrics);
      renderTrendChart();
      renderWidthHeight(widthHeight);
      renderRankingPanel(rankings);
    }),
    loading.run("appendix", "Loading appendix tables...", async () => {
      const appendix = await fetchJson(`/api/appendix-tables?dataset=${state.dataset}&n=${state.level}`);
      renderAppendixTables(appendix);
    }),
    loading.run("analysis", "Loading co-occurrence...", async () => {
      const cooccurrence = await fetchJson(`/api/cooccurrence?dataset=${state.dataset}&n=${state.level}`);
      renderCooccurrence(cooccurrence);
    }),
  ]);
}

async function loadEntries() {
  return loading.run("entries", "Loading entries...", async () => {
    const query = currentFilterQuery();
    const payload = await fetchJson(`/api/items?dataset=${state.dataset}&n=${state.level}&limit=${state.pageSize}&offset=${state.offset}${query ? `&${query}` : ""}`);
    renderEntryList(payload);
  });
}

async function loadViewer(target) {
  let dataset;
  let level;
  let index;
  let boxId;
  if (target === "primary") {
    dataset = state.dataset;
    level = state.level;
    index = byId("primaryIndex").value || 0;
    boxId = "primaryView";
  } else {
    dataset = byId("secondaryDataset").value;
    level = byId("secondaryLevel").value;
    index = byId("secondaryIndex").value || 0;
    boxId = "secondaryView";
  }
  const region = target === "primary" ? "primary" : "secondary";
  return loading.run(region, `Loading ${target} view...`, async () => {
    try {
      const entry = await fetchJson(`/api/entry?dataset=${dataset}&n=${level}&index=${index}`);
      renderViewer(target, entry);
      if (target === "primary") {
        state.primaryEntry = entry;
      } else {
        state.secondaryEntry = entry;
      }
      if (target === "primary") {
        await loadFamilyComparison(entry);
      }
      syncUrlState();
    } catch (error) {
      const appError = errors.handle(error, {
        source: `viewer.${target}`,
        kind: error.status === 404 ? "ui" : undefined,
        silent: error.status === 404,
        target,
      });
      byId(boxId).innerHTML = `<div class="empty">${appError.message}</div>`;
      if (target === "primary") {
        hideFamilyPanel();
      }
    }
  });
}

async function syncPrimaryContext({ resetIndex = true } = {}) {
  state.offset = 0;
  if (resetIndex) {
    byId("primaryIndex").value = 0;
  }
  await Promise.all([loadFilterBounds(), loadAnalysis()]);
  await loadEntries();
  await loadViewer("primary");
}

async function syncSecondaryViewer() {
  await loadViewer("secondary");
}

async function syncSecondaryContext() {
  byId("secondaryIndex").value = 0;
  await loadViewer("secondary");
}

async function boot() {
  errors.installGlobalHandlers();
  const restored = restoreStateFromUrl();
  const levels = Array.from({ length: 12 }, (_, i) => i + 1);
  const datasets = ["lat", "extlat", "reslat"];
  byId("dataset").innerHTML = optionMarkup(datasets, state.dataset);
  byId("secondaryDataset").innerHTML = optionMarkup(datasets, restored.secondaryDataset);
  byId("level").innerHTML = optionMarkup(levels, state.level);
  byId("secondaryLevel").innerHTML = optionMarkup(levels, restored.secondaryLevel);
  await loadSummary();
  await fetchPropertyFilters();
  await loadFilterBounds();
  await Promise.all([loadEntries(), loadAnalysis()]);
  byId("primaryIndex").value = restored.primaryIndex;
  byId("secondaryIndex").value = restored.secondaryIndex;
  await loadViewer("primary");
  await loadViewer("secondary");
  wireDoubleSlider("Width");
  wireDoubleSlider("Height");
  wireInfoButtons();
  wireSummaryDialog();
  byId("copyQueryLink").addEventListener("click", async () => {
    syncUrlState();
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch (error) {
      const helper = document.createElement("textarea");
      helper.value = window.location.href;
      helper.setAttribute("readonly", "true");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
      logger.warn("ui.copy_query_link_fallback", { message: error.message });
    }
  });
  byId("exportListCsv").addEventListener("click", () => exportCurrentList("csv"));
  byId("exportListJson").addEventListener("click", () => exportCurrentList("json"));
  byId("exportPrimaryJson").addEventListener("click", () => exportViewerEntry("primary"));
  byId("exportSecondaryJson").addEventListener("click", () => exportViewerEntry("secondary"));
  byId("exportAppendixProperties").addEventListener("click", exportAppendixProperties);
  byId("exportAppendixDimensions").addEventListener("click", exportAppendixDimensions);
  byId("exportCooccurrenceCsv").addEventListener("click", exportCooccurrenceCsv);
  byId("trendCounts").addEventListener("click", () => {
    state.trendMode = "counts";
    renderTrendChart();
    syncUrlState();
  });
  byId("trendRatios").addEventListener("click", () => {
    state.trendMode = "ratios";
    renderTrendChart();
    syncUrlState();
  });

  byId("dataset").addEventListener("change", protect("controls.primary_dataset", async (e) => {
    state.dataset = e.target.value;
    clearFilterInputs();
    await fetchPropertyFilters();
    await syncPrimaryContext();
    syncUrlState();
  }, { kind: "ui" }));
  byId("level").addEventListener("change", protect("controls.primary_level", async (e) => {
    state.level = Number(e.target.value);
    await syncPrimaryContext();
    syncUrlState();
  }, { kind: "ui" }));
  byId("pageSize").addEventListener("change", protect("controls.page_size", async (e) => {
    state.pageSize = Number(e.target.value);
    state.offset = 0;
    await loadEntries();
    syncUrlState();
  }, { kind: "ui" }));
  byId("applyFilters").addEventListener("click", protect("controls.apply_filters", async () => {
    syncFilterStateFromInputs();
    renderConstraintSummary();
    state.offset = 0;
    await loadEntries();
    syncUrlState();
  }, { kind: "ui" }));
  byId("clearFilters").addEventListener("click", protect("controls.clear_filters", async () => {
    clearFilterInputs();
    state.offset = 0;
    await loadEntries();
    syncUrlState();
  }, { kind: "ui" }));
  byId("prevPage").addEventListener("click", protect("controls.prev_page", async () => {
    state.offset = Math.max(0, state.offset - state.pageSize);
    await loadEntries();
    syncUrlState();
  }, { kind: "ui" }));
  byId("nextPage").addEventListener("click", protect("controls.next_page", async () => {
    if (state.offset + state.pageSize < state.total) {
      state.offset += state.pageSize;
      await loadEntries();
      syncUrlState();
    }
  }, { kind: "ui" }));
  byId("loadPrimary").addEventListener("click", protect("viewer.load_primary", () => loadViewer("primary"), { kind: "ui" }));
  byId("loadSecondary").addEventListener("click", protect("viewer.load_secondary", () => loadViewer("secondary"), { kind: "ui" }));
  byId("secondaryDataset").addEventListener("change", protect("controls.secondary_dataset", async () => {
    await syncSecondaryContext();
    syncUrlState();
  }, { kind: "ui" }));
  byId("secondaryLevel").addEventListener("change", protect("controls.secondary_level", async () => {
    await syncSecondaryContext();
    syncUrlState();
  }, { kind: "ui" }));
  byId("secondaryIndex").addEventListener("change", protect("controls.secondary_index", async () => {
    await syncSecondaryViewer();
    syncUrlState();
  }, { kind: "ui" }));
  syncUrlState();
}

protect("boot", boot, { kind: "ui" })();
