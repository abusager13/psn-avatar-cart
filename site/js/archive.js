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
  { id: 'all', label: 'All delisted', test: () => true },
  { id: 'named', label: 'With a name', test: (r) => Boolean(r.name) },
];

const state = { rows: [], query: '', filter: 'all', shown: 0, matched: [] };

async function load() {
  const res = await fetch(ARCHIVE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const rows = [];
  for (const line of text.split('\n').slice(1)) {
    const [hash, sku, game, name] = line.split('\t');
    if (!hash || !sku) continue;
    rows.push({ hash, sku, game: game || '', name: name || '' });
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
  el.count.textContent = state.query || state.filter !== 'all'
    ? `${state.matched.length.toLocaleString()} of ${total.toLocaleString()} delisted avatars`
    : `${total.toLocaleString()} delisted avatars`;
}

function card(row) {
  const article = document.createElement('article');
  article.className = 'card border border-white/5 bg-base-200 transition hover:border-white/15';
  article.innerHTML = `
    <div class="card-body gap-2 p-4">
      <p class="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wider text-base-content/45">
        <span class="truncate">${esc(row.game || 'unknown game')}</span>
        <span class="badge badge-error badge-xs shrink-0">delisted</span>
      </p>
      <h3 class="line-clamp-2 min-h-[2.4rem] text-sm font-semibold leading-snug">${esc(row.name || '(no avatar name recorded)')}</h3>
      <code class="truncate font-mono text-[10px] text-base-content/40">${esc(row.sku)}</code>
      <code class="truncate font-mono text-[10px] text-base-content/25">${esc(row.hash)}</code>
      <div class="mt-1 flex gap-2">
        <a class="btn btn-primary btn-xs flex-1" href="./?hash=${esc(row.hash)}">Open ↗</a>
        <button class="btn btn-ghost btn-xs" type="button">Copy hash</button>
      </div>
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
    b.className = `btn btn-xs ${state.filter === f.id ? 'btn-primary' : 'btn-ghost'}`;
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
  el.lede.textContent = `${state.rows.length.toLocaleString()} avatars we can name by hash that no longer exist in any of the 14 stores.`;
  const params = new URLSearchParams(location.search);
  if (params.get('filter')) state.filter = params.get('filter');
  if (params.get('q')) { el.q.value = params.get('q'); state.query = params.get('q'); }
  renderFilters();
  apply();
}

boot();
