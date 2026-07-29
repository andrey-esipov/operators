import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * No-reload shell gate — the app must navigate between screens with
 * `history.pushState`, never a full-page navigation.
 *
 * The defect this locks down was the worst-scored surface in the project
 * (transitions 3/10): "no commercial fighter reloads the page between menu
 * screens — ours did it twice in the first ten seconds." Three seams drove it —
 * `FightSelect` launched a match with `window.location.assign(...)`, and `App`
 * left the attract reel and the front door with `window.location.search = 'select=1'`.
 * Each was a full document teardown that threw away the live WebGL context, the
 * fighter atlases AND the AudioContext — which is *why* continuous BGM across
 * title → attract → select was impossible. The fix routes all three through a
 * `navigate` helper that pushState's the next search and mirrors it into state,
 * so one document — and its running audio — survives every hop.
 *
 * THE PROXY THIS ASSERTS ON, STATED PLAINLY (tonight's rule: name the proxy and
 * prove the failure mode can't satisfy it):
 *   proxy = "the two shell files contain NO assignment/call-form full-page
 *            navigation, and DO contain the pushState primitive that replaced it."
 * The failure mode it must catch = "a reload seam remains, or one is reintroduced
 * later." A reintroduced `location.assign(` / `location.search =` / `location.reload()`
 * is exactly what the banned-pattern set matches, so that failure cannot satisfy
 * the proxy — it reddens here.
 *
 * WHY THIS CAN'T LIE VACUOUSLY (an absence gate's signature weakness is passing
 * because it looked at nothing, or because its matcher is broken and matches
 * nothing):
 *   - POSITIVE CONTROL: the same detector is run against a synthetic snippet that
 *     DOES contain a reload, and must fire. A regex typo that matched nothing
 *     would fail this control instead of green-washing every real file.
 *   - VACUITY GUARDS: each file must exist, be substantial, AND contain the
 *     positive replacement token (`history.pushState` / the `navigate` wiring /
 *     `onLaunch`). So the gate cannot pass because a file was emptied or the nav
 *     code deleted — the very "removed the seam by removing the feature" cheat.
 *
 * WHAT THIS DOES *NOT* PROVE (stated so this gate is not itself a lying harness —
 * presence of text is not reachability of execution, the exact trap that bit the
 * `forceContextLoss()` gate tonight):
 *   - It does NOT prove a click actually calls `navigate`, nor that React swaps
 *     the mounted screen without a document reload. That is React runtime
 *     behaviour and there is no jsdom in this suite, so it cannot be observed in
 *     node. The behavioural half — that the pushed search strings resolve to the
 *     intended screens — is proven in `src/appRoute.test.ts`; the runtime half
 *     (no document reload, VRAM/context freed across the hop, audio continuity)
 *     is the GPU/browser proof requested separately. This gate's job is narrow
 *     and honest: the reload seams are textually gone and the pushState primitive
 *     is textually wired.
 *
 * Mutation-proven both directions: re-introduce `window.location.assign(` in
 * FightSelect (or `window.location.search = 'select=1'` in App) and the relevant
 * "contains no full-page navigation" assertion goes red naming the file; delete
 * the detector's teeth and the positive control goes red.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..', '..')

const APP = resolve(SRC, 'App.tsx')
const FIGHT_SELECT = resolve(SRC, 'fighthud', 'select', 'FightSelect.tsx')

/**
 * Assignment/call forms of full-page navigation. Deliberately NOT a bare
 * `location.search` — `App` legitimately *reads* `window.location.search` to seed
 * and restore route state, and a read is not a navigation. Only the forms that
 * tear down the document are banned:
 *   - `.assign(` / `.replace(` — method calls, always a navigation
 *   - `.reload(` — explicit reload
 *   - `.href = ` / `.search = ` — assignment (the `(?!=)` rules out `===`/`==`)
 */
const RELOAD_FORMS: { label: string; re: RegExp }[] = [
  { label: 'location.assign(', re: /location\.assign\s*\(/ },
  { label: 'location.replace(', re: /location\.replace\s*\(/ },
  { label: 'location.reload(', re: /location\.reload\s*\(/ },
  { label: 'location.href =', re: /location\.href\s*=(?!=)/ },
  { label: 'location.search =', re: /location\.search\s*=(?!=)/ },
]

function reloadFormsIn(source: string): string[] {
  return RELOAD_FORMS.filter(({ re }) => re.test(source)).map(({ label }) => label)
}

describe('shell navigation — no full-page reloads between screens', () => {
  it('POSITIVE CONTROL: the reload detector actually fires on known-bad source', () => {
    // If this ever passes empty, every "contains no reload" assertion below is
    // vacuous — a broken matcher would clear real files by matching nothing.
    const knownBad = [
      `window.location.assign('/?a=x')`,
      `window.location.search = 'select=1'`,
      `window.location.href = '/'`,
      `window.location.replace('/x')`,
      `window.location.reload()`,
    ].join('\n')
    expect(reloadFormsIn(knownBad).sort()).toEqual(
      ['location.assign(', 'location.href =', 'location.reload(', 'location.replace(', 'location.search ='].sort(),
    )
    // And a pure READ of location.search must NOT trip the detector.
    expect(reloadFormsIn(`const s = window.location.search`)).toEqual([])
  })

  it('App.tsx exists, is substantial, and wires the pushState primitive', () => {
    expect(existsSync(APP)).toBe(true)
    const src = readFileSync(APP, 'utf8')
    expect(src.length).toBeGreaterThan(2000)
    // Vacuity: the replacement must be present, so "no reload" can't pass because
    // navigation was deleted rather than converted.
    expect(src).toMatch(/history\.pushState/)
    expect(src).toMatch(/navigate\(SELECT_SEARCH\)/)
    expect(src).toMatch(/onLaunch=\{navigate\}/)
  })

  it('FightSelect.tsx exists, is substantial, and launches via the onLaunch prop', () => {
    expect(existsSync(FIGHT_SELECT)).toBe(true)
    const src = readFileSync(FIGHT_SELECT, 'utf8')
    expect(src.length).toBeGreaterThan(2000)
    // Vacuity: the client-swap replacement must be present.
    expect(src).toMatch(/onLaunch\(\s*\n?\s*matchupSearch\(/)
  })

  it('App.tsx contains NO full-page navigation (pushState only)', () => {
    const found = reloadFormsIn(readFileSync(APP, 'utf8'))
    expect(found, `App.tsx reintroduced a full-page reload: ${found.join(', ')}`).toEqual([])
  })

  it('FightSelect.tsx contains NO full-page navigation (onLaunch only)', () => {
    const found = reloadFormsIn(readFileSync(FIGHT_SELECT, 'utf8'))
    expect(found, `FightSelect.tsx reintroduced a full-page reload: ${found.join(', ')}`).toEqual([])
  })
})
