// Catalogue browser: search the merged live catalogue, lazily fetch artwork.

import { initCore, core } from './wasm.js';
import { REGIONS } from './catalog.js';

const CATALOG_URL = 'data/browse-catalog.tsv?v=__V__';
const PAGE = 48;
const IMAGE_CONCURRENCY = 6;

const el = {
  q: document.getElementById('q'),
  clear: document.getElementById('clear'),
  regions: document.getElementById('regions'),
  count: document.getElementById('count'),
  results: document.getElementById('results'),
  more: document.getElementById('more'),
  lede: document.getElementById('lede'),
};

const state = {
  rows: [],
  query: '',
  region: '',
  shown: 0,
  matched: [],
};

/* ---------------------------------------------------------------- loading */

async function loadCatalog() {
  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split('\n');
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const [sku, name, price, regions] = lines[i].split('\t');
    if (!sku || !regions) continue;
    rows.push({ sku, name: name || '', price: price || '', regions: regions.split(' ') });
  }
  return rows;
}

/* ---------------------------------------------------------------- artwork */

const imageQueue = [];
let active = 0;

function requestImage(card, sku, region) {
  imageQueue.push({ card, sku, region });
  pump();
}

function pump() {
  while (active < IMAGE_CONCURRENCY && imageQueue.length) {
    const job = imageQueue.shift();
    active += 1;
    fetchImage(job).finally(() => {
      active -= 1;
      pump();
    });
  }
}

async function fetchImage({ card, sku, region }) {
  const url = `https://store.playstation.com/store/api/chihiro/00_09_000/container/${region}/en/19/${sku}/`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    const img = (data.images || []).slice(-1)[0];
    if (!img || !img.url) return;
    const parsed = new URL(img.url);
    if (parsed.protocol !== 'https:') return;
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith('.playstation.net') && !host.endsWith('.playstation.com')) return;
    const image = new Image();
    image.className = 'av-img';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.alt = '';
    image.onload = () => card.querySelector('.av-thumb')?.replaceWith(image);
    image.src = img.url;
  } catch {
    /* artwork is a nicety */
  }
}

/* ---------------------------------------------------------------- render */

function apply() {
  const q = state.query.trim().toLowerCase();
  state.matched = state.rows.filter((row) => {
    if (state.region && !row.regions.includes(state.region)) return false;
    if (!q) return true;
    return row.name.toLowerCase().includes(q) || row.sku.toLowerCase().includes(q);
  });
  state.shown = 0;
  el.results.innerHTML = '';
  renderMore();
  renderCount();
  renderPage();
}

function renderCount() {
  const total = state.rows.length;
  const n = state.matched.length;
  el.count.textContent = state.query || state.region
    ? `${n.toLocaleString()} of ${total.toLocaleString()} listings`
    : `${total.toLocaleString()} avatars across 14 stores`;
}

function renderMore() {
  const left = state.matched.length - state.shown;
  el.more.classList.toggle('hidden', left <= 0);
  el.more.textContent = left > 0 ? `Load more (${left.toLocaleString()} left)` : 'Load more';
}

function card(row) {
  const article = document.createElement('article');
  article.className = 'av';
  const link = core.cartLink(row.sku).value || '#';
  article.innerHTML = `
    <div class="av-thumb"></div>
    <div class="av-body">
      <h3 class="av-name">${esc(row.name || '(unnamed)')}</h3>
      <p class="av-meta"><span class="av-region">${esc(row.regions.join(' '))}</span>
        <span class="av-price">${esc(row.price || '—')}</span></p>
      <code class="av-sku">${esc(row.sku)}</code>
    </div>
    <div class="av-actions">
      <a class="btn primary small" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Add to cart ↗</a>
      <button class="btn ghost small" type="button">Copy link</button>
    </div>`;
  article.querySelector('button').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(link);
      button.textContent = 'Copied ✓';
      setTimeout(() => { button.textContent = 'Copy link'; }, 1500);
    } catch {
      button.textContent = 'Copy failed';
    }
  });
  requestImage(article, row.sku, row.regions[0]);
  return article;
}

function renderPage() {
  const slice = state.matched.slice(state.shown, state.shown + PAGE);
  const frag = document.createDocumentFragment();
  for (const row of slice) frag.appendChild(card(row));
  el.results.appendChild(frag);
  state.shown += slice.length;
  renderMore();
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ---------------------------------------------------------------- wiring */

function renderRegions() {
  const codes = [''].concat(REGIONS.map((r) => r.code));
  el.regions.innerHTML = '';
  for (const code of codes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${state.region === code ? ' active' : ''}`;
    b.textContent = code || 'All regions';
    b.addEventListener('click', () => {
      state.region = code;
      renderRegions();
      apply();
    });
    el.regions.appendChild(b);
  }
}

let timer;
el.q.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    state.query = el.q.value;
    apply();
  }, 120);
});

el.clear.addEventListener('click', () => {
  el.q.value = '';
  state.query = '';
  state.region = '';
  renderRegions();
  apply();
});

el.more.addEventListener('click', renderPage);

async function boot() {
  try {
    await initCore('wasm/psn_core.wasm?v=__V__');
  } catch (error) {
    el.lede.textContent = `The Rust/WASM core failed to load (${error.message}).`;
    return;
  }
  try {
    state.rows = await loadCatalog();
  } catch (error) {
    el.lede.textContent = `Could not load the catalogue (${error.message}).`;
    return;
  }
  el.lede.textContent = `${state.rows.length.toLocaleString()} listings, each one a real product ID from the PlayStation Store.`;
  const params = new URLSearchParams(location.search);
  if (params.get('region')) state.region = params.get('region').toUpperCase();
  if (params.get('q')) { el.q.value = params.get('q'); state.query = params.get('q'); }
  renderRegions();
  apply();
}

boot();
