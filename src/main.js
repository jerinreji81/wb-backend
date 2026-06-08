import * as XLSX from "xlsx";
import "./styles.css";

const REQUIRED_COLUMNS = [
  "Title",
  "Artist",
  "Original Key",
  "Tags",
  "Time sig",
  "BPM",
  "Spotify link",
  "Youtube link",
  "Chart Text",
  "Notes",
];

const COLUMN_ALIASES = {
  Title: ["Title"],
  Artist: ["Artist"],
  "Original Key": ["Original Key"],
  Tags: ["Tags"],
  "Time sig": ["Time sig", "Time Sig", "Time Signature"],
  BPM: ["BPM", "Tempo"],
  "Spotify link": ["Spotify link", "Spotify Link"],
  "Youtube link": ["Youtube link", "YouTube link", "Youtube Link", "YouTube Link"],
  "Chart Text": ["Chart Text", "Chart text"],
  Notes: ["Notes"],
};

const app = document.querySelector("#app");

const state = {
  fileName: "",
  workbook: null,
  sheets: [],
  activeSheetName: "",
  selectedIndex: -1,
  query: "",
  issuesOnly: false,
  error: "",
};

function getActiveSheet() {
  return state.sheets.find((sheet) => sheet.name === state.activeSheetName) ?? null;
}

function getVisibleSongs(rows) {
  const q = state.query.trim().toLowerCase();
  return rows.filter((song) => {
    const haystack = [
      song.title,
      song.artist,
      song.originalKey,
      song.tags,
      song.notes,
      song.chartText,
    ]
      .join(" ")
      .toLowerCase();
    const matchesQuery = !q || haystack.includes(q);
    return matchesQuery && (!state.issuesOnly || song.issues.length > 0);
  });
}

function render() {
  const activeSheet = getActiveSheet();
  const rows = activeSheet?.rows ?? [];
  const visibleSongs = getVisibleSongs(rows);

  if (rows.length === 0) {
    state.selectedIndex = -1;
  } else if (!rows[state.selectedIndex] || !visibleSongs.includes(rows[state.selectedIndex])) {
    state.selectedIndex = rows.indexOf(visibleSongs[0] ?? rows[0]);
  }

  const selectedSong = rows[state.selectedIndex] ?? null;

  app.innerHTML = `
    <div class="app-shell">
      <div class="workspace-column">
        <section class="surface-card load-card">
          <div>
            <p class="eyebrow">WB Library Builder</p>
            <h1>Excel Preview Tool</h1>
            <p class="muted">Load your workbook, choose a sheet, and preview exactly how the chart reads before it ever reaches the app.</p>
          </div>
          <label class="upload-card">
            <input id="file-input" type="file" accept=".xlsx,.xls,.csv" hidden />
            <span class="upload-title">${state.fileName ? "Replace workbook" : "Load workbook"}</span>
            <span class="upload-subtitle">${state.fileName || "Excel (.xlsx, .xls) or CSV"}</span>
          </label>
        </section>

        <section class="surface-card info-card">
          <div class="section-head">
            <h2>Workbook Info</h2>
          </div>
          <div class="info-grid">
            <div class="info-item">
              <span>Workbook</span>
              <strong>${state.fileName || "Nothing loaded"}</strong>
            </div>
            <div class="info-item">
              <span>Selected tab</span>
              <strong>${activeSheet?.name || "—"}</strong>
            </div>
            <div class="info-item">
              <span>Tabs found</span>
              <strong>${state.sheets.length}</strong>
            </div>
            <div class="info-item">
              <span>Songs in tab</span>
              <strong>${rows.length}</strong>
            </div>
            <div class="info-item">
              <span>Showing</span>
              <strong>${visibleSongs.length}</strong>
            </div>
            <div class="info-item">
              <span>With issues</span>
              <strong>${rows.filter((row) => row.issues.length > 0).length}</strong>
            </div>
          </div>

          ${
            state.sheets.length
              ? `
                <div class="sheet-tabs" role="tablist" aria-label="Workbook tabs">
                  ${state.sheets
                    .map(
                      (sheet) => `
                        <button class="sheet-tab ${sheet.name === state.activeSheetName ? "is-active" : ""}" data-sheet-name="${escapeAttribute(sheet.name)}">
                          ${escapeHtml(sheet.name)}
                          <span>${sheet.rows.length}</span>
                        </button>
                      `,
                    )
                    .join("")}
                </div>
              `
              : ""
          }
        </section>

        <section class="surface-card search-card">
          <div class="search-row">
            <input id="search-input" class="search-input" type="search" placeholder="Search title, artist, key, tags…" value="${escapeAttribute(state.query)}" />
            <label class="toggle-wrap">
              <input id="issues-toggle" type="checkbox" ${state.issuesOnly ? "checked" : ""} />
              <span>Issues only</span>
            </label>
          </div>
        </section>

        <section class="surface-card list-card">
          <div class="section-head">
            <div>
              <h2>Song List</h2>
              <p>${visibleSongs.length} songs${activeSheet ? ` in ${escapeHtml(activeSheet.name)}` : ""}</p>
            </div>
          </div>

          <div class="song-list-scroll">
            ${
              visibleSongs.length === 0
                ? `<div class="empty-state">${state.fileName ? "No songs match this tab/filter yet." : "Load a workbook to start previewing songs."}</div>`
                : visibleSongs
                    .map((song) => {
                      const globalIndex = rows.indexOf(song);
                      return `
                        <button class="song-row ${globalIndex === state.selectedIndex ? "is-selected" : ""}" data-song-index="${globalIndex}">
                          <div class="song-row-main">
                            <strong>${escapeHtml(song.title || "Untitled song")}</strong>
                            <span>${escapeHtml(song.artist || "No artist")}</span>
                          </div>
                          <div class="song-row-side">
                            <span>${escapeHtml(song.originalKey || "—")}</span>
                            ${song.issues.length ? `<em>${song.issues.length}</em>` : ""}
                          </div>
                        </button>
                      `;
                    })
                    .join("")
            }
          </div>
        </section>

        <section class="surface-card preview-card">
          <div class="section-head">
            <div>
              <h2>Chart Preview</h2>
              <p>${selectedSong ? escapeHtml(selectedSong.title || "Untitled song") : "Choose a song to preview it here."}</p>
            </div>
            ${
              selectedSong
                ? `<span class="preview-count">${parseChart(selectedSong.chartText).filter((b) => b.type !== "spacer").length} blocks</span>`
                : ""
            }
          </div>
          ${
            selectedSong
              ? `<div class="chart-surface">${parseChart(selectedSong.chartText).map(renderBlock).join("")}</div>`
              : `<div class="preview-empty">Chart preview will appear here once you choose a song.</div>`
          }
        </section>

        <section class="surface-card details-card">
          ${
            selectedSong
              ? renderDetails(selectedSong)
              : `
                <div class="section-head">
                  <h2>Song Details</h2>
                </div>
                <div class="preview-empty">Selected song metadata, links, notes, and raw chart text will appear here.</div>
              `
          }
        </section>

        <section class="surface-card columns-card">
          <div class="section-head">
            <h2>Expected Columns</h2>
          </div>
          <ul class="column-list">
            ${REQUIRED_COLUMNS.map((column) => `<li>${column}</li>`).join("")}
          </ul>
        </section>

        ${
          state.error
            ? `<section class="surface-card error-card"><strong>Import issue</strong><p>${escapeHtml(state.error)}</p></section>`
            : ""
        }
      </div>
    </div>
  `;

  wireEvents();
}

