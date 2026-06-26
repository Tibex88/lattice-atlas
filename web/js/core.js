const Residuals = window.Residuals || (window.Residuals = {});

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
  currentEntries: [],
  primaryEntry: null,
  secondaryEntry: null,
  savedBlueprints: [],
  storageStatus: null,
  storageError: null,
  pendingBlueprintTarget: null,
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

function openDialog(dialog) {
  if (!dialog) {
    return;
  }
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
    return;
  }
  dialog.setAttribute("open", "");
}

function closeDialog(dialog) {
  if (!dialog) {
    return;
  }
  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }
  dialog.removeAttribute("open");
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
        blueprints: { element: byId("blueprintsPanel"), disable: "button, input, select, textarea" },
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

async function fetchJson(url, options = {}) {
  const candidates = [url];
  if (window.location.port !== "8000") {
    candidates.push(`${window.location.protocol}//${window.location.hostname || "127.0.0.1"}:8000${url}`);
  }
  let lastError;
  for (const candidate of candidates) {
    const started = performance.now();
    try {
      const requestOptions = {
        method: options.method || "GET",
        headers: { ...(options.headers || {}) },
      };
      if (options.body != null) {
        requestOptions.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
        if (!requestOptions.headers["Content-Type"]) {
          requestOptions.headers["Content-Type"] = "application/json";
        }
      }
      const res = await fetch(candidate, requestOptions);
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
        method: requestOptions.method,
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
        method: options.method || "GET",
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
      openDialog(dialog);
    });
  });
  const closeButton = byId("closeInfoDialog");
  if (!closeButton.dataset.infoWired) {
    closeButton.dataset.infoWired = "1";
    closeButton.addEventListener("click", () => closeDialog(dialog));
  }
  if (!dialog.dataset.infoWired) {
    dialog.dataset.infoWired = "1";
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        closeDialog(dialog);
      }
    });
  }
}

function wireSummaryDialog() {
  const dialog = byId("summaryDialog");
  byId("summaryFab").addEventListener("click", () => openDialog(dialog));
  byId("closeSummaryDialog").addEventListener("click", () => closeDialog(dialog));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      closeDialog(dialog);
    }
  });
}

Object.assign(Residuals, {
  state,
  byId,
  AppError,
  logger,
  errors,
  protect,
  openDialog,
  closeDialog,
  loading,
  fetchJson,
  optionMarkup,
  escapeHtml,
  numberFmt,
  downloadCsv,
  downloadJson,
  distinct,
  wireInfoButtons,
  wireSummaryDialog,
});
