// Network + orchestration. All string/byte rules live in the Rust core.

import { core, ERR } from './wasm.js';

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
    label: 'July 2027',
    exact: false,
    note: 'Sony announced “July 2027” without a day.',
  },
  TR: {
    target: '2026-12-31T00:00:00Z',
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

async function fetchCatalog(base, region) {
  const url = `${CATALOG}/${region}/en/19/${base}/`;
  let response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new LookupError('transport', { message: error.message });
  }
  if (response.status === 404) throw new LookupError('notSold', { region, base });
  if (!response.ok) throw new LookupError('transport', { message: `HTTP ${response.status}` });
  try {
    return await response.json();
  } catch {
    throw new LookupError('transport', { message: 'unparseable catalog JSON' });
  }
}

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
  } else if (cleaned.includes('-') && cleaned.includes('_')) {
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

async function findTwin(base, home, targetRegion) {
  if (home === targetRegion) return null;

  let sourceName;
  try {
    const data = await fetchCatalog(base, home);
    sourceName = data?.name;
  } catch {
    return null;
  }
  if (!sourceName) return null;

  const wanted = core.normName(sourceName).value;
  if (!wanted) return null;

  let payload;
  try {
    const response = await fetch(
      `${SEARCH}/${targetRegion}/en/19/${encodeURIComponent(sourceName)}?platform=ps3`
    );
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null;
  }

  for (const item of payload?.links || []) {
    if (item.top_category !== 'avatar') continue;
    const candidate = core.normName(item.name).value;
    if (!candidate) continue;
    if (core.namesMatch(candidate, wanted)) {
      return { sku: item.id, sourceName };
    }
  }
  return null;
}

/** Probe every region for this product, streaming rows back as they land. */
/** Build a card for a SKU from a store that does sell it. */
export async function cardFromRegion(base, region, extra = {}) {
  const data = await fetchCatalog(base, region);
  return toCard(data, region, { baseSku: base, ...extra });
}

export async function availability(base, sourceName, home, onRow) {
  const queue = REGIONS.map((r) => r.code);
  const worker = async () => {
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

      if (sourceName && code !== home) {
        const twin = await findTwin(base, home, code);
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
