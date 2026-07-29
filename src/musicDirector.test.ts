import { describe, expect, it } from 'vitest'
import type { RouteKind } from './appRoute'
import type { Phase } from './types'
import { musicIntentFor, ROUTE_MUSIC, type MusicIntent } from './musicDirector'
import { fadeRamp } from './lib/music'

/**
 * The soundtrack director, gated behaviourally on its real decision — not on a
 * proxy. `musicIntentFor` is pure, so "does entering a match switch to combat
 * music" and "does a title -> attract -> select hop keep the same track" are
 * both directly assertable with zero mocks. This is the EMIT side of the audio
 * seam; the structural singleton gate (`screens/__tests__/audioShell.node`) is
 * the CONSUME side.
 *
 * The regression this pins is the orphaned wiring the task exists to fix: the
 * old inline effect keyed music on the legacy `phase`, which the real fighter
 * flow never advances (it stays `'menu'`), so a real match played menu music
 * forever. The director keys on `route`, so a match switches to combat music
 * even with `phase` stuck at `'menu'` — the exact state the real flow leaves it
 * in. A revert to phase-keying reddens `switches to combat music on the play
 * route`.
 */
const ON = true

describe('musicIntentFor — real-time fighter is route-driven', () => {
  it('front-of-house routes all hold the SAME menu track (continuity: no restart across a hop)', () => {
    const frontOfHouse: RouteKind[] = ['frontdoor', 'attract', 'select']
    const intents = frontOfHouse.map((r) => musicIntentFor(r, 'menu', null, ON))
    // Identical intent across all three ⇒ a title -> attract -> select
    // transition never changes the track, and Music.play(track) is idempotent,
    // so the soundtrack is continuous with no fade and no restart.
    for (const it of intents) expect(it).toEqual<MusicIntent>({ kind: 'play', track: 'menu' })
    expect(new Set(intents.map((i) => JSON.stringify(i))).size).toBe(1)
  })

  it('switches to combat music on the play route EVEN with phase stuck at menu (the orphan fix)', () => {
    // The whole bug: the real flow leaves the legacy phase at 'menu'. The old
    // phase-keyed effect therefore returned menu here and combat music never
    // played. Route-keying fixes it.
    expect(musicIntentFor('play', 'menu', null, ON)).toEqual<MusicIntent>({ kind: 'play', track: 'fight' })
    expect(musicIntentFor('fight', 'menu', null, ON)).toEqual<MusicIntent>({ kind: 'play', track: 'fight' })
  })

  it('reserves the boss theme for Lenny on the combat routes', () => {
    expect(musicIntentFor('play', 'menu', 'lenny', ON)).toEqual<MusicIntent>({ kind: 'play', track: 'boss' })
    expect(musicIntentFor('play', 'menu', 'chesky', ON)).toEqual<MusicIntent>({ kind: 'play', track: 'fight' })
  })

  it('holds the menu track on the dev surfaces (hud/lab)', () => {
    expect(musicIntentFor('hud', 'menu', null, ON)).toEqual<MusicIntent>({ kind: 'play', track: 'menu' })
    expect(musicIntentFor('lab', 'menu', null, ON)).toEqual<MusicIntent>({ kind: 'play', track: 'menu' })
  })

  it('the crossing INTO a match is the one boundary that changes the track', () => {
    const beforeMatch = musicIntentFor('select', 'menu', null, ON)
    const inMatch = musicIntentFor('play', 'menu', null, ON)
    expect(beforeMatch).not.toEqual(inMatch) // a real transition — the cross-fade point
  })
})

describe('musicIntentFor — the route→soundtrack partition is exhaustive', () => {
  // Type-level completeness: ALL_ROUTES is provably EVERY RouteKind, or this file
  // does not compile. `Exclude<RouteKind, …>` collapses to `never` iff the list
  // omits nothing; binding that to `true` fails the moment a route is missed — so
  // the runtime check below cannot be fooled by a stale hand-maintained list.
  const ALL_ROUTES = ['lab', 'fight', 'hud', 'select', 'attract', 'cards', 'play', 'frontdoor'] as const
  type RoutesCovered = Exclude<RouteKind, (typeof ALL_ROUTES)[number]> extends never ? true : false
  const _routesComplete: RoutesCovered = true
  void _routesComplete

  it('every RouteKind declares a soundtrack role — no route can silently default', () => {
    // ROUTE_MUSIC is `satisfies Record<RouteKind, …>`, so a missing route is a
    // COMPILE error at the table (mutation-proven). This is its visible runtime
    // companion: the table's keys are EXACTLY the route set — nothing missing,
    // nothing stray — which is what makes "a 9th route inherits menu music"
    // impossible rather than merely unlikely.
    expect(Object.keys(ROUTE_MUSIC).sort()).toEqual([...ALL_ROUTES].sort())
    for (const r of ALL_ROUTES) expect(ROUTE_MUSIC[r]).toBeDefined()
  })

  it('ANTI-VACUITY: the partition actually uses all three roles (not one blanket default)', () => {
    // The defect being closed is precisely "everything defaults to one role", so
    // a table that mapped every route to 'front-of-house' must NOT pass.
    expect(new Set(Object.values(ROUTE_MUSIC))).toEqual(new Set(['combat', 'front-of-house', 'cards']))
  })
})


