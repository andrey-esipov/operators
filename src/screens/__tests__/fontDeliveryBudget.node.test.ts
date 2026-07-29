import { createHash } from 'node:crypto'
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Font delivery gate — EVERY font the app renders ships from THIS origin.
 *
 * History. `index.html` used to pull Press Start 2P + VT323 from Google Fonts,
 * and three screen stylesheets (menu.css, select.css, ceremony.css) each
 * `@import`ed a SEPARATE Google css2 set (Anton, Bebas Neue, Chakra Petch,
 * Oswald, Saira, Saira Condensed, Barlow Condensed) — render-blocking, on the
 * FIRST screen a player sees, with the "OPERATORS" wordmark (Anton) depending
 * on a third-party CDN. public/hud.html did the same. That put third-party
 * origins (DNS + TLS) on the critical path, broke on offline / locked-down /
 * Google-blocked networks, caused FOUT (fallback → reflow), and logged every
 * player's IP to Google. All of it is now self-hosted, subset to Google's own
 * "latin" unicode-range under SIL OFL 1.1 (see public/fonts/), wired via
 * @font-face in the bundled stylesheet (src/index.css) + inline in the two
 * standalone public HTML pages.
 *
 * SCOPE — this now guards WHOLE-APP font-origin freedom, not just two fonts.
 * A player fetches zero third-party font bytes on any route. Nine faces are
 * self-hosted (2 brand + Anton + Chakra Petch ×3 + Oswald variable + Saira +
 * Barlow Condensed). Two families the old @imports declared — Bebas Neue and
 * Saira Condensed — render zero pixels (Bebas Neue's var is never applied;
 * Saira Condensed is only an unreachable fallback behind Oswald) and are
 * deliberately NOT shipped; the gate asserts they stay unshipped so nobody
 * "fixes" a future miss by re-adding dead typography.
 *
 * WHY THIS CAN'T LIE:
 *   - Reads the REAL files from disk (index.html, src/index.css, the screen +
 *     public CSS/HTML, the shipped .woff2, the coverage manifest) and re-hashes
 *     the font bytes, so the manifest can't claim coverage the shipped font
 *     doesn't have without the sha256 tie reddening.
 *   - Vacuity guards throughout: the origin scan must actually visit the four
 *     screen/public files by name (not an empty walk); coverage runs over > 90
 *     required glyphs; the manifest must describe exactly the 9 expected faces;
 *     the @font-face check must resolve every one to an on-disk woff2. A gate
 *     that checks zero files / zero glyphs / zero fonts and passes is this
 *     project's single most-repeated failure mode; each reddens here instead.
 *   - Positive controls: the origin regex is proven to match a real Google URL
 *     and NOT match a local /fonts/ path; 'A'/'0'/'·' are asserted present.
 *   - Anti-rubber-stamp: '●' (U+25CF, the ss-foot bullet) is asserted ABSENT
 *     from all nine faces. It is genuinely absent from Google's latin subset —
 *     the app renders it via CSS fallback — so a coverage manifest lazily
 *     regenerated as "every codepoint" would redden here. This is the assertion
 *     that proves the codepoint sets are a real cmap enumeration, not a stamp.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '../../..')

const ORIGIN_RE = /fonts\.(googleapis|gstatic)\.com/

