import http from "node:http";
import { URL } from "node:url";

const PORT = process.env.PORT || 10000;
const VERSION = "68.4.1";

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload));
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value = "") {
  return decodeHtml(String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function browserHeaders(extra = {}) {
  return {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9,en-US;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    ...extra
  };
}

async function fetchText(url, extraHeaders = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: browserHeaders(extraHeaders),
    redirect: "follow"
  });

  const text = await response.text();

  if (!response.ok) {
    const shortBody = stripTags(text).slice(0, 500);
    const err = new Error(`Fetch failed with status ${response.status}`);
    err.status = response.status;
    err.body = shortBody;
    err.url = url;
    throw err;
  }

  return text;
}

function normaliseUgUrl(href) {
  if (!href) return "";
  let url = decodeHtml(href).trim();

  if (url.includes("uddg=")) {
    try {
      const parsed = new URL(url, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) url = decodeURIComponent(uddg);
    } catch {}
  }

  if (url.startsWith("//")) url = "https:" + url;
  if (url.startsWith("/")) url = "https://www.ultimate-guitar.com" + url;

  // Keep only Ultimate Guitar tab URLs.
  if (!/^https?:\/\/(www\.)?(tabs\.)?ultimate-guitar\.com\//i.test(url)) return "";
  return url;
}

function uniqByUrl(results) {
  const seen = new Set();
  return results.filter(item => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function searchDuckDuckGo(query) {
  const searchUrl = "https://duckduckgo.com/html/?q=" + encodeURIComponent(`site:tabs.ultimate-guitar.com/tab ${query}`);
  const html = await fetchText(searchUrl, { "Referer": "https://duckduckgo.com/" });

  const results = [];
  const linkRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html)) && results.length < 12) {
    const url = normaliseUgUrl(match[1]);
    const title = stripTags(match[2]);

    if (url && title) {
      results.push({
        title,
        artist: "",
        type: "Ultimate Guitar",
        source: "DuckDuckGo",
        url
      });
    }
  }

  // Fallback: pull any ultimate-guitar tab links from the HTML.
  if (!results.length) {
    const hrefRegex = /href="([^"]*ultimate-guitar\.com\/tab[^"]*)"/gi;
    while ((match = hrefRegex.exec(html)) && results.length < 12) {
      const url = normaliseUgUrl(match[1]);
      if (url) {
        const bits = decodeURIComponent(url).split("/").filter(Boolean);
        const last = bits[bits.length - 1] || "Ultimate Guitar result";
        results.push({
          title: last.replace(/[-_]+/g, " ").replace(/\b\w/g, ch => ch.toUpperCase()),
          artist: "",
          type: "Ultimate Guitar",
          source: "DuckDuckGo",
          url
        });
      }
    }
  }

  return uniqByUrl(results).slice(0, 10);
}

