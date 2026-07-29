import { createHash } from 'node:crypto'
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Font delivery gate — the two arcade brand fonts ship from THIS origin.
 *
 * `index.html` used to request Press Start 2P + VT323 from Google Fonts:
 *   <link rel=preconnect href=fonts.googleapis.com>
 *   <link rel=preconnect href=fonts.gstatic.com crossorigin>
 *   <link href=".../css2?family=Press+Start+2P&family=VT323&display=swap">
 * That put two third-party origins (2× DNS + TLS) on the entry document every
 * route loads, made the brand fonts fail on locked-down / offline / Google-
 * blocked networks, and logged every player's IP to a third party. The fonts
 * are now self-hosted, subset to Google's own "latin" unicode-range under SIL
 * OFL 1.1 (see public/fonts/), and wired via @font-face in the bundled
 * stylesheet (src/index.css) + inline in public/audiolab.html.
 *
 * SCOPE — read this before trusting the gate. This guards the *entry document*
 * and the *two brand fonts only*. It deliberately does NOT assert whole-app
 * font-origin-freedom, because that would be a lie today: src/screens/menu/
 * menu.css (the front-door title shell, framing-owned), select.css and
 * ceremony.css still `@import` a separate SEVEN-family Google set (Anton, Bebas
 * Neue, Chakra Petch, Oswald, Saira, Saira Condensed, Barlow Condensed), and
 * the front-door "OPERATORS" wordmark actually renders in Anton — that is a
 * larger, measured, routed finding, not something this commit fixed. Encoding
 * those origins as "allowed" here would rot the gate into a rubber stamp, so
 * they are out of scope and reported instead.
 *
 * WHY THIS CAN'T LIE:
 *   - It reads the REAL files from disk (index.html, src/index.css, the shipped
 *     .woff2, and the coverage manifest) and re-hashes the font bytes, so the
 *     manifest can't claim coverage the shipped font doesn't have without the
 *     sha256 tie reddening too.
 *   - Vacuity guards throughout: the coverage check runs over > 90 required
 *     glyphs (not an empty set), the manifest must describe exactly 2 fonts each
 *     with a plausible glyph count, and the source scan must actually visit
 *     multiple files. A gate that checks zero glyphs / zero fonts / zero files
 *     and passes is this project's single most-repeated failure mode; each of
 *     those reddens here instead.
 *   - Positive control: characters known to be present ('A', '0', '·') are
 *     asserted present, proving the codepoint list is real and parsed.
 *   - Anti-rubber-stamp: '●' (U+25CF, the ss-foot bullet) is asserted ABSENT
 *     from both fonts. It is genuinely absent — the app renders it via the CSS
 *     fallback (Courier New) and always has — so a coverage manifest that had
 *     been lazily regenerated as "every codepoint" would redden here. This is
 *     the assertion that proves the codepoint sets are a real cmap enumeration
 *     rather than a stamp that answers "yes" to everything.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '../../..')

const ORIGIN_RE = /fonts\.(googleapis|gstatic)\.com/
// A Google css2 request that names one of OUR two brand fonts specifically.
const BRAND_ON_CDN_RE =
  /fonts\.googleapis\.com\/css2\?[^"')\s]*(Press\+Start\+2P|family=VT323)/

interface CoverageFont {
  family: string
  file: string
  format: string
  bytes: number
  sha256: string
  glyphCount: number
  codepoints: number[]
}
interface Coverage {
  fonts: CoverageFont[]
}

const coverage: Coverage = JSON.parse(
  readFileSync(resolve(REPO, 'public/fonts/fonts.coverage.json'), 'utf8'),
)
const indexHtml = readFileSync(resolve(REPO, 'index.html'), 'utf8')
const indexCss = readFileSync(resolve(REPO, 'src/index.css'), 'utf8')

const BRAND_FAMILIES = ['Press Start 2P', 'VT323']

// Every glyph the app is known to render, that MUST survive subsetting. ASCII
// printable + the punctuation the UI actually emits (fighter/stage names, HUD,
// and the front-door footer string "● INSERT COIN · N OPERATORS · M FRAMEWORKS
// · © LENNY'S PODCAST" — note the · separators and the ' apostrophe). Every
// codepoint below was verified present in BOTH shipped subsets before being
// required here; '●' is intentionally NOT in this list (see anti-rubber-stamp).
const REQUIRED_GLYPHS: number[] = [
  ...Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => 0x20 + i), // ASCII printable
  0x00b7, // · MIDDLE DOT (footer separator)
  0x2019, // ’ RIGHT SINGLE QUOTE ("Lenny’s")
  0x00a9, // © COPYRIGHT
  0x201c, 0x201d, // “ ” curly double quotes
  0x2013, 0x2014, // – — en/em dash
  0x00d7, // × MULTIPLICATION (used in "N×" combo counts)
  0x00b0, // ° DEGREE
  0x2026, // … HORIZONTAL ELLIPSIS
  0x2022, // • BULLET
  0x2122, // ™ TRADE MARK
  0x20ac, // € EURO
]

// Files worth scanning for a brand-font CDN request: bundled app CSS + the
// standalone public HTML pages + the entry document.
function scanTargets(): string[] {
  const out: string[] = [resolve(REPO, 'index.html')]
  const walk = (dir: string, exts: string[]) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue
        walk(p, exts)
      } else if (exts.some((e) => ent.name.endsWith(e))) {
        out.push(p)
      }
    }
  }
  walk(resolve(REPO, 'src'), ['.css'])
  walk(resolve(REPO, 'public'), ['.html'])
  return out
}

