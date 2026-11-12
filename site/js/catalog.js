// Network + orchestration. String/byte rules live in core.js.

import { core, ERR } from './core.js';

export const CLIENT_ID = '2eb25762-877f-4140-b341-7c7e14c19f98';
const CATALOG = 'https://store.playstation.com/store/api/chihiro/00_09_000/container';
const SEARCH = 'https://commerce1.api.np.km.playstation.net/store/api/chihiro/00_09_000/search';

export const REGIONS = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'IE', name: 'Ireland' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' },
  { code: 'PL', name: 'Poland' },
  { code: 'SE', name: 'Sweden' },
  { code: 'TR', name: 'Türkiye' },
  { code: 'AU', name: 'Australia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'JP', name: 'Japan' },
];

const REGION_SET = new Set(REGIONS.map((r) => r.code));

/* Sony's published shutdown schedule (PlayStation.Blog, 1 Jul 2026).
   Only month-level granularity was announced, so these are upper bounds:
   the store may close earlier in the month than the target shown. */
export const CLOSURE = {
  default: {
    target: '2027-07-01T00:00:00Z',
    since: '2026-07-01T00:00:00Z',
    label: 'July 2027',
    exact: false,
    note: 'Sony announced “July 2027” without a day.',
  },
  TR: {
    target: '2026-12-31T00:00:00Z',
    since: '2026-07-01T00:00:00Z',
    label: 'late 2026',
    exact: false,
    note: "Sony groups Türkiye with the Middle East, which closes late 2026. Unconfirmed.",
  },
};

export const closureFor = (code) => CLOSURE[code] || CLOSURE.default;

export class LookupError extends Error {
  constructor(kind, payload = {}) {
    super(kind);
    this.kind = kind;
    this.payload = payload;
  }
}

export const isRegion = (code) => REGION_SET.has(String(code || '').toUpperCase());

export async function loadIndex(url) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new LookupError('index', { message: `HTTP ${response.status}` });
  const text = await response.text();

  // Count from the file itself; nothing here is a constant.
  const hashes = new Set();
  const skus = new Set();
  for (const line of text.split('\n').slice(1)) {
    const [hash, , sku] = line.split('\t');
    if (!hash || !sku || !sku.trim()) continue;
    hashes.add(hash.trim().toUpperCase());
    skus.add(sku.trim());
  }

  const built = core.buildIndex(text);
  if (built <= 0) throw new LookupError('index', { message: 'the index parsed to zero rows' });
  return { hashes: hashes.size, skus: skus.size, built };
}

// Several stores serve their catalogue only in their own language: asking JP
// for /en/ returns 404 even when the item is on sale. Native first, English as
// the fallback (PL, SE, TR answer to both).
const REGION_LANG = { JP: 'ja', DE: 'de', FR: 'fr', IT: 'it', ES: 'es', TR: 'tr', PL: 'pl', SE: 'sv' };

// Politeness + speed, in the order that matters:
//   1. cache every answer (success and 404) for as long as the store's own
//      Cache-Control allows, and keep it across page loads for the session
//   2. back off when the server says so (429/503 + Retry-After), with jitter
//   3. never ask the same URL twice concurrently
const TTL = 300000;          // the store sends cache-control: max-age=300
const MAX_ENTRIES = 150;
const CACHE_KEY = 'psnacart.catalog.v1';

function loadCache() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let store = loadCache();
const inflight = new Map();

function cacheGet(url) {
  const hit = store[url];
  if (!hit || Date.now() - hit.at > TTL) return null;
  return hit;
}

