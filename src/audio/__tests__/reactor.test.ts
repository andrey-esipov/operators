import { describe, it, expect } from 'vitest'
import { FightAudioReactor, flavorForHit } from '../reactor'
import type { FightAudioSink, AnnouncerKey, VoiceKey } from '../reactor'
import type { Flavor, ImpactOpts } from '../impacts'
import type { StageId } from '../reverb'
import type { FightEvent, FightState, FighterState, Stance, HitLevel, Vec2 } from '../../fight/types'

// ─── a recording sink ──────────────────────────────────────────────────────
// The reactor talks only to `FightAudioSink`; this spy records every call so a
// test can assert the exact sound moment each event maps to. This is the unit-
// level mirror of the PCM measurement in tools/measure-fight-audio.mjs: here we
// prove the *mapping*, there we prove *actual audible energy*.

interface Call { m: string; a: unknown[] }

class SpySink implements FightAudioSink {
  calls: Call[] = []
  private rec(m: string, ...a: unknown[]) { this.calls.push({ m, a }) }

  impact(flavor: Flavor, opts?: ImpactOpts) { this.rec('impact', flavor, opts) }
  ko(opts?: ImpactOpts) { this.rec('ko', opts) }
  shatter(opts?: ImpactOpts) { this.rec('shatter', opts) }
  whiff(opts?: ImpactOpts) { this.rec('whiff', opts) }
  footstep(opts?: ImpactOpts) { this.rec('footstep', opts) }
  cloth(opts?: ImpactOpts) { this.rec('cloth', opts) }
  meterCharge() { this.rec('meterCharge') }
  superStinger() { this.rec('superStinger') }
  victory() { this.rec('victory') }
  defeat() { this.rec('defeat') }
  setStage(stage: StageId) { this.rec('setStage', stage) }
  setTension(hp01: number) { this.rec('setTension', hp01) }
  duckMusic(intensity: number) { this.rec('duckMusic', intensity) }
  announce(key: AnnouncerKey) { this.rec('announce', key) }
  voice(side: 0 | 1, key: VoiceKey, text: string) { this.rec('voice', side, key, text) }
  musicStart() { this.rec('musicStart') }
  musicStop() { this.rec('musicStop') }

  methods(): string[] { return this.calls.map((c) => c.m) }
  of(m: string): Call[] { return this.calls.filter((c) => c.m === m) }
  impactFlavors(): Flavor[] { return this.of('impact').map((c) => c.a[0] as Flavor) }
  clear() { this.calls = [] }
}

// ─── state fixtures ─────────────────────────────────────────────────────────

function fighter(over: Partial<FighterState> = {}): FighterState {
  return {
    id: 'x', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, facing: 1,
    stance: 'idle', health: 100, maxHealth: 100, meter: 0,
    stunRemaining: 0, comboCount: 0, juggleLeft: 3, grounded: true,
    ...over,
  }
}

function state(over: Partial<FightState> = {}): FightState {
  return {
    frame: 0,
    fighters: [fighter(), fighter({ id: 'y', pos: { x: 100, y: 0 } })],
    timer: 3600, round: 1, wins: [0, 0], phase: 'fight', hitstop: 0,
    cameraFocus: { x: 0, y: 0 }, cameraZoom: 1,
    ...over,
  }
}

const AT: Vec2 = { x: 0, y: 40 }

function make(): { r: FightAudioReactor; s: SpySink } {
  const s = new SpySink()
  return { r: new FightAudioReactor(s), s }
}

// ─── flavorForHit ───────────────────────────────────────────────────────────

describe('flavorForHit', () => {
  it('routes light pokes to the light impact and heavier levels to heavy/crit', () => {
    expect(flavorForHit('light').flavor).toBe('light')
    expect(flavorForHit('medium').flavor).toBe('heavy')
    expect(flavorForHit('heavy').flavor).toBe('heavy')
    expect(flavorForHit('launcher').flavor).toBe('heavy')
    expect(flavorForHit('sweep').flavor).toBe('heavy')
    expect(flavorForHit('crumple').flavor).toBe('crit')
  })

  it('assigns rising intrinsic power with level', () => {
    expect(flavorForHit('light').power).toBeLessThan(flavorForHit('heavy').power)
    expect(flavorForHit('heavy').power).toBeLessThanOrEqual(flavorForHit('launcher').power)
  })
})

