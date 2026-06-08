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
  "Chart text",
  "Notes",
];

const app = document.querySelector("#app");

const state = {
  fileName: "",
  sheetName: "",
  rows: [],
  selectedIndex: -1,
  query: "",
  issuesOnly: false,
  error: "",
};

function render() {
  const selectedSong = state.rows[state.selectedIndex] ?? null;
  const visibleSongs = state.rows.filter((song) => {
    const q = state.query.trim().toLowerCase();
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

  if (!selectedSong && visibleSongs.length > 0) {
    state.selectedIndex = state.rows.indexOf(visibleSongs[0]);
  }

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar-header">
          <div>
            <p class="eyebrow">WB Library Builder</p>
            <h1>Excel Preview Tool</h1>
            <p class="muted">Load your worship library sheet and preview songs the way they will read in the app.</p>
          </div>
          <label class="upload-card">
            <input id="file-input" type="file" accept=".xlsx,.xls,.csv" hidden />
            <span class="upload-title">${state.fileName ? "Replace workbook" : "Load workbook"}</span>
            <span class="upload-subtitle">${state.fileName || "Excel (.xlsx, .xls) or CSV"}</span>
          </label>
        </div>

        <section class="summary-card">
          <div class="summary-row">
            <span>Workbook</span>
            <strong>${state.fileName || "Nothing loaded"}</strong>
          </div>
          <div class="summary-row">
            <span>Sheet</span>
            <strong>${state.sheetName || "—"}</strong>
          </div>
          <div class="summary-row">
            <span>Songs</span>
            <strong>${state.rows.length}</strong>
          </div>
          <div class="summary-row">
            <span>With issues</span>
            <strong>${state.rows.filter((row) => row.issues.length > 0).length}</strong>
          </div>
        </section>

        <section class="columns-card">
          <div class="section-title-row">
            <h2>Expected Columns</h2>
          </div>
          <ul class="column-list">
            ${REQUIRED_COLUMNS.map((column) => `<li>${column}</li>`).join("")}
          </ul>
        </section>

        ${
          state.error
            ? `<section class="error-card"><strong>Import issue</strong><p>${escapeHtml(state.error)}</p></section>`
            : ""
        }
      </aside>

      <main class="workspace">
        <div class="toolbar">
          <div class="search-wrap">
            <input id="search-input" class="search-input" type="search" placeholder="Search title, artist, key, tags…" value="${escapeAttribute(state.query)}" />
          </div>
          <label class="toggle-wrap">
            <input id="issues-toggle" type="checkbox" ${state.issuesOnly ? "checked" : ""} />
            <span>Issues only</span>
          </label>
        </div>

        <div class="content-grid">
          <section class="song-list-panel">
            <div class="panel-header">
              <div>
                <h2>Song list</h2>
                <p>${visibleSongs.length} showing</p>
              </div>
            </div>
            <div class="song-list">
              ${
                visibleSongs.length === 0
                  ? `<div class="empty-state">Load a workbook to start previewing songs.</div>`
                  : visibleSongs
                      .map((song) => {
                        const globalIndex = state.rows.indexOf(song);
                        const issueBadge =
                          song.issues.length > 0
                            ? `<span class="issue-pill">${song.issues.length} ${song.issues.length === 1 ? "issue" : "issues"}</span>`
                            : "";
                        return `
                          <button class="song-row ${globalIndex === state.selectedIndex ? "is-selected" : ""}" data-song-index="${globalIndex}">
                            <div class="song-row-top">
                              <strong>${escapeHtml(song.title || "Untitled song")}</strong>
                              ${issueBadge}
                            </div>
                            <div class="song-row-meta">${escapeHtml(song.artist || "No artist")} · ${escapeHtml(song.originalKey || "No key")}</div>
                            <div class="song-row-tags">${escapeHtml(song.tags || "No tags")}</div>
                          </button>
                        `;
                      })
                      .join("")
              }
            </div>
          </section>

          <section class="preview-panel">
            ${
              selectedSong
                ? renderPreview(selectedSong)
                : `<div class="preview-empty">Choose a song to preview it here.</div>`
            }
          </section>
        </div>
      </main>
    </div>
  `;

  wireEvents();
}

function renderPreview(song) {
  const previewBlocks = parseChart(song.chartText);
  const noteBlock = song.notes?.trim()
    ? `
      <section class="notes-card">
        <div class="notes-header">
          <h3>Notes</h3>
        </div>
        <p>${escapeHtml(song.notes).replace(/\n/g, "<br />")}</p>
      </section>
    `
    : "";

  const issues = song.issues.length
    ? `
      <section class="issues-card">
        <div class="notes-header">
          <h3>Validation notes</h3>
        </div>
        <ul>
          ${song.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}
        </ul>
      </section>
    `
    : "";

  return `
    <div class="preview-shell">
      <div class="preview-header">
        <div>
          <h2>${escapeHtml(song.title || "Untitled song")}</h2>
          <p>${escapeHtml(song.artist || "Unknown artist")} · Key ${escapeHtml(song.originalKey || "—")}</p>
        </div>
        <div class="preview-metadata">
          <span>${escapeHtml(song.timeSig || "No time sig")}</span>
          <span>${escapeHtml(song.bpm || "No BPM")}</span>
        </div>
      </div>

      <div class="meta-pill-row">
        ${song.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
          .map((tag) => `<span class="meta-pill">${escapeHtml(tag)}</span>`)
          .join("") || `<span class="meta-pill is-muted">No tags</span>`}
      </div>

      <div class="link-grid">
        <div class="link-card">
          <span>Spotify</span>
          <strong>${song.spotifyLink ? "Added" : "Missing"}</strong>
        </div>
        <div class="link-card">
          <span>YouTube</span>
          <strong>${song.youtubeLink ? "Added" : "Missing"}</strong>
        </div>
      </div>

      ${issues}
      ${noteBlock}

      <section class="chart-card">
        <div class="notes-header">
          <h3>Chart preview</h3>
          <p>${previewBlocks.length} blocks</p>
        </div>
        <div class="chart-surface">
          ${previewBlocks.map(renderBlock).join("")}
        </div>
      </section>

      <section class="source-card">
        <div class="notes-header">
          <h3>Source text</h3>
        </div>
        <pre>${escapeHtml(song.chartText || "")}</pre>
      </section>
    </div>
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
}

async function loadWorkbook(file) {
  state.error = "";
  state.fileName = file.name;

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: false,
    });

    state.sheetName = sheetName;
    state.rows = rows.map((row, index) => normalizeSongRow(row, index));
    state.selectedIndex = state.rows.length > 0 ? 0 : -1;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Could not read workbook.";
    state.rows = [];
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
    chartText: valueFor(row, "Chart text"),
    notes: valueFor(row, "Notes"),
  };

  normalized.issues = validateSong(normalized);
  return normalized;
}

function valueFor(row, key) {
  return String(row[key] ?? "").trim();
}

function validateSong(song) {
  const issues = [];

  if (!song.title) issues.push("Missing Title");
  if (!song.artist) issues.push("Missing Artist");
  if (!song.originalKey) issues.push("Missing Original Key");
  if (!song.chartText) issues.push("Missing Chart text");
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
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
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
    if (isChordLine(current) && next.trim()) {
      blocks.push({ type: "pair", chord: current, lyric: next });
      index += 2;
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
  if (trimmed.startsWith("[")) return false;
  const tokens = trimmed.split(/\s+/);
  return tokens.length > 0 && tokens.every((token) => /^[A-G](#|b)?(m|maj|min|sus|add|dim|aug|\/[A-G](#|b)?)?[0-9A-Za-z/#()\-+]*$/.test(token));
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
