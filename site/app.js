/* PSN Avatar Cart — static site.
   Everything runs in the browser: Sony's catalog API sends CORS headers, so no
   proxy or backend is needed. No login, no storage, no analytics. */

const CLIENT_ID = '2eb25762-877f-4140-b341-7c7e14c19f98';
const CHECKOUT = 'https://checkout.playstation.com/add';
const CATALOG = 'https://store.playstation.com/store/api/chihiro/00_09_000/container';
const REGIONS = ['US', 'GB', 'DE', 'FR', 'JP', 'PL', 'TR', 'AU', 'CA', 'IE', 'SE', 'ZA', 'IT', 'ES'];
const INDEX_URL = 'data/avatar-sku-index.tsv';

const el = {
  chips: document.getElementById('chips'),
  input: document.getElementById('input'),
  paste: document.getElementById('paste'),
  edat: document.getElementById('edat'),
  file: document.getElementById('file'),
  go: document.getElementById('go'),
  message: document.getElementById('message'),
  card: document.getElementById('card'),
};

const state = {
  region: 'US',
  card: null,
  message: null,
  kind: 'info',
  loading: false,
  copied: false,
  index: null,
  indexPromise: null,
};

/* ---------------------------------------------------------------- helpers */

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function stripVariant(sku) {
  const m = String(sku).match(/^(.*)-([A-Z][A-Z0-9]{3})$/);
  return m ? m[1] : sku;
}

async function loadIndex() {
  if (state.index) return state.index;
  if (!state.indexPromise) {
    state.indexPromise = (async () => {
      const res = await fetch(INDEX_URL, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`index unavailable (HTTP ${res.status})`);
      const text = await res.text();
      const map = new Map();
      const lines = text.split('\n');
      for (let i = 1; i < lines.length; i += 1) {
        const [hash, game, sku] = lines[i].split('\t');
        if (hash && sku && sku.trim()) {
          map.set(hash.trim().toUpperCase(), { sku: sku.trim(), game: game || null });
        }
      }
      state.index = map;
      return map;
    })().catch((err) => {
      state.indexPromise = null;
      throw err;
    });
  }
  return state.indexPromise;
}

async function fetchCatalog(base, region) {
  const url = `${CATALOG}/${region}/en/19/${base}/`;
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw { kind: 'transport', message: err.message };
  }
  if (res.status === 404) throw { kind: 'notSold', region, base };
  if (!res.ok) throw { kind: 'transport', message: `HTTP ${res.status}` };
  try {
    return await res.json();
  } catch {
    throw { kind: 'transport', message: 'unparseable catalog JSON' };
  }
}

function trustedImageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (host.endsWith('.playstation.net') || host.endsWith('.playstation.com')) return url.toString();
  } catch { /* ignore */ }
  return null;
}

async function resolveItem(rawInput, region) {
  const cleaned = String(rawInput || '')
    .trim().toUpperCase()
    .replace(/PSNA_/g, '')
    .replace(/\.EDAT/g, '')
    .trim();

  let sku;
  let source;
  let game = null;

  if (/^[0-9A-F]{40}$/.test(cleaned)) {
    const map = await loadIndex();
    const hit = map.get(cleaned);
    if (!hit) throw { kind: 'notInArchive', hash: cleaned };
    sku = hit.sku;
    game = hit.game;
    source = 'PSNA hash → SKU';
  } else if (cleaned.includes('-') && cleaned.includes('_')) {
    sku = cleaned;
    source = 'Direct SKU lookup';
  } else {
    throw { kind: 'badInput' };
  }

  const base = stripVariant(sku);
  const data = await fetchCatalog(base, region);
  const ds = data.default_sku || {};
  const checkoutSku = ds.id || base;
  const images = Array.isArray(data.images) ? data.images : [];
  const image = images.length ? trustedImageUrl(images[images.length - 1].url) : null;

  return {
    name: data.name || '(unnamed)',
    platform: (data.playable_platform || ['?'])[0],
    price: ds.display_price || '—',
    baseSku: base,
    link: `${CHECKOUT}/${checkoutSku}?clientId=${CLIENT_ID}`,
    image,
    game,
    region,
    source,
  };
}

