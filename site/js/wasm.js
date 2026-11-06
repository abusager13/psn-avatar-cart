// Thin ABI layer over the Rust core (core/src/lib.rs).
// Strings cross as (ptr, len); results come back as length or negative code.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let wasm = null;

export const ERR = {
  BUFFER_TOO_SMALL: -1,
  TOO_SHORT: -2,
  BAD_MAGIC: -3,
  BAD_CONTENT_ID: -4,
  NO_INDEX: -5,
  NOT_FOUND: -6,
};

export async function initCore(path = 'wasm/psn_core.wasm') {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`core: HTTP ${response.status} for ${path}`);

  let instance;
  if (WebAssembly.instantiateStreaming) {
    try {
      ({ instance } = await WebAssembly.instantiateStreaming(response.clone(), {}));
    } catch {
      instance = null;
    }
  }
  if (!instance) {
    const bytes = await response.arrayBuffer();
    ({ instance } = await WebAssembly.instantiate(bytes, {}));
  }
  wasm = instance.exports;
  return wasm;
}

function pushString(value) {
  const bytes = encoder.encode(value);
  const ptr = wasm.alloc(bytes.length || 1);
  new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

function callString(fn, value, capacity = 8192) {
  const { ptr, len } = pushString(value);
  const outPtr = wasm.alloc(capacity);
  let code;
  try {
    code = fn(ptr, len, outPtr, capacity);
  } finally {
    wasm.dealloc(ptr, len || 1);
  }
  const result = code >= 0
    ? decoder.decode(new Uint8Array(wasm.memory.buffer, outPtr, code))
    : null;
  wasm.dealloc(outPtr, capacity);
  return { ok: code >= 0, code, value: result };
}

function callBytes(fn, bytes, capacity = 8192) {
  const ptr = wasm.alloc(bytes.length || 1);
  new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
  const outPtr = wasm.alloc(capacity);
  let code;
  try {
    code = fn(ptr, bytes.length, outPtr, capacity);
  } finally {
    wasm.dealloc(ptr, bytes.length || 1);
  }
  const result = code >= 0
    ? decoder.decode(new Uint8Array(wasm.memory.buffer, outPtr, code))
    : null;
  wasm.dealloc(outPtr, capacity);
  return { ok: code >= 0, code, value: result };
}

export const core = {
  ready: () => wasm !== null,
  normalizeInput: (s) => callString(wasm.normalize_input, s),
  stripVariant: (s) => callString(wasm.strip_variant, s),
  homeRegion: (s) => callString(wasm.home_region, s),
  normName: (s) => callString(wasm.norm_name, s),
  cartLink: (s) => callString(wasm.cart_link, s),
  decodeEdat: (bytes) => callBytes(wasm.decode_edat, bytes),
  buildIndex: (tsv) => {
    const { ptr, len } = pushString(tsv);
    try {
      return wasm.index_build(ptr, len);
    } finally {
      wasm.dealloc(ptr, len || 1);
    }
  },
  lookup: (hash) => callString(wasm.index_lookup, hash, 256),
  namesMatch: (a, b) => {
    const x = pushString(a);
    const y = pushString(b);
    try {
      return wasm.names_match(x.ptr, x.len, y.ptr, y.len) === 1;
    } finally {
      wasm.dealloc(x.ptr, x.len || 1);
      wasm.dealloc(y.ptr, y.len || 1);
    }
  },
};
