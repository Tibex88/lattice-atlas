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

  function renderStorageMeta() {
    const node = byId("storageMeta");
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

  function renderSavedBlueprints() {
    renderStorageMeta();
    const list = byId("blueprintList");
    const shortlist = new Set(state.shortlistIds || []);
    if (!state.savedBlueprints.length) {
      list.innerHTML = `<div class="empty">No saved blueprints yet.</div>`;
      return;
    }
    list.innerHTML = state.savedBlueprints.map((item) => `
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
          <button class="pick-blueprint-primary" data-id="${item.id}" type="button">Primary</button>
          <button class="pick-blueprint-secondary" data-id="${item.id}" type="button">Secondary</button>
          <button class="ghost-button shortlist-blueprint ${shortlist.has(item.id) ? "is-active" : ""}" data-id="${item.id}" type="button">${shortlist.has(item.id) ? "Shortlisted" : "Shortlist"}</button>
          <button class="ghost-button delete-blueprint" data-id="${item.id}" type="button">Delete</button>
        </div>
      </div>
    `).join("");
    list.querySelectorAll(".pick-blueprint-primary").forEach((button) => {
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
      });
    });
    list.querySelectorAll(".pick-blueprint-secondary").forEach((button) => {
      button.addEventListener("click", async () => {
        const item = state.savedBlueprints.find((entry) => entry.id === Number(button.dataset.id));
        if (!item) {
          return;
        }
        byId("secondaryDataset").value = item.dataset;
        byId("secondaryLevel").value = item.n;
        byId("secondaryIndex").value = item.index;
        await R.loadViewer("secondary");
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

  Object.assign(R, {
    blueprintKey,
    savedBlueprintMap,
    renderSavedBlueprints,
    loadStorageStatus,
    loadSavedBlueprints,
    openBlueprintDialog,
    wireBlueprintDialog,
  });
})();