async function liveRegions(base, excluding) {
  const hits = await Promise.all(
    REGIONS.filter((r) => r !== excluding).map(async (cc) => {
      try { await fetchCatalog(base, cc); return cc; } catch { return null; }
    })
  );
  return REGIONS.filter((r) => hits.includes(r));
}

function messageFor(err, regions) {
  switch (err.kind) {
    case 'badInput':
      return 'Paste a 40-character PSNA hash, or a full SKU like UP1004-BLUS30418_00-AVARDRSHADOWWOLF.';
    case 'notInArchive':
      return `${err.hash} isn't in the archive index.\nIt covers the 5,415 avatars from the PS3-Avatars-Edat collection — use "Open .edat…" for anything else.`;
    case 'notSold':
      if (!regions) return `Not sold in ${err.region}.`;
      if (!regions.length) {
        return `Not sold in ${err.region} — and not in any of the other ${REGIONS.length - 1} tracked stores either. This SKU is delisted as far as this site can check.`;
      }
      return `Not sold in ${err.region}. Still on sale in: ${regions.join(', ')}. Switch the region chip to one of those.`;
    case 'index':
      return `${err.message}. If you are running this locally, copy desktop/resources/avatar-sku-index.tsv into site/data/ first.`;
    default:
      return `Catalog request failed: ${(err && err.message) || 'unknown error'}`;
  }
}

/* ---------------------------------------------------------------- render */

function setMessage(text, kind) {
  state.message = text;
  state.kind = kind || 'info';
  renderMessage();
}

function clearMessage() {
  state.message = null;
  renderMessage();
}

function renderMessage() {
  if (!state.message) {
    el.message.className = 'message hidden';
    el.message.textContent = '';
    return;
  }
  el.message.className = `message ${state.kind === 'error' ? 'error' : 'info'}`;
  el.message.textContent = state.message;
}