interface CoverageFont {
  family: string
  weight: string
  style: string
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
const SECONDARY_FAMILIES = ['Anton', 'Chakra Petch', 'Oswald', 'Saira', 'Barlow Condensed']
const ALL_FAMILIES = [...BRAND_FAMILIES, ...SECONDARY_FAMILIES]
// Declared in the old @imports but render zero pixels — must NOT be re-hosted.
const DROPPED_FAMILIES = ['Bebas Neue', 'Saira Condensed']

// Every distinct self-hosted face, as "family|weight|style". This is the exact
// set the app renders (audited across index.css, menu/select/ceremony.css and
// hud.html). Oswald is one Google variable file spanning 400-700.
const EXPECTED_FACES = [
  'Press Start 2P|400|normal',
  'VT323|400|normal',
  'Anton|400|normal',
  'Chakra Petch|400|normal',
  'Chakra Petch|600|normal',
  'Chakra Petch|700|normal',
  'Oswald|400 700|normal',
  'Saira|400|normal',
  'Barlow Condensed|600|normal',
].sort()

// Every glyph the app is known to render that MUST survive subsetting: ASCII
// printable + the punctuation the UI actually emits (fighter/stage names, HUD,
// and the front-door footer "● INSERT COIN · N OPERATORS · M FRAMEWORKS · ©
// LENNY'S PODCAST" — note the · separators and the ' apostrophe). Every
// codepoint below was verified present in ALL nine faces before being required
// here; '●' is intentionally NOT in this list (see anti-rubber-stamp).
const REQUIRED_GLYPHS: number[] = [
  ...Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => 0x20 + i), // ASCII printable
  0x00b7, // · MIDDLE DOT (footer separator)
  0x2019, // ’ RIGHT SINGLE QUOTE ("Lenny’s")
  0x00a9, // © COPYRIGHT
  0x201c, 0x201d, // “ ” curly double quotes
  0x2013, 0x2014, // – — en/em dash
  0x00d7, // × MULTIPLICATION
  0x00b0, // ° DEGREE
  0x2026, // … HORIZONTAL ELLIPSIS
  0x2022, // • BULLET
  0x2122, // ™ TRADE MARK
  0x20ac, // € EURO
]

// Files that could smuggle a third-party font request back in: the entry
// document + every bundled/served CSS and standalone HTML page.
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

interface FaceDecl {
  family: string
  weight: string
  style: string
  url: string
  display: string
}
function parseFontFaces(css: string): FaceDecl[] {
  const out: FaceDecl[] = []
  for (const raw of css.split('@font-face').slice(1)) {
    const b = raw.slice(0, raw.indexOf('}') + 1)
    const family = b.match(/font-family:\s*["']([^"']+)["']/)?.[1]
    if (!family) continue
    out.push({
      family,
      weight: (b.match(/font-weight:\s*([^;]+);/)?.[1] ?? '400').trim(),
      style: (b.match(/font-style:\s*([^;]+);/)?.[1] ?? 'normal').trim(),
      url: b.match(/url\(\s*["']?(\/fonts\/[^"')]+\.woff2)["']?\s*\)/)?.[1] ?? '',
      display: (b.match(/font-display:\s*([^;]+);/)?.[1] ?? '').trim(),
    })
  }
  return out
}

