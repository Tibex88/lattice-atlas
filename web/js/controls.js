(() => {
  const R = window.Residuals;
  const { state, byId, fetchJson, loading, escapeHtml } = R;

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

  async function fetchPropertyFilters() {
    return loading.run("controls", "Loading property filters...", async () => {
      const payload = await fetchJson(`/api/filter-options?dataset=${state.dataset}`);
      renderPropertyFilters(payload);
      return payload;
    });
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
