import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { FightCamera, type CameraFraming } from '../FightCamera'
import { WORLD } from '../../types'

/**
 * Authored-shot guard: the camera must re-frame on the dramatic beats (super
 * freeze, KO) and NOT on ordinary pokes.
 *
 * Measured before this existed: a super and a KO pushed the frame in by ~2.5%
 * on-screen — identical to a heavy hit and to each other — and that push had
 * already bled out by mid-freeze (hold ratio ~0.57), because the old dolly
 * impulse decayed on WALL time while the world was frozen. So the game's two
 * most cinematic beats — the 260ms super freeze and the 340ms KO freeze, which
 * are the dominant share of those moments' screen time — were framed like
 * neutral poking. The genre (SF6/GGST) pushes 15-30% on a super/KO.
 *
 * The fix drives an authored push with a WALL-time attack (so it ramps in during
 * the freeze) and a SIM-time release (so it HOLDS across the freeze and eases
 * out only as the world resumes). These tests drive the REAL FightCamera with no
 * GPU: settle the framing springs, fire the exact impulses FightVfx sends for
 * each beat, advance the freeze at kickDt=0 (sim frozen, wall time flowing) with
 * pushIn ramping 0.6->0 like the engine's hitstop envelope, and read the
 * on-screen character height by projecting the feet (y=0) and head
 * (y=FIGHTER_HEIGHT) points. Every assertion is red when the behaviour it guards
 * regresses (no push, a push that decays, a push that crops a fighter, or a push
 * that fires on jabs), and the mutation test proves the re-frame comes from this
 * code and not the measurement.
 */

const FOV = WORLD.CAMERA.fov
const DT = 1 / 60
const HEAD = WORLD.FIGHTER_HEIGHT
const NEUTRAL: CameraFraming = { ax: -2, bx: 2, topY: HEAD, pushIn: 0 }

const STAGES = [
  { name: 'narrow', bounds: { minX: -6, maxX: 6 } },
  { name: 'default', bounds: { minX: -8.2, maxX: 8.2 } },
  { name: 'wide', bounds: { minX: -12, maxX: 12 } },
]

// The exact camera impulses FightVfx sends per beat (FightVfx.ts): addShake +
// punchIn weight, and the engine freeze duration (requestHitstop ms).
const JAB = { shake: 0.1, push: 0.15, ms: 60 }
const HEAVY = { shake: 0.26, push: 0.5, ms: 130 }
const SUPER = { shake: 0.2, push: 0.6, ms: 260 }
const KO = { shake: 0.5, push: 0.8, ms: 340 }

const fracFromBottom = (cam: THREE.PerspectiveCamera, y: number) =>
  new THREE.Vector3(0, y, 0).project(cam).y * 0.5 + 0.5
const charFrac = (cam: THREE.PerspectiveCamera) => fracFromBottom(cam, HEAD) - fracFromBottom(cam, 0)

function settled(bounds: { minX: number; maxX: number }) {
  const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 100)
  const fc = new FightCamera(cam, bounds)
  for (let i = 0; i < 240; i++) fc.update(DT, DT, NEUTRAL)
  return { cam, fc }
}

interface Beat { shake: number; push: number; ms: number }
interface ShotResult {
  neutral: number
  frames: number
  peakExc: number
  meanExc: number
  holdRatio: number
}

/**
 * Fire a beat's impulses, then advance the freeze at kickDt=0 with pushIn ramping
 * 0.6->0 (the hitstop envelope), then a short resume. Returns the on-screen
 * character-fraction excursion (peak and freeze-mean) versus the settled neutral,
 * and the hold ratio (mean/peak — how much of the peak push survives the freeze).
 * `sep`/`topY` let a caller stress containment at wide spacing / launches.
 */
function freezeShot(
  bounds: { minX: number; maxX: number },
  beat: Beat,
  opts: { mutate?: boolean; sep?: number; topY?: number } = {},
): ShotResult {
  const sep = opts.sep ?? 4
  const topY = opts.topY ?? HEAD
  const framing: CameraFraming = { ax: -sep / 2, bx: sep / 2, topY, pushIn: 0 }
  const { cam, fc } = settled(bounds)
  // settle at the test spacing before measuring the neutral baseline
  for (let i = 0; i < 120; i++) fc.update(DT, DT, framing)
  const neutral = charFrac(cam)
  if (opts.mutate) (globalThis as Record<string, unknown>).__MUT_NO_CINE__ = true
  fc.addShake(beat.shake, new THREE.Vector3(1, 0, 0))
  fc.punchIn(beat.push)
  const frames = Math.max(1, Math.round(beat.ms / 1000 / DT))
  let peak = neutral
  let sum = 0
  for (let i = 0; i < frames; i++) {
    fc.update(DT, 0, { ...framing, pushIn: 0.6 * (1 - i / frames) })
    const cf = charFrac(cam)
    peak = Math.max(peak, cf)
    sum += cf
  }
  if (opts.mutate) delete (globalThis as Record<string, unknown>).__MUT_NO_CINE__
  const mean = sum / frames
  return {
    neutral,
    frames,
    peakExc: (peak - neutral) / neutral,
    meanExc: (mean - neutral) / neutral,
    holdRatio: (mean - neutral) / Math.max(1e-6, peak - neutral),
  }
}