// ─── event → sound mapping ──────────────────────────────────────────────────

describe('FightAudioReactor.handle — one sound per event', () => {
  it('every one of the thirteen event types produces at least one sink call (no silent gap)', () => {
    const events: FightEvent[] = [
      { type: 'hit', at: AT, attacker: 0, level: 'medium', damage: 12 },
      { type: 'counter-hit', at: AT, attacker: 0, level: 'medium', damage: 12 },
      { type: 'block', at: AT, attacker: 0 },
      { type: 'parry', at: AT, attacker: 0 },
      { type: 'whiff', at: AT, attacker: 0 },
      { type: 'throw', at: AT, attacker: 0 },
      { type: 'launch', at: AT, attacker: 0 },
      { type: 'knockdown', at: AT, who: 1 },
      { type: 'wall-bounce', at: AT, who: 1 },
      { type: 'ko', who: 1 },
      { type: 'super-flash', who: 0, moveId: 'super' },
      { type: 'round-start', round: 1 },
      { type: 'round-end', winner: 0 },
    ]
    for (const e of events) {
      const { r, s } = make()
      r.handle(e)
      expect(s.calls.length, `event ${e.type} made no sound`).toBeGreaterThan(0)
    }
  })

  it('a light hit plays the light impact', () => {
    const { r, s } = make()
    r.handle({ type: 'hit', at: AT, attacker: 0, level: 'light', damage: 6 })
    expect(s.impactFlavors()).toContain('light')
    expect(s.impactFlavors()).not.toContain('crit')
  })

  it('a heavy, high-damage connect ducks the music', () => {
    const { r, s } = make()
    r.handle({ type: 'hit', at: AT, attacker: 0, level: 'heavy', damage: 90 })
    expect(s.impactFlavors()).toContain('heavy')
    expect(s.of('duckMusic').length).toBe(1)
  })

  it('a block is duller and quieter than a hit (light impact + cloth, no heavy/crit)', () => {
    const { r, s } = make()
    r.handle({ type: 'block', at: AT, attacker: 0 })
    expect(s.impactFlavors()).toEqual(['light'])
    expect(s.of('cloth').length).toBe(1)
    // The block impact must be softer than the softest clean hit.
    const blockPower = (s.of('impact')[0].a[1] as ImpactOpts).power!
    expect(blockPower).toBeLessThan(flavorForHit('light').power)
  })

  it('a parry is a bright ex deflection', () => {
    const { r, s } = make()
    r.handle({ type: 'parry', at: AT, attacker: 0 })
    expect(s.impactFlavors()).toEqual(['ex'])
  })

  it('a whiff swings (the event the sim emits specifically for audio)', () => {
    const { r, s } = make()
    r.handle({ type: 'whiff', at: AT, attacker: 0 })
    expect(s.of('whiff').length).toBe(1)
  })

  it('super-flash fires the stinger, a hard duck, the announcer and the ult voice', () => {
    const { r, s } = make()
    r.handle({ type: 'super-flash', who: 1, moveId: 'm' })
    expect(s.of('superStinger').length).toBe(1)
    expect(s.of('announce')[0].a[0]).toBe('ultimate')
    expect(s.of('voice')[0].a).toEqual([1, 'ult', expect.any(String)])
    expect((s.of('duckMusic')[0].a[0] as number)).toBeGreaterThan(0.9)
  })

  it('KO fires the ko impact, a full duck, the KO shout and the KO voice', () => {
    const { r, s } = make()
    r.handle({ type: 'ko', who: 0 })
    expect(s.of('ko').length).toBe(1)
    expect(s.of('duckMusic')[0].a[0]).toBe(1)
    expect(s.of('announce')[0].a[0]).toBe('ko')
    expect(s.of('voice')[0].a[0]).toBe(0)
  })

  it('round-start announces the round number (clamped to round3)', () => {
    for (const [round, key] of [[1, 'round1'], [2, 'round2'], [3, 'round3'], [4, 'round3']] as const) {
      const { r, s } = make()
      r.handle({ type: 'round-start', round })
      expect(s.of('announce')[0].a[0]).toBe(key)
    }
  })

  it('a round that ends on the clock announces TIME UP; a KO round does not', () => {
    // Timeout round: no preceding ko.
    {
      const { r, s } = make()
      r.handle({ type: 'round-start', round: 1 })
      s.clear()
      r.handle({ type: 'round-end', winner: 0 })
      expect(s.of('announce').map((c) => c.a[0])).toContain('timeup')
    }
    // KO round: the ko already spoke, so round-end stays quiet on timeup.
    {
      const { r, s } = make()
      r.handle({ type: 'round-start', round: 1 })
      r.handle({ type: 'ko', who: 1 })
      s.clear()
      r.handle({ type: 'round-end', winner: 0 })
      expect(s.of('announce').map((c) => c.a[0])).not.toContain('timeup')
    }
  })
})

