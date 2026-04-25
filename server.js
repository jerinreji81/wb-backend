import express from 'express';
import cors from 'cors';
import * as cheerio from 'cheerio';

const app = express();
const PORT = process.env.PORT || 8787;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: '1mb' }));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function ok(res, payload) { res.json({ ok: true, ...payload }); }
function fail(res, status, message, extra = {}) { res.status(status).json({ ok: false, error: message, ...extra }); }

function requestHeaders(url, referer = 'https://www.google.com/') {
  return {
    'user-agent': UA,
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'referer': referer,
    'upgrade-insecure-requests': '1',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': new URL(url).hostname.includes('ultimate-guitar') ? 'same-origin' : 'cross-site',
    'sec-fetch-user': '?1'
  };
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: requestHeaders(url, options.referer)
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    const bodyPreview = text.slice(0, 260).replace(/\s+/g, ' ').trim();
    const err = new Error(`Fetch failed: ${response.status}`);
    err.status = response.status;
    err.url = url;
    err.bodyPreview = bodyPreview;
    throw err;
  }
  return text;
}

function assertUgUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error('Invalid Ultimate Guitar URL'); }
  const host = u.hostname.replace(/^www\./, '');
  const allowed = host === 'ultimate-guitar.com' || host === 'tabs.ultimate-guitar.com';
  if (!allowed) throw new Error('Only Ultimate Guitar URLs are allowed');
  return u.toString();
}

function decodeHtml(s = '') {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\//g, '/');
}

