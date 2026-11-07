#!/usr/bin/env node
/**
 * edat-scan — turn a folder of PS3 avatar .edat files into a SKU table.
 *
 * A PSNA avatar file keeps its content ID in plaintext at offset 0x10, so the
 * store SKU can be recovered from the file alone. Point this at a folder (or at
 * a copy of /dev_hdd0/home/<userid>/psn_avatar/ pulled off a console over FTP)
 * and it writes a TSV you can merge into site/data/avatar-sku-index.tsv.
 *
 * Usage:
 *   node tools/edat-scan.mjs <dir> [--region US] [--out scan.tsv] [--no-lookup]
 *
 * Columns: hash, content_id, name, price, region, status
 *   status: live | delisted | unknown
 */

import fs from 'node:fs';
import path from 'node:path';

const CATALOG = 'https://store.playstation.com/store/api/chihiro/00_09_000/container';

// These stores answer only in their own language; /en/ returns 404 for items
// that are on sale.
const REGION_LANG = { JP: 'ja', DE: 'de', FR: 'fr', IT: 'it', ES: 'es', TR: 'tr', PL: 'pl', SE: 'sv' };

function parseArgs(argv) {
  const args = { dir: null, region: 'US', out: null, lookup: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--region') args.region = String(argv[++i] || 'US').toUpperCase();
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--no-lookup') args.lookup = false;
    else if (!args.dir) args.dir = a;
  }
  return args;
}

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (/\.edat$/i.test(entry.name)) found.push(full);
  }
  return found;
}

/** Content ID from the header: magic "NPD\0", then ASCII at 0x10..0x40. */
function decode(file) {
  const buf = Buffer.alloc(64);
  const fd = fs.openSync(file, 'r');
  try {
    const read = fs.readSync(fd, buf, 0, 64, 0);
    if (read < 64) return null;
  } finally {
    fs.closeSync(fd);
  }
  if (buf.subarray(0, 4).toString('latin1') !== 'NPD\u0000') return null;
  let end = 16;
  while (end < 64 && buf[end] !== 0) end += 1;
  const cid = buf.subarray(16, end).toString('latin1').trim();
  return /^[A-Z]{2}\d{4}-[A-Z0-9]{4,}_\d{2}-/.test(cid) ? cid : null;
}

function hashFromName(file) {
  const m = path.basename(file).match(/PSNA_([0-9A-Fa-f]{40})/i);
  return m ? m[1].toUpperCase() : '';
}

async function lookup(cid, region) {
  const base = cid.replace(/-[A-Z][A-Z0-9]{3}$/, '');
  const langs = [REGION_LANG[region], 'en'].filter((l, i, a) => l && a.indexOf(l) === i);
  let delisted = true;
  for (const lang of langs) {
    const url = `${CATALOG}/${region}/${lang}/19/${base}/`;
    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      return { status: 'unknown', name: '', price: '' };
    }
    if (res.status === 404) continue;
    if (!res.ok) return { status: 'unknown', name: '', price: '' };
    delisted = false;
    const data = await res.json();
    const sku = data.default_sku || {};
    return {
      status: 'live',
      name: data.name || '',
      price: sku.display_price || '',
    };
  }
  if (delisted) return { status: 'delisted', name: '', price: '' };
  return { status: 'unknown', name: '', price: '' };
}

const args = parseArgs(process.argv.slice(2));
if (!args.dir) {
  console.error('usage: node tools/edat-scan.mjs <dir> [--region US] [--out scan.tsv] [--no-lookup]');
  process.exit(2);
}
if (!fs.existsSync(args.dir)) {
  console.error(`no such directory: ${args.dir}`);
  process.exit(2);
}

const files = walk(args.dir);
console.log(`found ${files.length} .edat file(s) under ${args.dir}`);

const rows = [];
let skipped = 0;
for (const file of files) {
  const cid = decode(file);
  if (!cid) {
    skipped += 1;
    continue;
  }
  const hash = hashFromName(file);
  let meta = { status: args.lookup ? 'pending' : 'unknown', name: '', price: '' };
  if (args.lookup) {
    meta = await lookup(cid, args.region);
    process.stdout.write('.');
  }
  rows.push({ hash, cid, ...meta });
}
if (args.lookup) process.stdout.write('\n');

const outPath = args.out || `edat-scan-${args.region}.tsv`;
const header = 'hash\tcontent_id\tname\tprice\tregion\tstatus\n';
const body = rows
  .map((r) => [r.hash, r.cid, r.name, r.price, args.region, r.status].join('\t'))
  .join('\n');
fs.writeFileSync(outPath, header + body + (body ? '\n' : ''));

const live = rows.filter((r) => r.status === 'live').length;
console.log(`decoded : ${rows.length}`);
console.log(`skipped : ${skipped} (not a PSNA file / too short)`);
console.log(`live    : ${live}`);
console.log(`written : ${outPath}`);

if (rows.length) {
  console.log('\nfirst rows:');
  for (const r of rows.slice(0, 5)) {
    console.log(`  ${r.hash || '(no hash in name)'}  ${r.cid}  ${r.status}  ${r.name.slice(0, 40)}`);
  }
}