async function searchUltimateGuitar(query) {
  // UG often blocks server fetches. This route is tried first, then DDG fallback is used.
  const searchUrl = "https://www.ultimate-guitar.com/search.php?search_type=title&value=" + encodeURIComponent(query);
  const html = await fetchText(searchUrl, { "Referer": "https://www.ultimate-guitar.com/" });

  const results = [];
  const urlRegex = /https?:\/\/tabs\.ultimate-guitar\.com\/tab\/[^"\\<>\s]+/gi;
  let match;

  while ((match = urlRegex.exec(html)) && results.length < 12) {
    const url = normaliseUgUrl(match[0]);
    if (url) {
      const slug = decodeURIComponent(url.split("/").filter(Boolean).pop() || "Ultimate Guitar result");
      results.push({
        title: slug.replace(/[-_]+/g, " ").replace(/\b\w/g, ch => ch.toUpperCase()),
        artist: "",
        type: "Ultimate Guitar",
        source: "Ultimate Guitar",
        url
      });
    }
  }

  return uniqByUrl(results).slice(0, 10);
}

function tryParseUgJson(html) {
  // Many UG pages include escaped JSON with "wiki_tab" or "tab_view".
  const unescaped = html
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");

  const title =
    (unescaped.match(/"song_name"\s*:\s*"([^"]+)"/i) || [])[1] ||
    (unescaped.match(/"title"\s*:\s*"([^"]+)"/i) || [])[1] ||
    "";

  const artist =
    (unescaped.match(/"artist_name"\s*:\s*"([^"]+)"/i) || [])[1] ||
    (unescaped.match(/"artist"\s*:\s*"([^"]+)"/i) || [])[1] ||
    "";

  const tuning = (unescaped.match(/"tuning"\s*:\s*"([^"]+)"/i) || [])[1] || "";
  const capo = (unescaped.match(/"capo"\s*:\s*("?[^",}\]]+"?|\d+)/i) || [])[1] || "";
  const key = (unescaped.match(/"tonality_name"\s*:\s*"([^"]+)"/i) || [])[1] || "";

  // Try several common content fields.
  let chart = "";
  const contentPatterns = [
    /"content"\s*:\s*"([\s\S]*?)"\s*,\s*"revision_id"/i,
    /"content"\s*:\s*"([\s\S]*?)"\s*,\s*"type"/i,
    /"text"\s*:\s*"([\s\S]*?)"\s*,\s*"wiki_tab"/i
  ];

  for (const pattern of contentPatterns) {
    const m = unescaped.match(pattern);
    if (m && m[1] && m[1].length > chart.length) chart = m[1];
  }

  chart = decodeHtml(chart)
    .replace(/\\u([\dA-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, "/")
    .replace(/\r/g, "")
    .trim();

  return {
    title: decodeHtml(title),
    artist: decodeHtml(artist),
    key: decodeHtml(key),
    capo: decodeHtml(capo),
    tuning: decodeHtml(tuning),
    chart
  };
}

async function importUgUrl(url) {
  const cleanUrl = normaliseUgUrl(url) || url;
  if (!/^https?:\/\/(www\.)?(tabs\.)?ultimate-guitar\.com\//i.test(cleanUrl)) {
    throw new Error("Please provide a valid Ultimate Guitar tab URL.");
  }

  const html = await fetchText(cleanUrl, { "Referer": "https://www.ultimate-guitar.com/" });
  const parsed = tryParseUgJson(html);

  if (!parsed.chart || parsed.chart.length < 10) {
    // Basic fallback from visible page text.
    const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const body = stripTags(html).slice(0, 12000);
    parsed.title = parsed.title || title.replace(/\s+@ Ultimate-Guitar\.Com.*$/i, "").trim();
    parsed.chart = body;
  }

  return {
    ok: true,
    source: "Ultimate Guitar",
    sourceUrl: cleanUrl,
    title: parsed.title || "Imported song",
    artist: parsed.artist || "",
    key: parsed.key || "",
    capo: parsed.capo || "",
    bpm: "",
    chart: parsed.chart || "",
    diagnostics: {
      backendVersion: VERSION,
      chartLength: (parsed.chart || "").length,
      tuning: parsed.tuning || ""
    }
  };
}

async function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (requestUrl.pathname === "/" || requestUrl.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        status: "ready",
        version: VERSION,
        endpoints: ["/api/ug/search?q=amazing%20grace", "/api/ug/import?url=..."]
      });
    }

    if (requestUrl.pathname === "/api/ug/search") {
      const q = (requestUrl.searchParams.get("q") || "").trim();
      if (!q) return sendJson(res, 400, { ok: false, error: "Missing q search query." });

      let primaryError = null;
      let results = [];

      try {
        results = await searchUltimateGuitar(q);
      } catch (err) {
        primaryError = {
          message: err.message,
          status: err.status || null,
          body: err.body || ""
        };
      }

      if (!results.length) {
        results = await searchDuckDuckGo(q);
      }

      return sendJson(res, 200, {
        ok: true,
        query: q,
        results,
        diagnostics: {
          backendVersion: VERSION,
          primaryUgError: primaryError,
          usedFallback: !!primaryError
        }
      });
    }

    if (requestUrl.pathname === "/api/ug/import") {
      const url = (requestUrl.searchParams.get("url") || "").trim();
      if (!url) return sendJson(res, 400, { ok: false, error: "Missing url parameter." });

      const imported = await importUgUrl(url);
      return sendJson(res, 200, imported);
    }

    return sendJson(res, 404, { ok: false, error: "Not found." });
  } catch (err) {
    return sendJson(res, err.status || 500, {
      ok: false,
      error: err.message || "Unknown backend error",
      status: err.status || null,
      body: err.body || "",
      version: VERSION
    });
  }
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`WorshipBase UG backend v${VERSION} listening on http://localhost:${PORT}`);
});
