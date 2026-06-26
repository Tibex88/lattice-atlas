(() => {
  const R = window.Residuals;
  const { state, byId, fetchJson, loading, escapeHtml, numberFmt, downloadCsv } = R;

  function buildSummaryIndex(rows) {
    const index = new Map();
    rows.forEach((row) => index.set(`${row.dataset}:${row.n}`, row));
    return index;
  }

  function summaryRow(index, dataset, n) {
    return index.get(`${dataset}:${n}`) || null;
  }

  function renderSummary(rows) {
    const box = byId("summary");
    box.innerHTML = rows.map((row) => {
      const max = row.max_count ? `, max expansions ${row.max_count.toLocaleString()}` : "";
      return `<div class="summary-row"><span>${row.dataset}${row.n}</span><span>${row.entries.toLocaleString()} entries${max}</span></div>`;
    }).join("");
  }

  async function loadSummary() {
    return loading.run("summary", "Loading summary...", async () => {
      state.summaryRows = await fetchJson("/api/summary");
      renderSummary(state.summaryRows);
      return state.summaryRows;
    });
  }

  function renderMetricCards(metrics) {
    byId("metricCards").innerHTML = `
      <article class="metric-card">
        <div class="metric-label">Lattices</div>
        <div class="metric-value">${numberFmt(metrics.lattices)}</div>
        <div class="metric-note">Base lattice shapes at n = ${metrics.n}</div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Reducts</div>
        <div class="metric-value">${numberFmt(metrics.reducts)}</div>
        <div class="metric-note">${numberFmt(metrics.reduct_ratio * 100, 1)}% of lattices admit expansions</div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Residuated</div>
        <div class="metric-value">${numberFmt(metrics.residuated_lattices)}</div>
        <div class="metric-note">${numberFmt(metrics.expansions_per_reduct, 1)} expansions per reduct on average</div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Peak extlat</div>
        <div class="metric-value">${numberFmt(metrics.max_expansions)}</div>
        <div class="metric-note">Largest expansion count for one base lattice</div>
      </article>
    `;
  }

  function renderTrendChart() {
    const toggleButtons = [
      ["trendCounts", state.trendMode === "counts"],
      ["trendRatios", state.trendMode === "ratios"],
    ];
    toggleButtons.forEach(([id, active]) => {
      const button = byId(id);
      if (button) {
        button.classList.toggle("is-active", active);
      }
    });
    const width = 760;
    const height = 280;
    const margin = { top: 18, right: 16, bottom: 34, left: 56 };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;
    const summaryIndex = buildSummaryIndex(state.summaryRows);
    let series;
    let yTicks;
    let y;
    const gridLines = [];
    const x = (n) => margin.left + ((n - 1) / 11) * chartW;

    if (state.trendMode === "counts") {
      const datasets = [
        { key: "lat", color: "#0f766e", label: "lattices" },
        { key: "extlat", color: "#c2410c", label: "reducts" },
        { key: "reslat", color: "#2563eb", label: "residuated" },
      ];
      series = datasets.map((dataset) => ({
        ...dataset,
        points: Array.from({ length: 12 }, (_, offset) => {
          const n = offset + 1;
          if (dataset.key === "extlat") {
            const row = summaryRow(summaryIndex, "extlat", n);
            return { n, value: row ? row.reducts || 0 : 0 };
          }
          const row = summaryRow(summaryIndex, dataset.key, n);
          return { n, value: row ? row.entries : 0 };
        }),
      }));
      const values = series.flatMap((item) => item.points.map((point) => Math.max(point.value, 1)));
      const minLog = Math.log10(Math.min(...values));
      const maxLog = Math.log10(Math.max(...values));
      y = (value) => {
        const lv = Math.log10(Math.max(value, 1));
        return margin.top + (maxLog - lv) / Math.max(maxLog - minLog, 1) * chartH;
      };
      for (let p = Math.floor(minLog); p <= Math.ceil(maxLog); p += 1) {
        const yy = y(10 ** p);
        gridLines.push(`<line x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}" class="chart-grid"></line>`);
        gridLines.push(`<text x="${margin.left - 10}" y="${yy + 4}" text-anchor="end" class="chart-axis">1e${p}</text>`);
      }
    } else {
      series = [
        {
          key: "reduct_ratio",
          color: "#c2410c",
          label: "reducts / lattices",
          points: Array.from({ length: 12 }, (_, offset) => {
            const n = offset + 1;
            const lat = summaryRow(summaryIndex, "lat", n)?.entries || 0;
            const reducts = summaryRow(summaryIndex, "extlat", n)?.reducts || 0;
            return { n, value: lat ? reducts / lat : 0 };
          }),
        },
        {
          key: "reslat_ratio",
          color: "#2563eb",
          label: "residuated / lattices",
          points: Array.from({ length: 12 }, (_, offset) => {
            const n = offset + 1;
            const lat = summaryRow(summaryIndex, "lat", n)?.entries || 0;
            const reslat = summaryRow(summaryIndex, "reslat", n)?.entries || 0;
            return { n, value: lat ? reslat / lat : 0 };
          }),
        },
        {
          key: "expansion_ratio",
          color: "#0f766e",
          label: "residuated / reducts",
          points: Array.from({ length: 12 }, (_, offset) => {
            const n = offset + 1;
            const reducts = summaryRow(summaryIndex, "extlat", n)?.reducts || 0;
            const reslat = summaryRow(summaryIndex, "reslat", n)?.entries || 0;
            return { n, value: reducts ? reslat / reducts : 0 };
          }),
        },
      ];
      const maxValue = Math.max(...series.flatMap((item) => item.points.map((point) => point.value)), 1);
      yTicks = 5;
      y = (value) => margin.top + (1 - (value / Math.max(maxValue, 1))) * chartH;
      for (let i = 0; i <= yTicks; i += 1) {
        const value = (maxValue / yTicks) * i;
        const yy = y(value);
        gridLines.push(`<line x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}" class="chart-grid"></line>`);
        gridLines.push(`<text x="${margin.left - 10}" y="${yy + 4}" text-anchor="end" class="chart-axis">${numberFmt(value, 2)}</text>`);
      }
    }
    const xTicks = Array.from({ length: 12 }, (_, offset) => {
      const n = offset + 1;
      return `<text x="${x(n)}" y="${height - 10}" text-anchor="middle" class="chart-axis">${n}</text>`;
    }).join("");
    const lines = series.map((item) => {
      const pts = item.points.map((point) => `${x(point.n)},${y(point.value)}`).join(" ");
      const highlight = item.points.find((point) => point.n === state.level);
      return `
        <polyline fill="none" stroke="${item.color}" stroke-width="3" points="${pts}"></polyline>
        <circle cx="${x(highlight.n)}" cy="${y(highlight.value)}" r="5" fill="${item.color}"></circle>
      `;
    }).join("");
    const legend = series.map((item, index) => `
      <g transform="translate(${margin.left + index * 150}, ${height - 2})">
        <circle cx="0" cy="0" r="5" fill="${item.color}"></circle>
        <text x="10" y="4" class="chart-axis">${item.label}</text>
      </g>
    `).join("");
    byId("trendChart").innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="280" class="chart-svg" aria-label="count trends">
        <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
        ${gridLines.join("")}
        <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="chart-axis-line"></line>
        <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="chart-axis-line"></line>
        ${xTicks}
        ${lines}
        ${legend}
      </svg>
    `;
  }

  function renderWidthHeight(panel) {
    if (!panel.cells.length) {
      byId("widthHeightPanel").innerHTML = `<div class="empty">No precomputed width/height context for this dataset.</div>`;
      return;
    }
    const widths = panel.widths.map((item) => item.value);
    const heights = panel.heights.map((item) => item.value);
    const max = Math.max(...panel.cells.map((cell) => cell.count));
    const cellMap = new Map(panel.cells.map((cell) => [`${cell.height}:${cell.width}`, cell.count]));
    const rows = heights.map((height) => {
      const cells = widths.map((width) => {
        const count = cellMap.get(`${height}:${width}`) || 0;
        const alpha = count ? 0.15 + 0.75 * (count / max) : 0.06;
        return `<td style="background: rgba(15,118,110,${alpha})">${count ? numberFmt(count) : ""}</td>`;
      }).join("");
      return `<tr><th>${height}</th>${cells}</tr>`;
    }).join("");
    byId("widthHeightPanel").innerHTML = `
      <div class="subtle-label">${panel.dataset === "lat" ? "lattices" : "residuated lattices"} at n = ${panel.n}</div>
      <table class="heatmap-table">
        <thead>
          <tr><th>h \\ w</th>${widths.map((width) => `<th>${width}</th>`).join("")}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderRankingPanel(payload) {
    const rows = payload.items.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${numberFmt(item.count)}</td>
        <td>${item.width}</td>
        <td>${item.height}</td>
        <td><code>${item.encoding.slice(0, 18)}...</code></td>
      </tr>
    `).join("");
    byId("rankingPanel").innerHTML = `
      <table>
        <thead>
          <tr><th>#</th><th>expansions</th><th>width</th><th>height</th><th>encoding</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderAppendixTables(payload) {
    state.appendixData = payload;
    const propertySections = payload.property_groups.map((group) => `
      <section class="appendix-block">
        <div class="appendix-block-head">
          <h4>${group.title}</h4>
          <div class="meta">${numberFmt(group.total)} total structures</div>
        </div>
        <table class="appendix-table">
          <thead>
            <tr><th>name</th><th>count</th><th>percent</th><th>meaning</th></tr>
          </thead>
          <tbody>
            ${group.rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.label)}</td>
                <td>${numberFmt(row.count)}</td>
                <td>${numberFmt(row.ratio * 100, 2)}%</td>
                <td class="appendix-description">${escapeHtml(row.description)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </section>
    `).join("");
    const dimensions = payload.dimensions;
    const widthHeader = dimensions.widths.map((item) => `<th>${item.value}</th>`).join("");
    const widthTotals = dimensions.widths.map((item) => `<td>${numberFmt(item.count)}</td>`).join("");
    const dimensionRows = dimensions.rows.map((row) => `
      <tr>
        <th>${row.height}</th>
        ${row.cells.map((cell) => `<td>${cell.count ? numberFmt(cell.count) : ""}</td>`).join("")}
        <td>${numberFmt(row.total)}</td>
      </tr>
    `).join("");
    byId("appendixPanel").innerHTML = `
      <div class="appendix-shell">
        ${propertySections}
        <section class="appendix-block">
          <div class="appendix-block-head">
            <h4>Width × Height Counts</h4>
            <div class="meta">${numberFmt(dimensions.total)} total structures</div>
          </div>
          <div class="appendix-table-wrap">
            <table class="appendix-table sticky-table">
              <thead>
                <tr><th>h \\ w</th>${widthHeader}<th>total</th></tr>
              </thead>
              <tbody>
                ${dimensionRows}
                <tr>
                  <th>total</th>
                  ${widthTotals}
                  <td>${numberFmt(dimensions.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  function exportAppendixProperties() {
    if (!state.appendixData) {
      return;
    }
    const rows = [["group", "name", "count", "percent", "meaning"]];
    state.appendixData.property_groups.forEach((group) => {
      group.rows.forEach((row) => {
        rows.push([group.kind, row.label, row.count, (row.ratio * 100).toFixed(4), row.description]);
      });
    });
    downloadCsv(`appendix-properties-${state.dataset}${state.level}.csv`, rows);
  }

  function exportAppendixDimensions() {
    if (!state.appendixData) {
      return;
    }
    const dims = state.appendixData.dimensions;
    const rows = [["height", "width", "count"]];
    dims.rows.forEach((row) => {
      row.cells.forEach((cell) => rows.push([row.height, cell.width, cell.count]));
    });
    downloadCsv(`appendix-dimensions-${state.dataset}${state.level}.csv`, rows);
  }

  function indexLabel(index) {
    return `<span class="cooccurrence-index">${index + 1}</span>`;
  }

  function renderCooccurrence(payload) {
    state.cooccurrenceData = payload;
    if (!payload.labels.length) {
      byId("cooccurrencePanel").innerHTML = `<div class="empty">No property matrix for this dataset.</div>`;
      return;
    }
    const size = payload.labels.length;
    const matrix = Array.from({ length: size }, () => Array(size).fill(0));
    payload.cells.forEach((cell) => {
      matrix[cell.row][cell.col] = cell.count;
      matrix[cell.col][cell.row] = cell.count;
    });
    const max = Math.max(...payload.cells.map((cell) => cell.count), 1);
    const header = payload.labels.map((label, index) => `
      <th title="${escapeHtml(label.label)}">${index + 1}</th>
    `).join("");
    const rows = payload.labels.map((label, rowIndex) => `
      <tr>
        <th title="${escapeHtml(label.label)}">${indexLabel(rowIndex)}</th>
        ${payload.labels.map((other, colIndex) => {
          const count = matrix[rowIndex][colIndex];
          const alpha = count ? 0.14 + 0.76 * (count / max) : 0.05;
          return `<td>
            <button
              class="cooccurrence-cell"
              type="button"
              data-row="${rowIndex}"
              data-col="${colIndex}"
              style="background: rgba(15,118,110,${alpha})"
              title="${escapeHtml(label.label)} × ${escapeHtml(other.label)}"
            >${count ? numberFmt(count) : ""}</button>
          </td>`;
        }).join("")}
      </tr>
    `).join("");
    const legend = payload.labels.map((label, index) => `
      <div class="legend-row"><strong>${index + 1}</strong><span>${escapeHtml(label.label)}</span><span class="meta">${escapeHtml(label.kind)}</span></div>
    `).join("");
    byId("cooccurrencePanel").innerHTML = `
      <div class="appendix-shell">
        <div class="appendix-table-wrap">
          <table class="appendix-table sticky-table cooccurrence-table">
            <thead>
              <tr><th>#</th>${header}</tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="cooccurrence-legend">${legend}</div>
      </div>
    `;
    byId("cooccurrencePanel").querySelectorAll(".cooccurrence-cell").forEach((button) => {
      button.addEventListener("click", async () => {
        const row = payload.labels[Number(button.dataset.row)];
        const col = payload.labels[Number(button.dataset.col)];
        const keys = R.distinct([row.key, col.key]);
        document.querySelectorAll(".property-check").forEach((input) => {
          input.checked = keys.includes(input.value);
        });
        R.syncFilterStateFromInputs();
        R.renderConstraintSummary();
        state.offset = 0;
        R.syncUrlState();
        await R.loadEntries();
      });
    });
  }

  function exportCooccurrenceCsv() {
    if (!state.cooccurrenceData?.labels.length) {
      return;
    }
    const labels = state.cooccurrenceData.labels;
    const size = labels.length;
    const matrix = Array.from({ length: size }, () => Array(size).fill(0));
    state.cooccurrenceData.cells.forEach((cell) => {
      matrix[cell.row][cell.col] = cell.count;
      matrix[cell.col][cell.row] = cell.count;
    });
    const rows = [["property", ...labels.map((label) => label.label)]];
    labels.forEach((label, rowIndex) => {
      rows.push([label.label, ...matrix[rowIndex]]);
    });
    downloadCsv(`cooccurrence-${state.dataset}${state.level}.csv`, rows);
  }

  async function loadAnalysis() {
    return Promise.all([
      loading.run("analysis", "Loading analysis...", async () => {
        const [metrics, widthHeight, rankings] = await Promise.all([
          fetchJson(`/api/level-metrics?n=${state.level}`),
          fetchJson(`/api/width-height?dataset=${state.dataset}&n=${state.level}`),
          fetchJson(`/api/extlat-rankings?n=${state.level}&limit=10`),
        ]);
        renderMetricCards(metrics);
        renderTrendChart();
        renderWidthHeight(widthHeight);
        renderRankingPanel(rankings);
      }),
      loading.run("appendix", "Loading appendix tables...", async () => {
        const appendix = await fetchJson(`/api/appendix-tables?dataset=${state.dataset}&n=${state.level}`);
        renderAppendixTables(appendix);
      }),
      loading.run("analysis", "Loading co-occurrence...", async () => {
        const cooccurrence = await fetchJson(`/api/cooccurrence?dataset=${state.dataset}&n=${state.level}`);
        renderCooccurrence(cooccurrence);
      }),
    ]);
  }

  Object.assign(R, {
    loadSummary,
    renderSummary,
    renderMetricCards,
    renderTrendChart,
    renderWidthHeight,
    renderRankingPanel,
    renderAppendixTables,
    exportAppendixProperties,
    exportAppendixDimensions,
    renderCooccurrence,
    exportCooccurrenceCsv,
    loadAnalysis,
  });
})();
