import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { FightVfx, type FightVfxDeps } from '../FightVfx'
import type { FightEvent, HitLevel } from '../../../fight/types'

/**
 * REACTIVE SCREEN-PUNCH ON THE SHIPPED ROUTE — the impact:6/10 gate.
 *
 * The reactive post grade (PostPipeline: bloom bump + chromatic-aberration
 * spike + contrast + grain + anamorphic streak, all driven by `impact`) was
 * authored to fire on every hit, but its ONLY charger was PostPipeline.onEvent,
 * which reads the card-game engine bus. On the shipped `/` (`?play=1`) fighter
 * that bus is never touched: the sim dispatches FightEvents straight to
 * FightVfx, and FightRenderer leaves the optional `emitEngine` bridge undefined,
 * so onEvent never runs on a normal hit. Measured live on the shipped route,
 * PostPipeline.impact sat at 0.0000 across 45 hits of every weight class — the
 * whole reactive grade was dead on the game people play. This is an
 * "authored-but-never-consumed" defect, the shape this project has shipped
 * repeatedly, and it is exactly what "present-but-timid, 6/10" looks like.
 *
 * The fix routes each hit's punch through the new FightVfx `punchPost` dep
 * (wired in FightRenderer to PostPipeline.impactPunch). This gate proves that
 * wire is live AND weight-aware, across ALL SIX weight classes — the live CPU
 * only ever landed light/medium/heavy, so launcher/sweep/crumple coverage lives
 * here, deterministically.
 *
 * Guards, in order:
 *   1. CONSUMPTION: every 'hit' charges the punch exactly once, > 0. A dead wire
 *      (the bug) records zero calls -> red.
 *   2. MONOTONIC IN WEIGHT: strength ascends the hitstop ladder. If the `post`
 *      field is dropped/flattened, the tiers collapse -> red (non-blindness).
 *   3. WARMTH IS DIRECTIONAL: strikes run warm (>0), the launcher runs cool (<0)
 *      — the blue pop. Proves the `warm` field is read, not decorative.
 *   4. ANTI-WASH: a normal hit carries NO full-frame flash; only the KO does.
 *   5. KO IS BIGGEST: the KO punches harder than any normal hit and adds the
 *      short warm flash — the most-remembered frame, but still punch-and-decay.
 *   6. VACUITY: a real spread (max > 1.5x min), so a constant table can't pass.
 *
 * Recorded from a real spy dep driven through the real FightVfx.handle switch —
 * this proves consumption on the shipped route, not a reimplementation of it.
 */

interface PunchCall {
  strength: number
  warm: number
  flash: number
}

function makeDeps(): { deps: FightVfxDeps; punches: PunchCall[] } {
  const punches: PunchCall[] = []
  const mk = () => ({
    triggerHitFlash: () => {},
    mesh: { position: new THREE.Vector3() },
    bodyWidth: 1,
    chestAnchor: () => new THREE.Vector3(),
    setDissolve: () => {},
  })
  const fighters = [mk(), mk()]
  ;(fighters[0] as unknown as { mesh: { position: THREE.Vector3 } }).mesh.position.x = -2
  ;(fighters[1] as unknown as { mesh: { position: THREE.Vector3 } }).mesh.position.x = 2
  const deps = {
    additive: { emit: () => {} },
    alpha: { emit: () => {} },
    shockwave: { spawn: () => {} },
    impact: { spawn: () => {} },
    fighters,
    camera: { addShake: () => {}, punchIn: () => {} },
    requestHitstop: () => {},
    // The channel under test. Records every charge the shipped route would send
    // to PostPipeline.impactPunch.
    punchPost: (strength: number, warm: number, flash = 0) => {
      punches.push({ strength, warm, flash })
    },
    emitEngine: () => {},
  } as unknown as FightVfxDeps
  return { deps, punches }
}

const hitEv = (level: HitLevel, damage = 60): FightEvent =>
  ({ type: 'hit', at: { x: 0, y: 100 }, attacker: 0, level, damage }) as FightEvent

function punchOf(ev: FightEvent): PunchCall {
  const { deps, punches } = makeDeps()
  new FightVfx(deps).handle(ev)
  expect(punches.length, 'exactly one punchPost per hit').toBe(1)
  return punches[0]
}

