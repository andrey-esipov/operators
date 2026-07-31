import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Audio-shell ownership — the CONSUME side of the continuous-BGM seam, gated on
 * the obligation the persistent shell (`2cec5fb`) created, not on a source-text
 * proxy. Sibling to `musicDirector.test.ts`, which gates the EMIT side.
 *
 * THE OBLIGATION. Continuous music across title -> attract -> select -> fight is
 * only possible because ONE AudioContext now lives for the whole session (a
 * reload used to destroy it at every hop). That guarantee is a convention the
 * moment it isn't enforced: the instant a screen constructs its own
 * AudioContext, we have two contexts, the soundtrack fragments, and — because
 * browsers cap live AudioContexts — enough navigations start throwing. So the
 * subject here is exactly the coordinator's: "the context is created once at the
 * shell and never constructed inside a screen component."
 *
 * WHY NOT A REGEX. A screen can construct a context two ways: `new
 * AudioContext()` directly, or by aliasing the constructor first (`const C =
 * window.AudioContext || window.webkitAudioContext; new C()` — which is exactly
 * how the SFX engine in `src/audio/index.ts` does it). A text scan for
 * "AudioContext" would both miss the alias form AND false-positive on the many
 * comments/type-positions that mention it. So detection is by AST: real
 * `new`-expressions only, with in-file alias resolution.
 *
 * ANTI-VACUITY, shipped with the gate:
 *   - POSITIVE CONTROL: the detector fires on a direct construction, on the
 *     `window.AudioContext || …` form, AND on the aliased form; it does NOT fire
 *     on a comment mention, a type annotation, or `new OfflineAudioContext()`
 *     (offline rendering is not a live playback context and is the SFX engine's
 *     headless tool, not a continuity concern).
 *   - NON-BLINDNESS: the enumeration reaches a substantial set of shipped
 *     modules and includes the known screens; the single-owner scan actually
 *     finds `lib/music.ts` (so "only music.ts" is not vacuously true because the
 *     scan found nothing).
 *
 * WHAT THIS DOES *NOT* PROVE (named, so the gate isn't itself a lying harness):
 * it is structural. It proves no screen *constructs* a context and that the BGM
 * context has a single module-scoped owner; it does NOT prove the browser keeps
 * that context alive across an unmount (a platform contract) nor that audio is
 * audible (a live-GL/live-audio claim). In-file alias resolution also won't
 * follow a constructor aliased across a module boundary — an exotic form no
 * module in the tree uses, and one that would require deliberately re-exporting
 * the raw Web Audio constructor.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..', '..') // src/
const rel = (abs: string) => abs.replace(SRC + '/', '')

/** Modules allowed to construct a live AudioContext: the BGM engine and the
 *  separate SFX/impact engine dir (owned by impact-vfx). Everything else —
 *  every React screen/route surface — must consume those singletons. */
const isAudioEngine = (relPath: string) => relPath === 'lib/music.ts' || relPath.startsWith('audio/')

function shippedSourceUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === '__tests__' || ent.name === 'node_modules') continue
      out.push(...shippedSourceUnder(p))
    } else if (/\.(ts|tsx)$/.test(ent.name) && !/\.(test|probe)\./.test(ent.name)) {
      out.push(p)
    }
  }
  return out
}

// A live AudioContext, by name. `\bAudioContext\b` does NOT match inside the
// single identifier `OfflineAudioContext` (no word boundary between "Offline"
// and "Audio"), so offline render contexts are excluded for free.
const LIVE_CTX = /\b(?:webkit)?AudioContext\b/

/**
 * Every live-AudioContext construction in a source file, by AST — direct,
 * `window.AudioContext || …`, and via an in-file alias of the constructor.
 * Returns short labels (empty = the file constructs no live context).
 */
