'use strict';
// Static file server for public/ plus GET /api/data, backed by an in-memory
// cache that is mirrored to cache/data.json. Zero dependencies (Node 18+).

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = __dirname;
loadEnv(path.join(ROOT, '.env'));

const { fetchAA, fetchComparEdge, join } = require('./sources');

const PORT = Number(process.env.PORT) || 3000;
const TTL_MS = (Number(process.env.CACHE_TTL_HOURS) || 12) * 3600 * 1000;
const RETRY_MS = 15 * 60 * 1000;
const USE_FIXTURE = process.env.USE_FIXTURE === '1';
const AA_KEY = (process.env.AA_API_KEY || '').trim();

const PUBLIC_DIR = path.join(ROOT, 'public');
const CACHE_DIR = path.join(ROOT, 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'data.json');
const FIXTURE_FILE = path.join(ROOT, 'fixtures', 'sample.json');
const MAP_FILE = path.join(ROOT, 'aa-map.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// Tiny .env parser: KEY=VALUE lines, # comments, optional quotes.
// Real environment variables win over the file.
function loadEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// ---- cache ------------------------------------------------------------------
// Each source keeps its own last good data, so one failing source never blanks
// or re-fetches the other. `nextRetryAt` is the backoff after a failure.
const emptySource = () => ({ data: null, fetchedAt: 0, nextRetryAt: 0, error: null });
const state = { aa: emptySource(), ce: emptySource() };
let inflight = null;

function loadCacheFile() {
  try {
    const saved = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    for (const name of ['aa', 'ce']) {
      if (saved[name]) state[name] = { ...emptySource(), ...saved[name] };
    }
    if (state.aa.data) state.aa.data.models = new Map(Object.entries(state.aa.data.models || {}));
    console.log(`[cache] loaded ${path.relative(ROOT, CACHE_FILE)}`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[cache] ignoring unreadable cache file: ${err.message}`);
  }
}

async function saveCacheFile() {
  const aa = state.aa.data
    ? { ...state.aa, data: { ...state.aa.data, models: Object.fromEntries(state.aa.data.models) } }
    : state.aa;
  const tmp = CACHE_FILE + '.tmp';
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify({ aa, ce: state.ce }));
  await fsp.rename(tmp, CACHE_FILE); // atomic replace
}

function needsRefresh(name, now) {
  if (name === 'aa' && !AA_KEY) return false; // nothing to fetch; reported by buildPayload
  const s = state[name];
  return now - s.fetchedAt >= TTL_MS && now >= s.nextRetryAt;
}

async function refresh(names) {
  console.log(`[refresh] fetching: ${names.join(', ')}`);
  const tasks = { aa: () => fetchAA(AA_KEY), ce: () => fetchComparEdge() };
  const results = await Promise.allSettled(names.map((n) => tasks[n]()));
  const now = Date.now();
  results.forEach((r, i) => {
    const s = state[names[i]];
    if (r.status === 'fulfilled') {
      Object.assign(s, { data: r.value, fetchedAt: now, nextRetryAt: 0, error: null });
    } else {
      const retryAt = r.reason?.retryAt > now ? r.reason.retryAt : now + RETRY_MS;
      Object.assign(s, { nextRetryAt: retryAt, error: r.reason?.message || String(r.reason) });
      console.warn(`[refresh] ${names[i]} failed: ${s.error} (next retry ${new Date(retryAt).toISOString()})`);
    }
  });
  try { await saveCacheFile(); } catch (err) { console.warn(`[cache] write failed: ${err.message}`); }
}

function readMap() {
  try { return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')); } catch (err) {
    console.warn(`[map] could not read aa-map.json: ${err.message}`);
    return {};
  }
}

function buildPayload() {
  const errors = [];
  if (!AA_KEY) errors.push({ source: 'artificialanalysis', message: 'AA_API_KEY is not set, so LLM scores are unavailable.' });
  else if (state.aa.error) errors.push({ source: 'artificialanalysis', message: state.aa.error });
  if (state.ce.error) errors.push({ source: 'comparedge', message: state.ce.error });
  for (const w of state.ce.data?.warnings || []) errors.push({ source: 'comparedge', message: w });

  const { llms, services } = state.ce.data
    ? join(state.ce.data, state.aa.data, readMap())
    : { llms: [], services: [] };
  const times = [state.ce.fetchedAt, AA_KEY ? state.aa.fetchedAt : 0].filter(Boolean);
  return {
    generatedAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    aaIndexVersion: state.aa.data?.version ?? null,
    llms,
    services,
    errors,
  };
}

async function getData() {
  if (USE_FIXTURE) return JSON.parse(await fsp.readFile(FIXTURE_FILE, 'utf8'));
  const stale = ['aa', 'ce'].filter((n) => needsRefresh(n, Date.now()));
  if (stale.length) {
    // Concurrent requests share one refresh.
    inflight ??= refresh(stale).finally(() => { inflight = null; });
    await inflight;
  }
  return buildPayload();
}

// ---- http -------------------------------------------------------------------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

async function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch { return send(res, 404, 'Not found'); }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.resolve(PUBLIC_DIR, '.' + path.sep + pathname);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || pathname.includes('\0')) return send(res, 404, 'Not found');
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return send(res, 404, 'Not found');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
  if (req.url.split('?')[0] === '/api/data') {
    try {
      const body = JSON.stringify(await getData());
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'public, max-age=300' });
      return res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      console.error('[api] unexpected error:', err);
      return send(res, 500, JSON.stringify({ llms: [], services: [], errors: [{ source: 'server', message: 'Internal error' }] }),
        { 'Content-Type': MIME['.json'] });
    }
  }
  return serveStatic(req, res);
});

if (!USE_FIXTURE) loadCacheFile();
server.listen(PORT, () => {
  console.log(`Free-Tier AI Finder on http://localhost:${PORT}` +
    (USE_FIXTURE ? ' (fixture mode: no upstream calls)' : '') +
    (!USE_FIXTURE && !AA_KEY ? ' (AA_API_KEY not set: no LLM scores)' : ''));
});
