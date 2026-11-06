// Wiring: state, events, URL permalinks, recent lookups.

import { initCore, core, ERR } from './wasm.js';
import {
  REGIONS, LookupError, isRegion, loadIndex, resolveInput, availability,
} from './catalog.js';
import {
  renderChips, renderMessage, renderEmpty, renderCard, renderRegionRows,
  renderRecent, setRecentVisible, renderCountdown,
} from './ui.js';

const INDEX_URL = 'data/avatar-sku-index.tsv?v=__V__';
const RECENT_KEY = 'psnacart.recent.v1';
const MAX_RECENT = 8;

const el = {
  chips: document.getElementById('chips'),
  input: document.getElementById('input'),
  paste: document.getElementById('paste'),
  edat: document.getElementById('edat'),
  file: document.getElementById('file'),
  go: document.getElementById('go'),
  message: document.getElementById('message'),
  card: document.getElementById('card'),
  permalink: document.getElementById('permalink'),
  permalinkUrl: document.getElementById('permalink-url'),
  permalinkCopy: document.getElementById('permalink-copy'),
  regions: document.getElementById('regions'),
  regionsBody: document.getElementById('regions-body'),
  regionsSummary: document.getElementById('regions-summary'),
  countdown: document.getElementById('countdown'),
  recentSection: document.getElementById('recent-section'),
  recent: document.getElementById('recent'),
};

const state = {
  region: 'US',
  card: null,
  rows: [],
  busy: false,
  indexReady: false,
  indexPromise: null,
  recent: readRecent(),
};

const REGION_NAMES = Object.fromEntries(REGIONS.map((r) => [r.code, r.name]));

/* ---------------------------------------------------------------- storage */

function readRecent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((x) => x && x.input) : [];
  } catch {
    return [];
  }
}

function remember(entry) {
  const rest = state.recent.filter((x) => !(x.input === entry.input && x.region === entry.region));
  state.recent = [entry, ...rest].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent));
  } catch { /* storage may be blocked; recents are a nicety */ }
  paintRecent();
}

function paintRecent() {
  setRecentVisible(el.recentSection, state.recent.length > 0);
  if (state.recent.length) {
    renderRecent(el.recent, state.recent, (item) => {
      el.input.value = item.input;
      state.region = item.region;
      renderChips(el.chips, REGIONS, state.region, pickRegion);
      run(item.input, item.region);
    }, () => {
      state.recent = [];
      try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
      paintRecent();
    });
  }
}

/* ---------------------------------------------------------------- helpers */

/** Names for avatars that are no longer sold anywhere (scene/archive lists). */
let namesPromise = null;
function loadNames() {
  if (!namesPromise) {
    namesPromise = fetch('data/avatar-names.tsv?v=__V__')
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => {
        const map = new Map();
        for (const line of text.split('\n').slice(1)) {
          const [sku, name, region] = line.split('\t');
          if (sku && name) map.set(sku, { name, region });
        }
        return map;
      })
      .catch(() => new Map());
  }
  return namesPromise;
}

async function ensureIndex() {
  if (state.indexReady) return;
  if (!state.indexPromise) {
    state.indexPromise = loadIndex(INDEX_URL)
      .then(() => { state.indexReady = true; })
      .catch((error) => { state.indexPromise = null; throw error; });
  }
  return state.indexPromise;
}

function messageFor(error, scanned) {
  switch (error.kind) {
    case 'badInput':
      return 'Paste a 40-character PSNA hash, a full SKU like UP1004-BLUS30418_00-AVARDRSHADOWWOLF, or open an .edat file.';
    case 'notInArchive':
      return `${error.payload.hash} isn't in the archive index.\nIt covers the 5,415 avatars from the PS3-Avatars-Edat collection — use “Open .edat…” for anything else.`;
    case 'index':
      return `Could not load the avatar index (${error.payload.message}).`;
    case 'notSoldAnywhere': {
      if (!scanned) return `Not sold in ${error.payload.region}.`;
      if (!scanned.length) {
        return `Not sold in ${error.payload.region}, and not in any of the other ${REGIONS.length - 1} tracked stores either. This item is delisted as far as this site can check.`;
      }
      return `Not sold in ${error.payload.region}. Still on sale in: ${scanned.join(', ')}.`;
    }
    default:
      return `Catalog request failed: ${error.payload?.message || 'unknown error'}`;
  }
}