describe('camera authors the super-freeze and KO shots', () => {
  it('a super pushes in AND holds the push across the freeze, on every stage', () => {
    for (const st of STAGES) {
      const s = freezeShot(st.bounds, SUPER)
      // vacuity: real work on a sane, genre-correct baseline
      expect(s.frames).toBeGreaterThan(8)
      expect(s.neutral).toBeGreaterThan(0.5)
      expect(s.neutral).toBeLessThan(0.7)
      // OUTCOME: the super visibly re-frames (measured ~13% bigger on screen)
      expect(s.peakExc).toBeGreaterThan(0.08)
      // ...and the push is HELD through the freeze, not spent in the first frames.
      // The old decaying dolly measured holdRatio ~0.57 and meanExc ~1.5%; both
      // assertions below are red against that regression.
      expect(s.meanExc).toBeGreaterThan(0.06)
      expect(s.holdRatio).toBeGreaterThan(0.7)
    }
  })

  it('scales with weight: KO > super > heavy, and a jab does not author a shot', () => {
    const b = STAGES[1].bounds
    const jab = freezeShot(b, JAB)
    const heavy = freezeShot(b, HEAVY)
    const sup = freezeShot(b, SUPER)
    const ko = freezeShot(b, KO)
    // a jab must NOT re-frame — guards a camera that lurches on every poke
    expect(jab.peakExc).toBeLessThan(0.04)
    // the dramatic curve exists, is monotonic, and is well separated
    expect(heavy.peakExc).toBeGreaterThan(jab.peakExc + 0.02)
    expect(sup.peakExc).toBeGreaterThan(heavy.peakExc + 0.03)
    expect(ko.peakExc).toBeGreaterThan(sup.peakExc + 0.05)
  })

  it('the push never crops a fighter — both stay in frame, every stage and spacing', () => {
    // KO is the deepest push. Stress it at typical AND wide spacing on every
    // stage; assert both fighters' feet, heads and body x stay inside the frame
    // for the whole freeze (the "never amputate a fighter" invariant).
    for (const st of STAGES) {
      for (const sep of [4, 10]) {
        const framing: CameraFraming = { ax: -sep / 2, bx: sep / 2, topY: HEAD, pushIn: 0 }
        const { cam, fc } = settled(st.bounds)
        for (let i = 0; i < 120; i++) fc.update(DT, DT, framing)
        fc.addShake(KO.shake, new THREE.Vector3(1, 0, 0))
        fc.punchIn(KO.push)
        const frames = Math.round(KO.ms / 1000 / DT)
        let observed = 0
        for (let i = 0; i < frames; i++) {
          fc.update(DT, 0, { ...framing, pushIn: 0.6 * (1 - i / frames) })
          const feet = fracFromBottom(cam, 0)
          const head = fracFromBottom(cam, HEAD)
          const lx = new THREE.Vector3(-sep / 2, 1.5, 0).project(cam).x
          const rx = new THREE.Vector3(sep / 2, 1.5, 0).project(cam).x
          expect(feet).toBeGreaterThan(0.0)
          expect(head).toBeLessThan(1.0)
          expect(Math.abs(lx)).toBeLessThan(1.0)
          expect(Math.abs(rx)).toBeLessThan(1.0)
          observed++
        }
        expect(observed).toBeGreaterThan(8) // vacuity: frames actually ran
      }
    }
  })

  it('mutation proof: disabling the cinematic push collapses the super re-frame', () => {
    const b = STAGES[1].bounds
    const on = freezeShot(b, SUPER, { mutate: false })
    const off = freezeShot(b, SUPER, { mutate: true })
    // ON: the freeze re-frames strongly (not a vacuous pass)
    expect(on.peakExc).toBeGreaterThan(0.08)
    // OFF: collapses to at most the residual framing micro-push (~2.5%) — the
    // authored shot is proven to come from this code, and the gate can fail.
    expect(off.peakExc).toBeLessThan(0.035)
    expect(on.peakExc - off.peakExc).toBeGreaterThan(0.06)
  })
})
