(() => {
  const R = window.Residuals;
  const { state, byId, fetchJson, loading, escapeHtml } = R;

  function blueprintKey(item) {
    return `${item.dataset}:${item.n}:${item.index}`;
  }

  function savedBlueprintMap() {
    return new Map(state.savedBlueprints.map((item) => [blueprintKey(item), item]));
  }

  function tagsFromInput(value) {
    return R.distinct(
      String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  function formatUtcStamp(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }

  function renderStorageMetaInto(node) {
    if (!node) {
      return;
    }
    if (state.storageError) {
      node.textContent = `Storage unavailable: ${state.storageError}`;
      return;
    }
    if (!state.storageStatus) {
      node.textContent = "Loading local storage...";
      return;
    }
    node.textContent = `${state.storageStatus.blueprints} blueprints saved in ${state.storageStatus.path}`;
  }

  function renderStorageMeta() {
    renderStorageMetaInto(byId("storageMeta"));
    renderStorageMetaInto(byId("storageMetaModal"));
  }

  function refreshViewerActions() {
    const shortlistButton = byId("shortlistPrimaryBlueprint");
    const saveButton = byId("savePrimaryBlueprint");
    const exportButton = byId("exportPrimaryJson");
    const entry = state.primaryEntry;
    if (saveButton) {
      saveButton.disabled = !entry;
    }
    if (exportButton) {
      exportButton.disabled = !entry;
    }
    if (!shortlistButton) {
      return;
    }
    if (!entry) {
      shortlistButton.disabled = true;
      shortlistButton.classList.remove("is-active");
      shortlistButton.textContent = "Shortlist";
      return;
    }
    shortlistButton.disabled = false;
    const saved = savedBlueprintMap().get(blueprintKey(entry));
    const shortlisted = saved && (state.shortlistIds || []).includes(saved.id);
    shortlistButton.classList.toggle("is-active", !!shortlisted);
    shortlistButton.textContent = R.shortlistButtonLabel(!!shortlisted);
  }

  function savedBlueprintMarkup() {
    const shortlist = new Set(state.shortlistIds || []);
    if (!state.savedBlueprints.length) {
      return `<div class="empty">No saved blueprints yet.</div>`;
    }
    return state.savedBlueprints.map((item) => `
      <div class="blueprint-row">
        <div class="blueprint-main">
          <div class="blueprint-head">
            <strong>${escapeHtml(item.title || `${item.dataset}${item.n} #${item.index}`)}</strong>
            <span class="pill">${item.dataset}${item.n}</span>
          </div>
          <div class="meta">index ${item.index} • w=${item.width} • h=${item.height}${item.count != null ? ` • count ${item.count}` : ""}</div>
          ${item.tags.length ? `<div class="tag-row">${item.tags.map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
          ${item.notes ? `<div class="meta">${escapeHtml(item.notes)}</div>` : ""}
          <div class="meta">updated ${escapeHtml(formatUtcStamp(item.updated_at))}</div>
        </div>
        <div class="entry-actions blueprint-actions">
          <button class="pick-blueprint-open" data-id="${item.id}" type="button">Open</button>
          <button class="ghost-button shortlist-blueprint ${shortlist.has(item.id) ? "is-active" : ""}" data-id="${item.id}" type="button">${R.shortlistButtonLabel(shortlist.has(item.id))}</button>
          <button class="ghost-button delete-blueprint" data-id="${item.id}" type="button">Delete</button>
        </div>
      </div>
    `).join("");
  }

  function wireSavedBlueprintActions(list) {
    if (!list) {
      return;
    }
    list.querySelectorAll(".pick-blueprint-open").forEach((button) => {
      button.addEventListener("click", async () => {
        const item = state.savedBlueprints.find((entry) => entry.id === Number(button.dataset.id));
        if (!item) {
          return;
        }
        state.dataset = item.dataset;
        state.level = item.n;
        byId("primaryIndex").value = item.index;
        R.renderSearchSelectors();
        await R.fetchPropertyFilters();
        await R.syncPrimaryContext({ resetIndex: false });
        R.openAnalysisDrawer();
      });
    });
    list.querySelectorAll(".shortlist-blueprint").forEach((button) => {
      button.addEventListener("click", () => {
        R.toggleShortlist(Number(button.dataset.id));
      });
    });
    list.querySelectorAll(".delete-blueprint").forEach((button) => {
      button.addEventListener("click", R.protect("blueprints.delete", async () => {
        await deleteBlueprint(Number(button.dataset.id));
      }, { kind: "ui" }));
    });
  }

  function renderSavedBlueprints() {
    renderStorageMeta();
    const markup = savedBlueprintMarkup();
    [byId("blueprintList"), byId("blueprintListModal")].forEach((list) => {
      if (!list) {
        return;
      }
      list.innerHTML = markup;
      wireSavedBlueprintActions(list);
    });
    refreshViewerActions();
  }

  async function loadStorageStatus() {
    return loading.run("blueprints", "Loading storage status...", async () => {
      try {
        state.storageStatus = await fetchJson("/api/storage");
        state.storageError = null;
      } catch (error) {
        state.storageStatus = null;
        state.storageError = error.message || "request failed";
        R.errors.handle(error, { source: "storage.status", kind: "network" });
      }
      renderStorageMeta();
    });
  }

  async function loadSavedBlueprints() {
    return loading.run("blueprints", "Loading saved blueprints...", async () => {
      try {
        const payload = await fetchJson("/api/blueprints");
        state.savedBlueprints = payload.items || [];
        state.storageError = null;
      } catch (error) {
        state.savedBlueprints = [];
        state.storageError = error.message || "request failed";
        R.errors.handle(error, { source: "storage.blueprints", kind: "network" });
      }
      renderSavedBlueprints();
      if (R.loadShortlistCompare) {
        await R.loadShortlistCompare();
      }
      if (state.currentEntries.length || state.total === 0) {
        R.renderEntryList({ items: state.currentEntries, total: state.total });
      }
    });
  }

  function openBlueprintDialog(entry) {
    state.pendingBlueprintTarget = entry;
    byId("blueprintDialogMeta").textContent = `${entry.dataset}${entry.n} • index ${entry.index} • width ${entry.width} • height ${entry.height}${entry.count != null ? ` • count ${entry.count}` : ""}`;
    const existing = savedBlueprintMap().get(blueprintKey(entry));
    byId("blueprintTitle").value = existing?.title || "";
    byId("blueprintTags").value = existing?.tags?.join(", ") || "";
    byId("blueprintNotes").value = existing?.notes || "";
    R.openDialog(byId("blueprintDialog"));
  }

  function closeBlueprintDialog() {
    R.closeDialog(byId("blueprintDialog"));
    state.pendingBlueprintTarget = null;
  }

  async function savePendingBlueprint() {
    const entry = state.pendingBlueprintTarget;
    if (!entry) {
      throw new R.AppError("No blueprint is selected for saving.", { kind: "ui" });
    }
    const payload = {
      dataset: entry.dataset,
      n: entry.n,
      index: entry.index,
      title: byId("blueprintTitle").value.trim(),
      tags: tagsFromInput(byId("blueprintTags").value),
      notes: byId("blueprintNotes").value.trim(),
    };
    await loading.run("blueprints", "Saving blueprint...", async () => {
      await fetchJson("/api/blueprints", {
        method: "POST",
        body: payload,
      });
      await Promise.all([loadStorageStatus(), loadSavedBlueprints()]);
    });
    closeBlueprintDialog();
  }

  async function deleteBlueprint(id) {
    await loading.run("blueprints", "Deleting blueprint...", async () => {
      await fetchJson(`/api/blueprints?id=${id}`, { method: "DELETE" });
      await Promise.all([loadStorageStatus(), loadSavedBlueprints()]);
    });
  }

  async function ensureBlueprintSaved(entry, { title = "", notes = "", tags = [] } = {}) {
    const existing = savedBlueprintMap().get(blueprintKey(entry));
    if (existing) {
      return existing;
    }
    await fetchJson("/api/blueprints", {
      method: "POST",
      body: {
        dataset: entry.dataset,
        n: entry.n,
        index: entry.index,
        title,
        notes,
        tags,
      },
    });
    await Promise.all([loadStorageStatus(), loadSavedBlueprints()]);
    return savedBlueprintMap().get(blueprintKey(entry));
  }

  async function toggleShortlistForEntry(entry) {
    return loading.run("blueprints", "Updating shortlist...", async () => {
      const saved = await ensureBlueprintSaved(entry);
      if (!saved) {
        throw new R.AppError("Could not save blueprint for shortlist.", { kind: "ui" });
      }
      R.toggleShortlist(saved.id);
      return saved;
    });
  }

  function wireBlueprintDialog() {
    const dialog = byId("blueprintDialog");
    byId("closeBlueprintDialog").addEventListener("click", closeBlueprintDialog);
    byId("blueprintForm").addEventListener("submit", R.protect("blueprints.save", async (event) => {
      event.preventDefault();
      await savePendingBlueprint();
    }, { kind: "ui" }));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        closeBlueprintDialog();
      }
    });
  }

  function wireSavedBlueprintsDialog() {
    const dialog = byId("blueprintsDialog");
    if (!dialog) {
      return;
    }
    byId("blueprintsFab")?.addEventListener("click", () => R.openDialog(dialog));
    byId("closeBlueprintsDialog")?.addEventListener("click", () => R.closeDialog(dialog));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        R.closeDialog(dialog);
      }
    });
  }

  Object.assign(R, {
    blueprintKey,
    savedBlueprintMap,
    renderSavedBlueprints,
    refreshViewerActions,
    loadStorageStatus,
    loadSavedBlueprints,
    ensureBlueprintSaved,
    toggleShortlistForEntry,
    openBlueprintDialog,
    wireBlueprintDialog,
    wireSavedBlueprintsDialog,
  });
})();
