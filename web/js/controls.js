(() => {
  const R = window.Residuals;
  const {
    state,
    byId,
    fetchJson,
    loading,
    escapeHtml,
    activeFilterState,
    activeFilterBounds,
    activeDataset,
  } = R;

  function currentFilterQuery() {
    const params = new URLSearchParams();
    if (state.filters.widthMin && Number(state.filters.widthMin) !== state.filterBounds?.width_min) params.set("width_min", state.filters.widthMin);
    if (state.filters.widthMax && Number(state.filters.widthMax) !== state.filterBounds?.width_max) params.set("width_max", state.filters.widthMax);
    if (state.filters.heightMin && Number(state.filters.heightMin) !== state.filterBounds?.height_min) params.set("height_min", state.filters.heightMin);
    if (state.filters.heightMax && Number(state.filters.heightMax) !== state.filterBounds?.height_max) params.set("height_max", state.filters.heightMax);
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
    params.set("mode", state.mode);
    params.set("page_size", String(state.pageSize));
    if (state.offset) params.set("offset", String(state.offset));
    if (state.trendMode !== "counts") params.set("trend", state.trendMode);
    const filterParams = new URLSearchParams(currentFilterQuery());
    filterParams.forEach((value, key) => params.append(key, value));
    if (state.mode === "search") {
      params.set("search_dataset", state.search.dataset);
      params.set("search_n_min", String(state.search.nMin));
      params.set("search_n_max", String(state.search.nMax));
      params.set("search_limit", String(state.search.limit));
      if (state.search.widthMin) params.set("search_width_min", state.search.widthMin);
      if (state.search.widthMax) params.set("search_width_max", state.search.widthMax);
      if (state.search.heightMin) params.set("search_height_min", state.search.heightMin);
      if (state.search.heightMax) params.set("search_height_max", state.search.heightMax);
      if (state.search.countMin) params.set("search_count_min", state.search.countMin);
      if (state.search.countMax) params.set("search_count_max", state.search.countMax);
      state.search.properties.forEach((value) => params.append("search_prop", value));
    } else if (state.mode === "smallest") {
      params.set("smallest_dataset", state.smallest.dataset);
      state.smallest.properties.forEach((value) => params.append("smallest_prop", value));
    }
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
    const mode = params.get("mode");
    if (mode === "search" || mode === "smallest") state.mode = mode;
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
    state.search = {
      dataset: params.get("search_dataset") || state.dataset,
      nMin: Number(params.get("search_n_min") || state.level || 1),
      nMax: Number(params.get("search_n_max") || state.level || 1),
      limit: Number(params.get("search_limit") || 25),
      widthMin: params.get("search_width_min") || "",
      widthMax: params.get("search_width_max") || "",
      heightMin: params.get("search_height_min") || "",
      heightMax: params.get("search_height_max") || "",
      countMin: params.get("search_count_min") || "",
      countMax: params.get("search_count_max") || "",
      properties: params.getAll("search_prop"),
    };
    state.smallest = {
      dataset: params.get("smallest_dataset") || state.dataset,
      properties: params.getAll("smallest_prop"),
    };
    return {
      primaryIndex: params.get("primary_index") || "0",
      secondaryDataset: params.get("secondary_dataset") || "reslat",
      secondaryLevel: params.get("secondary_n") || String(state.level),
      secondaryIndex: params.get("secondary_index") || "0",
    };
  }

  function applyFilterInputsFromState() {
    const filters = activeFilterState();
    const bounds = activeFilterBounds();
    if (bounds) {
      byId("filterWidthMin").value = filters.widthMin || bounds.width_min;
      byId("filterWidthMax").value = filters.widthMax || bounds.width_max;
      byId("filterHeightMin").value = filters.heightMin || bounds.height_min;
      byId("filterHeightMax").value = filters.heightMax || bounds.height_max;
    }
    byId("filterCountMin").value = filters.countMin || "";
    byId("filterCountMax").value = filters.countMax || "";
    document.querySelectorAll(".property-check").forEach((input) => {
      input.checked = filters.properties.includes(input.value);
    });
    byId("countFilterRow").style.display = state.mode !== "smallest" && activeDataset() === "extlat" ? "grid" : "none";
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
    const filters = activeFilterState();
    const bounds = activeFilterBounds();
    if (!bounds) {
      return;
    }
    filters.widthMin = boundFilterValue(filters.widthMin, bounds.width_min, bounds.width_max);
    filters.widthMax = boundFilterValue(filters.widthMax, bounds.width_min, bounds.width_max);
    filters.heightMin = boundFilterValue(filters.heightMin, bounds.height_min, bounds.height_max);
    filters.heightMax = boundFilterValue(filters.heightMax, bounds.height_min, bounds.height_max);
    if (filters.widthMin && filters.widthMax && Number(filters.widthMin) > Number(filters.widthMax)) {
      filters.widthMax = filters.widthMin;
    }
    if (filters.heightMin && filters.heightMax && Number(filters.heightMin) > Number(filters.heightMax)) {
      filters.heightMax = filters.heightMin;
    }
  }

  function renderConstraintSummary() {
    const bits = [];
    const filters = activeFilterState();
    const bounds = activeFilterBounds();
    if (bounds) {
      const widthChanged = (filters.widthMin && Number(filters.widthMin) !== bounds.width_min)
        || (filters.widthMax && Number(filters.widthMax) !== bounds.width_max);
      const heightChanged = (filters.heightMin && Number(filters.heightMin) !== bounds.height_min)
        || (filters.heightMax && Number(filters.heightMax) !== bounds.height_max);
      if (widthChanged) bits.push(`w ${filters.widthMin || "min"}-${filters.widthMax || "max"}`);
      if (heightChanged) bits.push(`h ${filters.heightMin || "min"}-${filters.heightMax || "max"}`);
    }
    if (state.mode !== "smallest" && activeDataset() === "extlat" && (filters.countMin || filters.countMax)) {
      bits.push(`count ${filters.countMin || "min"}-${filters.countMax || "max"}`);
    }
    if (filters.properties.length) bits.push(`${filters.properties.length} properties`);
    if (state.mode === "search") {
      bits.push(`${state.search.dataset} n=${state.search.nMin}-${state.search.nMax}`);
      bits.push(`top ${state.search.limit}`);
    } else if (state.mode === "smallest") {
      bits.push(state.smallest.dataset);
      bits.push("least-size witness");
    } else {
      bits.push(`${state.dataset}${state.level}`);
    }
    byId("constraintSummary").textContent = bits.length ? bits.join(" • ") : "No active query constraints.";
  }

  function syncFilterStateFromInputs() {
    const filters = activeFilterState();
    if (state.mode !== "smallest") {
      filters.widthMin = byId("filterWidthMin").value.trim();
      filters.widthMax = byId("filterWidthMax").value.trim();
      filters.heightMin = byId("filterHeightMin").value.trim();
      filters.heightMax = byId("filterHeightMax").value.trim();
      filters.countMin = byId("filterCountMin").value.trim();
      filters.countMax = byId("filterCountMax").value.trim();
    }
    filters.properties = [...document.querySelectorAll(".property-check:checked")].map((input) => input.value);
  }

  function clearFilterInputs() {
    const bounds = activeFilterBounds();
    const filters = activeFilterState();
    if (bounds) {
      byId("filterWidthMin").value = bounds.width_min;
      byId("filterWidthMax").value = bounds.width_max;
      byId("filterHeightMin").value = bounds.height_min;
      byId("filterHeightMax").value = bounds.height_max;
    }
    ["filterCountMin", "filterCountMax"].forEach((id) => {
      byId(id).value = "";
    });
    document.querySelectorAll(".property-check").forEach((input) => {
      input.checked = false;
    });
    if (state.mode !== "smallest") {
      filters.widthMin = bounds ? String(bounds.width_min) : "";
      filters.widthMax = bounds ? String(bounds.width_max) : "";
      filters.heightMin = bounds ? String(bounds.height_min) : "";
      filters.heightMax = bounds ? String(bounds.height_max) : "";
      filters.countMin = "";
      filters.countMax = "";
    }
    filters.properties = [];
    updateDoubleSlider("Width");
    updateDoubleSlider("Height");
    renderConstraintSummary();
  }

  function renderPropertyFilters(payload) {
    state.propertyOptions = payload.properties;
    const filters = activeFilterState();
    byId("countFilterRow").style.display = state.mode !== "smallest" && activeDataset() === "extlat" ? "grid" : "none";
    byId("propertyFilters").innerHTML = payload.properties.map((prop) => `
      <label class="property-item">
        <input class="property-check" type="checkbox" value="${prop.key}" ${filters.properties.includes(prop.key) ? "checked" : ""}>
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

  async function fetchPropertyFilters() {
    return loading.run("controls", "Loading property filters...", async () => {
      const payload = await fetchJson(`/api/filter-options?dataset=${activeDataset()}`);
      renderPropertyFilters(payload);
      return payload;
    });
  }

  async function aggregateSearchBounds() {
    const sizes = state.summaryRows
      .filter((row) => row.dataset === state.search.dataset)
      .map((row) => row.n)
      .filter((n) => n >= Math.min(state.search.nMin, state.search.nMax) && n <= Math.max(state.search.nMin, state.search.nMax))
      .sort((a, b) => a - b);
    if (!sizes.length) {
      return { width_min: 1, width_max: 1, height_min: 1, height_max: 1 };
    }
    const payloads = await Promise.all(
      sizes.map((n) => fetchJson(`/api/filter-bounds?dataset=${state.search.dataset}&n=${n}`)),
    );
    return {
      width_min: Math.min(...payloads.map((item) => item.width_min)),
      width_max: Math.max(...payloads.map((item) => item.width_max)),
      height_min: Math.min(...payloads.map((item) => item.height_min)),
      height_max: Math.max(...payloads.map((item) => item.height_max)),
    };
  }

  async function loadFilterBounds() {
    if (state.mode === "smallest") {
      state.searchFilterBounds = null;
      renderConstraintSummary();
      return null;
    }
    return loading.run("controls", "Loading filter bounds...", async () => {
      const nextBounds = state.mode === "search"
        ? await aggregateSearchBounds()
        : await fetchJson(`/api/filter-bounds?dataset=${state.dataset}&n=${state.level}`);
      if (state.mode === "search") {
        state.searchFilterBounds = nextBounds;
      } else {
        state.filterBounds = nextBounds;
      }
      const bounds = activeFilterBounds();
      const widthMin = byId("filterWidthMin");
      const widthMax = byId("filterWidthMax");
      const heightMin = byId("filterHeightMin");
      const heightMax = byId("filterHeightMax");
      widthMin.min = bounds.width_min;
      widthMin.max = bounds.width_max;
      widthMax.min = bounds.width_min;
      widthMax.max = bounds.width_max;
      heightMin.min = bounds.height_min;
      heightMin.max = bounds.height_max;
      heightMax.min = bounds.height_min;
      heightMax.max = bounds.height_max;
      ensureFilterValuesWithinBounds();
      applyFilterInputsFromState();
      renderConstraintSummary();
    });
  }

  Object.assign(R, {
    currentFilterQuery,
    currentQueryParamsObject,
    syncUrlState,
    restoreStateFromUrl,
    applyFilterInputsFromState,
    ensureFilterValuesWithinBounds,
    renderConstraintSummary,
    syncFilterStateFromInputs,
    clearFilterInputs,
    renderPropertyFilters,
    updateDoubleSlider,
    wireDoubleSlider,
    fetchPropertyFilters,
    loadFilterBounds,
  });
})();