// Ascending order of the hitstop ladder = the canonical weight order. The
// `post` strengths must ascend along it.
const WEIGHT_LADDER: HitLevel[] = ['light', 'medium', 'sweep', 'heavy', 'launcher', 'crumple']

describe('reactive screen-punch reaches the shipped route (FightVfx.handle → punchPost)', () => {
  it('every hit charges the reactive punch exactly once, with real strength — the dead-wire guard', () => {
    for (const level of WEIGHT_LADDER) {
      const p = punchOf(hitEv(level))
      expect(p.strength, `${level} punch strength`).toBeGreaterThan(0)
    }
  })

  it('punch strength is monotonic up the weight ladder — `post` is consumed, not decorative', () => {
    // Fixed damage so only the weight (`post`) varies across the ladder.
    const strengths = WEIGHT_LADDER.map((lv) => punchOf(hitEv(lv, 60)).strength)
    for (let i = 1; i < strengths.length; i++) {
      expect(
        strengths[i],
        `${WEIGHT_LADDER[i]} (${strengths[i].toFixed(3)}) must exceed ${WEIGHT_LADDER[i - 1]} (${strengths[i - 1].toFixed(3)})`,
      ).toBeGreaterThan(strengths[i - 1])
    }
  })

  it('higher damage punches harder at the same weight — combo power is folded in', () => {
    const soft = punchOf(hitEv('heavy', 30)).strength
    const hard = punchOf(hitEv('heavy', 240)).strength
    expect(hard, `heavy@240 (${hard.toFixed(3)}) > heavy@30 (${soft.toFixed(3)})`).toBeGreaterThan(soft)
  })

  it('warmth is directional — strikes run warm, the launcher runs cool (the blue pop)', () => {
    expect(punchOf(hitEv('light')).warm, 'light warm').toBeGreaterThan(0)
    expect(punchOf(hitEv('heavy')).warm, 'heavy warm').toBeGreaterThan(0)
    expect(punchOf(hitEv('crumple')).warm, 'crumple warm').toBeGreaterThan(0)
    expect(punchOf(hitEv('launcher')).warm, 'launcher cool (blue pop)').toBeLessThan(0)
  })

  it('a normal hit carries NO full-frame flash — anti-wash; the wash is the KO only', () => {
    for (const level of WEIGHT_LADDER) {
      expect(punchOf(hitEv(level)).flash, `${level} flash`).toBe(0)
    }
  })

  it('the KO punches harder than any normal hit and adds the short warm flash', () => {
    const { deps, punches } = makeDeps()
    new FightVfx(deps).handle({ type: 'ko', who: 1 } as FightEvent)
    expect(punches.length, 'KO charges the punch').toBe(1)
    const ko = punches[0]
    const heaviestNormal = Math.max(...WEIGHT_LADDER.map((lv) => punchOf(hitEv(lv, 240)).strength))
    expect(ko.strength, `KO (${ko.strength}) > heaviest normal hit (${heaviestNormal.toFixed(3)})`).toBeGreaterThan(heaviestNormal)
    expect(ko.flash, 'KO carries a full-frame flash accent').toBeGreaterThan(0)
    expect(ko.warm, 'KO runs warm').toBeGreaterThan(0)
  })

  it('the punch has a real dynamic range — a constant table cannot pass (vacuity)', () => {
    const strengths = WEIGHT_LADDER.map((lv) => punchOf(hitEv(lv, 60)).strength)
    const min = Math.min(...strengths)
    const max = Math.max(...strengths)
    expect(max, `spread max ${max.toFixed(3)} vs min ${min.toFixed(3)}`).toBeGreaterThan(min * 1.5)
  })

  it('block and parry do NOT charge the reactive punch — it lives on hits, not neutral', () => {
    // A defended hit must not fire the impact grade (the reason punchPost is
    // charged from hit()/ko(), not from the shared hitstop envelope that block
    // also pulses).
    for (const ev of [
      { type: 'block', at: { x: 0, y: 100 }, attacker: 0, chip: 2 } as FightEvent,
      { type: 'parry', at: { x: 0, y: 100 } } as FightEvent,
    ]) {
      const { deps, punches } = makeDeps()
      new FightVfx(deps).handle(ev)
      expect(punches.length, `${(ev as { type: string }).type} must not punch`).toBe(0)
    }
  })
})
