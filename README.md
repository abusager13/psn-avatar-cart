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
- **Availability** — probes all 14 tracked stores, ending in either "still on sale in …" or a
  delisted verdict.
- **Cart** — `checkout.playstation.com/add/<SKU>` in a new tab. Sony's checkout, so you need a
  signed-in PlayStation session in that browser.
- **Extras** — permalinks (`?hash=…&region=…`), recent lookups kept in the browser, and a shutdown
  countdown per region from Sony's published schedule.

## Architecture

```
core/     Rust crate: SKU rules, EDAT header parsing, index lookup, name matching
          → 55 KB WebAssembly module, no wasm-bindgen
site/     the product: HTML, CSS, ES modules, data/
docs/     screenshots
.github/  Pages deploy (builds the core, then publishes site/)
```

```bash
rustup target add wasm32-unknown-unknown
./core/build.sh                      # → site/wasm/psn_core.wasm
python3 -m http.server -d site 8731
```

Pushing to `main` builds the core and publishes `site/` to Pages.

## Data

<!-- data:start -->
| File | Contents |
|---|---|
| `avatar-sku-index.tsv` | 5,350 hashes → SKUs, read out of `.edat` headers |
| `all-skus.txt` | 30,527 unique SKUs — the master list |
| `live-catalog.tsv` | 103,871 listings across 14 stores, 28,475 distinct SKUs, 25,180 absent from the archive |
| `archive.tsv` | 1,902 hashes that resolve but are sold in no store |
| `avatar-names.tsv` | 1,365 display names, 924 of them new to the archive |
<!-- data:end -->

## No backend

Sony's legacy catalog endpoint sends `Access-Control-Allow-Origin: *`, so the browser queries it
directly — no proxy, no serverless function, no precomputed prices. The cart `clientId` is Sony's
public first-party OAuth identifier, visible in their own page source; not a secret, not ours.

## Limitations

- The bundled index only covers the archived collection; unknown hashes need **Open .edat…**.
- Region matters: `EP*` SKUs are European, `UP*` are SCEA/US. A US account cannot buy an `EP` item.
- JP, DE, FR, IT and ES answer only in their own language; the site asks each store natively first.
- Twin matching is heuristic (name containment + `avatar` category). Japanese titles often have
  unrelated regional names, so no match will be found there.
- The cart only fills if the browser has a signed-in store session for that region.

## Attribution

The index was derived from [lI-Isekai-Il/PS3-Avatars-Edat](https://github.com/lI-Isekai-Il/PS3-Avatars-Edat)
by reading the content ID out of each EDAT header — product identifiers and game names only, no
Sony assets. `avatar-names.tsv` comes from a community avatar table; only `content_id`, `name` and
`region` were taken, never files or licence keys. Artwork is fetched from Sony's CDN at runtime.

## Scanning a console dump

```bash
node tools/edat-scan.mjs ./psn_avatar --region US --out scan.tsv
```

`tools/edat-scan.mjs` walks a folder of PSNA `.edat` files and writes
`hash · content_id · name · price · region · status`. On a console every avatar you own lives in
`/dev_hdd0/home/<userid>/psn_avatar/` — copy that folder off and scan it.

## Fonts

Homoarakhn and Orbitron, self-hosted. Terms: [`site/fonts/FONT-LICENSES.md`](site/fonts/FONT-LICENSES.md).

## Legal

Unofficial fan tool. Not affiliated with, endorsed by, or sponsored by Sony Interactive
Entertainment. PlayStation and PSN are trademarks of Sony Interactive Entertainment LLC.

Source available — all rights reserved. No open-source license is granted; the bundled index is
derived from a third-party archive and is not the author's to license.
