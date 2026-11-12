#!/usr/bin/env node
/**
 * build-data — regenerate every derived data file from the two sources we keep.
 *
 * Sources (edited by hand or by tools/crawl.mjs):
 *   site/data/live-catalog.tsv     one row per (SKU, region) listing
 *   site/data/avatar-sku-index.tsv hash → SKU, read out of .edat headers
 *   site/data/avatar-names.tsv     content ID → display name
 *
 * Derived (written here, never edited by hand):
 *   site/data/browse-catalog.tsv   one row per SKU, regions collapsed
 *   site/data/all-skus.txt         union of everything
 *   site/data/archive.tsv          hashes that are sold in no store
 *   README data table              counts, so they cannot drift
 *
 *   node tools/build-data.mjs          # rebuild
 *   node tools/build-data.mjs --check  # fail if anything is stale
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const D = 'site/data/';
const CHECK = process.argv.includes('--check');

const read = async (file) => (existsSync(file) ? readFile(file, 'utf8') : '');

function rows(text, expected, file) {
  const lines = text.split('\n').slice(1).filter(Boolean);
  const bad = lines.filter((l) => l.split('\t').length !== expected);
  if (bad.length) {
    console.warn(`warning: ${bad.length} malformed row(s) in ${file} — first: ${bad[0].slice(0, 90)}`);
  }
  return lines.map((line) => line.split('\t'));
}

async function load() {
  const live = rows(await read(`${D}live-catalog.tsv`), 5, 'live-catalog.tsv')
    .filter((r) => r[0] && r[3])
    .map(([sku, name, price, region]) => ({ sku, name, price, region }));

  const index = rows(await read(`${D}avatar-sku-index.tsv`), 3, 'avatar-sku-index.tsv')
    .filter((r) => r[0] && r[2])
    .map(([hash, game, sku]) => ({ hash, game, sku }));

  const names = new Map(rows(await read(`${D}avatar-names.tsv`), 3, 'avatar-names.tsv')
    .filter((r) => r[0])
    .map(([sku, name]) => [sku, name]));

  return { live, index, names };
}

function build({ live, index, names }) {
  const archiveSkus = new Set(index.map((r) => r.sku));
  const liveSkus = new Set(live.map((r) => r.sku));

  // live-catalog: recompute the archive flag, keep region grouping
  const catalog = live
    .map((r) => ({ ...r, inArchive: archiveSkus.has(r.sku) ? 'yes' : 'no' }))
    .sort((a, b) => (a.region < b.region ? -1 : a.region > b.region ? 1 : a.name.localeCompare(b.name)));

  // browse-catalog: one row per SKU
  const bySku = new Map();
  for (const r of catalog) {
    if (!bySku.has(r.sku)) bySku.set(r.sku, { name: r.name, price: r.price, regions: [] });
    bySku.get(r.sku).regions.push(r.region);
  }

  const allSkus = [...new Set([...archiveSkus, ...liveSkus, ...names.keys()])].sort();

  // archive: every resolvable hash whose SKU is sold nowhere
  const archive = index
    .filter((r) => !liveSkus.has(r.sku))
    .map((r) => ({ ...r, name: names.get(r.sku) || '' }))
    .sort((a, b) => a.game.localeCompare(b.game) || a.name.localeCompare(b.name) || a.hash.localeCompare(b.hash));

  const hashes = new Set(index.map((r) => r.hash));
  const stats = {
    hashes: hashes.size,
    allSkus: allSkus.length,
    listings: catalog.length,
    liveSkus: liveSkus.size,
    beyondArchive: allSkus.filter((s) => !archiveSkus.has(s)).length,
    delisted: archive.length,
    named: names.size,
    namedNew: [...names.keys()].filter((s) => archiveSkus.has(s)).length,
    stores: new Set(catalog.map((r) => r.region)).size,
  };

  const files = {
    [`${D}live-catalog.tsv`]: 'sku\tname\tprice\tregion\tin_archive\n'
      + catalog.map((r) => `${r.sku}\t${r.name}\t${r.price}\t${r.region}\t${r.inArchive}`).join('\n') + '\n',
    [`${D}browse-catalog.tsv`]: 'sku\tname\tprice\tregions\n'
      + [...bySku].map(([sku, v]) => `${sku}\t${v.name}\t${v.price}\t${v.regions.join(' ')}`).join('\n') + '\n',
    [`${D}all-skus.txt`]: allSkus.join('\n') + '\n',
    [`${D}archive.tsv`]: 'hash\tsku\tgame\tname\n'
      + archive.map((r) => `${r.hash}\t${r.sku}\t${r.game}\t${r.name}`).join('\n') + '\n',
  };

  return { files, stats };
}

async function main() {
  const data = await load();
  const { files, stats } = build(data);

  let stale = 0;
  for (const [path, content] of Object.entries(files)) {
    const current = await read(path);
    if (current !== content) {
      stale += 1;
      if (!CHECK) await writeFile(path, content);
    }
  }

  if (CHECK) {
    console.log(stale === 0 ? 'data is up to date' : `${stale} file(s) stale — run: node tools/build-data.mjs`);
    process.exit(stale === 0 ? 0 : 1);
  }

  console.log(`listings ${stats.listings.toLocaleString('en-US')} · SKUs ${stats.allSkus.toLocaleString('en-US')} · delisted ${stats.delisted.toLocaleString('en-US')} · ${stale} file(s) rewritten`);
}

main().catch((error) => { console.error(error); process.exit(1); });
