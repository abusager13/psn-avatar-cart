# PSN Avatar Cart

A web tool that turns a **PSNA hash**, a **PSN SKU**, or a **`.edat` file** into a working
PlayStation Store cart link — and shows you which store regions still sell it.

### → **https://abusager13.github.io/psn-avatar-cart/**

Static site. No install, no login, no backend.

![Result and regional availability](docs/result-us.png)

## What it does

1. **Input** — paste a 40-character PSNA hash, a full SKU like
   `UP1004-BLUS30418_00-AVARDRSHADOWWOLF`, or open a `.edat` file (the SKU is read out of its header).
2. **Resolve** — live catalog lookup for the selected store region: name, platform, price, artwork.
3. **Regional twin** — the same avatar is a *different product* in each region. If the SKU 404s, the
   site finds its home store, reads the name there, and matches it in the store you picked.
4. **Where it's still sold** — probes all 14 tracked stores and streams the results into a table,
   marking name-matched twins separately from the same product ID.
5. **Cart** — builds `checkout.playstation.com/add/<SKU>?clientId=…` and opens it in a new tab.
6. **Shareable** — every lookup becomes a permalink (`?hash=…&region=…`) and recent lookups are
   kept in this browser only.
7. **Shutdown countdown** — a live timer for the selected store plus a "closes …" line per region,
   from Sony's published schedule ([PlayStation.Blog, 1 Jul 2026](https://blog.playstation.com/2026/07/01/an-update-on-playstation-store-for-ps3-and-ps-vita/)):
   Mexico/Honduras/Nicaragua August 2026, other LatAm and Middle East late 2026, everywhere else
   July 2027. Only month-level dates were announced, so the timer is an upper bound.

Nothing is purchased here. There is no login, no storage on a server, and no server.

## Architecture

```
core/     Rust crate: SKU rules, EDAT header parsing, index lookup, name matching
          → compiled to a 55 KB WebAssembly module (no wasm-bindgen, plain C ABI)
site/     the product: index.html, styles.css, js/ (module ES), data/avatar-sku-index.tsv
docs/     screenshots
.github/  Pages deploy (builds the Rust core, then publishes site/)
```

The split is deliberate: **string and byte rules live in Rust**, where they can be unit-tested and
where a panic is a compile error rather than a silent `undefined`. Network and DOM stay in JS,
because that is what the browser is for.

`core/src/lib.rs` has no dependencies — not even wasm-bindgen — so the module is a plain
`extern "C"` ABI and CI needs nothing beyond `rustup target add wasm32-unknown-unknown`.

## Build

```bash
rustup target add wasm32-unknown-unknown
./core/build.sh          # → site/wasm/psn_core.wasm
python3 -m http.server -d site 8731
```

Deployment is automatic: pushing to `main` builds the core and publishes `site/` to Pages.

## Why a static site works

Sony's legacy catalog endpoint sends `Access-Control-Allow-Origin: *`, so the browser queries it
directly — no proxy, no serverless function, no precomputed prices:

```
GET store.playstation.com/store/api/chihiro/00_09_000/container/{REGION}/en/19/{SKU}/
→ access-control-allow-origin: *
```

| Step | Source |
|---|---|
| Catalog lookup | `store.playstation.com/store/api/chihiro/…` |
| Name search | `commerce1.api.np.km.playstation.net/store/api/chihiro/…/search/…` |
| Cart link | `checkout.playstation.com/add/{SKU}?clientId=…` |
| Hash → SKU | [`site/data/avatar-sku-index.tsv`](site/data/avatar-sku-index.tsv) — 5,350 resolvable hashes. Mostly read from `.edat` files, plus any mapping confirmed by hand |
| Archive SKUs | [`site/data/avatar-skus.txt`](site/data/avatar-skus.txt), 5,346 unique |
| **All known SKUs** | [`site/data/all-skus.txt`](site/data/all-skus.txt) — **28,733 unique**, the merged master list |
| Live catalogue | [`site/data/live-catalog.tsv`](site/data/live-catalog.tsv) — 101,831 rows across 14 stores, 26,435 distinct SKUs, **23,386 absent from the archive** |
| Deep US catalogue | [`site/data/live-us.tsv`](site/data/live-us.tsv) — 11,090 US avatars, **9,642 absent from the archive** |
| Archive view | [`site/data/archive.tsv`](site/data/archive.tsv) — 5,375 resolved hashes with game, avatar name where known, and live/delisted status |
| Avatar names | [`site/data/avatar-names.tsv`](site/data/avatar-names.tsv) — 1,365 names for delisted/archived SKUs, 934 of which the archive had no name for |

The `clientId` is Sony's public first-party OAuth client identifier, visible in their own store page
source. It is not a secret, and not ours.

## Limitations

- The bundled index only covers the archived collection; unknown hashes need **Open .edat…**.
- Region matters: `EP*` SKUs are European, `UP*` are SCEA/US. A US account cannot buy an `EP` item.
- Delisted items return `DataNotFound` everywhere and cannot be carted.
- Twin matching is heuristic (name containment + `avatar` category). Japanese titles especially
  often have unrelated regional names, so no match will be found there.
- The cart only fills if the browser you open it in has a signed-in store session for that region.

## A note on one imported list

`avatar-names.tsv` was derived from a community PS3 avatar table that also carried **RAP licence keys**
and **direct PKG download links** — i.e. a piracy index. Only `content_id`, `name` and `region` were
imported. The keys and download links were not read into this project, are not stored anywhere in it,
and nothing here can install content without a purchase.

The names matter because they fill the archive's real gap: it records a content ID per file but never
a display name, so a delisted avatar previously resolved to a SKU with no identity. 934 archive SKUs
now have one.

## Attribution

`site/data/avatar-sku-index.tsv` was derived from
[lI-Isekai-Il/PS3-Avatars-Edat](https://github.com/lI-Isekai-Il/PS3-Avatars-Edat) by reading the
content ID out of each EDAT header. It contains product identifiers and game names only — no
artwork, no avatar images, no Sony assets. Artwork in the UI is fetched from Sony's CDN at runtime
and never bundled or proxied.

## Bulk scanning a console dump

`tools/edat-scan.mjs` walks a folder of PSNA `.edat` files, reads the content ID out of each header,
and writes a TSV you can merge into the index. Works on any `.edat`, not just archived ones.

```bash
node tools/edat-scan.mjs ./psn_avatar --region US --out scan.tsv
```

On a console, every avatar you own lives in `/dev_hdd0/home/<userid>/psn_avatar/` as
`PSNA_<hash>.edat` — copy that folder off (FTP/homebrew) and scan it. Output columns:
`hash · content_id · name · price · region · status`, where status is `live`, `delisted` or `unknown`.

## Fonts

- **Homoarakhn** (Dan Zadorozny / Iconian Fonts) — the title face. Iconian's terms allow free
  **non-commercial** use; commercial use is $20/seat with written consent. This site is a free fan
  tool with no ads or payments. If that changes, the font must be licensed or removed first.
- **Orbitron** (SIL OFL 1.1) — fallback title face, shipped with its licence.

Both are self-hosted; nothing is loaded from a third-party font CDN. Full terms in
[`site/fonts/FONT-LICENSES.md`](site/fonts/FONT-LICENSES.md).

## Legal

Unofficial fan tool. Not affiliated with, endorsed by, or sponsored by Sony Interactive
Entertainment. PlayStation and PSN are trademarks of Sony Interactive Entertainment LLC.

Source available — all rights reserved. No open-source license is granted; the bundled index is
derived from a third-party archive and is not the author's to license.