describe('app font delivery budget', () => {
  it('the origin scanner actually works (positive control)', () => {
    // A scanner that never matches would pass every origin assertion blind.
    expect(ORIGIN_RE.test('https://fonts.googleapis.com/css2?family=Anton')).toBe(true)
    expect(ORIGIN_RE.test('https://fonts.gstatic.com/s/anton/v27/x.woff2')).toBe(true)
    expect(ORIGIN_RE.test('/fonts/Anton-400-latin.woff2')).toBe(false)
  })

  it('entry document names no third-party font origin', () => {
    const hits = indexHtml.match(new RegExp(ORIGIN_RE, 'g')) ?? []
    expect(hits, `index.html still references: ${hits.join(', ')}`).toEqual([])
  })

  it('no route fetches a font from a third-party origin, anywhere', () => {
    const targets = scanTargets()
    // Vacuity: we must actually have visited the screens/pages that used to
    // @import Google — a walk that silently skipped them would pass blind.
    const rel = targets.map((t) => t.slice(REPO.length + 1))
    for (const must of [
      'src/index.css',
      'src/screens/menu/menu.css',
      'src/screens/select/select.css',
      'src/screens/ceremony/ceremony.css',
      'public/hud.html',
    ]) {
      expect(rel, `origin scan never visited ${must}`).toContain(must)
    }
    const offenders: string[] = []
    for (const f of targets) {
      if (ORIGIN_RE.test(readFileSync(f, 'utf8'))) offenders.push(f.slice(REPO.length + 1))
    }
    expect(
      offenders,
      `third-party font origin (googleapis/gstatic) present in: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('self-hosts every rendered face via @font-face → an on-disk local woff2', () => {
    const faces = parseFontFaces(indexCss)
    const found = new Set<string>()
    for (const f of faces) {
      if (!ALL_FAMILIES.includes(f.family)) continue
      expect(f.url, `@font-face for "${f.family}" ${f.weight} has no local /fonts/*.woff2 src`).toBeTruthy()
      expect(f.display, `@font-face for "${f.family}" ${f.weight} must set font-display: swap`).toBe(
        'swap',
      )
      expect(
        existsSync(resolve(REPO, 'public' + f.url)),
        `${f.url} declared in @font-face but missing on disk`,
      ).toBe(true)
      found.add(`${f.family}|${f.weight}|${f.style}`)
    }
    // Vacuity: exactly the nine expected faces are self-hosted — not zero,
    // not a subset, not a stray extra family.
    expect([...found].sort()).toEqual(EXPECTED_FACES)
  })

  it('does NOT re-host the two dead families (consolidation guard)', () => {
    // Bebas Neue + Saira Condensed rendered nothing even before this change.
    // Re-adding them (e.g. to silence a future coverage miss) is a regression.
    for (const dead of DROPPED_FAMILIES) {
      expect(
        indexCss.includes(`font-family: "${dead}"`) || indexCss.includes(`font-family: '${dead}'`),
        `${dead} was re-hosted in src/index.css — it renders zero pixels; drop it`,
      ).toBe(false)
      expect(
        coverage.fonts.some((f) => f.family === dead),
        `${dead} appears in the coverage manifest — it renders zero pixels; drop it`,
      ).toBe(false)
    }
  })

  it('coverage manifest describes the real shipped bytes (sha256 tie)', () => {
    // Vacuity: exactly the nine expected faces, each a plausible latin subset.
    expect(coverage.fonts.length).toBe(9)
    const faceKeys = coverage.fonts.map((f) => `${f.family}|${f.weight}|${f.style}`).sort()
    expect(faceKeys).toEqual(EXPECTED_FACES)
    for (const f of coverage.fonts) {
      const p = resolve(REPO, 'public/fonts', f.file)
      expect(existsSync(p), `${f.file} missing on disk`).toBe(true)
      const bytes = readFileSync(p)
      expect(bytes.length, `${f.file} byte count drifted from manifest`).toBe(f.bytes)
      expect(statSync(p).size).toBe(f.bytes)
      const sha = createHash('sha256').update(bytes).digest('hex')
      expect(sha, `${f.file} sha256 does not match manifest — bytes changed`).toBe(f.sha256)
      expect(f.glyphCount, `${f.file} glyphCount implausible`).toBeGreaterThan(150)
      expect(f.glyphCount, `${f.file} glyphCount implausible`).toBeLessThan(400)
      expect(f.codepoints.length).toBe(f.glyphCount)
    }
  })

  it('subset covers every glyph the app renders, for ALL nine faces', () => {
    // Vacuity: the coverage assertion runs over a real, non-trivial glyph set.
    expect(REQUIRED_GLYPHS.length).toBeGreaterThan(90)
    expect(coverage.fonts.length).toBe(9)
    for (const f of coverage.fonts) {
      const cps = new Set(f.codepoints)
      // Positive control: characters known present are present.
      for (const cp of [0x41 /*A*/, 0x30 /*0*/, 0x00b7 /*·*/]) {
        expect(cps.has(cp), `${f.family} ${f.weight} missing U+${cp.toString(16)}`).toBe(true)
      }
      // Anti-rubber-stamp: '●' is genuinely absent (renders via fallback). A
      // manifest lazily regenerated as "all codepoints" would fail here.
      expect(
        cps.has(0x25cf),
        `${f.family} ${f.weight} claims '●' (U+25CF) — coverage manifest looks rubber-stamped`,
      ).toBe(false)
      const missing = REQUIRED_GLYPHS.filter((cp) => !cps.has(cp))
      expect(
        missing,
        `${f.family} ${f.weight} subset drops rendered glyphs: ${missing
          .map((c) => 'U+' + c.toString(16).toUpperCase())
          .join(', ')}`,
      ).toEqual([])
    }
  })

  it('total self-hosted font payload stays within budget', () => {
    // Sum of ALL nine self-hosted faces. Achieved 125,060 B; a player fetches
    // only the faces a given screen renders, but this caps the whole set so it
    // cannot silently balloon (e.g. a full non-latin re-subset, or re-adding a
    // dead family). +8.2 KB vs the prior 116,832 B: Press Start 2P moved from a
    // local pyftsubset to Google's verbatim latin woff2 because it is the only
    // Reserved-Font-Name family (see README licence section). Modest headroom.
    const BUDGET_BYTES = 135_168 // achieved 125,060 B (~8.1% headroom)
    const total = coverage.fonts.reduce((n, f) => n + f.bytes, 0)
    expect(total, 'font payload suspiciously small').toBeGreaterThan(90_000)
    expect(total, `self-hosted fonts ${total} B exceed budget ${BUDGET_BYTES} B`).toBeLessThan(
      BUDGET_BYTES,
    )
  })

  // Attribution must not drift from the licence files sitting next to it. Every
  // family's copyright line in public/fonts/README.md has to appear VERBATIM
  // (whitespace-normalised for markdown line-wrapping) in the shipped
  // <Family>-OFL.txt, and the Reserved Font Name flag is derived mechanically
  // from those files — never from memory. This exists because the README once
  // claimed VT323 carried an RFN it does not, and dropped ".git" from two
  // upstream URLs: attribution that is wrong where it is checkable is worth
  // less everywhere else.
  it('README attribution matches the shipped OFL licence files verbatim', () => {
    const OFL_FILES: Record<string, string> = {
      'Press Start 2P': 'PressStart2P-OFL.txt',
      VT323: 'VT323-OFL.txt',
      Anton: 'Anton-OFL.txt',
      'Chakra Petch': 'ChakraPetch-OFL.txt',
      Oswald: 'Oswald-OFL.txt',
      Saira: 'Saira-OFL.txt',
      'Barlow Condensed': 'BarlowCondensed-OFL.txt',
    }
    // Vacuity: seven real licence files, exactly one per shipped family.
    expect(Object.keys(OFL_FILES).length).toBe(7)
    expect(new Set(Object.keys(OFL_FILES))).toEqual(new Set(ALL_FAMILIES))

    const readme = readFileSync(resolve(REPO, 'public/fonts/README.md'), 'utf8')
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
    const readmeNorm = norm(readme)

    let rfnCount = 0
    for (const [family, file] of Object.entries(OFL_FILES)) {
      const oflPath = resolve(REPO, 'public/fonts', file)
      expect(existsSync(oflPath), `${file} missing on disk`).toBe(true)
      const ofl = readFileSync(oflPath, 'utf8')
      const copyright = ofl
        .split('\n')
        .map((l) => l.trim())
        .find((l) => /^Copyright/i.test(l))
      expect(copyright, `${file} has no Copyright line`).toBeTruthy()
      // README must quote the licence's copyright line verbatim.
      expect(
        readmeNorm.includes(norm(copyright!)),
        `README attribution for ${family} does not match ${file} verbatim:\n  OFL: ${copyright}`,
      ).toBe(true)
      // RFN flag comes from the licence file itself, not the README's prose.
      const hasRFN = /with Reserved Font Name/i.test(ofl)
      if (family === 'Press Start 2P') {
        expect(hasRFN, `${file} should declare its Reserved Font Name`).toBe(true)
        rfnCount++
      } else {
        expect(hasRFN, `${file} unexpectedly declares a Reserved Font Name`).toBe(false)
      }
    }
    // Exactly one shipped family carries an RFN (Press Start 2P). If the licence
    // files ever change, this and the per-family checks move together.
    expect(rfnCount).toBe(1)
  })
})