function cacheSet(url, entry) {
  store[url] = { at: Date.now(), ...entry };
  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => store[a].at - store[b].at)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete store[k]);
  }
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(store)); } catch { /* quota */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function requestJson(url, attempt = 0) {
  let response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new LookupError('transport', { message: error.message });
  }

  if (response.status === 429 || response.status === 503) {
    if (attempt >= 2) throw new LookupError('transport', { message: `HTTP ${response.status}` });
    const hint = Number(response.headers.get('Retry-After'));
    const wait = (Number.isFinite(hint) && hint > 0 ? hint * 1000 : 2 ** attempt * 500)
      + Math.random() * 400;
    await sleep(wait);
    return requestJson(url, attempt + 1);
  }

  if (response.status === 404) return { notSold: true };
  if (!response.ok) throw new LookupError('transport', { message: `HTTP ${response.status}` });
  try {
    return { data: await response.json() };
  } catch {
    throw new LookupError('transport', { message: 'unparseable catalog JSON' });
  }
}

function cachedFetch(url) {
  const hit = cacheGet(url);
  if (hit) {
    return hit.notSold
      ? Promise.reject(new LookupError('notSold', { region: '', base: '' }))
      : Promise.resolve(hit.data);
  }

  if (inflight.has(url)) return inflight.get(url);

  const promise = requestJson(url).then((result) => {
    cacheSet(url, result);
    inflight.delete(url);
    if (result.notSold) throw new LookupError('notSold', { region: '', base: '' });
    return result.data;
  }, (error) => {
    inflight.delete(url);
    throw error;
  });

  promise.catch(() => {}); // callers handle it; avoid unhandled-rejection noise
  inflight.set(url, promise);
  return promise;
}

async function fetchCatalogLang(base, region, lang) {
  const url = `${CATALOG}/${region}/${lang}/19/${base}/`;
  try {
    return await cachedFetch(url);
  } catch (error) {
    if (error.kind === 'notSold') throw new LookupError('notSold', { region, base });
    throw error;
  }
}

async function fetchCatalog(base, region) {
  const langs = [REGION_LANG[region], 'en'].filter((l, i, a) => l && a.indexOf(l) === i);
  let notSold = null;
  for (const lang of langs) {
    try {
      return await fetchCatalogLang(base, region, lang);
    } catch (error) {
      if (error.kind !== 'notSold') throw error;
      notSold = error;
    }
  }
  throw notSold || new LookupError('notSold', { region, base });
}

export { fetchCatalog as fetchItem };

function trustedImage(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (host.endsWith('.playstation.net') || host.endsWith('.playstation.com')) return url.toString();
  } catch { /* ignore */ }
  return null;
}

function toCard(data, region, extra = {}) {
  const sku = data?.default_sku || {};
  const images = Array.isArray(data?.images) ? data.images : [];
  return {
    name: data?.name || '(unnamed)',
    platform: (data?.playable_platform || ['?'])[0],
    price: sku.display_price || '—',
    baseSku: extra.baseSku || sku.id?.replace(/-[A-Z][A-Z0-9]{3}$/, '') || '',
    link: core.cartLink(sku.id || '').value || '',
    image: images.length ? trustedImage(images[images.length - 1].url) : null,
    region,
    ...extra,
  };
}

/** Resolve a hash or SKU into a card plus a note when a regional twin was used. */
export async function resolveInput(rawInput, region) {
  const normalized = core.normalizeInput(rawInput);
  if (!normalized.ok) throw new LookupError('badInput');

  const cleaned = normalized.value;
  let sku;
  let game = null;
  let source;
  let hash = null;

  if (/^[0-9A-F]{40}$/.test(cleaned)) {
    const hit = core.lookup(cleaned);
    if (!hit.ok) {
      if (hit.code === ERR.NO_INDEX) throw new LookupError('index', { message: 'the index is not loaded' });
      throw new LookupError('notInArchive', { hash: cleaned });
    }
    sku = hit.value;
    hash = cleaned;
    source = 'PSNA hash → SKU';
  } else if (core.isContentId(cleaned)) {
    sku = cleaned;
    source = 'SKU';
  } else {
    throw new LookupError('badInput');
  }

  const base = core.stripVariant(sku).value;
  const home = core.homeRegion(base).value;

  try {
    const data = await fetchCatalog(base, region);
    return { card: toCard(data, region, { baseSku: base, source, game, hash }), note: null };
  } catch (error) {
    if (error.kind !== 'notSold') throw error;

    // The archive stores the listing from the region the file came from. The same
    // artwork is a different product elsewhere, so look for it by name.
    const twin = await findTwin(base, home, region);
    if (twin) {
      const data = await fetchCatalog(twin.sku, region);
      const card = toCard(data, region, {
        baseSku: twin.sku,
        source,
        game,
        hash,
        twinOf: twin.sourceName,
        twinHome: home,
      });
      return {
        card,
        note: `That SKU is ${home}-only. Showing the ${region} listing of the same avatar.`,
      };
    }
    throw new LookupError('notSoldAnywhere', { region, base, hash });
  }
}

