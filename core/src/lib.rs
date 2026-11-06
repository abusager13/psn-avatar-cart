//! Pure logic for PSN Avatar Cart, compiled to a dependency-free WebAssembly module.
//!
//! No wasm-bindgen: the ABI is plain `extern "C"`, so the site needs no build
//! tooling beyond `rustc`, and CI only has to add the wasm target.
//!
//! Conventions:
//!   * strings cross the boundary as (pointer, length) UTF-8
//!   * any function producing a string writes it into a caller-provided buffer
//!     and returns its length, or a negative error code
//!   * the JS side owns every allocation and frees it with `dealloc`

use std::collections::HashMap;
use std::sync::OnceLock;

const CLIENT_ID: &str = "2eb25762-877f-4140-b341-7c7e14c19f98";
const CHECKOUT: &str = "https://checkout.playstation.com/add";

/// Error codes returned across the ABI.
const ERR_BUFFER_TOO_SMALL: i32 = -1;
const ERR_TOO_SHORT: i32 = -2;
const ERR_BAD_MAGIC: i32 = -3;
const ERR_BAD_CONTENT_ID: i32 = -4;
const ERR_NO_INDEX: i32 = -5;
const ERR_NOT_FOUND: i32 = -6;

static INDEX: OnceLock<HashMap<String, String>> = OnceLock::new();

// ---------------------------------------------------------------- memory