function regionHunt(base, home, sourceName) {
  const found = [];
  return availability(base, sourceName, home, (row) => {
    if (row.status === 'yes' || row.status === 'twin') found.push(row.region);
  }).then(() => found);
}

/* ---------------------------------------------------------------- actions */

async function run(rawInput, region) {
  const value = String(rawInput || '').trim();
  if (!value || state.busy) return;

  state.busy = true;
  state.card = null;
  state.rows = [];
  el.go.disabled = true;
  // Keep the URL and the share bar honest for this attempt, not the last one.
  syncUrl();
  el.permalink.classList.add('hidden');
  el.regions.classList.add('hidden');
  renderMessage(el.message, 'Querying the PlayStation catalog…', 'info');
  renderEmpty(el.card);

  try {
    if (!core.ready()) throw new Error('the core is still loading');
    if (/^[0-9A-F]{40}$/.test(core.normalizeInput(value).value || '')) {
      await ensureIndex();
    }
    const { card, note } = await resolveInput(value, region);
    state.card = card;
    renderMessage(el.message, '', 'info');
    renderCard(el.card, card, note, {
      copy: copyText,
      copyShare: () => copyText(shareUrl()),
    });
    showPermalink();
    remember({
      input: value,
      region,
      name: card.name,
      price: card.price,
      image: card.image,
    });
    startAvailability(card, value, region);
  } catch (error) {
    if (error instanceof LookupError && error.kind === 'notSoldAnywhere') {
      renderMessage(el.message, `Not sold as that SKU in ${region} — checking every store…`, 'info');
      const home = core.homeRegion(error.payload.base).value;
      let sourceName = null;
      try {
        const data = await fetchItem(error.payload.base, home);
        sourceName = data?.name || null;
      } catch { /* no name to match on */ }
      const found = await regionHunt(error.payload.base, home, sourceName);
      let text = messageFor(error, found);
      if (!found.length) {
        const names = await loadNames();
        const hit = names.get(error.payload.base);
        if (hit) text += `\nKnown as: “${hit.name}” (${hit.region} listing, delisted).`;
      }
      renderMessage(el.message, text, 'error');
    } else {
      renderMessage(el.message, messageFor(error), 'error');
    }
    renderEmpty(el.card);
  } finally {
    state.busy = false;
    el.go.disabled = false;
  }
}

async function fetchItem(base, region) {
  const response = await fetch(
    `https://store.playstation.com/store/api/chihiro/00_09_000/container/${region}/en/19/${base}/`
  );
  if (!response.ok) return null;
  return response.json();
}

function startAvailability(card, rawInput, region) {
  const base = core.stripVariant(card.baseSku).value;
  const home = core.homeRegion(base).value;

  state.rows = REGIONS.map((r) => ({ region: r.code, status: 'checking' }));
  el.regions.classList.remove('hidden');
  el.regionsSummary.textContent = 'checking 14 stores…';
  renderRegionRows(el.regionsBody, state.rows, REGION_NAMES);

  const update = (row) => {
    const index = state.rows.findIndex((r) => r.region === row.region);
    if (index >= 0) state.rows[index] = { ...state.rows[index], ...row };
    renderRegionRows(el.regionsBody, state.rows, REGION_NAMES);
    const done = state.rows.filter((r) => r.status !== 'checking').length;
    const sold = state.rows.filter((r) => r.status === 'yes' || r.status === 'twin').length;
    el.regionsSummary.textContent = `${done}/${REGIONS.length} checked · ${sold} selling`;
  };

  availability(base, card.name, home, update).catch(() => {
    el.regionsSummary.textContent = 'availability check failed';
  });
}