async function findTwin(base, home, targetRegion, knownName) {
  if (home === targetRegion) return null;

  let sourceName = knownName;
  if (!sourceName) {
    try {
      const data = await fetchCatalog(base, home);
      sourceName = data?.name;
    } catch {
      return null;
    }
  }
  if (!sourceName) return null;

  const wanted = core.normName(sourceName).value;
  if (!wanted) return null;

  let payload;
  const lang = REGION_LANG[targetRegion] || 'en';
  try {
    const response = await fetch(
      `${SEARCH}/${targetRegion}/${lang}/19/${encodeURIComponent(sourceName)}?platform=ps3`
    );
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null;
  }

  // Containment alone is loose: "cat" sits inside "catalogue cat". Collect the
  // candidates and score them, so the closest name wins rather than the first.
  if (wanted.length < 6) return null;

  let best = null;
  for (const item of payload?.links || []) {
    if (item.top_category !== 'avatar') continue;
    const candidate = core.normName(item.name).value;
    if (!candidate || !core.namesMatch(candidate, wanted)) continue;

    const score = candidate === wanted
      ? 1
      : Math.min(candidate.length, wanted.length) / Math.max(candidate.length, wanted.length);
    if (score < 0.6) continue;
    if (!best || score > best.score) best = { sku: item.id, sourceName, score };
  }
  return best;
}

/** Probe every region for this product, streaming rows back as they land. */
/** Build a card for a SKU from a store that does sell it. */
export async function cardFromRegion(base, region, extra = {}) {
  const data = await fetchCatalog(base, region);
  return toCard(data, region, { baseSku: base, ...extra });
}

export async function availability(base, sourceName, home, onRow) {
  // One read of the home store, reused by every twin lookup below. Before this,
  // each failing region re-fetched it, so a delisted avatar cost a dozen
  // identical requests.
  let name = sourceName;
  if (!name) {
    try {
      name = (await fetchCatalog(base, home))?.name || null;
    } catch {
      name = null;
    }
  }

  const queue = REGIONS.map((r) => r.code);
  const worker = async () => {
    // Stagger the workers by a few tens of milliseconds so a scan does not hit
    // the store with four simultaneous requests at every step.
    await new Promise((r) => setTimeout(r, Math.random() * 120));
    while (queue.length) {
      const code = queue.shift();
      onRow({ region: code, status: 'checking' });

      try {
        const data = await fetchCatalog(base, code);
        const sku = data?.default_sku || {};
        onRow({
          region: code,
          status: 'yes',
          price: sku.display_price || '—',
          link: core.cartLink(sku.id || '').value || '',
        });
        continue;
      } catch { /* fall through to a name match */ }

      if (name && code !== home) {
        const twin = await findTwin(base, home, code, name);
        if (twin) {
          try {
            const data = await fetchCatalog(twin.sku, code);
            const sku = data?.default_sku || {};
            onRow({
              region: code,
              status: 'twin',
              price: sku.display_price || '—',
              link: core.cartLink(sku.id || '').value || '',
            });
            continue;
          } catch { /* ignore */ }
        }
      }
      onRow({ region: code, status: 'no' });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
