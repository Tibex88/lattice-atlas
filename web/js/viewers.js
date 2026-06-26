(() => {
  const R = window.Residuals;
  const { state, byId, fetchJson, loading, escapeHtml, numberFmt, downloadCsv, downloadJson } = R;

  async function exportCurrentList(format) {
    return loading.run("entries", `Exporting list ${format.toUpperCase()}...`, async () => {
      const query = R.currentFilterQuery();
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
    state.currentEntries = payload.items;
    state.total = payload.total;
    const list = byId("entryList");
    const savedMap = R.savedBlueprintMap();
    if (!payload.items.length) {
      list.innerHTML = `<div class="empty">No entries.</div>`;
      byId("pageMeta").textContent = state.total ? `${state.offset}-${Math.max(state.offset - 1, 0)} of ${state.total}` : "0 of 0";
      return;
    }
    list.innerHTML = payload.items.map((item) => {
      const extra = item.count != null ? `count ${item.count}` : "";
      const key = R.blueprintKey({ dataset: state.dataset, n: state.level, index: item.index });
      const saved = savedMap.get(key);
      return `
        <div class="entry-row">
          <div>
            <div><strong>#${item.index}</strong> ${extra} ${saved ? '<span class="saved-mark">Saved</span>' : ""}</div>
            <div class="meta">w=${item.width}, h=${item.height}</div>
            <div class="meta"><code>${item.encoding.slice(0, 24)}${item.encoding.length > 24 ? "..." : ""}</code></div>
          </div>
          <div class="entry-actions">
            <button data-index="${item.index}" class="pick-primary">Primary</button>
            <button data-index="${item.index}" class="pick-secondary">Secondary</button>
            <button data-index="${item.index}" class="ghost-button save-entry-blueprint" type="button">Save</button>
          </div>
        </div>
      `;
    }).join("");
    const pageEnd = Math.min(state.offset + state.pageSize, state.total);
    byId("pageMeta").textContent = `${state.offset}-${Math.max(pageEnd - 1, state.offset)} of ${state.total}`;
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
    list.querySelectorAll(".save-entry-blueprint").forEach((button) => {
      button.addEventListener("click", R.protect("blueprints.open_from_list", async () => {
        const index = Number(button.dataset.index);
        const entry = await fetchJson(`/api/entry?dataset=${state.dataset}&n=${state.level}&index=${index}`);
        R.openBlueprintDialog(entry);
      }, { kind: "ui" }));
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
    const groups = R.distinct(entry.property_items.map((item) => item.kind)).map((kind) => ({
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
    R.wireInfoButtons(box);
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
        await R.fetchPropertyFilters();
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

  async function loadEntries() {
    return loading.run("entries", "Loading entries...", async () => {
      const query = R.currentFilterQuery();
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
        R.syncUrlState();
      } catch (error) {
        const appError = R.errors.handle(error, {
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
    await Promise.all([R.loadFilterBounds(), R.loadAnalysis()]);
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

  Object.assign(R, {
    exportCurrentList,
    exportViewerEntry,
    renderEntryList,
    renderViewer,
    hideFamilyPanel,
    loadFamilyComparison,
    loadEntries,
    loadViewer,
    syncPrimaryContext,
    syncSecondaryViewer,
    syncSecondaryContext,
  });
})();