/* ---------------------------------------------------------------- URL */

function shareUrl() {
  const input = core.normalizeInput(el.input.value).value || '';
  if (!input) return location.href.split('?')[0];
  const params = new URLSearchParams();
  const isHash = /^[0-9A-F]{40}$/.test(input);
  params.set(isHash ? 'hash' : 'sku', input);
  params.set('region', state.region);
  return `${location.origin}${location.pathname}?${params.toString()}`;
}

function showPermalink() {
  el.permalink.classList.remove('hidden');
  el.permalinkUrl.textContent = shareUrl().replace(/^https?:\/\//, '');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      el.input.value = text;
      el.input.select();
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

function syncUrl() {
  const url = shareUrl();
  try {
    history.replaceState(null, '', url);
  } catch { /* ignore */ }
}

/* ---------------------------------------------------------------- events */

function pickRegion(code) {
  if (code === state.region) return;
  state.region = code;
  renderChips(el.chips, REGIONS, code, pickRegion);
  renderCountdown(el.countdown, code);
  const value = el.input.value.trim();
  if (value) {
    run(value, code);
    syncUrl();
  }
}

el.go.addEventListener('click', () => {
  syncUrl();
  run(el.input.value, state.region);
});
el.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    syncUrl();
    run(el.input.value, state.region);
  }
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
  const file = el.file.files?.[0];
  el.file.value = '';
  if (!file) return;
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const result = core.decodeEdat(bytes);
  if (!result.ok) {
    const reason = {
      [ERR.TOO_SHORT]: 'file is too short to be a PSNA avatar',
      [ERR.BAD_MAGIC]: 'header magic is missing — not a PSNA avatar file',
      [ERR.BAD_CONTENT_ID]: 'the header content ID looks wrong',
    }[result.code] || 'unknown header error';
    renderMessage(el.message, `Could not read that file: ${reason}.`, 'error');
    return;
  }
  el.input.value = result.value;
  run(result.value, state.region);
});

el.permalinkCopy.addEventListener('click', async () => {
  const ok = await copyText(shareUrl());
  el.permalinkCopy.textContent = ok ? 'Copied ✓' : 'Copy failed';
  setTimeout(() => { el.permalinkCopy.textContent = 'Copy'; }, 1600);
});

const example = document.getElementById('example');
if (example) {
  example.addEventListener('click', () => {
    el.input.value = 'B19E79472B5D7F475C9FEAFC93FF7F2A6C4DEDAB';
    state.region = 'GB';
    renderChips(el.chips, REGIONS, 'GB', pickRegion);
    run(el.input.value, 'GB');
  });
}

/* ---------------------------------------------------------------- boot */

async function boot() {
  renderChips(el.chips, REGIONS, state.region, pickRegion);
  renderCountdown(el.countdown, state.region);
  setInterval(() => {
    renderCountdown(el.countdown, state.region);
    if (state.rows.length) renderRegionRows(el.regionsBody, state.rows, REGION_NAMES);
  }, 1000);
  renderEmpty(el.card);
  paintRecent();

  try {
    await initCore('wasm/psn_core.wasm?v=__V__');
  } catch (error) {
    renderMessage(el.message, `The Rust/WASM core failed to load (${error.message}).`, 'error');
    return;
  }

  const params = new URLSearchParams(location.search);
  const region = (params.get('region') || '').toUpperCase();
  const hash = params.get('hash');
  const sku = params.get('sku');

  if (isRegion(region)) {
    state.region = region;
    renderChips(el.chips, REGIONS, state.region, pickRegion);
  }
  const seed = hash || sku;
  if (seed) {
    el.input.value = seed;
    run(seed, state.region);
  }
}

boot();
