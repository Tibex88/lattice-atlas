(() => {
  const R = window.Residuals;
  const { state, byId, fetchJson, loading, escapeHtml } = R;

  function availableDatasets() {
    return R.distinct(state.summaryRows.map((row) => row.dataset)).sort();
  }

  function availableSizes(dataset) {
    return state.summaryRows
      .filter((row) => row.dataset === dataset)
      .map((row) => row.n)
      .sort((a, b) => a - b);
  }

  function ensureSearchDataset() {
    const datasets = availableDatasets();
    const currentDataset = state.mode === "smallest" ? state.smallest.dataset : state.search.dataset;
    if (!datasets.includes(currentDataset)) {
      const fallback = datasets[0] || state.dataset || "lat";
      if (state.mode === "smallest") {
        state.smallest.dataset = fallback;
      } else {
        state.search.dataset = fallback;
      }
    }
  }

  function ensureSearchSizeBounds() {
    const sizes = availableSizes(state.search.dataset);
    if (!sizes.length) {
      state.search.nMin = 1;
      state.search.nMax = 1;
      return;
    }
    if (!sizes.includes(Number(state.search.nMin))) {
      state.search.nMin = state.level && sizes.includes(state.level) ? state.level : sizes[0];
    }
    if (!sizes.includes(Number(state.search.nMax))) {
      state.search.nMax = state.level && sizes.includes(state.level) ? state.level : sizes[sizes.length - 1];
    }
    if (Number(state.search.nMin) > Number(state.search.nMax)) {
      state.search.nMax = state.search.nMin;
    }
  }

  function syncSearchStateFromInputs() {
    if (state.mode === "smallest") {
      state.smallest.dataset = byId("searchDataset").value;
      return;
    }
    state.search.dataset = byId("searchDataset").value;
    state.search.nMin = Number(byId("searchNMin").value || 1);
    state.search.nMax = Number(byId("searchNMax").value || state.search.nMin || 1);
    if (state.mode === "search") {
      state.search.limit = Number(byId("pageSize").value || 25);
    }
  }

  function renderSearchSelectors() {
    if (state.mode === "browse") {
      state.search.dataset = state.dataset;
      state.search.nMin = state.level;
      state.search.nMax = state.level;
    }
    ensureSearchDataset();
    if (state.mode !== "smallest") {
      ensureSearchSizeBounds();
    }
    const datasets = availableDatasets();
    const selectedDataset = state.mode === "smallest" ? state.smallest.dataset : state.search.dataset;
    byId("searchDataset").innerHTML = R.optionMarkup(datasets, selectedDataset);
    if (state.mode !== "smallest") {
      const sizes = availableSizes(state.search.dataset);
      byId("searchNMin").innerHTML = R.optionMarkup(sizes, state.search.nMin);
      byId("searchNMax").innerHTML = R.optionMarkup(sizes, state.search.nMax);
    }
    if (byId("dataset")) {
      byId("dataset").value = state.dataset;
    }
    if (byId("level")) {
      byId("level").value = String(state.level);
    }
    byId("pageSize").value = String(state.mode === "search" ? state.search.limit : state.pageSize);
  }

  function renderModeUI() {
    const browseMode = state.mode === "browse";
    const searchMode = state.mode === "search";
    const smallestMode = state.mode === "smallest";
    const scope = byId("searchScopeFields");
    byId("browseMode").classList.toggle("is-active", browseMode);
    byId("searchMode").classList.toggle("is-active", searchMode);
    byId("smallestMode").classList.toggle("is-active", smallestMode);
    scope.hidden = false;
    scope.classList.toggle("browse-scope", browseMode);
    scope.classList.toggle("search-scope-mode", searchMode);
    byId("searchDatasetRow").style.display = "";
    byId("searchNMaxRow").style.display = searchMode ? "" : "none";
    byId("searchNMinRow").style.display = smallestMode ? "none" : "";
    byId("searchNMinLabel").textContent = searchMode ? "n min" : "n";
    byId("pageSizeRow").hidden = !searchMode && !browseMode;
    byId("widthSliderGroup").hidden = smallestMode;
    byId("heightSliderGroup").hidden = smallestMode;
    byId("countFilterRow").hidden = smallestMode;
    byId("copyQueryLink").hidden = searchMode || smallestMode;
    byId("entriesTitle").textContent = searchMode ? "Blueprint Results" : smallestMode ? "Smallest Example" : "Entries";
    byId("entryListMeta").textContent = searchMode
      ? "Search across sizes using the same live database-backed constraints."
      : smallestMode
        ? "Find the least-size witness for the selected dataset and property set."
        : "Current browse slice.";
    byId("applyFilters").textContent = searchMode ? "Run Search" : smallestMode ? "Find Smallest Match" : "Apply Filters";
    byId("clearFilters").textContent = searchMode ? "Reset Search" : smallestMode ? "Reset Finder" : "Clear";
    byId("exportListCsv").textContent = searchMode ? "Export Results CSV" : "Export List CSV";
    byId("exportListJson").textContent = searchMode ? "Export Results JSON" : "Export List JSON";
    const pager = document.querySelector(".pager");
    if (pager) {
      pager.hidden = searchMode || smallestMode;
    }
    byId("entriesToolbar").hidden = smallestMode;
  }

  function resetBlueprintSearchForm() {
    state.search.dataset = state.dataset;
    state.search.nMin = state.level;
    state.search.nMax = state.level;
    state.search.limit = 25;
    state.search.widthMin = "";
    state.search.widthMax = "";
    state.search.heightMin = "";
    state.search.heightMax = "";
    state.search.countMin = "";
    state.search.countMax = "";
    state.search.properties = [];
    state.searchFilterBounds = null;
    renderSearchSelectors();
  }

  function searchQuery() {
    const params = new URLSearchParams();
    params.set("dataset", state.search.dataset);
    params.set("n_min", String(state.search.nMin));
    params.set("n_max", String(state.search.nMax));
    params.set("limit", String(state.search.limit));
    if (state.search.widthMin) params.set("width_min", state.search.widthMin);
    if (state.search.widthMax) params.set("width_max", state.search.widthMax);
    if (state.search.heightMin) params.set("height_min", state.search.heightMin);
    if (state.search.heightMax) params.set("height_max", state.search.heightMax);
    if (state.search.dataset === "extlat") {
      if (state.search.countMin) params.set("count_min", state.search.countMin);
      if (state.search.countMax) params.set("count_max", state.search.countMax);
    }
    state.search.properties.forEach((value) => params.append("prop", value));
    return params.toString();
  }

  function searchStructuralReasons(item) {
    const reasons = [];
    reasons.push(`Size ${item.n} lies within the requested n range ${state.search.nMin} to ${state.search.nMax}.`);
    if (state.search.widthMin || state.search.widthMax) {
      reasons.push(`Width ${item.width} satisfies the requested width bounds.`);
    }
    if (state.search.heightMin || state.search.heightMax) {
      reasons.push(`Height ${item.height} satisfies the requested height bounds.`);
    }
    if (item.count != null && (state.search.countMin || state.search.countMax)) {
      reasons.push(`Expansion count ${item.count} satisfies the requested count bounds.`);
    }
    reasons.push(item.explanation);
    return reasons;
  }

  async function loadWhyQualified(shell, item) {
    const body = shell.querySelector(".why-qualified-body");
    if (!body || shell.dataset.loaded === "1") {
      return;
    }
    body.innerHTML = `<div class="meta">Loading explanation...</div>`;
    const params = new URLSearchParams({
      dataset: item.dataset,
      n: String(item.n),
      index: String(item.index),
    });
    (item.matched_property_keys || []).forEach((key) => params.append("prop", key));
    const payload = await fetchJson(`/api/why-qualified?${params.toString()}`);
    const propertyRows = payload.properties?.length
      ? payload.properties.map((prop) => `
          <div class="why-qualified-item">
            <strong>${escapeHtml(prop.label)}</strong>
            <div class="meta">${escapeHtml(prop.why || prop.description || "")}</div>
          </div>
        `).join("")
      : `<div class="meta">No property-specific qualifier was selected for this result.</div>`;
    const structuralRows = searchStructuralReasons(item).map((reason) => `
      <div class="why-qualified-item">
        <div class="meta">${escapeHtml(reason)}</div>
      </div>
    `).join("");
    body.innerHTML = `
      <div class="why-qualified-section">
        <div class="checker-group-title">Matched Properties</div>
        <div class="why-qualified-list">${propertyRows}</div>
      </div>
      <div class="why-qualified-section">
        <div class="checker-group-title">Structural Reasons</div>
        <div class="why-qualified-list">${structuralRows}</div>
      </div>
    `;
    shell.dataset.loaded = "1";
  }

  function renderSearchResults(payload) {
    byId("entryListMeta").textContent = payload.total
      ? `${payload.total} matches across n=${payload.n_min} to n=${payload.n_max}. Showing top ${payload.items.length}.`
      : `No matches for ${payload.dataset} across n=${payload.n_min} to n=${payload.n_max}.`;
    const box = byId("entryList");
    if (!payload.items.length) {
      box.innerHTML = `<div class="empty">No candidate blueprints matched.</div>`;
      return;
    }
    box.innerHTML = payload.items.map((item) => `
      <div class="blueprint-row search-result-row" data-dataset="${item.dataset}" data-n="${item.n}" data-index="${item.index}" role="button" tabindex="0">
        <div class="blueprint-main">
          <div class="blueprint-head">
            <strong>${item.dataset}${item.n} #${item.index}</strong>
            <span class="pill">w=${item.width}</span>
            <span class="pill">h=${item.height}</span>
            ${item.count != null ? `<span class="pill">count ${item.count}</span>` : ""}
          </div>
          ${item.matched_properties?.length ? `<div class="tag-row">${item.matched_properties.map((label) => `<span class="tag-chip">${escapeHtml(label)}</span>`).join("")}</div>` : ""}
          <div class="meta"><code>${item.encoding.slice(0, 24)}${item.encoding.length > 24 ? "..." : ""}</code></div>
          <div class="meta">${escapeHtml(item.explanation)}</div>
          <details class="why-qualified-shell" data-dataset="${item.dataset}" data-n="${item.n}" data-index="${item.index}">
            <summary>Why qualified</summary>
            <div class="why-qualified-body"></div>
          </details>
        </div>
        <div class="entry-actions blueprint-actions">
          <button class="search-primary" data-dataset="${item.dataset}" data-n="${item.n}" data-index="${item.index}" type="button">Primary</button>
          <button class="search-secondary" data-dataset="${item.dataset}" data-n="${item.n}" data-index="${item.index}" type="button">Secondary</button>
          <button class="ghost-button search-save" data-dataset="${item.dataset}" data-n="${item.n}" data-index="${item.index}" type="button">Save</button>
        </div>
      </div>
    `).join("");
    async function openSearchSelection(dataset, n, index) {
      state.dataset = dataset;
      state.level = Number(n);
      byId("primaryIndex").value = index;
      renderSearchSelectors();
      await Promise.all([R.loadAnalysis(), R.loadViewer("primary")]);
      R.openAnalysisDrawer();
      R.syncUrlState();
    }
    box.querySelectorAll(".search-result-row").forEach((row) => {
      const open = R.protect("search.open_result", async () => {
        await openSearchSelection(row.dataset.dataset, row.dataset.n, row.dataset.index);
      }, { kind: "ui" });
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
    box.querySelectorAll(".search-primary").forEach((button) => {
      button.addEventListener("click", R.protect("search.primary", async (event) => {
        event.stopPropagation();
        await openSearchSelection(button.dataset.dataset, button.dataset.n, button.dataset.index);
      }, { kind: "ui" }));
    });
    box.querySelectorAll(".search-secondary").forEach((button) => {
      button.addEventListener("click", R.protect("search.secondary", async (event) => {
        event.stopPropagation();
        byId("secondaryDataset").value = button.dataset.dataset;
        byId("secondaryLevel").value = button.dataset.n;
        byId("secondaryIndex").value = button.dataset.index;
        await R.loadViewer("secondary");
        R.syncUrlState();
      }, { kind: "ui" }));
    });
    box.querySelectorAll(".search-save").forEach((button) => {
      button.addEventListener("click", R.protect("search.save_result", async (event) => {
        event.stopPropagation();
        const entry = await fetchJson(`/api/entry?dataset=${button.dataset.dataset}&n=${button.dataset.n}&index=${button.dataset.index}`);
        R.openBlueprintDialog(entry);
      }, { kind: "ui" }));
    });
    box.querySelectorAll(".why-qualified-shell").forEach((shell, index) => {
      shell.addEventListener("click", (event) => event.stopPropagation());
      shell.addEventListener("toggle", R.protect("search.why_qualified", async () => {
        if (!shell.open) {
          return;
        }
        await loadWhyQualified(shell, payload.items[index]);
      }, { kind: "ui" }));
    });
  }

  async function runBlueprintSearch() {
    return loading.run("entries", "Searching blueprints...", async () => {
      const payload = await fetchJson(`/api/blueprint-search?${searchQuery()}`);
      renderSearchResults(payload);
      return payload;
    });
  }

  async function loadResultsByMode() {
    if (state.mode === "search") {
      return runBlueprintSearch();
    }
    if (state.mode === "smallest") {
      return R.runSmallestExample();
    }
    return R.loadEntries();
  }

  async function setMode(mode, { syncResults = true } = {}) {
    state.mode = ["browse", "search", "smallest"].includes(mode) ? mode : "browse";
    if (state.mode === "browse") {
      state.search.dataset = state.dataset;
      state.search.nMin = state.level;
      state.search.nMax = state.level;
    } else if (state.mode === "smallest" && !state.smallest.dataset) {
      state.smallest.dataset = state.dataset;
    }
    renderModeUI();
    renderSearchSelectors();
    if (state.mode === "smallest") {
      await R.fetchPropertyFilters();
    } else {
      await Promise.all([R.fetchPropertyFilters(), R.loadFilterBounds()]);
    }
    R.renderConstraintSummary();
    R.applyFilterInputsFromState();
    if (syncResults) {
      await loadResultsByMode();
    }
    R.syncUrlState();
  }

  async function initializeBlueprintSearch() {
    if (!state.search.dataset) {
      state.search.dataset = state.dataset;
    }
    if (!state.search.nMin) {
      state.search.nMin = state.level;
    }
    if (!state.search.nMax) {
      state.search.nMax = state.level;
    }
    renderSearchSelectors();
    renderModeUI();
  }

  function wireBlueprintSearch() {
    byId("browseMode").addEventListener("click", R.protect("search.mode_browse", async () => {
      await setMode("browse");
    }, { kind: "ui" }));
    byId("searchMode").addEventListener("click", R.protect("search.mode_search", async () => {
      await setMode("search");
    }, { kind: "ui" }));
    byId("smallestMode").addEventListener("click", R.protect("search.mode_smallest", async () => {
      await setMode("smallest");
    }, { kind: "ui" }));
    byId("searchDataset").addEventListener("change", R.protect("search.dataset", async () => {
      syncSearchStateFromInputs();
      if (state.mode === "smallest") {
        await R.fetchPropertyFilters();
        R.renderConstraintSummary();
        R.applyFilterInputsFromState();
        R.syncUrlState();
        return;
      }
      if (state.mode === "browse") {
        state.dataset = state.search.dataset;
        renderSearchSelectors();
        R.clearFilterInputs();
        await R.fetchPropertyFilters();
        await R.syncPrimaryContext();
        R.syncUrlState();
        return;
      }
      ensureSearchSizeBounds();
      renderSearchSelectors();
      await Promise.all([R.fetchPropertyFilters(), R.loadFilterBounds()]);
      R.renderConstraintSummary();
      R.syncUrlState();
    }, { kind: "ui" }));
    ["searchNMin", "searchNMax"].forEach((id) => {
      byId(id).addEventListener("change", R.protect(`search.scope.${id}`, async () => {
        syncSearchStateFromInputs();
        if (state.mode === "browse") {
          state.dataset = state.search.dataset;
          state.level = state.search.nMin;
          state.search.nMax = state.search.nMin;
          renderSearchSelectors();
          await R.syncPrimaryContext();
          R.syncUrlState();
          return;
        }
        renderSearchSelectors();
        await R.loadFilterBounds();
        R.renderConstraintSummary();
        R.syncUrlState();
      }, { kind: "ui" }));
    });
  }

  Object.assign(R, {
    initializeBlueprintSearch,
    wireBlueprintSearch,
    resetBlueprintSearchForm,
    syncSearchStateFromInputs,
    renderSearchSelectors,
    renderSearchResults,
    runBlueprintSearch,
    loadResultsByMode,
    setMode,
  });
})();
