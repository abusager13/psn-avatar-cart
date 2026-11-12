// Pure rules: input normalisation, SKU handling, EDAT parsing, index lookup.

const CLIENT_ID = '2eb25762-877f-4140-b341-7c7e14c19f98';
const CHECKOUT = 'https://checkout.playstation.com/add';

export const ERR = {
  BUFFER_TOO_SMALL: -1,
  TOO_SHORT: -2,
  BAD_MAGIC: -3,
  BAD_CONTENT_ID: -4,
  NO_INDEX: -5,
  NOT_FOUND: -6,
};

const ok = (value) => ({ ok: true, code: 0, value });
const fail = (code) => ({ ok: false, code, value: null });

/* ---------------------------------------------------------------- input */

// Cyrillic and Greek letters that render identically to ASCII ones. Hashes
// copied out of web pages or typed on a non-Latin layout pick these up, and a
// single one is enough to make a valid hash fail every format check.
const LOOKALIKE = {
  'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K',
  'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'У': 'Y', 'Х': 'X',
  'а': 'a', 'с': 'c', 'е': 'e', 'о': 'o', 'р': 'p', 'х': 'x', 'у': 'y',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I',
  'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T',
  'Υ': 'Y', 'Χ': 'X',
};

const foldLookalike = (ch) => LOOKALIKE[ch] || ch;

function normalizeInput(raw) {
  const text = String(raw ?? '').trim().toUpperCase();
  let s = text.replace(/PSNA_/g, '').replace(/\.EDAT/g, '');

  // Pasted hashes often carry invisible characters (zero-width spaces, BOMs,
  // non-breaking spaces) that trim() does not remove. A hash or SKU is only
  // ever ASCII alphanumerics, dashes and underscores, so drop everything else.
  const cleaned = [...s]
    .map(foldLookalike)
    .filter((c) => /[A-Za-z0-9_-]/.test(c))
    .join('');

  // A PSNA hash is 40 hex characters. If that is what we are looking at, a
  // letter O/I/L where the hash needs 0/1 is a reader's transcription slip,
  // not a different product, so repair it. Safe: only applies at length 40.
  if (cleaned.length === 40) {
    const repaired = cleaned.replace(/O/g, '0').replace(/[IL]/g, '1');
    if (/^[0-9A-F]+$/.test(repaired)) return ok(repaired);
  }

  return ok(cleaned.trim());
}

/** `UP1004-BLUS30418_00-AVARDRSHADOWWOLF-U099` -> `...` without `-U099`. */
function stripVariant(sku) {
  const s = String(sku ?? '').trim();
  const cut = s.lastIndexOf('-');
  if (cut > 0) {
    const tail = s.slice(cut + 1);
    if (tail.length === 4 && /^[A-Za-z][A-Za-z0-9]{3}$/.test(tail)) return ok(s.slice(0, cut));
  }
  return ok(s);
}

/** Which store a SKU belongs to, from its publisher prefix. */
function homeRegion(sku) {
  const s = String(sku ?? '').toUpperCase();
  const prefix = s.slice(0, 2);
  if (prefix === 'EP') return ok('GB');
  if (prefix === 'JP') return ok('JP');
  if (prefix === 'HP') return ok('HK');
  return ok('US');
}

/** Lower-case, drop trademark noise, reduce to single spaces for fuzzy matching. */
function normName(name) {
  const text = String(name ?? '').toLowerCase();
  let out = '';
  let space = false;
  for (const ch of text) {
    if (ch === '\u00ae' || ch === '\u2122' || ch === '\u00a9') continue;
    if (/[a-z0-9]/.test(ch)) {
      out += ch;
      space = false;
    } else if (!space && out.length) {
      out += ' ';
      space = true;
    }
  }
  return ok(out.replace(/ $/, ''));
}

/** Regional names differ, so containment in either direction counts. */
function namesMatch(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

/** The cart deep-link Sony's own store uses. */
function cartLink(sku) {
  return ok(`${CHECKOUT}/${String(sku ?? '').trim()}?clientId=${CLIENT_ID}`);
}

/* ---------------------------------------------------------------- EDAT */

/** A PSNA `.edat` stores its content ID in plaintext at offset 0x10. */
function decodeEdat(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (data.length < 64) return fail(ERR.TOO_SHORT);
  if (data[0] !== 0x4e || data[1] !== 0x50 || data[2] !== 0x44 || data[3] !== 0x00) {
    return fail(ERR.BAD_MAGIC);
  }
  let end = 16;
  while (end < 64 && data[end] !== 0) end += 1;
  const cid = new TextDecoder('latin1').decode(data.subarray(16, end)).trim();
  if (!validContentId(cid)) return fail(ERR.BAD_CONTENT_ID);
  return ok(cid);
}

function validContentId(cid) {
  if (cid.length < 14) return false;
  if (!/^[A-Z]{2}\d{4}-/.test(cid)) return false;           // XX1234-
  const rest = cid.slice(7);
  const m = rest.match(/^([A-Z0-9]{4,})(.*)$/);              // TITLEID
  if (!m) return false;
  const after = m[2];
  if (!after.startsWith('_')) return false;                  // _NN-
  return /^\d{2}-/.test(after.slice(1));
}

/* ---------------------------------------------------------------- index */

let index = null;

/** Parse the `hash<TAB>game<TAB>sku` table once; returns the row count. */
function buildIndex(tsv) {
  const map = new Map();
  const lines = String(tsv ?? '').split('\n');
  for (let i = 1; i < lines.length; i += 1) {
    const fields = lines[i].split('\t');
    if (fields.length < 3) continue;
    const hash = (fields[0] || '').trim();
    const sku = (fields[2] || '').trim();
    if (hash && sku) map.set(hash.toUpperCase(), sku);
  }
  index = map;
  return map.size;
}

function lookup(hash) {
  if (!index) return fail(ERR.NO_INDEX);
  const key = String(hash ?? '').trim().toUpperCase();
  const sku = index.get(key);
  return sku ? ok(sku) : fail(ERR.NOT_FOUND);
}

/* ---------------------------------------------------------------- api */

export const core = {
  ready: () => true,
  normalizeInput,
  stripVariant,
  homeRegion,
  normName,
  namesMatch,
  cartLink,
  decodeEdat,
  buildIndex,
  lookup,
};
