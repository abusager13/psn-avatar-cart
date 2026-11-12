// Live search: ask Sony's own search for avatars matching a name.

import { core } from './core.js';
import { REGIONS } from './catalog.js';

const SEARCH = 'https://commerce1.api.np.km.playstation.net/store/api/chihiro/00_09_000/search';

// These stores answer only in their own language.
const LANG = { JP: 'ja', DE: 'de', FR: 'fr', IT: 'it', ES: 'es', TR: 'tr', PL: 'pl', SE: 'sv' };

const el = {
  q: document.getElementById('q'),
  clear: document.getElementById('clear'),
  regions: document.getElementById('regions'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  more: document.getElementById('more'),
};

const state = {
  region: 'US',
  query: '',
  total: 0,
  shown: 0,
  seen: new Set(),
  busy: false,
  seq: 0,
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function imageUrl(item) {
  const images = Array.isArray(item.images) ? item.images : [];
  if (!images.length) return null;
  try {
    const url = new URL(images[images.length - 1].url);
    const host = url.hostname.toLowerCase();
    if (url.protocol === 'https:' && (host.endsWith('.playstation.net') || host.endsWith('.playstation.com'))) {
      return url.toString();
    }
  } catch { /* ignore */ }
  return null;
}

async function search(start) {
  const lang = LANG[state.region] || 'en';
  const url = `${SEARCH}/${state.region}/${lang}/19/${encodeURIComponent(state.query)}`
    + `?top_category=avatar&start=${start}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function card(item) {
  const sku = (item.default_sku || {}).id || '';
  const base = core.stripVariant(sku).value || sku;
  const link = core.cartLink(sku).value || '#';
  const price = (item.default_sku || {}).display_price || '';
  const platform = (item.playable_platform || [''])[0];
  const art = imageUrl(item);

  const article = document.createElement('article');
  article.className = 'av';
  article.innerHTML = `
    ${art ? `<img class="av-img" src="${esc(art)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
          : '<div class="av-img"></div>'}
    <div class="av-body">
      <h3 class="av-name">${esc(item.name || '(unnamed)')}</h3>
      <p class="av-meta"><span class="av-region">${esc(platform)}</span>
        <span class="av-price">${esc(price || '—')}</span></p>
      <code class="av-sku">${esc(base)}</code>
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
  return article;
}

async function load(reset) {
  if (!state.query.trim() || state.query.trim().length < 2) {
    if (reset) {
      el.results.innerHTML = '';
      el.more.classList.add('hidden');
      el.status.textContent = 'Pick a store and type a name.';
    }
    return;
  }
  if (state.busy) return;

  state.busy = true;
  const seq = reset ? ++state.seq : state.seq;
  if (reset) {
    state.seen.clear();
    state.shown = 0;
    state.total = 0;
    el.results.innerHTML = '';
    el.status.textContent = 'Searching…';
  }

  try {
    const data = await search(state.shown);
    if (seq !== state.seq) return;
    state.total = data.total_results || 0;

    const items = (data.links || []).filter((i) => i.top_category === 'avatar' && i.id);
    const frag = document.createDocumentFragment();
    let added = 0;
    for (const item of items) {
      if (state.seen.has(item.id)) continue;
      state.seen.add(item.id);
      frag.appendChild(card(item));
      added += 1;
    }
    el.results.appendChild(frag);
    state.shown += items.length;

    el.status.textContent = state.total
      ? `${state.total.toLocaleString()} result${state.total === 1 ? '' : 's'} in ${state.region} — showing ${state.seen.size}`
      : `Nothing called “${state.query}” in ${state.region}. Try another store or spelling.`;
    el.more.classList.toggle('hidden', !(state.total > state.seen.size && items.length === 20));
  } catch (error) {
    if (seq === state.seq) el.status.textContent = `Search failed: ${error.message}`;
  } finally {
    if (seq === state.seq) state.busy = false;
  }
}

function renderRegions() {
  el.regions.innerHTML = '';
  for (const r of REGIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${state.region === r.code ? ' active' : ''}`;
    b.textContent = r.code;
    b.title = r.name;
    b.addEventListener('click', () => {
      state.region = r.code;
      renderRegions();
      if (state.query.trim().length >= 2) load(true);
    });
    el.regions.appendChild(b);
  }
}

let timer;
el.q.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    state.query = el.q.value;
    load(true);
  }, 300);
});

el.q.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    clearTimeout(timer);
    state.query = el.q.value;
    load(true);
  }
});

el.clear.addEventListener('click', () => {
  el.q.value = '';
  state.query = '';
  load(true);
  el.q.focus();
});

el.more.addEventListener('click', () => load(false));

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('region')) state.region = params.get('region').toUpperCase();
  if (params.get('q')) {
    el.q.value = params.get('q');
    state.query = params.get('q');
  }
  renderRegions();
  if (state.query) load(true);
}

boot();