#[unsafe(no_mangle)]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let mut buf = vec![0u8; size];
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` must come from `alloc` with the same `size`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, size: usize) {
    if !ptr.is_null() && size > 0 {
        drop(Vec::from_raw_parts(ptr, size, size));
    }
}

unsafe fn bytes<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(ptr, len)
    }
}

fn out(s: &str, dst: *mut u8, cap: usize) -> i32 {
    let b = s.as_bytes();
    if b.len() > cap {
        return ERR_BUFFER_TOO_SMALL;
    }
    unsafe { std::ptr::copy_nonoverlapping(b.as_ptr(), dst, b.len()) };
    b.len() as i32
}

// ---------------------------------------------------------------- input rules


/// Cyrillic and Greek letters that render identically to ASCII ones. Hashes
/// copied out of web pages or typed on a non-Latin layout pick these up, and a
/// single one is enough to make a valid hash fail every format check.
fn fold_lookalike(c: char) -> char {
    match c {
        'А' => 'A', 'В' => 'B', 'С' => 'C', 'Е' => 'E', 'Н' => 'H', 'К' => 'K',
        'М' => 'M', 'О' => 'O', 'Р' => 'P', 'Т' => 'T', 'У' => 'Y', 'Х' => 'X',
        'а' => 'a', 'с' => 'c', 'е' => 'e', 'о' => 'o', 'р' => 'p', 'х' => 'x', 'у' => 'y',
        'Α' => 'A', 'Β' => 'B', 'Ε' => 'E', 'Ζ' => 'Z', 'Η' => 'H', 'Ι' => 'I',
        'Κ' => 'K', 'Μ' => 'M', 'Ν' => 'N', 'Ο' => 'O', 'Ρ' => 'P', 'Τ' => 'T',
        'Υ' => 'Y', 'Χ' => 'X',
        other => other,
    }
}

/// Trim, upper-case, and drop the `PSNA_` / `.edat` decoration people paste in.
#[unsafe(no_mangle)]
pub extern "C" fn normalize_input(p: *const u8, l: usize, dst: *mut u8, cap: usize) -> i32 {
    let raw = unsafe { bytes(p, l) };
    let text = String::from_utf8_lossy(raw);
    let mut s = text.trim().to_uppercase();
    s = s.replace("PSNA_", "").replace(".EDAT", "");
    // Pasted hashes often carry invisible characters (zero-width spaces, BOMs,
    // non-breaking spaces) that trim() does not remove. A hash or SKU is only
    // ever ASCII alphanumerics, dashes and underscores, so drop everything else.
    let cleaned: String = s
        .chars()
        .map(fold_lookalike)
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();

    // A PSNA hash is 40 hex characters. If that is what we are looking at, a
    // letter O/I/L where the hash needs 0/1 is a reader's transcription slip,
    // not a different product, so repair it. Safe: only applies at length 40.
    if cleaned.len() == 40 {
        let repaired: String = cleaned
            .chars()
            .map(|c| match c {
                'O' => '0',
                'I' | 'L' => '1',
                other => other,
            })
            .collect();
        if repaired.chars().all(|c| c.is_ascii_hexdigit()) {
            return out(&repaired, dst, cap);
        }
    }

    out(cleaned.trim(), dst, cap)
}

/// `UP1004-BLUS30418_00-AVARDRSHADOWWOLF-U099` -> `...-U099` stripped.
#[unsafe(no_mangle)]
pub extern "C" fn strip_variant(p: *const u8, l: usize, dst: *mut u8, cap: usize) -> i32 {
    let raw = unsafe { bytes(p, l) };
    let sku = String::from_utf8_lossy(raw);
    let sku = sku.trim();

    if let Some((head, tail)) = sku.rsplit_once('-') {
        let first_ok = tail.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false);
        let rest_ok = tail.chars().all(|c| c.is_ascii_alphanumeric());
        if tail.len() == 4 && first_ok && rest_ok {
            return out(head, dst, cap);
        }
    }
    out(sku, dst, cap)
}

/// Which store a SKU belongs to, from its publisher prefix.
#[unsafe(no_mangle)]
pub extern "C" fn home_region(p: *const u8, l: usize, dst: *mut u8, cap: usize) -> i32 {
    let raw = unsafe { bytes(p, l) };
    let sku = String::from_utf8_lossy(raw).to_uppercase();
    let region = match sku.get(0..2) {
        Some("EP") => "GB",
        Some("JP") => "JP",
        Some("HP") => "HK",
        _ => "US",
    };
    out(region, dst, cap)
}

/// Lower-case, drop trademark noise, and reduce to single spaces for fuzzy matching.
#[unsafe(no_mangle)]
pub extern "C" fn norm_name(p: *const u8, l: usize, dst: *mut u8, cap: usize) -> i32 {
    let raw = unsafe { bytes(p, l) };
    let text = String::from_utf8_lossy(raw).to_lowercase();
    let mut s = String::with_capacity(text.len());
    let mut space = false;
    for ch in text.chars() {
        if ch == '\u{ae}' || ch == '\u{2122}' || ch == '\u{a9}' {
            continue;
        }
        if ch.is_ascii_alphanumeric() {
            s.push(ch);
            space = false;
        } else if !space && !s.is_empty() {
            s.push(' ');
            space = true;
        }
    }
    out(s.trim_end(), dst, cap)
}

/// Regional names differ ("Franklin 3 Avatar" vs "Grand Theft Auto V Franklin 3
/// Avatar"), so containment in either direction counts as a match.
#[unsafe(no_mangle)]
pub extern "C" fn names_match(ap: *const u8, al: usize, bp: *const u8, bl: usize) -> i32 {
    let a = String::from_utf8_lossy(unsafe { bytes(ap, al) }).to_string();
    let b = String::from_utf8_lossy(unsafe { bytes(bp, bl) }).to_string();
    if a.is_empty() || b.is_empty() {
        return 0;
    }
    if a.contains(&b) || b.contains(&a) {
        1
    } else {
        0
    }
}

/// The cart deep-link Sony's own store uses.
#[unsafe(no_mangle)]
pub extern "C" fn cart_link(p: *const u8, l: usize, dst: *mut u8, cap: usize) -> i32 {
    let raw = unsafe { bytes(p, l) };
    let sku = String::from_utf8_lossy(raw);
    let link = format!("{CHECKOUT}/{}?clientId={CLIENT_ID}", sku.trim());
    out(&link, dst, cap)
}

// ---------------------------------------------------------------- EDAT

/// A PSNA `.edat` stores its content ID in plaintext at offset 0x10, so the file
/// alone recovers the store SKU.
#[unsafe(no_mangle)]
pub extern "C" fn decode_edat(p: *const u8, l: usize, dst: *mut u8, cap: usize) -> i32 {
    let data = unsafe { bytes(p, l) };
    if data.len() < 64 {
        return ERR_TOO_SHORT;
    }
    if &data[0..4] != b"NPD\0" {
        return ERR_BAD_MAGIC;
    }
    let mut end = 16;
    while end < 64 && data[end] != 0 {
        end += 1;
    }
    let cid = String::from_utf8_lossy(&data[16..end]).trim().to_string();
    if !valid_content_id(&cid) {
        return ERR_BAD_CONTENT_ID;
    }
    out(&cid, dst, cap)
}

fn valid_content_id(cid: &str) -> bool {
    let b = cid.as_bytes();
    if b.len() < 14 {
        return false;
    }
    // XX1234-
    if !b[0].is_ascii_uppercase() || !b[1].is_ascii_uppercase() {
        return false;
    }
    if !b[2..6].iter().all(|c| c.is_ascii_digit()) || b[6] != b'-' {
        return false;
    }
    let mut i = 7;
    let start = i;
    while i < b.len() && (b[i].is_ascii_uppercase() || b[i].is_ascii_digit()) {
        i += 1;
    }
    if i - start < 4 || i >= b.len() || b[i] != b'_' {
        return false;
    }
    // _NN-
    i + 1 + 2 < b.len() && b[i + 1].is_ascii_digit() && b[i + 2].is_ascii_digit() && b[i + 3] == b'-'
}

// ---------------------------------------------------------------- index

/// Parse the `hash<TAB>game<TAB>sku` table once; returns the row count.
#[unsafe(no_mangle)]
pub extern "C" fn index_build(p: *const u8, l: usize) -> i32 {
    let raw = unsafe { bytes(p, l) };
    let text = String::from_utf8_lossy(raw);
    let mut map: HashMap<String, String> = HashMap::new();
    for line in text.lines().skip(1) {
        let mut fields = line.split('\t');
        let (Some(hash), Some(_game), Some(sku)) = (fields.next(), fields.next(), fields.next()) else {
            continue;
        };
        let hash = hash.trim();
        let sku = sku.trim();
        if !hash.is_empty() && !sku.is_empty() {
            map.insert(hash.to_uppercase(), sku.to_string());
        }
    }
    let count = map.len() as i32;
    let _ = INDEX.set(map);
    count
}

#[unsafe(no_mangle)]
pub extern "C" fn index_lookup(hp: *const u8, hl: usize, dst: *mut u8, cap: usize) -> i32 {
    let hash = String::from_utf8_lossy(unsafe { bytes(hp, hl) }).trim().to_uppercase();
    let Some(map) = INDEX.get() else {
        return ERR_NO_INDEX;
    };
    match map.get(&hash) {
        Some(sku) => out(sku, dst, cap),
        None => ERR_NOT_FOUND,
    }
}