// ─── the counter-hit is measurably meatier ──────────────────────────────────

describe('counter-hit is meatier than a normal hit of the same level', () => {
  it('adds a crit transient AND a heavy body layer that the normal hit lacks', () => {
    const normal = make()
    normal.r.handle({ type: 'hit', at: AT, attacker: 0, level: 'medium', damage: 12 })

    const counter = make()
    counter.r.handle({ type: 'counter-hit', at: AT, attacker: 0, level: 'medium', damage: 12 })

    // A normal medium hit is a single heavy impact — no crit.
    expect(normal.s.impactFlavors()).not.toContain('crit')
    // The counter layers a sharp crit over a heavy body: strictly more impacts,
    // and the crit transient is present. This is the mapping guarantee behind
    // the acoustic "counter is louder + more sub-bass" measurement.
    expect(counter.s.impactFlavors()).toContain('crit')
    expect(counter.s.impactFlavors()).toContain('heavy')
    expect(counter.s.of('impact').length).toBeGreaterThan(normal.s.of('impact').length)
    // And it punches the mix harder.
    expect(counter.s.of('duckMusic')[0].a[0]).toBeGreaterThan(0.8)
  })
})

// ─── derived, per-frame ─────────────────────────────────────────────────────

function walkStep(from: number, to: number, stance: Stance = 'walk-fwd'): [FightState, FightState] {
  const prev = state({ frame: 1, fighters: [fighter({ pos: { x: from, y: 0 }, stance, grounded: true }), fighter({ id: 'y' })] })
  const next = state({ frame: 2, fighters: [fighter({ pos: { x: to, y: 0 }, stance, grounded: true }), fighter({ id: 'y' })] })
  return [prev, next]
}

