const state = {
  dataset: "lat",
  level: 6,
  pageSize: 50,
  offset: 0,
  total: 0,
  summaryRows: [],
  filterBounds: null,
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

async function fetchJson(url) {
  const candidates = [url];
  if (window.location.port !== "8000") {
    candidates.push(`${window.location.protocol}//${window.location.hostname || "127.0.0.1"}:8000${url}`);
  }
  let lastError;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate);
      if (!res.ok) {
        throw new Error(`Request failed: ${candidate}`);
      }
      return res.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function optionMarkup(values, selected) {
  return values.map((value) => `<option value="${value}" ${String(value) === String(selected) ? "selected" : ""}>${value}</option>`).join("");
}

function numberFmt(value, digits = 0) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function buildSummaryIndex(rows) {
  const index = new Map();
  rows.forEach((row) => index.set(`${row.dataset}:${row.n}`, row));
  return index;
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
}

function renderPropertyFilters(payload) {
  byId("countFilterRow").style.display = state.dataset === "extlat" ? "grid" : "none";
  byId("propertyFilters").innerHTML = payload.properties.map((prop) => `
    <label class="property-item">
      <input class="property-check" type="checkbox" value="${prop.key}">
      <span>${prop.label}</span>
    </label>
  `).join("");
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
  clearFilterInputs();
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
  const width = 760;
  const height = 280;
  const margin = { top: 18, right: 16, bottom: 34, left: 56 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  const datasets = ["lat", "extlat", "reslat"];
  const colors = { lat: "#0f766e", extlat: "#c2410c", reslat: "#2563eb" };
  const labels = { lat: "lattices", extlat: "reducts", reslat: "residuated" };
  const summaryIndex = buildSummaryIndex(state.summaryRows);
  const points = datasets.map((dataset) => Array.from({ length: 12 }, (_, offset) => {
    const n = offset + 1;
    const row = summaryIndex.get(`${dataset}:${n}`);
    return { n, value: row ? row.entries : 0 };
  }));
  const values = points.flat().map((point) => Math.max(point.value, 1));
  const minLog = Math.log10(Math.min(...values));
  const maxLog = Math.log10(Math.max(...values));
  const x = (n) => margin.left + ((n - 1) / 11) * chartW;
  const y = (value) => {
    const lv = Math.log10(Math.max(value, 1));
    return margin.top + (maxLog - lv) / Math.max(maxLog - minLog, 1) * chartH;
  };
  const gridLines = [];
  for (let p = Math.floor(minLog); p <= Math.ceil(maxLog); p += 1) {
    const yy = y(10 ** p);
    gridLines.push(`<line x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}" class="chart-grid"></line>`);
    gridLines.push(`<text x="${margin.left - 10}" y="${yy + 4}" text-anchor="end" class="chart-axis">1e${p}</text>`);
  }
  const xTicks = Array.from({ length: 12 }, (_, offset) => {
    const n = offset + 1;
    return `<text x="${x(n)}" y="${height - 10}" text-anchor="middle" class="chart-axis">${n}</text>`;
  }).join("");
  const lines = datasets.map((dataset, idx) => {
    const pts = points[idx].map((point) => `${x(point.n)},${y(point.value)}`).join(" ");
    const highlight = points[idx].find((point) => point.n === state.level);
    return `
      <polyline fill="none" stroke="${colors[dataset]}" stroke-width="3" points="${pts}"></polyline>
      <circle cx="${x(highlight.n)}" cy="${y(highlight.value)}" r="5" fill="${colors[dataset]}"></circle>
    `;
  }).join("");
  const legend = datasets.map((dataset, index) => `
    <g transform="translate(${margin.left + index * 150}, ${height - 2})">
      <circle cx="0" cy="0" r="5" fill="${colors[dataset]}"></circle>
      <text x="10" y="4" class="chart-axis">${labels[dataset]}</text>
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
      body.textContent = button.dataset.infoBody || "";
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
  const [metrics, widthHeight, rankings] = await Promise.all([
    fetchJson(`/api/level-metrics?n=${state.level}`),
    fetchJson(`/api/width-height?dataset=${state.dataset}&n=${state.level}`),
    fetchJson(`/api/extlat-rankings?n=${state.level}&limit=10`),
  ]);
  renderMetricCards(metrics);
  renderTrendChart();
  renderWidthHeight(widthHeight);
  renderRankingPanel(rankings);
}

async function loadEntries() {
  const query = currentFilterQuery();
  const payload = await fetchJson(`/api/items?dataset=${state.dataset}&n=${state.level}&limit=${state.pageSize}&offset=${state.offset}${query ? `&${query}` : ""}`);
  renderEntryList(payload);
}

async function loadViewer(target) {
  let dataset;
  let level;
  let index;
  if (target === "primary") {
    dataset = state.dataset;
    level = state.level;
    index = byId("primaryIndex").value || 0;
  } else {
    dataset = byId("secondaryDataset").value;
    level = byId("secondaryLevel").value;
    index = byId("secondaryIndex").value || 0;
  }
  const entry = await fetchJson(`/api/entry?dataset=${dataset}&n=${level}&index=${index}`);
  renderViewer(target, entry);
}

async function syncPrimaryContext() {
  state.offset = 0;
  await Promise.all([loadFilterBounds(), loadAnalysis()]);
  await loadEntries();
  await loadViewer("primary");
}

async function syncSecondaryViewer() {
  await loadViewer("secondary");
}

async function boot() {
  const levels = Array.from({ length: 12 }, (_, i) => i + 1);
  const datasets = ["lat", "extlat", "reslat"];
  byId("dataset").innerHTML = optionMarkup(datasets, state.dataset);
  byId("secondaryDataset").innerHTML = optionMarkup(datasets, "reslat");
  byId("level").innerHTML = optionMarkup(levels, state.level);
  byId("secondaryLevel").innerHTML = optionMarkup(levels, state.level);
  state.summaryRows = await fetchJson("/api/summary");
  renderSummary(state.summaryRows);
  renderPropertyFilters(await fetchJson(`/api/filter-options?dataset=${state.dataset}`));
  await loadFilterBounds();
  await Promise.all([loadEntries(), loadAnalysis()]);
  byId("primaryIndex").value = 0;
  byId("secondaryIndex").value = 0;
  await loadViewer("primary");
  await loadViewer("secondary");
  wireDoubleSlider("Width");
  wireDoubleSlider("Height");
  wireInfoButtons();
  wireSummaryDialog();

  byId("dataset").addEventListener("change", async (e) => {
    state.dataset = e.target.value;
    clearFilterInputs();
    renderPropertyFilters(await fetchJson(`/api/filter-options?dataset=${state.dataset}`));
    await syncPrimaryContext();
  });
  byId("level").addEventListener("change", async (e) => {
    state.level = Number(e.target.value);
    await syncPrimaryContext();
  });
  byId("pageSize").addEventListener("change", async (e) => {
    state.pageSize = Number(e.target.value);
    state.offset = 0;
    await loadEntries();
  });
  byId("applyFilters").addEventListener("click", async () => {
    syncFilterStateFromInputs();
    state.offset = 0;
    await loadEntries();
  });
  byId("clearFilters").addEventListener("click", async () => {
    clearFilterInputs();
    state.offset = 0;
    await loadEntries();
  });
  byId("prevPage").addEventListener("click", async () => {
    state.offset = Math.max(0, state.offset - state.pageSize);
    await loadEntries();
  });
  byId("nextPage").addEventListener("click", async () => {
    if (state.offset + state.pageSize < state.total) {
      state.offset += state.pageSize;
      await loadEntries();
    }
  });
  byId("loadPrimary").addEventListener("click", () => loadViewer("primary"));
  byId("loadSecondary").addEventListener("click", () => loadViewer("secondary"));
  byId("secondaryDataset").addEventListener("change", syncSecondaryViewer);
  byId("secondaryLevel").addEventListener("change", syncSecondaryViewer);
  byId("secondaryIndex").addEventListener("change", syncSecondaryViewer);
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre>${err.message}</pre>`;
});