function renderDetails(song) {
  const tags = song.tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  return `
    <div class="section-head">
      <div>
        <h2>${escapeHtml(song.title || "Untitled song")}</h2>
        <p>${escapeHtml(song.artist || "Unknown artist")}</p>
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-item"><span>Original Key</span><strong>${escapeHtml(song.originalKey || "—")}</strong></div>
      <div class="detail-item"><span>Time Sig</span><strong>${escapeHtml(song.timeSig || "—")}</strong></div>
      <div class="detail-item"><span>BPM</span><strong>${escapeHtml(song.bpm || "—")}</strong></div>
      <div class="detail-item"><span>Spreadsheet Row</span><strong>${song.rowNumber}</strong></div>
    </div>

    <div class="meta-pill-row">
      ${
        tags.length
          ? tags.map((tag) => `<span class="meta-pill">${escapeHtml(tag)}</span>`).join("")
          : `<span class="meta-pill is-muted">No tags</span>`
      }
    </div>

    <div class="link-grid">
      <div class="link-card">
        <span>Spotify link</span>
        <strong>${song.spotifyLink ? "Added" : "Missing"}</strong>
      </div>
      <div class="link-card">
        <span>YouTube link</span>
        <strong>${song.youtubeLink ? "Added" : "Missing"}</strong>
      </div>
    </div>

    ${
      song.issues.length
        ? `
          <section class="notes-card">
            <div class="notes-header"><h3>Validation Notes</h3></div>
            <ul class="issue-list">
              ${song.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}
            </ul>
          </section>
        `
        : ""
    }

    ${
      song.notes?.trim()
        ? `
          <section class="notes-card">
            <div class="notes-header"><h3>Notes</h3></div>
            <p>${escapeHtml(song.notes).replace(/\n/g, "<br />")}</p>
          </section>
        `
        : ""
    }

    <section class="source-card">
      <div class="notes-header"><h3>Source Text</h3></div>
      <pre>${escapeHtml(song.chartText || "")}</pre>
    </section>
  `;
}

function wireEvents() {
  document.querySelector("#file-input")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadWorkbook(file);
  });

  document.querySelector("#search-input")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });

  document.querySelector("#issues-toggle")?.addEventListener("change", (event) => {
    state.issuesOnly = event.target.checked;
    render();
  });

  document.querySelectorAll("[data-song-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedIndex = Number(button.dataset.songIndex);
      render();
    });
  });

  document.querySelectorAll("[data-sheet-name]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSheetName = button.dataset.sheetName;
      state.selectedIndex = -1;
      state.query = "";
      state.issuesOnly = false;
      render();
    });
  });
}

