const state = {
  dataset: "lat",
  level: 6,
  pageSize: 50,
  offset: 0,
  total: 0,
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

function renderSummary(rows) {
  const box = byId("summary");
  box.innerHTML = rows.map((row) => {
    const max = row.max_count ? `, max expansions ${row.max_count}` : "";
    return `<div class="summary-row"><span>${row.dataset}${row.n}</span><span>${row.entries.toLocaleString()} entries${max}</span></div>`;
  }).join("");
}

function renderEntryList(payload) {
  state.total = payload.total;
  const list = byId("entryList");
  if (!payload.items.length) {
    list.innerHTML = `<div class="empty">No entries.</div>`;
    return;
  }
  list.innerHTML = payload.items.map((item) => {
    const extra = item.count !== undefined ? `count ${item.count}` : "";
    return `
      <div class="entry-row">
        <div>
          <div><strong>#${item.index}</strong> ${extra}</div>
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
  const maxPerRow = Math.max(...groups.map(([, nodes]) => nodes.length));
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

async function loadEntries() {
  const payload = await fetchJson(`/api/items?dataset=${state.dataset}&n=${state.level}&limit=${state.pageSize}&offset=${state.offset}`);
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
  const summary = await fetchJson("/api/summary");
  renderSummary(summary);
  await loadEntries();
  byId("primaryIndex").value = 0;
  byId("secondaryIndex").value = 0;
  await loadViewer("primary");
  await loadViewer("secondary");
  wireInfoButtons();
  wireSummaryDialog();

  byId("dataset").addEventListener("change", async (e) => {
    state.dataset = e.target.value;
    state.offset = 0;
    await loadEntries();
    await loadViewer("primary");
  });
  byId("level").addEventListener("change", async (e) => {
    state.level = Number(e.target.value);
    state.offset = 0;
    await loadEntries();
    await loadViewer("primary");
  });
  byId("pageSize").addEventListener("change", async (e) => {
    state.pageSize = Number(e.target.value);
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
