'use strict';
// Fetch and normalize both upstream sources, then join them.
// ComparEdge decides what is free; Artificial Analysis only adds LLM scores.

const AA_URL = 'https://artificialanalysis.ai/api/v2/language/models/free';
const CE_URL = 'https://comparedge.com/api/v2/discover';
const CE_CATEGORIES = ['llm', 'ai-coding', 'ai-image', 'ai-video', 'ai-voice', 'ai-agents', 'ai-writing', 'ai-assistants', 'ai-productivity'];
const CE_LIMIT = 200; // server-side cap, and there is no paging
const TIMEOUT_MS = 15000;
const MAX_AA_PAGES = 20; // guard against a pagination loop

// GET a URL and parse JSON, with a timeout and a clear error for non-JSON
// replies (for example a Cloudflare challenge page).
async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${new URL(url).host} returned HTTP ${res.status}`);
    err.status = res.status;
    err.headers = res.headers;
    throw err;
  }
  try {
    return { json: JSON.parse(text), headers: res.headers };
  } catch {
    throw new Error(`${new URL(url).host} returned non-JSON (${res.headers.get('content-type') || 'unknown type'})`);
  }
}

// When may we call AA again after a 429? Returns epoch ms or undefined.
function retryTime(headers) {
  const retryAfter = headers?.get('retry-after');
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) return Date.now() + secs * 1000;
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return date;
  }
  const reset = headers?.get('x-ratelimit-reset');
  if (reset) {
    const n = Number(reset);
    if (Number.isFinite(n)) {
      if (n > 1e12) return n; // epoch ms
      if (n > 1e9) return n * 1000; // epoch seconds
      return Date.now() + n * 1000; // seconds from now
    }
    const date = Date.parse(reset);
    if (!Number.isNaN(date)) return date;
  }
  return undefined;
}

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Returns { version, models: Map<slug, {name, creator, intelligence, speed}> }.
// null scores mean "not measured", never 0.
async function fetchAA(key) {
  if (!key) throw new Error('AA_API_KEY is not set');
  const models = new Map();
  let version = null;
  for (let page = 1; page <= MAX_AA_PAGES; page++) {
    let result;
    try {
      result = await getJSON(`${AA_URL}?page=${page}`, { 'x-api-key': key });
    } catch (err) {
      if (err.status === 429) {
        err.message = 'Artificial Analysis rate limit reached (HTTP 429)';
        err.retryAt = retryTime(err.headers);
      } else if (err.status === 401 || err.status === 403) {
        err.message = `Artificial Analysis rejected the API key (HTTP ${err.status})`;
      }
      throw err;
    }
    const { json, headers } = result;
    console.log(`[aa] page ${page}: X-RateLimit-Remaining=${headers.get('x-ratelimit-remaining') ?? '?'}`);
    version ??= json?.intelligence_index_version ?? null;
    for (const m of Array.isArray(json?.data) ? json.data : []) {
      if (!m?.slug) continue;
      models.set(m.slug, {
        name: m.name ?? m.slug,
        creator: m.model_creator?.name ?? null,
        intelligence: numOrNull(m.evaluations?.artificial_analysis_intelligence_index),
        speed: numOrNull(m.performance?.median_output_tokens_per_second),
      });
    }
    if (!json?.pagination?.has_more) break;
  }
  if (!models.size) throw new Error('Artificial Analysis returned no models');
  return { version, models };
}

// Returns { rows: [...], warnings: [...] }, deduped by slug (first category wins,
// and `llm` is fetched first so LLM products stay LLMs).
async function fetchComparEdge() {
  const lists = await Promise.all(CE_CATEGORIES.map(async (category) => {
    const url = `${CE_URL}?hasFreeTier=true&category=${encodeURIComponent(category)}&limit=${CE_LIMIT}`;
    const { json } = await getJSON(url, { 'User-Agent': 'free-tier-ai-finder' });
    return { category, results: Array.isArray(json?.results) ? json.results : [] };
  }));
  console.log(`[ce] fetched ${CE_CATEGORIES.length} categories`);

  const rows = [];
  const seen = new Set();
  const warnings = [];
  for (const { category, results } of lists) {
    if (results.length >= CE_LIMIT) warnings.push(`Category "${category}" returned ${results.length} results and may be truncated.`);
    for (const r of results) {
      if (!r?.slug || seen.has(r.slug)) continue;
      seen.add(r.slug);
      rows.push({
        slug: r.slug,
        name: r.name ?? r.slug,
        category: r.category ?? category,
        startingPrice: numOrNull(r.startingPrice),
        freeTier: r.freeTier ?? true,
        verifiedAt: r.verifiedAt ?? null,
        url: r.links?.page ?? `https://comparedge.com/tools/${encodeURIComponent(r.slug)}`,
      });
    }
  }
  return { rows, warnings };
}

// join() runs on every request, so log each map warning only once.
const warned = new Set();
function warnOnce(msg) {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(msg);
}

// Split ComparEdge rows into LLMs and services, and attach AA scores to LLM
// rows through aa-map.json. `aa` may be null when AA is unavailable.
function join(ce, aa, map) {
  const llms = [];
  const services = [];
  for (const row of ce.rows) {
    if (row.category !== 'llm') {
      services.push(row);
      continue;
    }
    const aaSlug = map[row.slug];
    const model = aaSlug ? aa?.models.get(aaSlug) : null;
    if (aaSlug === undefined) {
      warnOnce(`[map] "${row.slug}" is not in aa-map.json`);
    } else if (aaSlug && aa && !model) {
      warnOnce(`[map] "${row.slug}" maps to "${aaSlug}", which Artificial Analysis does not list`);
    }
    llms.push({
      ...row,
      aaModelName: model?.name ?? null,
      intelligence: model?.intelligence ?? null,
      speed: model?.speed ?? null,
    });
  }
  return { llms, services };
}

module.exports = { fetchAA, fetchComparEdge, join };
