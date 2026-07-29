# Self-hosted UI fonts

Every font the app renders is served from **this origin**. The bundle pulls
**zero third-party font origins** on any route — the entry document
(`index.html`), the front door, character select, the ceremony screen, and the
in-match HUD. This removes the render-blocking `fonts.googleapis.com/css2`
request plus two extra origins (`googleapis.com` + `gstatic.com`, each a DNS
lookup + TLS handshake) from the first screen a buyer sees, kills the
third-party FOUT, and makes the fonts work offline, on locked-down corporate
networks, and in regions where Google Fonts is blocked or throttled.

`Anton` renders the **"OPERATORS" wordmark** on the title card, so this is
brand-critical: before self-hosting, the product's own name depended on a
network request to a CDN we do not control.

## Shipped faces

| Family           | Face        | File                              | Bytes  | Glyphs | Licence     |
|------------------|-------------|-----------------------------------|--------|--------|-------------|
| Press Start 2P   | 400         | `PressStart2P-latin.woff2`        | 4,284  | 223    | SIL OFL 1.1 |
| VT323            | 400         | `VT323-latin.woff2`               | 6,656  | 222    | SIL OFL 1.1 |
| Anton            | 400         | `Anton-400-latin.woff2`           | 18,612 | 232    | SIL OFL 1.1 |
| Chakra Petch     | 400         | `ChakraPetch-400-latin.woff2`     | 9,756  | 228    | SIL OFL 1.1 |
| Chakra Petch     | 600         | `ChakraPetch-600-latin.woff2`     | 9,968  | 228    | SIL OFL 1.1 |
| Chakra Petch     | 700         | `ChakraPetch-700-latin.woff2`     | 9,900  | 228    | SIL OFL 1.1 |
| Oswald           | 400–700 var | `Oswald-var-latin.woff2`          | 21,472 | 226    | SIL OFL 1.1 |
| Saira            | 400         | `Saira-400-latin.woff2`           | 13,876 | 229    | SIL OFL 1.1 |
| Barlow Condensed | 600         | `BarlowCondensed-600-latin.woff2` | 22,308 | 227    | SIL OFL 1.1 |

**Total: 116,832 bytes across 7 files / 9 faces.** `@font-face` is declared once
in the bundled stylesheet (`src/index.css`) for the React app, and inline in the
standalone `public/hud.html` lab preview. Fonts fetch lazily, same-origin, at
first use; none is `<link rel=preload>`ed, so they never steal critical
bandwidth from the entry chunk.

## Consolidation finding (routed to the UI owner)

The old `@import`s declared **more families than the app renders**. A grep-level
usage audit found two that render **zero pixels**:

- **Bebas Neue** — declared as `--mm-menu` but that variable is never used as a
  `font-family` anywhere; nothing paints in it.
- **Saira Condensed** — only ever appears as an unreachable fallback *behind*
  Oswald in `--mm-cond`; the browser never falls through to it.

Both are **dropped** here rather than self-hosted, and the delivery gate has a
"consolidation guard" that fails if either is ever re-hosted. Nine families were
requested from the CDN; nine faces (seven families) are actually rendered and
shipped. Whether even seven UI families is the right count for a fighting game
is a design question owned by the UI/framing team — this change delivers only
the typography the app actually paints today.

## Provenance & subsetting

Source for every family: the upstream OFL project on
<https://github.com/google/fonts> (`ofl/pressstart2p`, `ofl/vt323`, `ofl/anton`,
`ofl/chakrapetch`, `ofl/oswald`, `ofl/saira`, `ofl/barlowcondensed`). The
delivery is **mixed-provenance**, chosen per family for the smallest bytes with
zero rendering change:

- **Brand fonts (Press Start 2P, VT323)** — a custom `pyftsubset` build from the
  OFL TTFs:
  ```
  pyftsubset <ttf> --unicodes="<google-latin-range>" --flavor=woff2 \
             --no-hinting --desubroutinize --drop-tables+=DSIG
  ```
  For these two bitmap/pixel fonts the local subset is marginally *smaller* than
  Google's served woff2 while rendering identically (correct under the app's
  `-webkit-font-smoothing: none; image-rendering: pixelated`).

- **Secondary fonts (Anton, Chakra Petch, Oswald, Saira, Barlow Condensed)** —
  **Google Fonts' own `latin`-subset woff2, re-hosted verbatim** under OFL 1.1.
  Google applies a woff2 `glyf`-transform (a build step `fontTools` does not
  emit) that makes their served file ~55% smaller than a local re-subset — *and*
  byte-identical to what the app already fetched from `gstatic.com` before
  self-hosting, so on-screen rendering is provably unchanged. `Oswald` is
  Google's single **variable** woff2 (`wght` 400–700, one file covering the
  400/600/700 the app requests). Only faces the app renders are shipped.

**Coverage manifest:** `fonts.coverage.json` records, per face, the exact
codepoints present, `weight`/`style`, byte count, and a `sha256` of the shipped
`.woff2`. The delivery gate
(`src/screens/__tests__/fontDeliveryBudget.node.test.ts`) re-hashes every woff2
on disk to prove the manifest describes the real bytes, asserts every glyph the
app renders is covered by the correct family, and asserts `●` (U+25CF) is
**absent** from every face (the app draws it via CSS fallback) — which is what
proves the manifest is a real cmap enumeration and not a rubber stamp.

## Licence & attribution (SIL OFL 1.1)

All nine faces are licensed under the SIL Open Font License, Version 1.1. The
full licence text ships alongside the fonts, one file per family:

- `PressStart2P-OFL.txt` — Copyright 2012 The Press Start 2P Project Authors
  (cody@zone38.net), with Reserved Font Name "Press Start 2P".
- `VT323-OFL.txt` — Copyright 2011 The VT323 Project Authors
  (peter.hull@oikoi.com), with Reserved Font Name "VT323".
- `Anton-OFL.txt` — Copyright 2020 The Anton Project Authors
  (https://github.com/googlefonts/AntonFont).
- `ChakraPetch-OFL.txt` — Copyright 2018 The Chakra Petch Project Authors
  (https://github.com/m4rc1e/Chakra-Petch).
- `Oswald-OFL.txt` — Copyright 2016 The Oswald Project Authors
  (https://github.com/googlefonts/OswaldFont).
- `Saira-OFL.txt` — Copyright 2020 The Saira Project Authors
  (https://github.com/Omnibus-Type/Saira).
- `BarlowCondensed-OFL.txt` — Copyright 2017 The Barlow Project Authors
  (https://github.com/jpt/barlow).

The OFL permits bundling, subsetting, and web-serving with attribution. Of the
nine faces, only Press Start 2P and VT323 declare a **Reserved Font Name**; both
are shipped either unmodified (secondary families) or as a plain outline-
preserving subset (brand fonts) under the original `font-family` name — exactly
what Google Fonts and Fontsource serve — so the reserved names are honoured and
the unmodified licence text is shipped for every family to satisfy attribution.
