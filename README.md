# PS3 Avatars

A web tool that turns a **PSNA hash**, a **PSN SKU**, or a **`.edat` file** into a working
PlayStation Store cart link — and shows you which store regions still sell it.

### → **https://abusager13.github.io/psn-avatar-cart/**

Static site. No install, no login, no backend.

![Result and regional availability](docs/result-us.png)

## What it does

- **Input** — a PSNA hash, a SKU, or a `.edat` file (the SKU is read out of its header).
- **Resolve** — live name, platform, price and artwork for the chosen store. If that SKU 404s, the
  same avatar exists as a *different product* elsewhere, so it finds the regional twin by name.
- **Availability** — probes all 14 tracked stores and streams the results, ending in either
  "still on sale in …" or a delisted verdict.
- **Cart** — `checkout.playstation.com/add/<SKU>` in a new tab. Sony's checkout, so you need a
  signed-in PlayStation session in that browser.
- **Extras** — permalinks (`?hash=…&region=…`), recent lookups kept in the browser, and a shutdown
  countdown per region from Sony's published schedule.

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
| **All known SKUs** | [`site/data/all-skus.txt`](site/data/all-skus.txt) — **30,234 unique**, the merged master list |
| Live catalogue | [`site/data/live-catalog.tsv`](site/data/live-catalog.tsv) — 103,737 rows across 14 stores, 28,341 distinct SKUs, **24,888 absent from the archive** |
| Deep US catalogue | [`site/data/live-us.tsv`](site/data/live-us.tsv) — 11,090 US avatars, **9,642 absent from the archive** |
| Delisted list | [`site/data/archive.tsv`](site/data/archive.tsv) — 1,913 hashes that resolve to a product ID but are sold in none of the 14 stores |
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

`avatar-names.tsv` comes from a community PS3 avatar table. Only `content_id`, `name` and `region` were
taken — no files, licence keys or download links. It fills the archive's real gap: a content ID with
no display name.

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

Homoarakhn and Orbitron, self-hosted. Terms: [`site/fonts/FONT-LICENSES.md`](site/fonts/FONT-LICENSES.md).

## Legal

Unofficial fan tool. Not affiliated with, endorsed by, or sponsored by Sony Interactive
Entertainment. PlayStation and PSN are trademarks of Sony Interactive Entertainment LLC.

Source available — all rights reserved. No open-source license is granted; the bundled index is
derived from a third-party archive and is not the author's to license.