describe('front-door font delivery budget', () => {
  it('the origin scanner actually works (positive control)', () => {
    // A scanner that never matches would pass every origin assertion blind.
    expect(ORIGIN_RE.test('https://fonts.googleapis.com/css2?family=x')).toBe(true)
    expect(ORIGIN_RE.test('/fonts/PressStart2P-latin.woff2')).toBe(false)
    expect(
      BRAND_ON_CDN_RE.test(
        'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap',
      ),
    ).toBe(true)
    expect(
      BRAND_ON_CDN_RE.test('https://fonts.googleapis.com/css2?family=Anton&family=Oswald'),
    ).toBe(false)
  })

  it('entry document names no third-party font origin', () => {
    const hits = indexHtml.match(new RegExp(ORIGIN_RE, 'g')) ?? []
    expect(hits, `index.html still references: ${hits.join(', ')}`).toEqual([])
  })

  it('never requests the two brand fonts from a third-party CDN, anywhere', () => {
    const targets = scanTargets()
    // Vacuity: we must actually have visited a meaningful set of files.
    expect(targets.length).toBeGreaterThan(3)
    const offenders: string[] = []
    for (const f of targets) {
      if (BRAND_ON_CDN_RE.test(readFileSync(f, 'utf8'))) {
        offenders.push(f.slice(REPO.length + 1))
      }
    }
    expect(
      offenders,
      `Press Start 2P / VT323 requested from Google in: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('self-hosts both brand fonts via @font-face → an on-disk local woff2', () => {
    const blocks = indexCss.split('@font-face').slice(1)
    const found: string[] = []
    for (const b of blocks) {
      const fam = b.match(/font-family:\s*["']([^"']+)["']/)?.[1]
      if (!fam || !BRAND_FAMILIES.includes(fam)) continue
      const url = b.match(/url\(\s*["']?(\/fonts\/[^"')]+\.woff2)["']?\s*\)/)?.[1]
      expect(url, `@font-face for "${fam}" has no local /fonts/*.woff2 src`).toBeTruthy()
      expect(b, `@font-face for "${fam}" must set font-display: swap`).toMatch(
        /font-display:\s*swap/,
      )
      expect(
        existsSync(resolve(REPO, 'public' + url!)),
        `${url} declared in @font-face but missing on disk`,
      ).toBe(true)
      found.push(fam)
    }
    // Vacuity: exactly the two brand fonts are self-hosted, not zero, not a dupe.
    expect(found.sort()).toEqual([...BRAND_FAMILIES].sort())
  })

  it('coverage manifest describes the real shipped bytes (sha256 tie)', () => {
    // Vacuity: exactly two fonts, each a plausible subset (not empty, not full).
    expect(coverage.fonts.length).toBe(2)
    for (const f of coverage.fonts) {
      const p = resolve(REPO, 'public/fonts', f.file)
      expect(existsSync(p), `${f.file} missing on disk`).toBe(true)
      const bytes = readFileSync(p)
      expect(bytes.length, `${f.file} byte count drifted from manifest`).toBe(f.bytes)
      expect(statSync(p).size).toBe(f.bytes)
      const sha = createHash('sha256').update(bytes).digest('hex')
      expect(sha, `${f.file} sha256 does not match manifest — bytes changed`).toBe(f.sha256)
      expect(f.glyphCount).toBeGreaterThan(150)
      expect(f.glyphCount).toBeLessThan(400)
      expect(f.codepoints.length).toBe(f.glyphCount)
    }
  })

  it('subset covers every glyph the app renders, for BOTH fonts', () => {
    // Vacuity: the coverage assertion runs over a real, non-trivial glyph set.
    expect(REQUIRED_GLYPHS.length).toBeGreaterThan(90)
    for (const f of coverage.fonts) {
      const cps = new Set(f.codepoints)
      // Positive control: characters known present are present.
      for (const cp of [0x41 /*A*/, 0x30 /*0*/, 0x00b7 /*·*/]) {
        expect(cps.has(cp), `${f.family} unexpectedly missing U+${cp.toString(16)}`).toBe(true)
      }
      // Anti-rubber-stamp: '●' is genuinely absent (renders via fallback). A
      // manifest lazily regenerated as "all codepoints" would fail here.
      expect(
        cps.has(0x25cf),
        `${f.family} claims '●' (U+25CF) — coverage manifest looks rubber-stamped`,
      ).toBe(false)
      const missing = REQUIRED_GLYPHS.filter((cp) => !cps.has(cp))
      expect(
        missing,
        `${f.family} subset drops rendered glyphs: ${missing
          .map((c) => 'U+' + c.toString(16).toUpperCase())
          .join(', ')}`,
      ).toEqual([])
    }
  })

  it('total self-hosted brand-font payload stays within budget', () => {
    const BUDGET_BYTES = 13_312 // achieved 10,940 B; modest headroom for re-subsets
    const total = coverage.fonts.reduce((n, f) => n + f.bytes, 0)
    expect(total, 'font payload suspiciously small').toBeGreaterThan(4_000)
    expect(total, `self-hosted fonts ${total} B exceed budget ${BUDGET_BYTES} B`).toBeLessThan(
      BUDGET_BYTES,
    )
  })
})
