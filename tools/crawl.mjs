#!/usr/bin/env node
/**
 * crawl — refresh one or more regional catalogues.
 *
 * Sony's search returns at most ~1,000 rows per query, so a keyword sweep only
 * exposes a few hundred avatars. The way through is vocabulary: every word in
 * the names we already have becomes a query, and the round repeats on the names
 * the previous round found, until it stops finding anything new.
 *
 *   node tools/crawl.mjs                     # every region, 2 rounds
 *   node tools/crawl.mjs --regions GB,JP     # just those
 *   node tools/crawl.mjs --rounds 3 --workers 8
 *
 * Writes the region's rows into site/data/live-catalog.tsv, then run
 * `node tools/build-data.mjs` to regenerate the derived files.
 */

import { readFile, writeFile } from 'node:fs/promises';

const ARGS = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : fallback;
};

const REGIONS = arg('regions', 'US,GB,CA,IE,DE,FR,IT,ES,PL,SE,TR,AU,ZA,JP').split(',').map((r) => r.trim().toUpperCase());
const ROUNDS = Number(arg('rounds', 2));
const WORKERS = Number(arg('workers', 10));
const PAGES = Number(arg('pages', 50));      // 50 × 20 = the 1,000-row cap
const LIMIT = Number(arg('limit', 0));       // cap the seed, for a smoke test
const DRY = ARGS.includes('--dry');          // crawl but do not write
const STORE = 'site/data/live-catalog.tsv';

// These stores answer only in their own language; /en/ returns nothing.
const LANG = { JP: 'ja', DE: 'de', FR: 'fr', IT: 'it', ES: 'es', TR: 'tr', PL: 'pl', SE: 'sv' };

const SEARCH = 'https://commerce1.api.np.km.playstation.net/store/api/chihiro/00_09_000/search';

function tokens(names) {
  const stop = new Set('avatar avatars the a an of and for with pack bundle set collection ps3 ps4 ps5'.split(' '));
  const counts = new Map();
  for (const name of names) {
    const words = name.toLowerCase().match(/[a-z]{4,}|[\u3041-\u3096\u30a1-\u30fa\u4e00-\u9fff\u30fc]{2,}/g) || [];
    for (const w of words) {
      if (!stop.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
}

async function loadRows() {
  const text = await readFile(STORE, 'utf8');
  return text.split('\n').slice(1).filter(Boolean).map((line) => {
    const parts = line.split('\t');
    if (parts.length === 4) return parts;
    // A row with extra fields means a tab slipped into a name or price; put the
    // pieces back where they belong rather than writing it straight back out.
    const [sku = '', name = '', ...rest] = parts;
    const price = rest.find((x) => /^(Free|[$£€])/.test(x)) || '';
    const region = rest.find((x) => /^[A-Z]{2}$/.test(x)) || '';
    return [sku, name, price, region];
  });
}

async function search(region, lang, term, start) {
  const url = `${SEARCH}/${region}/${lang}/19/${encodeURIComponent(term)}`
    + `?top_category=avatar&start=${start}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'ps3-avatars/1.0', Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (attempt === 2) return {};
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  return {};
}

async function crawlRegion(region, seedNames) {
  const lang = LANG[region] || 'en';
  const found = new Map();
  const done = new Set();
  let vocabulary = tokens(seedNames);

  for (let round = 1; round <= ROUNDS; round += 1) {
    const todo = vocabulary.filter((w) => !done.has(w));
    if (!todo.length) break;
    const before = found.size;
    let cursor = 0;
    let finished = 0;
    const startedAt = Date.now();
    console.log(`  ${region} round ${round}: ${todo.length} terms queued`);

    const worker = async () => {
      while (cursor < todo.length) {
        const term = todo[cursor++];
        for (let start = 0; start < PAGES * 20; start += 20) {
          const data = await search(region, lang, term, start);
          const items = (data.links || []).filter((i) => i.top_category === 'avatar' && i.id);
          for (const item of items) {
            if (!found.has(item.id)) {
              found.set(item.id, {
                name: item.name || '',
                price: (item.default_sku || {}).display_price || '',
              });
            }
          }
          // a short page means the query is exhausted; stop paging it
          if (items.length < 20) break;
        }

        // Heartbeat: without this a long round looks like a hang, because the
        // round total is only printed once everything is done.
        finished += 1;
        if (finished % 50 === 0) {
          const secs = (Date.now() - startedAt) / 1000;
          const rate = (finished / secs).toFixed(1);
          const eta = Math.round((todo.length - finished) / Math.max(finished / secs, 0.01) / 60);
          console.log(`    ${region} r${round}: ${finished}/${todo.length} terms, +${found.size - before} new, ${rate}/s, ~${eta}m left`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(WORKERS, todo.length) }, worker));
    todo.forEach((w) => done.add(w));

    const added = found.size - before;
    console.log(`  ${region} round ${round}: ${todo.length} terms, +${added}, total ${found.size}`);
    if (added < 40) break;
    vocabulary = tokens([...found.values()].map((v) => v.name));
  }

  return found;
}

async function main() {
  const rows = await loadRows();
  const usVocabulary = tokens(rows.filter((r) => r[3] === 'US').map((r) => r[1]));

  for (const region of REGIONS) {
    const local = rows.filter((r) => r[3] === region).map((r) => r[1]);
    const seed = local.length >= 200 ? local : [...local, ...usVocabulary.slice(0, 900)];
    console.log(`${region}: seeding ${seed.length} ${LANG[region] ? `names (${LANG[region]})` : 'names'}`);

    const found = await crawlRegion(region, LIMIT ? seed.slice(0, LIMIT) : seed);
    const known = new Set(rows.filter((r) => r[3] === region).map((r) => r[0]));
    const fresh = [...found.keys()].filter((sku) => !known.has(sku));
    console.log(`${region}: ${found.size} listings found, ${fresh.length} of them NEW`);
    if (DRY) {
      console.log(`${region}: dry run, nothing written`);
      continue;
    }

    // Union, not replace: a crawl must never delete a row it did not re-find.
    const keep = rows.filter((r) => r[3] !== region);
    const merged = new Map(rows.filter((r) => r[3] === region).map((r) => [r[0], r]));
    for (const [sku, v] of found) merged.set(sku, [sku, v.name, v.price, region]);

    await writeFile(STORE, 'sku\tname\tprice\tregion\tin_archive\n'
      + [...keep, ...merged.values()].map((r) => r.slice(0, 4).join('\t') + '\t' + (r[4] || 'no')).join('\n') + '\n');
    console.log(`${region}: ${merged.size} listings on file (${found.size} seen this run)`);
  }

  console.log('\nnow run: node tools/build-data.mjs');
}

main().catch((error) => { console.error(error); process.exit(1); });
