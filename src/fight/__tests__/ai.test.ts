import { describe, expect, it } from 'vitest'
import { makeAI, type Difficulty } from '../ai'
import { createFight, step } from '../sim'
import { fightAtRange, inp, NEU } from './helpers'
import type { FightState } from '../types'

/**
 * The tiers must differ in the two ways that actually make an AI feel human or
 * inhuman: how fast it reacts, and how reliably it defends. These tests measure
 * both from the running AI, not from the config, so re-tuning that accidentally
 * flattens the tiers (all the same reaction, or nobody techs) goes red.
 */

// A minimal scene: the AI (fighter 1) stands neutral and can act; the opponent
// is either grounded-neutral or airborne-and-close. Flipping that at a known
// frame lets us time the AI's reaction to a "jump-in".
function scene(airborne: boolean): FightState {
  const s = createFight('operator', 'operator')
  s.phase = 'fight'
  s.phaseTimer = 0
  const me = s.fighters[1]
  const opp = s.fighters[0]
  me.pos = { x: 0, y: 0 }
  me.facing = 1
  me.stance = 'idle'
  me.grounded = true
  me.stunRemaining = 0
  opp.pos = { x: 60, y: airborne ? 120 : 0 }
  opp.grounded = !airborne
  opp.stance = airborne ? 'jump-fall' : 'idle'
  return s
}

/** Frames after the jump before the AI first throws out its anti-air (hp). */
function reactionFrames(diff: Difficulty, seed: number, jumpAt = 30): number {
  const ai = makeAI({ difficulty: diff, seed })
  for (let k = 0; k < 90; k++) {
    if (ai.decide(scene(k >= jumpAt), 1).pressed.has('hp')) return k - jumpAt
  }
  return 999
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

describe('AI difficulty tiers', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8]

  it('reaction time is strictly faster on harder tiers', () => {
    const easy = median(seeds.map((s) => reactionFrames('easy', s)))
    const medium = median(seeds.map((s) => reactionFrames('medium', s)))
    const hard = median(seeds.map((s) => reactionFrames('hard', s)))

    // Each tier reacts no sooner than its human-lag window (a hard read is fast,
    // never frame-1) and the ordering is strict: this is the whole point.
    expect(hard).toBeGreaterThanOrEqual(8)
    expect(hard).toBeLessThanOrEqual(12)
    expect(medium).toBeGreaterThanOrEqual(13)
    expect(medium).toBeLessThanOrEqual(19)
    expect(easy).toBeGreaterThanOrEqual(21)
    expect(hard).toBeLessThan(medium)
    expect(medium).toBeLessThan(easy)
  })

  it('a hard AI cannot anti-air on the first frame (no inhuman precision)', () => {
    // Even the sharpest tier is blind to the jump for its reaction window.
    for (const s of seeds) {
      expect(reactionFrames('hard', s)).toBeGreaterThanOrEqual(8)
    }
  })

  // Count defensive escapes and successful grabs against a fixed throw offense.
  // An "escape" is any read that gets the AI out of the throw pressure: teching
  // the throw outright, or — once knocked down — an invulnerable wakeup reversal.
  // Both are defensive reads gated by the tier, so counting only techs would
  // undercount a hard AI that increasingly escapes via reversal instead.
  function throwDefence(diff: Difficulty, seed: number): { escapes: number; grabbed: number } {
    let s = fightAtRange(60)
    const ai = makeAI({ difficulty: diff, seed })
    let escapes = 0
    let grabbed = 0
    let prevTech = false
    let prevKD = false
    let prevStance: string | undefined
    for (let k = 0; k < 600; k++) {
      const atk = k % 40 === 20 ? inp(5, 'lp', 'lk') : inp(6)
      s = step(s, [atk, ai.decide(s, 1)]).state
      const f = s.fighters[1]
      const teching = f.stance === 'throw-tech'
      const kd = f.stance === 'knockdown'
      const reversed = prevStance === 'wakeup' && f.stance === 'attack' && f.move?.id === 'dp.P'
      if (teching && !prevTech) escapes++
      if (reversed) escapes++
      if (kd && !prevKD) grabbed++
      prevTech = teching
      prevKD = kd
      prevStance = f.stance
    }
    return { escapes, grabbed }
  }

  it('a hard AI escapes throw pressure far more — and gets grabbed less — than an easy AI', () => {
    const easy = seeds.reduce(
      (a, s) => { const r = throwDefence('easy', s); return { e: a.e + r.escapes, g: a.g + r.grabbed } },
      { e: 0, g: 0 },
    )
    const hard = seeds.reduce(
      (a, s) => { const r = throwDefence('hard', s); return { e: a.e + r.escapes, g: a.g + r.grabbed } },
      { e: 0, g: 0 },
    )
    expect(hard.e).toBeGreaterThan(easy.e)
    expect(hard.g).toBeLessThan(easy.g)
  })

  it('AI-vs-AI stays deterministic per tier and seed', () => {
    const play = (): string => {
      let s = createFight('operator', 'operator')
      const a0 = makeAI({ difficulty: 'hard', seed: 7 })
      const a1 = makeAI({ difficulty: 'easy', seed: 9 })
      for (let k = 0; k < 500; k++) s = step(s, [a0.decide(s, 0), a1.decide(s, 1)]).state
      return JSON.stringify(s.fighters.map((f) => [f.health, Math.round(f.pos.x)]))
    }
    expect(play()).toBe(play())
    void NEU
  })
})