describe('FightAudioReactor.step — derived audio', () => {
  it('a walking fighter lays down footsteps roughly every stride length', () => {
    const { r, s } = make()
    // Walk 200cm in 10cm increments. Stride is 46cm, so expect ~4 steps.
    let x = 0
    for (let i = 0; i < 20; i++) {
      const [p, n] = walkStep(x, x + 10)
      r.step(p, n)
      x += 10
    }
    const steps = s.of('footstep').length
    expect(steps).toBeGreaterThanOrEqual(3)
    expect(steps).toBeLessThanOrEqual(5)
  })

  it('an idle micro-drift never triggers a footstep', () => {
    const { r, s } = make()
    let x = 0
    for (let i = 0; i < 60; i++) {
      // 0.5cm of jitter per frame while idle — far more than a real idle, and
      // still no stride should ever complete.
      const [p, n] = walkStep(x, x + 0.5, 'idle')
      r.step(p, n)
      x += 0.5
    }
    expect(s.of('footstep').length).toBe(0)
  })

  it('landing from the air thumps once', () => {
    const { r, s } = make()
    const prev = state({ frame: 1, fighters: [fighter({ grounded: false, stance: 'jump-fall' }), fighter({ id: 'y' })] })
    const next = state({ frame: 2, fighters: [fighter({ grounded: true, stance: 'idle' }), fighter({ id: 'y' })] })
    r.step(prev, next)
    expect(s.of('footstep').length).toBe(1)
  })

  it('crossing into a new super bar fires a charge cue exactly once per bar', () => {
    const { r, s } = make()
    const at = (m0: number, m1: number, f: number): FightState =>
      state({ frame: f, fighters: [fighter({ meter: m0 }), fighter({ id: 'y', meter: m1 })] })
    r.step(at(0, 0, 1), at(999, 0, 2))    // not yet a full bar
    expect(s.of('meterCharge').length).toBe(0)
    r.step(at(999, 0, 2), at(1000, 0, 3)) // crosses bar 1
    expect(s.of('meterCharge').length).toBe(1)
    r.step(at(1000, 0, 3), at(1000, 0, 4)) // no new bar
    expect(s.of('meterCharge').length).toBe(1)
    r.step(at(1000, 0, 4), at(2000, 0, 5)) // crosses bar 2
    expect(s.of('meterCharge').length).toBe(2)
  })

  it('spending meter re-arms the cue without firing, so the next fill charges again', () => {
    const { r, s } = make()
    const at = (m: number, f: number): FightState =>
      state({ frame: f, fighters: [fighter({ meter: m }), fighter({ id: 'y' })] })
    r.step(at(0, 1), at(1000, 2))   // charge
    r.step(at(1000, 2), at(0, 3))   // spend — silent
    expect(s.of('meterCharge').length).toBe(1)
    r.step(at(0, 3), at(1000, 4))   // re-charge fires again
    expect(s.of('meterCharge').length).toBe(2)
  })

  it('tension tracks the nearest-to-death fighter and only updates when it moves', () => {
    const { r, s } = make()
    const hp = (a: number, b: number, f: number): FightState =>
      state({ frame: f, fighters: [fighter({ health: a }), fighter({ id: 'y', health: b })] })
    r.step(hp(100, 100, 1), hp(100, 80, 2))  // min 1.0 -> 0.8: moved
    r.step(hp(100, 80, 2), hp(100, 79, 3))   // 0.80 -> 0.79: below epsilon, no update
    r.step(hp(100, 79, 3), hp(100, 40, 4))   // 0.79 -> 0.40: moved
    const tensions = s.of('setTension').map((c) => c.a[0])
    expect(tensions).toEqual([0.8, 0.4])
  })

  it('the intro→fight transition shouts FIGHT and starts the music', () => {
    const { r, s } = make()
    const intro = state({ phase: 'intro', frame: 1 })
    const fight = state({ phase: 'fight', frame: 2 })
    r.step(intro, fight)
    expect(s.of('announce').map((c) => c.a[0])).toContain('fight')
    expect(s.of('musicStart').length).toBe(1)
  })

  it('reaching match-end plays victory + win/lose voices exactly once', () => {
    const { r, s } = make()
    const fight = state({ phase: 'fight', frame: 1, wins: [2, 1] })
    const end = state({ phase: 'match-end', frame: 2, wins: [2, 1] })
    r.step(fight, end)
    r.step(end, end)  // idempotent: staying in match-end does not replay
    expect(s.of('victory').length).toBe(1)
    const voices = s.of('voice')
    expect(voices.map((c) => c.a[1])).toEqual(['win', 'lose'])
    expect(voices[0].a[0]).toBe(0) // p0 had more wins
  })
})

// ─── mutation sensitivity ───────────────────────────────────────────────────
// These encode the failure the whole task guards against: a reactor that is
// wired but silent, or an event that maps to nothing. If a `handle` case were
// deleted (the exact defect that shipped), the matching assertion here goes red.

describe('mutation sensitivity', () => {
  it('the reactor with no events makes no sound (the control the PCM no-wiring mutation mirrors)', () => {
    const { s } = make()
    expect(s.calls.length).toBe(0)
  })

  it('setStage forwards the arena to the sink for per-room reverb', () => {
    const { r, s } = make()
    r.setStage('distribution' as StageId)
    expect(s.of('setStage')[0].a[0]).toBe('distribution')
  })

  it('dispose stops the music bed', () => {
    const { r, s } = make()
    r.dispose()
    expect(s.of('musicStop').length).toBe(1)
  })

  it('reset clears per-match derived state (meter re-arms from zero)', () => {
    const { r, s } = make()
    const at = (m: number, f: number): FightState =>
      state({ frame: f, fighters: [fighter({ meter: m }), fighter({ id: 'y' })] })
    r.step(at(0, 1), at(1000, 2)) // charge bar 1
    r.reset()
    s.clear()
    // After reset the bar counter is zero again, so re-crossing 1000 charges.
    r.step(at(0, 3), at(1000, 4))
    expect(s.of('meterCharge').length).toBe(1)
  })
})

// Keep the HitLevel import meaningful for readers of the fixtures.
const _levels: HitLevel[] = ['light', 'medium', 'heavy', 'launcher', 'sweep', 'crumple']
void _levels
