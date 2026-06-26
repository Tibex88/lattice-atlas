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
    if (!datasets.includes(state.search.dataset)) {
      state.search.dataset = datasets[0] || "lat";
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
      state.search.nMin = sizes[0];
    }
    if (!sizes.includes(Number(state.search.nMax))) {
      state.search.nMax = sizes[sizes.length - 1];
    }
    if (Number(state.search.nMin) > Number(state.search.nMax)) {
      state.search.nMax = state.search.nMin;
    }
  }

  function renderSearchSelectors() {
    ensureSearchDataset();
    ensureSearchSizeBounds();
    const datasets = availableDatasets();
    const sizes = availableSizes(state.search.dataset);
    byId("searchDataset").innerHTML = R.optionMarkup(datasets, state.search.dataset);
    byId("searchNMin").innerHTML = R.optionMarkup(sizes, state.search.nMin);
    byId("searchNMax").innerHTML = R.optionMarkup(sizes, state.search.nMax);
    byId("searchLimit").value = String(state.search.limit);
    byId("searchWidthMin").value = state.search.widthMin;
    byId("searchWidthMax").value = state.search.widthMax;
    byId("searchHeightMin").value = state.search.heightMin;
    byId("searchHeightMax").value = state.search.heightMax;
    byId("searchCountMin").value = state.search.countMin;
    byId("searchCountMax").value = state.search.countMax;
    byId("searchCountRow").style.display = state.search.dataset === "extlat" ? "grid" : "none";
  }

  function renderSearchPropertyFilters(payload) {
    state.searchPropertyOptions = payload.properties;
    byId("searchPropertyFilters").innerHTML = payload.properties.map((prop) => `
      <label class="property-item">
        <input class="search-property-check" type="checkbox" value="${prop.key}" ${state.search.properties.includes(prop.key) ? "checked" : ""}>
        <span>${prop.label}</span>
      </label>
    `).join("");
    const infoButton = byId("searchPropertiesInfo");
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
        <div class="meta">Each checked property is required in the search result.</div>
        <div class="info-definition-list">${definitions}</div>
      `;
    }
  }

  async function loadSearchPropertyFilters() {
    return loading.run("search", "Loading search properties...", async () => {
      const payload = await fetchJson(`/api/filter-options?dataset=${state.search.dataset}`);
      renderSearchPropertyFilters(payload);
      return payload;
    });
  }

  function syncSearchStateFromInputs() {
    state.search.dataset = byId("searchDataset").value;
    state.search.nMin = Number(byId("searchNMin").value || 1);
    state.search.nMax = Number(byId("searchNMax").value || state.search.nMin || 1);
    state.search.limit = Number(byId("searchLimit").value || 25);
    state.search.widthMin = byId("searchWidthMin").value.trim();
    state.search.widthMax = byId("searchWidthMax").value.trim();
    state.search.heightMin = byId("searchHeightMin").value.trim();
    state.search.heightMax = byId("searchHeightMax").value.trim();
    state.search.countMin = byId("searchCountMin").value.trim();
    state.search.countMax = byId("searchCountMax").value.trim();
    state.search.properties = [...document.querySelectorAll(".search-property-check:checked")].map((input) => input.value);
  }

  function resetBlueprintSearchForm() {
    state.search = {
      dataset: state.dataset,
      nMin: state.level,
      nMax: state.level,
      limit: 25,
      widthMin: "",
      widthMax: "",
      heightMin: "",
      heightMax: "",
      countMin: "",
      countMax: "",
      properties: [],
    };
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

  function renderSearchResults(payload) {
    byId("searchSummary").textContent = payload.total
      ? `${payload.total} matches across n=${payload.n_min} to n=${payload.n_max}. Showing top ${payload.items.length}.`
      : `No matches for ${payload.dataset} across n=${payload.n_min} to n=${payload.n_max}.`;
    const box = byId("searchResults");
    if (!payload.items.length) {
      box.innerHTML = `<div class="empty">No candidate blueprints matched.</div>`;
      return;
    }
    box.innerHTML = payload.items.map((item) => `
      <div class="blueprint-row">
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
        </div>
        <div class="entry-actions blueprint-actions">
          <button class="search-primary" data-dataset="${item.dataset}" data-n="${item.n}" data-index="${item.index}" type="button">Primary</button>
          <button class="search-secondary" data-dataset="${item.dataset}" data-n="${item.n}" data-index="${item.index}" type="button">Secondary</button>
          <button class="ghost-button search-save" data-dataset="${item.dataset}" data-n="${item.n}" data-index="${item.index}" type="button">Save</button>
        </div>
      </div>
    `).join("");
    box.querySelectorAll(".search-primary").forEach((button) => {
      button.addEventListener("click", async () => {
        state.dataset = button.dataset.dataset;
        state.level = Number(button.dataset.n);
        byId("dataset").value = state.dataset;
        byId("level").value = String(state.level);
        byId("primaryIndex").value = button.dataset.index;
        await R.fetchPropertyFilters();
        await R.syncPrimaryContext({ resetIndex: false });
      });
    });
    box.querySelectorAll(".search-secondary").forEach((button) => {
      button.addEventListener("click", async () => {
        byId("secondaryDataset").value = button.dataset.dataset;
        byId("secondaryLevel").value = button.dataset.n;
        byId("secondaryIndex").value = button.dataset.index;
        await R.loadViewer("secondary");
      });
    });
    box.querySelectorAll(".search-save").forEach((button) => {
      button.addEventListener("click", R.protect("search.save_result", async () => {
        const entry = await fetchJson(`/api/entry?dataset=${button.dataset.dataset}&n=${button.dataset.n}&index=${button.dataset.index}`);
        R.openBlueprintDialog(entry);
      }, { kind: "ui" }));
    });
  }

  async function runBlueprintSearch() {
    syncSearchStateFromInputs();
    return loading.run("search", "Searching blueprints...", async () => {
      const payload = await fetchJson(`/api/blueprint-search?${searchQuery()}`);
      renderSearchResults(payload);
      return payload;
    });
  }

  async function initializeBlueprintSearch() {
    resetBlueprintSearchForm();
    renderSearchSelectors();
    await loadSearchPropertyFilters();
    renderSearchResults({ total: 0, n_min: state.search.nMin, n_max: state.search.nMax, items: [], dataset: state.search.dataset });
  }

  function wireBlueprintSearch() {
    byId("searchDataset").addEventListener("change", R.protect("search.dataset", async () => {
      state.search.dataset = byId("searchDataset").value;
      ensureSearchSizeBounds();
      renderSearchSelectors();
      await loadSearchPropertyFilters();
    }, { kind: "ui" }));
    byId("searchNMin").addEventListener("change", () => {
      syncSearchStateFromInputs();
      renderSearchSelectors();
    });
    byId("searchNMax").addEventListener("change", () => {
      syncSearchStateFromInputs();
      renderSearchSelectors();
    });
    byId("runBlueprintSearch").addEventListener("click", R.protect("search.run", runBlueprintSearch, { kind: "ui" }));
    byId("resetBlueprintSearch").addEventListener("click", R.protect("search.reset", async () => {
      resetBlueprintSearchForm();
      renderSearchSelectors();
      await loadSearchPropertyFilters();
      renderSearchResults({ total: 0, n_min: state.search.nMin, n_max: state.search.nMax, items: [], dataset: state.search.dataset });
    }, { kind: "ui" }));
  }

  Object.assign(R, {
    initializeBlueprintSearch,
    wireBlueprintSearch,
  });
})();