function audioContextConstructions(src: string): string[] {
  const sf = ts.createSourceFile('probe.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  // Pass 1: identifiers bound to a live-AudioContext constructor become aliases.
  // e.g. `const Ctor = window.AudioContext || window.webkitAudioContext`.
  const aliases = new Set<string>()
  const collectAliases = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initText = node.initializer.getText(sf)
      if (LIVE_CTX.test(initText)) aliases.add(node.name.text)
    }
    ts.forEachChild(node, collectAliases)
  }
  collectAliases(sf)

  // Pass 2: `new` expressions whose constructor is a live AudioContext, the
  // `window.AudioContext || …` form, or a Pass-1 alias identifier.
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node)) {
      const exprText = node.expression.getText(sf)
      const isAlias = ts.isIdentifier(node.expression) && aliases.has(node.expression.text)
      if (isAlias || LIVE_CTX.test(exprText)) {
        found.push(`new ${exprText.replace(/\s+/g, ' ').slice(0, 48)}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** Does the module declare a module-scoped `ctx` binding (the singleton cache
 *  that makes construction happen at most once)? */
function hasModuleScopedCtx(src: string): boolean {
  const sf = ts.createSourceFile('probe.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === 'ctx') return true
      }
    }
  }
  return false
}

const MUSIC = 'lib/music.ts'
const allShipped = shippedSourceUnder(SRC)

describe('audio shell — no screen constructs its own AudioContext', () => {
  it('POSITIVE CONTROL: the detector fires on direct, window, and aliased forms — not on comments/types/offline', () => {
    expect(audioContextConstructions(`const c = new AudioContext()`).length).toBe(1)
    expect(audioContextConstructions(`new webkitAudioContext()`).length).toBe(1)
    expect(
      audioContextConstructions(
        `const c = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)()`,
      ).length,
    ).toBe(1)
    // Aliased constructor — the laundering a text scan misses:
    expect(
      audioContextConstructions(`const Ctor = window.AudioContext || (window as any).webkitAudioContext; const c = new Ctor()`).length,
    ).toBe(1)
    // Must NOT fire:
    expect(audioContextConstructions(`// new AudioContext() in a comment`)).toEqual([])
    expect(audioContextConstructions(`let ctx: AudioContext | null = null`)).toEqual([])
    expect(audioContextConstructions(`const r = new OfflineAudioContext(2, 44100, 44100)`)).toEqual([])
  })

  it('NON-BLINDNESS: the enumeration covers many shipped modules incl. the known screens', () => {
    expect(allShipped.length).toBeGreaterThan(30)
    const rels = allShipped.map(rel)
    for (const known of [
      'App.tsx',
      'screens/AttractMode.tsx',
      'screens/FrontDoor.tsx',
      'play/PlayableMatch.tsx',
      'fighthud/select/FightSelect.tsx',
    ]) {
      expect(rels).toContain(known)
    }
  })

  it('no shipped module OUTSIDE the audio engine constructs a live AudioContext', () => {
    const offenders: string[] = []
    for (const f of allShipped) {
      const r = rel(f)
      if (isAudioEngine(r)) continue
      const forms = audioContextConstructions(readFileSync(f, 'utf8'))
      if (forms.length) offenders.push(`${r} → ${forms.join(', ')}`)
    }
    expect(offenders, `screens/other modules constructing their own AudioContext:\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('audio shell — the BGM context is created once, at the shell', () => {
  it('NON-BLINDNESS: the single-owner scan actually finds the construction in lib/music.ts', () => {
    const owners = allShipped.filter((f) => !rel(f).startsWith('audio/') && audioContextConstructions(readFileSync(f, 'utf8')).length > 0)
    expect(owners.map(rel)).toContain(MUSIC) // the scan is not blind — it found the real site
  })

  it('lib/music.ts is the ONLY BGM-context owner and constructs it exactly once, behind a module-scoped cache', () => {
    // Excludes the SFX engine dir (audio/**, impact-vfx's own context); this is
    // the BGM context the shell relies on for continuity.
    const nonSfx = allShipped.filter((f) => !rel(f).startsWith('audio/'))
    const owners = nonSfx.filter((f) => audioContextConstructions(readFileSync(f, 'utf8')).length > 0).map(rel)
    expect(owners).toEqual([MUSIC]) // one owner, no screen among them

    const musicSrc = readFileSync(resolve(SRC, MUSIC), 'utf8')
    expect(audioContextConstructions(musicSrc).length).toBe(1) // created once…
    expect(hasModuleScopedCtx(musicSrc)).toBe(true) // …behind the module-scoped singleton cache
  })
})
