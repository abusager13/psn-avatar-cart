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
site/     the product: HTML, ES modules, data/
  js/core.js    SKU rules, EDAT header parsing, index lookup, name matching
  js/*.js       network, rendering, page wiring
  css/input.css Tailwind source (daisyUI theme lives in tailwind.config.js)
  styles.css    build output — do not edit by hand
tools/    data pipeline: crawl.mjs, build-data.mjs, edat-scan.mjs
docs/     screenshots
.github/  Pages deploy (builds CSS, then publishes site/)
```

UI is Tailwind + daisyUI on a black theme. Build the stylesheet, then serve:

```bash
npm install
npm run css                          # → site/styles.css
python3 -m http.server -d site 8731
```

Pushing to `main` builds the CSS and publishes `site/` to Pages.

## Talking to Sony

The store sends `cache-control: max-age=300`, so every catalogue answer — including
"not sold here" — is cached for five minutes, kept in `sessionStorage` so it survives
navigation and reload, and never requested twice concurrently. A repeated lookup costs
zero requests. The site backs off on `429`/`503` using `Retry-After` with jitter instead
of retrying into the limit, caps the availability scan at four parallel workers, and
staggers them so the fourteen probes don't travel in lockstep.

One speculative request is allowed: when the input already looks like a product ID and
the user pauses for 600 ms, the selected store's record is fetched so Resolve draws from
cache (85 ms to card instead of 277 ms). It never prefetches the fourteen-store scan.

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
