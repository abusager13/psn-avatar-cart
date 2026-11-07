// Archive view: every PSNA hash we can resolve, including delisted ones.

const ARCHIVE_URL = 'data/archive.tsv?v=__V__';
const PAGE = 60;

const el = {
  q: document.getElementById('q'),
  clear: document.getElementById('clear'),
  filters: document.getElementById('filters'),
  count: document.getElementById('count'),
  results: document.getElementById('results'),
  more: document.getElementById('more'),
  lede: document.getElementById('lede'),
};

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'gone', label: 'Delisted only', test: (r) => r.live === 'no' },
  { id: 'live', label: 'Still sold', test: (r) => r.live === 'yes' },
  { id: 'named', label: 'Named', test: (r) => Boolean(r.name) },
];

const state = { rows: [], query: '', filter: 'all', shown: 0, matched: [] };

async function load() {
  const res = await fetch(ARCHIVE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const rows = [];
  for (const line of text.split('\n').slice(1)) {
    const [hash, sku, game, name, live] = line.split('\t');
    if (!hash || !sku) continue;
    rows.push({ hash, sku, game: game || '', name: name || '', live: live || 'no' });
  }
  return rows;
}

function apply() {
  const q = state.query.trim().toLowerCase();
  const filter = FILTERS.find((f) => f.id === state.filter) || FILTERS[0];
  state.matched = state.rows.filter((row) => {
    if (!filter.test(row)) return false;
    if (!q) return true;
    return (
      row.hash.toLowerCase().includes(q) ||
      row.sku.toLowerCase().includes(q) ||
      row.game.toLowerCase().includes(q) ||
      row.name.toLowerCase().includes(q)
    );
  });
  state.shown = 0;
  el.results.innerHTML = '';
  renderCount();
  renderPage();
}

function renderCount() {
  const total = state.rows.length;
  const gone = state.rows.filter((r) => r.live === 'no').length;
  el.count.textContent = state.query || state.filter !== 'all'
    ? `${state.matched.length.toLocaleString()} of ${total.toLocaleString()} hashes`
    : `${total.toLocaleString()} hashes · ${gone.toLocaleString()} delisted`;
}

function card(row) {
  const article = document.createElement('article');
  article.className = 'av';
  const badge = row.live === 'yes'
    ? '<span class="badge live">still sold</span>'
    : '<span class="badge gone">delisted</span>';
  article.innerHTML = `
    <div class="av-body">
      <p class="av-meta"><span class="av-region">${esc(row.game || 'unknown game')}</span>${badge}</p>
      <h3 class="av-name">${esc(row.name || '(no avatar name recorded)')}</h3>
      <code class="av-sku">${esc(row.sku)}</code>
      <code class="av-sku hash">${esc(row.hash)}</code>
    </div>
    <div class="av-actions">
      <a class="btn primary small" href="./?hash=${esc(row.hash)}" >Open ↗</a>
      <button class="btn ghost small" type="button">Copy hash</button>
    </div>`;
  article.querySelector('button').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(row.hash);
      button.textContent = 'Copied ✓';
      setTimeout(() => { button.textContent = 'Copy hash'; }, 1500);
    } catch {
      button.textContent = 'Copy failed';
    }
  });
  return article;
}

function renderPage() {
  const slice = state.matched.slice(state.shown, state.shown + PAGE);
  const frag = document.createDocumentFragment();
  for (const row of slice) frag.appendChild(card(row));
  el.results.appendChild(frag);
  state.shown += slice.length;
  const left = state.matched.length - state.shown;
  el.more.classList.toggle('hidden', left <= 0);
  el.more.textContent = left > 0 ? `Load more (${left.toLocaleString()} left)` : 'Load more';
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderFilters() {
  el.filters.innerHTML = '';
  for (const f of FILTERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${state.filter === f.id ? ' active' : ''}`;
    b.textContent = f.label;
    b.addEventListener('click', () => {
      state.filter = f.id;
      renderFilters();
      apply();
    });
    el.filters.appendChild(b);
  }
}

let timer;
el.q.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => { state.query = el.q.value; apply(); }, 120);
});

el.clear.addEventListener('click', () => {
  el.q.value = '';
  state.query = '';
  state.filter = 'all';
  renderFilters();
  apply();
});

el.more.addEventListener('click', renderPage);

async function boot() {
  try {
    state.rows = await load();
  } catch (error) {
    el.lede.textContent = `Could not load the archive (${error.message}).`;
    return;
  }
  const gone = state.rows.filter((r) => r.live === 'no').length;
  el.lede.textContent = `${state.rows.length.toLocaleString()} hashes resolve to a product ID — ${gone.toLocaleString()} of them are no longer sold anywhere.`;
  const params = new URLSearchParams(location.search);
  if (params.get('filter')) state.filter = params.get('filter');
  if (params.get('q')) { el.q.value = params.get('q'); state.query = params.get('q'); }
  renderFilters();
  apply();
}

boot();