async function loadWorkbook(file) {
  state.error = "";
  state.fileName = file.name;

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    state.workbook = workbook;
    state.sheets = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, {
        defval: "",
        raw: false,
      });
      return {
        name: sheetName,
        rows: rows.map((row, index) => normalizeSongRow(row, index)),
      };
    });
    state.activeSheetName = state.sheets[0]?.name || "";
    state.selectedIndex = state.sheets[0]?.rows.length ? 0 : -1;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Could not read workbook.";
    state.workbook = null;
    state.sheets = [];
    state.activeSheetName = "";
    state.selectedIndex = -1;
  }

  render();
}

function normalizeSongRow(row, index) {
  const normalized = {
    rowNumber: index + 2,
    title: valueFor(row, "Title"),
    artist: valueFor(row, "Artist"),
    originalKey: valueFor(row, "Original Key"),
    tags: valueFor(row, "Tags"),
    timeSig: valueFor(row, "Time sig"),
    bpm: valueFor(row, "BPM"),
    spotifyLink: valueFor(row, "Spotify link"),
    youtubeLink: valueFor(row, "Youtube link"),
    chartText: valueFor(row, "Chart Text"),
    notes: valueFor(row, "Notes"),
  };

  normalized.issues = validateSong(normalized);
  return normalized;
}

function valueFor(row, key) {
  const aliases = COLUMN_ALIASES[key] || [key];
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null) {
      return String(row[alias]).trim();
    }
  }
  return "";
}

function validateSong(song) {
  const issues = [];

  if (!song.title) issues.push("Missing Title");
  if (!song.artist) issues.push("Missing Artist");
  if (!song.originalKey) issues.push("Missing Original Key");
  if (!song.chartText) issues.push("Missing Chart Text");
  if (!song.tags) issues.push("Missing Tags");
  if (song.bpm && Number.isNaN(Number(song.bpm))) issues.push("BPM should be a number");
  if (song.spotifyLink && !looksLikeUrl(song.spotifyLink)) issues.push("Spotify link does not look like a URL");
  if (song.youtubeLink && !looksLikeUrl(song.youtubeLink)) issues.push("Youtube link does not look like a URL");

  return issues;
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value);
}

function parseChart(text) {
  const normalized = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const current = lines[index] ?? "";
    const trimmed = current.trim();

    if (!trimmed) {
      blocks.push({ type: "spacer" });
      index += 1;
      continue;
    }

    if (/^\[[^\]]+\]$/.test(trimmed)) {
      blocks.push({ type: "section", text: trimmed.replace(/^\[|\]$/g, "") });
      index += 1;
      continue;
    }

    const next = lines[index + 1] ?? "";
    if (isChordLine(current) && next.trim() && !isChordLine(next) && !/^\[[^\]]+\]$/.test(next.trim())) {
      blocks.push({ type: "pair", chord: current, lyric: next });
      index += 2;
      continue;
    }

    if (looksInlineChorded(current)) {
      blocks.push({ type: "inline", text: current });
      index += 1;
      continue;
    }

    blocks.push({
      type: isChordLine(current) ? "chordOnly" : "lyric",
      text: current,
    });
    index += 1;
  }

  return blocks;
}

function isChordLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return false;
  const tokens = trimmed.split(/\s+/);
  return (
    tokens.length > 0 &&
    tokens.every((token) =>
      /^[A-G](#|b)?(m|maj|min|sus|add|dim|aug|\/[A-G](#|b)?)?[0-9A-Za-z/#()\-+]*$/.test(token),
    )
  );
}

function looksInlineChorded(line) {
  return /\[[^\]]+\]/.test(line);
}

function renderBlock(block) {
  switch (block.type) {
    case "section":
      return `<div class="chart-section">${escapeHtml(block.text)}</div>`;
    case "pair":
      return `
        <div class="chart-pair">
          <pre class="chart-line chart-chords">${escapeHtml(block.chord)}</pre>
          <pre class="chart-line chart-lyrics">${escapeHtml(block.lyric)}</pre>
        </div>
      `;
    case "inline":
      return `<pre class="chart-line chart-inline">${renderInlineChords(block.text)}</pre>`;
    case "chordOnly":
      return `<pre class="chart-line chart-chords">${escapeHtml(block.text)}</pre>`;
    case "lyric":
      return `<pre class="chart-line chart-lyrics">${escapeHtml(block.text)}</pre>`;
    case "spacer":
      return `<div class="chart-spacer"></div>`;
    default:
      return "";
  }
}

function renderInlineChords(text) {
  return escapeHtml(text).replace(/\[([^\]]+)\]/g, '<span class="inline-chord">[$1]</span>');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

render();