describe('musicIntentFor — legacy cards route stays phase-driven', () => {
  const cases: Array<[Phase, MusicIntent]> = [
    ['menu', { kind: 'play', track: 'menu' }],
    ['character-select', { kind: 'play', track: 'menu' }],
    ['stage-select', { kind: 'play', track: 'menu' }],
    ['quote-bank', { kind: 'play', track: 'menu' }],
    ['how-to-play', { kind: 'play', track: 'menu' }],
    ['credits', { kind: 'play', track: 'menu' }],
    ['story-cutscene', { kind: 'play', track: 'menu' }],
    ['pre-fight', { kind: 'play', track: 'fight' }],
    ['fight', { kind: 'play', track: 'fight' }],
    ['match-end', { kind: 'play', track: 'victory' }],
    ['arcade-victory', { kind: 'play', track: 'victory' }],
    ['story-ending', { kind: 'play', track: 'victory' }],
    ['round-end', { kind: 'hold' }],
    ['stats', { kind: 'hold' }],
    ['marquee-matchups', { kind: 'hold' }],
  ]
  for (const [phase, expected] of cases) {
    it(`cards + phase='${phase}' → ${expected.kind}${'track' in expected ? ` ${expected.track}` : ''}`, () => {
      expect(musicIntentFor('cards', phase, null, ON)).toEqual(expected)
    })
  }

  it('cards pre-fight against Lenny is the boss theme', () => {
    expect(musicIntentFor('cards', 'pre-fight', 'lenny', ON)).toEqual<MusicIntent>({ kind: 'play', track: 'boss' })
  })
})

describe('musicIntentFor — the music toggle wins from any surface', () => {
  it('musicEnabled=false yields stop on every route', () => {
    const routes: RouteKind[] = ['frontdoor', 'attract', 'select', 'play', 'fight', 'cards', 'hud', 'lab']
    for (const r of routes) expect(musicIntentFor(r, 'fight', 'lenny', false)).toEqual<MusicIntent>({ kind: 'stop' })
  })

  it('ANTI-VACUITY: the director is not a constant — it produces stop, menu, fight and victory', () => {
    // A stub that returns one value would pass individual cases but not this.
    const outcomes = new Set(
      [
        musicIntentFor('frontdoor', 'menu', null, false), // stop
        musicIntentFor('frontdoor', 'menu', null, ON), // play menu
        musicIntentFor('play', 'menu', null, ON), // play fight
        musicIntentFor('cards', 'match-end', null, ON), // play victory
        musicIntentFor('cards', 'round-end', null, ON), // hold
      ].map((i) => JSON.stringify(i)),
    )
    expect(outcomes.size).toBe(5)
  })
})

describe('fadeRamp — the cross-fade math (pure, no AudioContext)', () => {
  it('ramps up to EXACTLY the target and is monotonic', () => {
    const up = fadeRamp(0, 1, 700)
    expect(up[up.length - 1]).toBe(1) // lands exactly on target — no residual gap
    for (let i = 1; i < up.length; i++) expect(up[i]).toBeGreaterThanOrEqual(up[i - 1])
  })

  it('ramps down to EXACTLY zero (outgoing track ends silent before it stops)', () => {
    const down = fadeRamp(1, 0, 700)
    expect(down[down.length - 1]).toBe(0)
    for (let i = 1; i < down.length; i++) expect(down[i]).toBeLessThanOrEqual(down[i - 1])
  })

  it('samples the fade over time and clamps to [0,1]', () => {
    const r = fadeRamp(0, 1, 700, 40)
    expect(r.length).toBe(Math.round(700 / 40))
    for (const v of r) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('ANTI-VACUITY: a real fade moves — start and end volumes differ', () => {
    const r = fadeRamp(0, 1, 700)
    expect(r[0]).toBeLessThan(r[r.length - 1])
    expect(r.length).toBeGreaterThan(1)
  })
})