function renderChips() {
  el.chips.innerHTML = '';
  for (const code of REGIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${code === state.region ? ' active' : ''}`;
    b.textContent = code;
    b.addEventListener('click', () => {
      if (state.region === code) return;
      state.region = code;
      state.card = null;
      clearMessage();
      renderChips();
      renderCard();
      const value = el.input.value.trim();
      if (value) run(value, code);
    });
    el.chips.appendChild(b);
  }
}

function renderCard() {
  const card = state.card;
  el.card.innerHTML = '';

  if (!card) {
    el.card.className = 'card empty';
    const inner = document.createElement('div');
    inner.className = 'empty-inner';
    inner.innerHTML = '<strong>No item resolved yet</strong><span>Pick a region, paste a PSNA hash or SKU, then hit Resolve.<br>Artwork, price and a ready-to-use cart link appear here.</span>';
    el.card.appendChild(inner);
    return;
  }

  el.card.className = 'card';

  const top = document.createElement('div');
  top.className = 'top';

  if (card.image) {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = card.image;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    top.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'thumb';
    top.appendChild(ph);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML =
    `<div class="name">${esc(card.name)}</div>` +
    `<div class="line">${esc(card.platform)} · ${esc(card.region)}</div>` +
    `<div class="price${card.price === 'Free' ? ' free' : ''}">${esc(card.price)}</div>` +
    `<div class="sku">${esc(card.baseSku)}</div>` +
    `<div class="source">${esc(card.game ? `${card.game} · ${card.source}` : card.source)}</div>`;
  top.appendChild(meta);
  el.card.appendChild(top);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const add = document.createElement('a');
  add.className = 'btn primary';
  add.href = card.link;
  add.target = '_blank';
  add.rel = 'noopener noreferrer';
  add.textContent = 'Add to cart ↗';
  add.addEventListener('click', () => { state.copied = false; });
  actions.appendChild(add);

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn ghost';
  copy.textContent = state.copied ? 'Copied ✓' : 'Copy link';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(card.link);
      state.copied = true;
      renderCard();
    } catch {
      window.prompt('Copy this link:', card.link);
    }
  });
  actions.appendChild(copy);

  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = 'Opens in this browser — sign in to your PSN account on the region you picked.';
  actions.appendChild(hint);

  el.card.appendChild(actions);
}

/* ---------------------------------------------------------------- actions */

async function run(raw, region) {
  const value = String(raw || '').trim();
  if (!value || state.loading) return;

  state.loading = true;
  state.card = null;
  state.copied = false;
  el.go.disabled = true;
  setMessage('Querying the PlayStation catalog…', 'info');
  renderCard();

  try {
    state.card = await resolveItem(value, region);
    clearMessage();
  } catch (err) {
    if (err && err.kind === 'notSold') {
      setMessage(`Not sold in ${err.region} — checking the other ${REGIONS.length - 1} stores…`, 'info');
      const regions = await liveRegions(err.base, err.region);
      setMessage(messageFor(err, regions), 'error');
    } else if (err && err.kind === 'transport' && /index/i.test(err.message || '')) {
      setMessage(messageFor(err), 'error');
    } else {
      setMessage(messageFor(err || { kind: 'transport', message: 'unknown error' }), 'error');
    }
  } finally {
    state.loading = false;
    el.go.disabled = false;
    renderCard();
  }
}

async function decodeEdatFile(file) {
  const buf = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const magic = String.fromCharCode(...buf.slice(0, 4));
  if (magic !== 'NPD\u0000') {
    throw { kind: 'transport', message: 'Not a PSNA avatar file — header magic is missing.' };
  }
  let cid = '';
  for (let i = 16; i < 64; i += 1) {
    if (buf[i] === 0) break;
    cid += String.fromCharCode(buf[i]);
  }
  cid = cid.trim();
  if (!/^[A-Z]{2}\d{4}-[A-Z0-9]{4,}_\d{2}-/.test(cid)) {
    throw { kind: 'transport', message: `Header content ID looks wrong: ${cid}` };
  }
  return cid;
}

/* ---------------------------------------------------------------- wiring */

renderChips();
renderCard();

el.go.addEventListener('click', () => run(el.input.value, state.region));
el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') run(el.input.value, state.region);
});

el.paste.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) { el.input.value = text.trim(); el.input.focus(); }
  } catch {
    el.input.focus();
  }
});

el.edat.addEventListener('click', () => el.file.click());
el.file.addEventListener('change', async () => {
  const file = el.file.files && el.file.files[0];
  el.file.value = '';
  if (!file) return;
  try {
    const sku = await decodeEdatFile(file);
    el.input.value = sku;
    run(sku, state.region);
  } catch (err) {
    setMessage(messageFor(err), 'error');
  }
});

/* Snapshot hook for automated layout checks. */
const snap = new URLSearchParams(location.search).get('snap');
if (snap) {
  (async () => {
    if (snap === 'error') {
      setMessage('Not sold in US. Sony returns DataNotFound for this SKU there — delisted, or a different catalog. Try another region.', 'error');
    } else if (snap === 'sweep') {
      el.input.value = '0300F206172D2DE79C5479547C7B13DF6CD0E693';
      await run(el.input.value, 'US');
    } else if (snap === 'gb') {
      state.region = 'GB';
      renderChips();
      el.input.value = 'B19E79472B5D7F475C9FEAFC93FF7F2A6C4DEDAB';
      await run(el.input.value, 'GB');
    } else if (snap !== 'empty') {
      el.input.value = 'UP1004-BLUS30418_00-AVARDRSHADOWWOLF';
      await run(el.input.value, 'US');
    }
    document.body.dataset.snapReady = '1';
  })();
}
