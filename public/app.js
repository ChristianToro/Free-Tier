'use strict';
// Fetches /api/data once, then filters and sorts in the browser.
// API data is only ever written with textContent, never innerHTML.

const STALE_MONTHS = 3;

const state = {
  data: { llms: [], services: [], errors: [] },
  tab: 'llms',
  query: '',
  category: 'all',
  sort: {
    llms: { key: 'intelligence', dir: 'desc' },
    services: { key: 'name', dir: 'asc' },
  },
};

const $ = (id) => document.getElementById(id);

// Build an element; text goes through textContent.
function el(tag, { text, className, title, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  if (title) node.title = title;
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  for (const child of children) if (child) node.append(child);
  return node;
}

// ---- formatting -------------------------------------------------------------
const DASH = '—';

function timeAgo(value) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return DASH;
  const secs = Math.max(0, (Date.now() - then) / 1000);
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    const n = Math.floor(secs / size);
    if (n >= 1) return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

function isStale(verifiedAt) {
  const then = new Date(verifiedAt);
  if (Number.isNaN(then.getTime())) return true;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - STALE_MONTHS);
  return then < cutoff;
}

const fmtPrice = (p) => (typeof p === 'number' ? (p === 0 ? 'Free' : `$${p}`) : DASH);
const fmtNum = (n, digits = 1) => (typeof n === 'number' ? n.toFixed(digits) : DASH);
const fmtFree = (f) => (f === true ? 'Yes' : typeof f === 'string' && f ? f : DASH);
const fmtCategory = (c) => {
  const words = String(c || '').replace(/^ai-/, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// Only link to http(s) URLs, so API data can't inject javascript: links.
function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

// ---- filter + sort ----------------------------------------------------------
function matches(row) {
  if (state.tab === 'services' && state.category !== 'all' && row.category !== state.category) return false;
  if (!state.query) return true;
  const models = (row.models || []).map((m) => m.name).join(' ');
  const hay = `${row.name} ${row.slug} ${row.category} ${row.aaModelName || ''} ${models}`.toLowerCase();
  return hay.includes(state.query);
}

// A product with several free models sorts by its best model's score.
const MODEL_KEYS = new Set(['intelligence', 'speed']);
function sortValue(row, key) {
  if (!row.models || !MODEL_KEYS.has(key)) return row[key];
  const values = row.models.map((m) => m[key]).filter((v) => typeof v === 'number');
  return values.length ? Math.max(...values) : null;
}

// Nulls always sort last, whichever direction.
function compare(a, b, key, dir) {
  const x = sortValue(a, key);
  const y = sortValue(b, key);
  const xNull = x == null || x === '';
  const yNull = y == null || y === '';
  if (xNull || yNull) return xNull === yNull ? 0 : xNull ? 1 : -1;
  const diff = typeof x === 'number' && typeof y === 'number'
    ? x - y
    : String(x).localeCompare(String(y), undefined, { sensitivity: 'base' });
  return dir === 'asc' ? diff : -diff;
}

function visibleRows(tab) {
  const { key, dir } = state.sort[tab];
  return state.data[tab]
    .filter(matches)
    .sort((a, b) => compare(a, b, key, dir) || a.name.localeCompare(b.name));
}

// ---- render -----------------------------------------------------------------
function nameCell(row) {
  const href = safeUrl(row.url);
  const name = href
    ? el('a', { text: row.name, attrs: { href, target: '_blank', rel: 'noopener' } })
    : el('span', { text: row.name });
  return el('td', { className: 'name' }, [name]);
}

function verifiedCell(row) {
  return el('td', { text: row.verifiedAt ? `verified ${timeAgo(row.verifiedAt)}` : DASH, className: 'verified' });
}

function rowShell(row) {
  const stale = isStale(row.verifiedAt);
  return el('tr', stale ? { className: 'stale', title: 'May be out of date: last verified more than 3 months ago' } : {});
}

// One sub-row per free model, under its product row.
function modelRows(row) {
  const { key } = state.sort.llms;
  const sortKey = MODEL_KEYS.has(key) ? key : 'intelligence';
  const dir = MODEL_KEYS.has(key) ? state.sort.llms.dir : 'desc';
  const models = [...row.models].sort((a, b) => compare(a, b, sortKey, dir));
  return models.map((m, i) => {
    const tr = rowShell(row);
    tr.classList.add('child');
    if (i === models.length - 1) tr.classList.add('end');
    tr.append(
      el('td', { text: `└ ${m.name}`, className: 'name' }),
      el('td'),
      el('td'),
      el('td', { text: fmtNum(m.intelligence), className: 'num' }),
      el('td', { text: fmtNum(m.speed, 0), className: 'num' }),
      el('td'),
    );
    return tr;
  });
}

// Returns an array: the product row, then any model sub-rows.
function llmRow(row) {
  const tr = rowShell(row);
  const multi = Array.isArray(row.models) && row.models.length > 0;
  const subtitle = multi ? 'Scores: see models below' : row.aaModelName ? `Scores: ${row.aaModelName}` : 'Scores: —';
  const intel = el('td', { className: 'num' }, [el('span', { text: fmtNum(row.intelligence) })]);
  intel.append(el('span', { className: 'sub', text: subtitle }));
  if (multi) tr.classList.add('has-models');
  tr.append(
    nameCell(row),
    el('td', { text: fmtFree(row.freeTier) }),
    el('td', { text: fmtPrice(row.startingPrice), className: 'num' }),
    intel,
    el('td', { text: fmtNum(row.speed, 0), className: 'num' }),
    verifiedCell(row),
  );
  return multi ? [tr, ...modelRows(row)] : [tr];
}

function serviceRow(row) {
  const tr = rowShell(row);
  tr.append(
    nameCell(row),
    el('td', { text: fmtCategory(row.category) }),
    el('td', { text: fmtFree(row.freeTier) }),
    el('td', { text: fmtPrice(row.startingPrice), className: 'num' }),
    verifiedCell(row),
  );
  return tr;
}

function renderTable(tab) {
  const rows = visibleRows(tab);
  const body = $(`rows-${tab}`);
  body.replaceChildren(...(tab === 'llms' ? rows.flatMap(llmRow) : rows.map(serviceRow)));
  $(`count-${tab}`).textContent = `(${rows.length})`;

  const { key, dir } = state.sort[tab];
  for (const th of document.querySelectorAll(`#panel-${tab} th.sortable`)) {
    th.setAttribute('aria-sort', th.dataset.key === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
  }
  return rows.length;
}

function renderChips() {
  const chips = $('chips');
  const categories = [...new Set(state.data.services.map((s) => s.category))].sort();
  chips.hidden = state.tab !== 'services' || categories.length === 0;
  chips.replaceChildren(...['all', ...categories].map((c) => el('button', {
    text: c === 'all' ? 'All' : fmtCategory(c),
    className: 'chip',
    attrs: { type: 'button', 'data-category': c, 'aria-pressed': String(state.category === c) },
  })));
}

function renderErrors() {
  const errors = state.data.errors || [];
  $('error-banner').hidden = errors.length === 0;
  $('error-list').replaceChildren(...errors.map((e) => el('li', { text: e.source ? `${e.source}: ${e.message}` : String(e.message ?? e) })));
}

function renderFooter() {
  const { generatedAt, aaIndexVersion } = state.data;
  $('updated').textContent = generatedAt ? `Data updated ${timeAgo(generatedAt)}.` : '';
  $('aa-version').textContent = aaIndexVersion ? ` (Intelligence Index v${aaIndexVersion})` : '';
}

function render() {
  for (const tab of ['llms', 'services']) {
    const active = tab === state.tab;
    $(`tab-${tab}`).setAttribute('aria-selected', String(active));
    $(`panel-${tab}`).hidden = !active;
  }
  renderChips();
  const llmCount = renderTable('llms');
  const serviceCount = renderTable('services');
  const shown = state.tab === 'llms' ? llmCount : serviceCount;
  const total = state.data.llms.length + state.data.services.length;

  const empty = $('empty');
  empty.hidden = shown > 0;
  empty.textContent = total === 0
    ? 'No data is available yet. The data sources could not be reached; try again later.'
    : 'No results match your search.';
  $(`panel-${state.tab}`).hidden = shown === 0;
}

// ---- events -----------------------------------------------------------------
function bindEvents() {
  $('search').addEventListener('input', (e) => {
    state.query = e.target.value.trim().toLowerCase();
    render();
  });

  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => {
      state.tab = btn.dataset.tab;
      render();
    });
  }

  $('chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.category = chip.dataset.category;
    render();
  });

  for (const th of document.querySelectorAll('th.sortable')) {
    th.tabIndex = 0;
    const activate = () => {
      const tab = th.closest('.panel').id.replace('panel-', '');
      const sort = state.sort[tab];
      const key = th.dataset.key;
      if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
      else Object.assign(sort, { key, dir: th.classList.contains('num') ? 'desc' : 'asc' });
      render();
    };
    th.addEventListener('click', activate);
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  }
}

async function init() {
  bindEvents();
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.data = {
      ...data,
      llms: Array.isArray(data.llms) ? data.llms : [],
      services: Array.isArray(data.services) ? data.services : [],
      errors: Array.isArray(data.errors) ? data.errors : [],
    };
  } catch (err) {
    state.data.errors = [{ source: 'page', message: `Could not load data (${err.message}).` }];
  }
  $('status').hidden = true;
  renderErrors();
  renderFooter();
  render();
}

init();
