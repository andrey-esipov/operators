# Self-hosted brand fonts

The two arcade brand fonts are served from this origin instead of Google Fonts,
so the app pulls **zero third-party font origins** on its entry document
(`index.html`). This removes two extra DNS lookups + TLS handshakes from every
route, kills the third-party FOUT, and makes the fonts work offline, on
locked-down corporate networks, and in regions where Google Fonts is blocked.

| Family          | File                       | Bytes  | Glyphs | Licence      |
|-----------------|----------------------------|--------|--------|--------------|
| Press Start 2P  | `PressStart2P-latin.woff2` | 4,284  | 223    | SIL OFL 1.1  |
| VT323           | `VT323-latin.woff2`        | 6,656  | 222    | SIL OFL 1.1  |

`@font-face` is declared once in the bundled stylesheet (`src/index.css`) for the
React app, and inline in the standalone `public/audiolab.html`. The fonts are
**not** `<link rel=preload>`ed: neither is painted on the front-door title (that
renders in Anton / Chakra Petch via `src/screens/menu/menu.css`), so a preload
would steal critical bandwidth from the entry chunk. They fetch lazily,
same-origin, at first use (the match HUD).

## Provenance & subsetting

- **Source:** the upstream OFL TTFs from <https://github.com/google/fonts>
  (`ofl/pressstart2p`, `ofl/vt323`).
- **Subset command:**
  ```
  pyftsubset <ttf> --unicodes="<google-latin-range>" --flavor=woff2 \
             --no-hinting --desubroutinize --drop-tables+=DSIG
  ```
  The unicode range is Google's own "latin" range (`U+0000-00FF, U+0131,
  U+0152-0153, ..., U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215,
  ...`), so the on-screen result is identical to what the CDN served: the same
  glyphs are pixel-rendered and the same glyphs fall back. `--no-hinting`
  matches Google's already-hinting-stripped served woff2 (and is correct under
  the app's `-webkit-font-smoothing: none; image-rendering: pixelated`), which
  is why these subsets are marginally *smaller* than Google's own latin woff2
  while rendering the same.
- **Coverage manifest:** `fonts.coverage.json` records, per font, the exact
  codepoints present plus a `sha256` of the shipped `.woff2` bytes. The delivery
  gate (`src/screens/__tests__/fontDeliveryBudget.node.test.ts`) reads this file,
  re-hashes the woff2 on disk to prove the manifest describes the real bytes, and
  asserts every glyph the app renders is covered.

## Licence & attribution (SIL OFL 1.1)

Both fonts are licensed under the SIL Open Font License, Version 1.1. Full
licence text ships alongside each font:

- `PressStart2P-OFL.txt` — Copyright 2012 The Press Start 2P Project Authors
  (cody@zone38.net), with Reserved Font Name "Press Start 2P".
- `VT323-OFL.txt` — Copyright 2011 The VT323 Project Authors
  (peter.hull@oikoi.com), with Reserved Font Name "VT323".

The OFL permits bundling, subsetting, and web-serving. The **Reserved Font Name**
clause means a *modified* font may not be distributed under the reserved name; a
plain subset that keeps the original glyph outlines is universally treated as the
same font (this is exactly what Google Fonts and Fontsource serve), so the
`font-family` name is retained and the unmodified licence text is shipped to
satisfy attribution.
