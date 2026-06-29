(() => {
  const R = window.Residuals;
  const { state, byId } = R;

  async function boot() {
    R.errors.installGlobalHandlers();
    const restored = R.restoreStateFromUrl();
    const levels = Array.from({ length: 12 }, (_, i) => i + 1);
    const datasets = ["lat", "extlat", "reslat"];
    byId("dataset").innerHTML = R.optionMarkup(datasets, state.dataset);
    byId("level").innerHTML = R.optionMarkup(levels, state.level);
    await Promise.all([R.loadSummary(), R.loadStorageStatus()]);
    await R.initializeBlueprintSearch();
    await R.fetchPropertyFilters();
    await R.loadFilterBounds();
    await Promise.all([R.loadResultsByMode(), R.loadAnalysis(), R.loadSavedBlueprints()]);
    byId("primaryIndex").value = restored.primaryIndex;
    await R.loadViewer();
    R.wireDoubleSlider("Width");
    R.wireDoubleSlider("Height");
    R.wirePropertyFilterPopover();
    R.wireInfoButtons();
    R.wireAnalysisDrawer();
    R.wireSummaryDialog();
    R.wireBlueprintDialog();
    R.wireSavedBlueprintsDialog();
    R.wireBlueprintSearch();
    await R.initializeWorkbench();
    R.wireWorkbench();

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
    byId("exportPrimaryJson").addEventListener("click", () => R.exportViewerEntry());
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
      R.renderSearchSelectors();
      if (state.mode === "search") {
        byId("primaryIndex").value = 0;
        await Promise.all([R.loadAnalysis(), R.loadViewer()]);
        R.syncUrlState();
        return;
      }
      if (state.mode === "smallest") {
        await R.syncPrimaryContext();
        R.syncUrlState();
        return;
      }
      R.clearFilterInputs();
      await R.fetchPropertyFilters();
      await R.syncPrimaryContext();
      R.syncUrlState();
    }, { kind: "ui" }));

    byId("level").addEventListener("change", R.protect("controls.primary_level", async (e) => {
      state.level = Number(e.target.value);
      R.renderSearchSelectors();
      if (state.mode === "search") {
        byId("primaryIndex").value = 0;
        await Promise.all([R.loadAnalysis(), R.loadViewer()]);
        R.syncUrlState();
        return;
      }
      if (state.mode === "smallest") {
        await R.syncPrimaryContext();
        R.syncUrlState();
        return;
      }
      await R.syncPrimaryContext();
      R.syncUrlState();
    }, { kind: "ui" }));

    byId("pageSize").addEventListener("change", R.protect("controls.page_size", async (e) => {
      if (state.mode === "smallest") {
        return;
      }
      if (state.mode === "search") {
        state.search.limit = Number(e.target.value);
      } else {
        state.pageSize = Number(e.target.value);
      }
      state.offset = 0;
      await R.loadResultsByMode();
      R.syncUrlState();
    }, { kind: "ui" }));

    byId("applyFilters").addEventListener("click", R.protect("controls.apply_filters", async () => {
      if (state.mode === "search") {
        R.syncSearchStateFromInputs();
      }
      R.syncFilterStateFromInputs();
      R.closePropertyFilterPopover?.();
      R.renderConstraintSummary();
      state.offset = 0;
      await R.loadResultsByMode();
      R.syncUrlState();
    }, { kind: "ui" }));

    byId("clearFilters").addEventListener("click", R.protect("controls.clear_filters", async () => {
      if (state.mode === "search") {
        R.resetBlueprintSearchForm();
        await R.loadFilterBounds();
        await R.fetchPropertyFilters();
      } else if (state.mode === "smallest") {
        R.resetSmallestExampleForm();
        R.renderSearchSelectors();
        await R.fetchPropertyFilters();
      }
      R.closePropertyFilterPopover?.();
      R.clearFilterInputs();
      state.offset = 0;
      if (state.mode === "smallest") {
        byId("entryListMeta").textContent = "Find the least-size witness for the selected dataset and property set.";
        byId("entryList").innerHTML = `<div class="empty">Select one or more properties, then run the finder.</div>`;
        R.renderConstraintSummary();
        R.syncUrlState();
        return;
      }
      await R.loadResultsByMode();
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

    byId("loadPrimary").addEventListener("click", R.protect("viewer.load_primary", async () => {
      await R.loadViewer();
      R.openAnalysisDrawer();
    }, { kind: "ui" }));

    byId("savePrimaryBlueprint").addEventListener("click", R.protect("blueprints.open_primary", async () => {
      if (!state.primaryEntry) {
        await R.loadViewer();
      }
      if (state.primaryEntry) {
        R.openBlueprintDialog(state.primaryEntry);
      }
    }, { kind: "ui" }));

    byId("shortlistPrimaryBlueprint").addEventListener("click", R.protect("blueprints.shortlist_primary", async () => {
      if (!state.primaryEntry) {
        await R.loadViewer();
      }
      if (state.primaryEntry) {
        await R.toggleShortlistForEntry(state.primaryEntry);
      }
    }, { kind: "ui" }));

    R.syncUrlState();
  }

  R.protect("boot", boot, { kind: "ui" })();
})();