function uniqByUrl(results) {
  const seen = new Set();
  return results.filter(r => {
    if (!r.url || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

function titleCaseFromSlug(slug = '') {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function resultFromUgUrl(url, anchorText = '') {
  try { url = new URL(url, 'https://www.ultimate-guitar.com').toString(); } catch { return null; }
  if (!/https:\/\/tabs\.ultimate-guitar\.com\/tab\//i.test(url)) return null;
  const bits = url.split('/tab/')[1]?.split('/').filter(Boolean) || [];
  const artist = bits[0] ? titleCaseFromSlug(bits[0]) : '';
  const last = bits[bits.length - 1] || '';
  let title = anchorText.replace(/\s+/g, ' ').trim();
  title = title.replace(/\s+chords?\s*$/i, '').replace(/\s+tabs?\s*$/i, '').trim();
  if (!title || title.length > 120) title = titleCaseFromSlug(last.replace(/-chords?|-tabs?|-ukulele|-bass|-guitar-pro/gi, '').replace(/_\d+$/, ''));
  const type = /chords/i.test(url) ? 'Chords' : /tab/i.test(url) ? 'Tab' : '';
  return { title, artist, type, url };
}

function parseUgSearchResults(html) {
  const results = [];
  const $ = cheerio.load(html);

  $('a[href*="tabs.ultimate-guitar.com/tab/"]').each((_, el) => {
    const item = resultFromUgUrl($(el).attr('href'), $(el).text());
    if (item) results.push(item);
  });

  const re = /https:\\/\\/tabs\.ultimate-guitar\.com\\/tab\\/[^"\\]+/g;
  const matches = html.match(re) || [];
  for (const raw of matches) {
    const item = resultFromUgUrl(decodeHtml(raw));
    if (item) results.push(item);
  }
  return uniqByUrl(results).slice(0, 20);
}

function parseDuckResults(html) {
  const results = [];
  const $ = cheerio.load(html);
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text() || '';
    let actual = href;
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      if (u.searchParams.get('uddg')) actual = decodeURIComponent(u.searchParams.get('uddg'));
      else actual = u.toString();
    } catch {}
    const item = resultFromUgUrl(actual, text);
    if (item) results.push(item);
  });
  return uniqByUrl(results).slice(0, 20);
}

async function searchUltimateGuitar(q) {
  const url = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(q)}`;
  const html = await fetchText(url, { referer: 'https://www.ultimate-guitar.com/' });
  return { provider: 'ultimate-guitar', results: parseUgSearchResults(html) };
}

async function searchDuckDuckGo(q) {
  const query = `site:tabs.ultimate-guitar.com/tab ${q} chords`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url, { referer: 'https://duckduckgo.com/' });
  return { provider: 'duckduckgo-html', results: parseDuckResults(html) };
}

function extractBalancedJson(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (start < 0) {
      if (ch === '{' || ch === '[') { start = i; depth = 1; }
      continue;
    }
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function walk(obj, visit) {
  if (!obj || typeof obj !== 'object') return;
  visit(obj);
  if (Array.isArray(obj)) for (const item of obj) walk(item, visit);
  else for (const key of Object.keys(obj)) walk(obj[key], visit);
}

function normalizeChart(raw = '') {
  let text = decodeHtml(raw);
  try { text = JSON.parse(`"${text.replace(/"/g, '\\"')}"`); } catch {}
  text = text
    .replace(/\r\n?/g, '\n')
    .replace(/\[tab\]/gi, '')
    .replace(/\[\/tab\]/gi, '')
    .replace(/\[ch\]([^[]+)\[\/ch\]/gi, '$1')
    .replace(/\[intro\]/gi, '[Intro]')
    .replace(/\[verse\]/gi, '[Verse]')
    .replace(/\[chorus\]/gi, '[Chorus]')
    .replace(/\[bridge\]/gi, '[Bridge]')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return text;
}

function parseUgPage(html, sourceUrl) {
  const song = { title: '', artist: '', key: 'C', capo: '', bpm: '', timeSig: '', chart: '', sourceUrl };
  const candidates = [];

  const nextMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch) {
    try { candidates.push(JSON.parse(nextMatch[1])); } catch {}
  }

  const storeIdx = html.indexOf('window.UGAPP.store');
  if (storeIdx >= 0) {
    const json = extractBalancedJson(html, storeIdx);
    if (json) { try { candidates.push(JSON.parse(json)); } catch {} }
  }

  const contentRegexes = [
    /"content"\s*:\s*"((?:\\.|[^"\\]){40,})"/g,
    /&quot;content&quot;\s*:\s*&quot;([\s\S]{40,}?)&quot;/g
  ];
  for (const re of contentRegexes) {
    let match;
    while ((match = re.exec(html))) {
      const chart = normalizeChart(match[1]);
      if (chart && chart.length > 40) song.chart = chart;
      if (song.chart) break;
    }
    if (song.chart) break;
  }

  for (const root of candidates) {
    walk(root, node => {
      if (!node || typeof node !== 'object') return;
      if (!song.chart && typeof node.content === 'string' && node.content.length > 40) song.chart = normalizeChart(node.content);
      if (!song.title && typeof node.song_name === 'string') song.title = node.song_name;
      if (!song.title && typeof node.name === 'string' && node.name.length < 120) song.title = node.name;
      if (!song.artist && typeof node.artist_name === 'string') song.artist = node.artist_name;
      if (!song.artist && node.artist && typeof node.artist.name === 'string') song.artist = node.artist.name;
      if (typeof node.tonality_name === 'string') song.key = node.tonality_name.replace(/m$/, '') || song.key;
      if (typeof node.key === 'string' && /^[A-G][b#]?m?$/.test(node.key)) song.key = node.key.replace(/m$/, '');
      if (!song.capo && (typeof node.capo === 'number' || typeof node.capo === 'string')) song.capo = String(node.capo);
      if (!song.bpm && (typeof node.bpm === 'number' || typeof node.bpm === 'string')) song.bpm = String(node.bpm);
    });
  }

  const $ = cheerio.load(html);
  if (!song.title) song.title = $('h1').first().text().replace(/\s+/g, ' ').trim();
  if (!song.artist) song.artist = $('[class*=artist], a[href*="/artist/"]').first().text().replace(/\s+/g, ' ').trim();
  if (!song.title) {
    const bits = sourceUrl.split('/tab/')[1]?.split('/').filter(Boolean) || [];
    song.artist = song.artist || (bits[0] ? titleCaseFromSlug(bits[0]) : '');
    song.title = bits[bits.length - 1] ? titleCaseFromSlug(bits[bits.length - 1].replace(/-chords?|-tabs?|-ukulele|-bass|-guitar-pro/gi, '').replace(/_\d+$/, '')) : 'Imported song';
  }

  if (song.capo && song.capo !== '0' && !/^capo/i.test(song.chart)) song.chart = `Capo: ${song.capo}\n\n${song.chart}`.trim();
  if (song.sourceUrl && !song.chart.includes(song.sourceUrl)) song.chart = `${song.chart}\n\nSource: ${song.sourceUrl}`.trim();
  if (!song.chart || song.chart.length < 20) throw new Error('Could not extract chord text from this Ultimate Guitar page');
  return song;
}

app.get('/health', (_, res) => ok(res, { status: 'ready', version: '68.4' }));

app.get('/api/ug/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return fail(res, 400, 'Missing search query');

  const attempts = [];
  for (const fn of [searchUltimateGuitar, searchDuckDuckGo]) {
    try {
      const out = await fn(q);
      attempts.push({ provider: out.provider, ok: true, count: out.results.length });
      if (out.results.length) return ok(res, { query: q, provider: out.provider, results: out.results, attempts });
    } catch (err) {
      attempts.push({ provider: fn.name, ok: false, error: err.message, status: err.status || null, bodyPreview: err.bodyPreview || '' });
    }
  }
  return fail(res, 502, 'Search failed or returned no results', { query: q, results: [], attempts });
});

app.get('/api/ug/import', async (req, res) => {
  try {
    const url = assertUgUrl(String(req.query.url || ''));
    const html = await fetchText(url, { referer: 'https://www.ultimate-guitar.com/' });
    const song = parseUgPage(html, url);
    ok(res, { song });
  } catch (err) {
    fail(res, 502, err.message || 'Ultimate Guitar import failed', {
      status: err.status || null,
      blocked: err.status === 403,
      bodyPreview: err.bodyPreview || ''
    });
  }
});

app.listen(PORT, () => {
  console.log(`WorshipBase UG backend v68.4 listening on http://localhost:${PORT}`);
});
