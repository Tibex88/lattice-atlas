(() => {
  const R = window.Residuals;
  const { state, byId } = R;

  async function boot() {
    R.errors.installGlobalHandlers();
    const restored = R.restoreStateFromUrl();
    const levels = Array.from({ length: 12 }, (_, i) => i + 1);
    const datasets = ["lat", "extlat", "reslat"];
    byId("dataset").innerHTML = R.optionMarkup(datasets, state.dataset);
    byId("secondaryDataset").innerHTML = R.optionMarkup(datasets, restored.secondaryDataset);
    byId("level").innerHTML = R.optionMarkup(levels, state.level);
    byId("secondaryLevel").innerHTML = R.optionMarkup(levels, restored.secondaryLevel);
    await Promise.all([R.loadSummary(), R.loadStorageStatus()]);
    await R.initializeBlueprintSearch();
    await R.fetchPropertyFilters();
    await R.loadFilterBounds();
    await Promise.all([R.loadEntries(), R.loadAnalysis(), R.loadSavedBlueprints()]);
    byId("primaryIndex").value = restored.primaryIndex;
    byId("secondaryIndex").value = restored.secondaryIndex;
    await R.loadViewer("primary");
    await R.loadViewer("secondary");
    R.wireDoubleSlider("Width");
    R.wireDoubleSlider("Height");
    R.wireInfoButtons();
    R.wireSummaryDialog();
    R.wireBlueprintDialog();
    R.wireBlueprintSearch();

    byId("copyQueryLink").addEventListener("click", async () => {
      R.syncUrlState();
      try {
        await navigator.clipboard.writeText(window.location.href);
      } catch (error) {
        const helper = document.createElement("textarea");
        helper.value = window.location.href;
        helper.setAttribute("readonly", "true");
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.append(helper);
        helper.select();
        document.execCommand("copy");
        helper.remove();
        R.logger.warn("ui.copy_query_link_fallback", { message: error.message });
      }
    });

    byId("exportListCsv").addEventListener("click", () => R.exportCurrentList("csv"));
    byId("exportListJson").addEventListener("click", () => R.exportCurrentList("json"));
    byId("exportPrimaryJson").addEventListener("click", () => R.exportViewerEntry("primary"));
    byId("exportSecondaryJson").addEventListener("click", () => R.exportViewerEntry("secondary"));
    byId("exportAppendixProperties").addEventListener("click", R.exportAppendixProperties);
    byId("exportAppendixDimensions").addEventListener("click", R.exportAppendixDimensions);
    byId("exportCooccurrenceCsv").addEventListener("click", R.exportCooccurrenceCsv);

    byId("trendCounts").addEventListener("click", () => {
      state.trendMode = "counts";
      R.renderTrendChart();
      R.syncUrlState();
    });
    byId("trendRatios").addEventListener("click", () => {
      state.trendMode = "ratios";
      R.renderTrendChart();
      R.syncUrlState();
    });

    byId("dataset").addEventListener("change", R.protect("controls.primary_dataset", async (e) => {
      state.dataset = e.target.value;
      R.clearFilterInputs();
      await R.fetchPropertyFilters();
      await R.syncPrimaryContext();
      R.syncUrlState();
    }, { kind: "ui" }));

    byId("level").addEventListener("change", R.protect("controls.primary_level", async (e) => {
      state.level = Number(e.target.value);
      await R.syncPrimaryContext();
      R.syncUrlState();
    }, { kind: "ui" }));

    byId("pageSize").addEventListener("change", R.protect("controls.page_size", async (e) => {
      state.pageSize = Number(e.target.value);
      state.offset = 0;
      await R.loadEntries();
      R.syncUrlState();
    }, { kind: "ui" }));

    byId("applyFilters").addEventListener("click", R.protect("controls.apply_filters", async () => {
      R.syncFilterStateFromInputs();
      R.renderConstraintSummary();
      state.offset = 0;
      await R.loadEntries();
      R.syncUrlState();
    }, { kind: "ui" }));

    byId("clearFilters").addEventListener("click", R.protect("controls.clear_filters", async () => {
      R.clearFilterInputs();
      state.offset = 0;
      await R.loadEntries();
      R.syncUrlState();
    }, { kind: "ui" }));

    byId("prevPage").addEventListener("click", R.protect("controls.prev_page", async () => {
      state.offset = Math.max(0, state.offset - state.pageSize);
      await R.loadEntries();
      R.syncUrlState();
    }, { kind: "ui" }));

    byId("nextPage").addEventListener("click", R.protect("controls.next_page", async () => {
      if (state.offset + state.pageSize < state.total) {
        state.offset += state.pageSize;
        await R.loadEntries();
        R.syncUrlState();
      }
    }, { kind: "ui" }));

    byId("loadPrimary").addEventListener("click", R.protect("viewer.load_primary", () => R.loadViewer("primary"), { kind: "ui" }));
    byId("loadSecondary").addEventListener("click", R.protect("viewer.load_secondary", () => R.loadViewer("secondary"), { kind: "ui" }));

    byId("savePrimaryBlueprint").addEventListener("click", R.protect("blueprints.open_primary", async () => {
      if (!state.primaryEntry) {
        await R.loadViewer("primary");
      }
      if (state.primaryEntry) {
        R.openBlueprintDialog(state.primaryEntry);
      }
    }, { kind: "ui" }));

    byId("saveSecondaryBlueprint").addEventListener("click", R.protect("blueprints.open_secondary", async () => {
      if (!state.secondaryEntry) {
        await R.loadViewer("secondary");
      }
      if (state.secondaryEntry) {
        R.openBlueprintDialog(state.secondaryEntry);
      }
    }, { kind: "ui" }));

    byId("secondaryDataset").addEventListener("change", R.protect("controls.secondary_dataset", async () => {
      await R.syncSecondaryContext();
      R.syncUrlState();
    }, { kind: "ui" }));

    byId("secondaryLevel").addEventListener("change", R.protect("controls.secondary_level", async () => {
      await R.syncSecondaryContext();
      R.syncUrlState();
    }, { kind: "ui" }));

    byId("secondaryIndex").addEventListener("change", R.protect("controls.secondary_index", async () => {
      await R.syncSecondaryViewer();
      R.syncUrlState();
    }, { kind: "ui" }));

    R.syncUrlState();
  }

  R.protect("boot", boot, { kind: "ui" })();
})();
