#!/usr/bin/env node
// Refresh catalogue health: is each SKU still purchasable, and at what price?
//
// Reads the per-SKU catalogue, checks one store per SKU (the first region that
// carried it), and writes site/data/catalog-health.tsv. Delistings are the thing
// worth catching: the PS3 stores close in 2027 and items vanish before that.
//
//   node tools/refresh.mjs            # everything
//   LIMIT=50 node tools/refresh.mjs   # sample, for testing
//
// No dependencies: Node's https module only, so it runs in Actions untouched.

import { readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';

const CATALOG = 'site/data/browse-catalog.tsv';
const OUT = 'site/data/catalog-health.tsv';
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const LIMIT = Number(process.env.LIMIT || 0);
const TIMEOUT = 20000;

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'psn-avatar-cart/1.0 (+https://abusager13.github.io/psn-avatar-cart/)',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      timeout: TIMEOUT,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), redirects + 1));
        return;
      }
      if (res.statusCode === 429 || res.statusCode >= 500) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      resolve({ status: res.statusCode, res });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function readJson(url, attempt = 0) {
  try {
    const { status, res } = await get(url);
    if (status === 404) { res.resume(); return null; }
    let raw = '';
    for await (const chunk of res) raw += chunk;
    if (res.headers['content-encoding'] === 'gzip') raw = await gunzip(raw);
    return JSON.parse(raw);
  } catch (error) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      return readJson(url, attempt + 1);
    }
    throw error;
  }
}

async function gunzip(raw) {
  const { gunzipSync } = await import('node:zlib');
  return gunzipSync(Buffer.from(raw, 'binary')).toString('utf8');
}

const container = (region, sku) =>
  `https://store.playstation.com/store/api/chihiro/00_09_000/container/${region}/en/19/${sku}/`;

async function loadRows() {
  const text = await readFile(CATALOG, 'utf8');
  const rows = [];
  for (const line of text.split('\n').slice(1)) {
    const [sku, name, , regions] = line.split('\t');
    if (!sku || !regions) continue;
    rows.push({ sku, name, regions: regions.split(' ') });
  }
  return LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
}

async function check(row) {
  for (const region of row.regions) {
    const data = await readJson(container(region, row.sku));
    if (data && data.name) {
      const price = (data.default_sku || {}).display_price || '';
      return { status: 'live', region, price };
    }
  }
  return { status: 'gone', region: row.regions[0], price: '' };
}

async function main() {
  const rows = await loadRows();
  const started = Date.now();
  const results = new Array(rows.length);
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < rows.length) {
      const i = next++;
      try {
        results[i] = { ...rows[i], ...(await check(rows[i])) };
      } catch (error) {
        results[i] = { ...rows[i], status: 'error', region: rows[i].regions[0], price: '' };
      }
      done += 1;
      if (done % 250 === 0) {
        const rate = done / ((Date.now() - started) / 1000);
        process.stdout.write(`  ${done}/${rows.length} (${rate.toFixed(1)}/s)\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const stamp = new Date().toISOString().slice(0, 10);
  const out = ['sku\tstatus\tregion\tprice\tchecked'];
  for (const r of results) out.push(`${r.sku}\t${r.status}\t${r.region}\t${r.price}\t${stamp}`);
  await writeFile(OUT, `${out.join('\n')}\n`);

  const gone = results.filter((r) => r.status === 'gone').length;
  const error = results.filter((r) => r.status === 'error').length;
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`checked ${results.length} in ${mins}m — live ${results.length - gone - error}, gone ${gone}, error ${error}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
