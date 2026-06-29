(() => {
  const R = window.Residuals;
  const { state, byId, fetchJson, loading, escapeHtml } = R;

  function availableDatasets() {
    return R.distinct(state.summaryRows.map((row) => row.dataset)).sort();
  }

  function normalizeShortlistIds() {
    const valid = new Set(state.savedBlueprints.map((item) => item.id));
    state.shortlistIds = state.shortlistIds.filter((id) => valid.has(id)).slice(0, 3);
  }

  function shortlistItems() {
    const savedById = new Map(state.savedBlueprints.map((item) => [item.id, item]));
    return state.shortlistIds.map((id) => savedById.get(id)).filter(Boolean);
  }

  function renderSmallestResult(payload) {
    const panel = byId("entryList");
    if (!panel) {
      return;
    }
    if (!payload?.found) {
      byId("entryListMeta").textContent = "No minimal witness matched the current dataset and property set.";
      panel.innerHTML = `<div class="empty">${escapeHtml(payload?.explanation || "No smallest example found yet.")}</div>`;
      return;
    }
    const entry = payload.entry;
    const saved = R.savedBlueprintMap ? R.savedBlueprintMap().get(R.blueprintKey(entry)) : null;
    const shortlisted = saved && (state.shortlistIds || []).includes(saved.id);
    byId("entryListMeta").textContent = `Smallest match: ${entry.dataset}${entry.n} #${entry.index}.`;
    panel.innerHTML = `
      <div class="blueprint-row search-result-row smallest-result-row has-preview" data-dataset="${entry.dataset}" data-n="${entry.n}" data-index="${entry.index}" role="button" tabindex="0">
        ${R.renderMiniDiagram ? R.renderMiniDiagram(entry) : ""}
        <div class="blueprint-main">
          <div class="blueprint-head">
            <strong>${entry.dataset}${entry.n} #${entry.index}</strong>
            <span class="pill">w=${entry.width}</span>
            <span class="pill">h=${entry.height}</span>
            ${entry.count != null ? `<span class="pill">count ${entry.count}</span>` : ""}
          </div>
          ${payload.matched_properties?.length ? `<div class="tag-row">${payload.matched_properties.map((label) => `<span class="tag-chip">${escapeHtml(label)}</span>`).join("")}</div>` : ""}
          <div class="meta">${escapeHtml(payload.explanation)}</div>
        </div>
        <div class="entry-actions blueprint-actions">
          <button id="smallestShortlist" class="ghost-button ${shortlisted ? "is-active" : ""}" type="button">${R.shortlistButtonLabel(shortlisted)}</button>
          <button id="smallestSave" class="ghost-button" type="button">Save</button>
        </div>
      </div>
    `;
    const openAsPrimary = async () => {
      state.dataset = entry.dataset;
      state.level = entry.n;
      byId("primaryIndex").value = entry.index;
      R.renderSearchSelectors();
      await R.syncPrimaryContext({ resetIndex: false });
      R.openAnalysisDrawer();
    };
    const row = panel.querySelector(".smallest-result-row");
    row?.addEventListener("click", R.protect("smallest.open_result", openAsPrimary, { kind: "ui" }));
    row?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        R.protect("smallest.open_result_keydown", openAsPrimary, { kind: "ui" })();
      }
    });
    byId("smallestSave").addEventListener("click", (event) => {
      event.stopPropagation();
      R.openBlueprintDialog(entry);
    });
    byId("smallestShortlist").addEventListener("click", R.protect("smallest.shortlist", async (event) => {
      event.stopPropagation();
      await R.toggleShortlistForEntry(entry);
      renderSmallestResult(payload);
    }, { kind: "ui" }));
  }

  async function runSmallestExample() {
    state.smallest.properties = [...document.querySelectorAll(".property-check:checked")].map((input) => input.value);
    if (!state.smallest.properties.length) {
      renderSmallestResult({
        found: false,
        explanation: "Select one or more properties, then run the finder.",
      });
      return null;
    }
    return loading.run("entries", "Finding smallest example...", async () => {
      const params = new URLSearchParams({ dataset: state.smallest.dataset });
      state.smallest.properties.forEach((prop) => params.append("prop", prop));
      const payload = await fetchJson(`/api/smallest-example?${params.toString()}`);
      renderSmallestResult(payload);
      return payload;
    });
  }

  function resetSmallestExampleForm() {
    state.smallest.dataset = state.dataset;
    state.smallest.properties = [];
  }

  function renderDesignReport(payload) {
    const panel = byId("designReportPanel");
    if (!payload) {
      panel.innerHTML = `<div class="empty">No structure selected.</div>`;
      return;
    }
    panel.innerHTML = `
      <div class="meta">${escapeHtml(payload.summary)}</div>
      <div class="metric-cards workbench-metric-cards">
        ${payload.metrics.map((metric) => `
          <article class="metric-card workbench-metric ${metric.level}">
            <div class="metric-label">${escapeHtml(metric.label)}</div>
            <div class="metric-value">${escapeHtml(String(metric.value))}</div>
            <div class="workbench-level">${escapeHtml(metric.level)}</div>
            <div class="metric-note">${escapeHtml(metric.summary)}</div>
          </article>
        `).join("")}
      </div>
      <div class="workbench-driver-list">
        ${payload.drivers.map((item) => `
          <div class="workbench-driver">
            <strong>Node ${item.node}</strong>
            <div class="meta">${escapeHtml(item.summary)}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderCounterGap(payload) {
    const panel = byId("counterGapPanel");
    if (!payload?.available) {
      panel.innerHTML = `<div class="empty">${escapeHtml(payload?.reason || "Counter-gap analysis is unavailable.")}</div>`;
      return;
    }
    panel.innerHTML = `
      <div class="meta">${escapeHtml(payload.summary)}</div>
      <div class="workbench-list">
        ${payload.items.map((item) => `
          <div class="workbench-row">
            <div class="blueprint-head">
              <strong>${item.from_node} → ${item.to_node}</strong>
              <span class="pill">${escapeHtml(item.level)}</span>
              <span class="pill">counter ${item.strongest_counter}</span>
              <span class="pill">${item.support_size} support nodes</span>
            </div>
            <div class="meta">${escapeHtml(item.explanation)}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  async function loadPrimaryWorkbench(entry = state.primaryEntry) {
    if (!entry) {
      renderDesignReport(null);
      renderCounterGap({ available: false });
      return;
    }
    await Promise.all([
      loading.run("design", "Building balance report...", async () => {
        const payload = await fetchJson(`/api/design-report?dataset=${entry.dataset}&n=${entry.n}&index=${entry.index}`);
        renderDesignReport(payload);
      }),
      loading.run("countergap", "Analyzing counter gaps...", async () => {
        const payload = await fetchJson(`/api/counter-gap?dataset=${entry.dataset}&n=${entry.n}&index=${entry.index}`);
        renderCounterGap(payload);
      }),
    ]);
  }

  async function loadShortlistCompare() {
    normalizeShortlistIds();
    const panel = byId("shortlistPanel");
    const selected = shortlistItems();
    if (!selected.length) {
      panel.innerHTML = `<div class="empty">Use Shortlist on any result or saved blueprint to pin up to three structures for side-by-side comparison here.</div>`;
      return;
    }
    return loading.run("shortlist", "Comparing shortlisted blueprints...", async () => {
      const entries = await Promise.all(
        selected.map((item) => fetchJson(`/api/entry?dataset=${item.dataset}&n=${item.n}&index=${item.index}`)),
      );

      panel.innerHTML = `
        <div class="shortlist-compare-shell">
          <div class="meta">Compare tray holds up to three saved structures. Each column mirrors the core viewer content so you can inspect shape, tables, properties, and encoding without leaving the workbench.</div>
          <div class="shortlist-compare-grid">
            ${selected.map((item, index) => {
              const entry = entries[index];
              const title = item.title || `${item.dataset}${item.n} #${item.index}`;
              return `
                <article class="shortlist-compare-card">
                  <div class="shortlist-compare-head">
                    <div class="blueprint-main">
                      <div class="blueprint-head">
                        <strong>${escapeHtml(title)}</strong>
                        <span class="pill">${item.dataset}${item.n}</span>
                      </div>
                      <div class="meta">index ${item.index} • w=${entry.width} • h=${entry.height}${entry.count != null ? ` • count ${entry.count}` : ""}</div>
                      ${(item.tags || []).length ? `<div class="tag-row">${item.tags.map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
                      <div class="shortlist-compare-preview">
                        ${R.renderMiniDiagram ? R.renderMiniDiagram(entry) : ""}
                      </div>
                    </div>
                    <div class="entry-actions shortlist-compare-actions">
                      <button class="shortlist-open" data-id="${item.id}" type="button">Open</button>
                      <button class="ghost-button shortlist-save" data-dataset="${entry.dataset}" data-n="${entry.n}" data-index="${entry.index}" type="button">Save</button>
                      <button class="ghost-button shortlist-remove" data-id="${item.id}" type="button">Remove</button>
                    </div>
                  </div>
                  <div class="shortlist-compare-scroll viewer-body">
                    ${R.renderViewerMarkup(entry)}
                  </div>
                </article>
              `;
            }).join("")}
          </div>
        </div>
      `;
      R.wireInfoButtons(panel);
      panel.querySelectorAll(".shortlist-open").forEach((button) => {
        button.addEventListener("click", async () => {
          const item = state.savedBlueprints.find((entry) => entry.id === Number(button.dataset.id));
          if (!item) return;
          state.dataset = item.dataset;
          state.level = item.n;
          byId("primaryIndex").value = item.index;
          R.renderSearchSelectors();
          await R.fetchPropertyFilters();
          await R.syncPrimaryContext({ resetIndex: false });
          R.openAnalysisDrawer();
        });
      });
      panel.querySelectorAll(".shortlist-save").forEach((button) => {
        button.addEventListener("click", R.protect("shortlist.save", async () => {
          const entry = await fetchJson(`/api/entry?dataset=${button.dataset.dataset}&n=${button.dataset.n}&index=${button.dataset.index}`);
          R.openBlueprintDialog(entry);
        }, { kind: "ui" }));
      });
      panel.querySelectorAll(".shortlist-remove").forEach((button) => {
        button.addEventListener("click", () => {
          toggleShortlist(Number(button.dataset.id));
        });
      });
    });
  }

  function toggleShortlist(id) {
    const next = [...state.shortlistIds];
    const index = next.indexOf(id);
    if (index >= 0) {
      next.splice(index, 1);
    } else {
      next.push(id);
      while (next.length > 3) {
        next.shift();
      }
    }
    state.shortlistIds = next;
    R.renderSavedBlueprints();
    R.refreshViewerActions?.();
    loadShortlistCompare();
  }

  async function initializeWorkbench() {
    state.smallest.dataset = state.smallest.dataset || state.dataset || "reslat";
    await loadShortlistCompare();
  }

  function wireShortlistDialog() {
    const dialog = byId("shortlistDialog");
    if (!dialog) {
      return;
    }
    byId("shortlistFab")?.addEventListener("click", () => R.openDialog(dialog));
    byId("closeShortlistDialog")?.addEventListener("click", () => R.closeDialog(dialog));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        R.closeDialog(dialog);
      }
    });
  }

  function wireWorkbench() {
    wireShortlistDialog();
  }

  Object.assign(R, {
    initializeWorkbench,
    wireWorkbench,
    toggleShortlist,
    loadShortlistCompare,
    loadPrimaryWorkbench,
    runSmallestExample,
    resetSmallestExampleForm,
  });
})();
