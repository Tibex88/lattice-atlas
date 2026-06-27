(() => {
  const R = window.Residuals;
  const { state, byId, fetchJson, loading, escapeHtml } = R;

  function availableDatasets() {
    return R.distinct(state.summaryRows.map((row) => row.dataset)).sort();
  }

  function shortlistSet() {
    return new Set(state.shortlistIds);
  }

  function normalizeShortlistIds() {
    const valid = new Set(state.savedBlueprints.map((item) => item.id));
    state.shortlistIds = state.shortlistIds.filter((id) => valid.has(id)).slice(0, 4);
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
    byId("entryListMeta").textContent = `Smallest match: ${entry.dataset}${entry.n} #${entry.index}.`;
    panel.innerHTML = `
      <div class="blueprint-row search-result-row smallest-result-row" data-dataset="${entry.dataset}" data-n="${entry.n}" data-index="${entry.index}" role="button" tabindex="0">
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
          <button id="smallestPrimary" type="button">Primary</button>
          <button id="smallestSecondary" type="button">Secondary</button>
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
    byId("smallestPrimary").addEventListener("click", R.protect("smallest.primary", async (event) => {
      event.stopPropagation();
      await openAsPrimary();
    }, { kind: "ui" }));
    byId("smallestSecondary").addEventListener("click", R.protect("smallest.secondary", async (event) => {
      event.stopPropagation();
      byId("secondaryDataset").value = entry.dataset;
      byId("secondaryLevel").value = entry.n;
      byId("secondaryIndex").value = entry.index;
      await R.loadViewer("secondary");
    }, { kind: "ui" }));
    byId("smallestSave").addEventListener("click", (event) => {
      event.stopPropagation();
      R.openBlueprintDialog(entry);
    });
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
      panel.innerHTML = `<div class="empty">No primary blueprint selected.</div>`;
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
    const selected = state.savedBlueprints.filter((item) => shortlistSet().has(item.id));
    if (!selected.length) {
      panel.innerHTML = `<div class="empty">Use the Shortlist button on saved blueprints to compare candidate shapes here.</div>`;
      return;
    }
    return loading.run("shortlist", "Comparing shortlisted blueprints...", async () => {
      const entries = await Promise.all(
        selected.map((item) => fetchJson(`/api/entry?dataset=${item.dataset}&n=${item.n}&index=${item.index}`)),
      );
      const truePropertySets = entries.map((entry) => new Set(entry.property_items.filter((item) => item.value).map((item) => item.label)));
      const common = [...truePropertySets.reduce((acc, current, index) => (
        index === 0 ? new Set(current) : new Set([...acc].filter((value) => current.has(value)))
      ), new Set())];

      panel.innerHTML = `
        <div class="meta">Shortlist compares saved candidates by size, dimensions, and shared true properties.</div>
        ${common.length ? `<div class="tag-row">${common.map((label) => `<span class="tag-chip">${escapeHtml(label)}</span>`).join("")}</div>` : `<div class="meta">No shared true-property core across the current shortlist.</div>`}
        <div class="workbench-compare-grid">
          ${selected.map((item, index) => {
            const entry = entries[index];
            const unique = entry.property_items.filter((prop) => prop.value && !common.includes(prop.label));
            return `
              <article class="workbench-card">
                <div class="blueprint-head">
                  <strong>${escapeHtml(item.title || `${item.dataset}${item.n} #${item.index}`)}</strong>
                  <span class="pill">${item.dataset}${item.n}</span>
                </div>
                <div class="meta">index ${item.index} • w=${entry.width} • h=${entry.height}${entry.count != null ? ` • count ${entry.count}` : ""}</div>
                ${unique.length ? `<div class="tag-row">${unique.slice(0, 8).map((prop) => `<span class="tag-chip">${escapeHtml(prop.label)}</span>`).join("")}</div>` : `<div class="meta">No unique true-property signal beyond the shared core.</div>`}
                <div class="entry-actions">
                  <button class="shortlist-primary" data-id="${item.id}" type="button">Primary</button>
                  <button class="shortlist-secondary" data-id="${item.id}" type="button">Secondary</button>
                  <button class="ghost-button shortlist-remove" data-id="${item.id}" type="button">Remove</button>
                </div>
              </article>
            `;
          }).join("")}
        </div>
      `;
      panel.querySelectorAll(".shortlist-primary").forEach((button) => {
        button.addEventListener("click", async () => {
          const item = state.savedBlueprints.find((entry) => entry.id === Number(button.dataset.id));
          if (!item) return;
          state.dataset = item.dataset;
          state.level = item.n;
          byId("primaryIndex").value = item.index;
          R.renderSearchSelectors();
          await R.fetchPropertyFilters();
          await R.syncPrimaryContext({ resetIndex: false });
        });
      });
      panel.querySelectorAll(".shortlist-secondary").forEach((button) => {
        button.addEventListener("click", async () => {
          const item = state.savedBlueprints.find((entry) => entry.id === Number(button.dataset.id));
          if (!item) return;
          byId("secondaryDataset").value = item.dataset;
          byId("secondaryLevel").value = item.n;
          byId("secondaryIndex").value = item.index;
          await R.loadViewer("secondary");
        });
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
      while (next.length > 4) {
        next.shift();
      }
    }
    state.shortlistIds = next;
    R.renderSavedBlueprints();
    loadShortlistCompare();
  }

  async function initializeWorkbench() {
    state.smallest.dataset = state.smallest.dataset || state.dataset || "reslat";
    await loadShortlistCompare();
  }

  function wireWorkbench() {}

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
