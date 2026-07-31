import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { FightCamera } from '../FightCamera'
import { WORLD } from '../../types'

/**
 * Camera-kick regression guard.
 *
 * v9's harshest renderer finding was `impact.json maxMag: 0` — contact produced
 * ZERO camera kick, the signature tell of a hobby fighter. It shipped because
 * nothing guarded it: the browser filmstrip that "measured" the kick paused the
 * sim and screenshotted frame-by-frame, and the old wall-time shake fully
 * decayed inside the hitstop freeze before frame 0 was ever captured, so a real
 * bug and a working kick were indistinguishable to it.
 *
 * These tests drive the REAL FightCamera (the class FightRenderer uses) with no
 * GPU: they settle the framing springs, fire the same weight-scaled impulses
 * FightVfx sends, then project a fighting-plane point through the camera every
 * frame and measure the screen displacement in px. Each assertion is red when
 * the behaviour it guards is broken (kick disabled, kick spent inside the
 * freeze, kick unbounded), so none of them can silently pass a regression.
 */

const FOV = WORLD.CAMERA.fov
const H = 720
const DT = 1 / 60
// A point on the fighting plane at ~head height — what the player actually
// watches. Its screen displacement is the felt camera kick.
const WATCH = new THREE.Vector3(0, 3.0, 0)
const FRAMING = { ax: -2, bx: 2, topY: WORLD.FIGHTER_HEIGHT, pushIn: 0 }

function px(cam: THREE.PerspectiveCamera, w: THREE.Vector3) {
  const v = w.clone().project(cam)
  const W = H * (16 / 9)
  return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H }
}

function fresh() {
  const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 100)
  const fc = new FightCamera(cam, { minX: -12, maxX: 12 })
  for (let i = 0; i < 200; i++) fc.update(DT, DT, FRAMING)
  return { cam, fc }
}

/**
 * Fire an impulse, then advance `freeze` frames at kickDt≈0 (a frozen gap: real
 * time flows so the framing stays live, but no sim frame advances, so the kick
 * is held) followed by `release` frames at full sim-frame time. Returns the peak
 * screen displacement seen during each phase.
 */
function kick(amount: number, dir: THREE.Vector3 | undefined, freeze: number, release: number) {
  const { cam, fc } = fresh()
  const rest = px(cam, WATCH)
  if (amount > 0) fc.addShake(amount, dir)
  let peakFreeze = 0
  let peakRelease = 0
  for (let f = 0; f < freeze; f++) {
    fc.update(DT, 0, FRAMING)
    const p = px(cam, WATCH)
    peakFreeze = Math.max(peakFreeze, Math.hypot(p.x - rest.x, p.y - rest.y))
  }
  for (let f = 0; f < release; f++) {
    fc.update(DT, DT, FRAMING)
    const p = px(cam, WATCH)
    peakRelease = Math.max(peakRelease, Math.hypot(p.x - rest.x, p.y - rest.y))
  }
  return { peakFreeze, peakRelease, peak: Math.max(peakFreeze, peakRelease) }
}

const DIR = new THREE.Vector3(1, 0.16, 0)

describe('camera kick on contact', () => {
  it('fires a real kick that scales with attack weight', () => {
    // No freeze: play the kick straight out, as it lands mid-combo.
    const light = kick(0.10, DIR, 0, 40).peak
    const heavy = kick(0.26, DIR, 0, 40).peak
    const ko = kick(0.50, DIR, 0, 40).peak

    // Non-zero — the v9 defect was exactly this reading ~0. The idle drift floor
    // is <1px, so a >2px kick is unambiguously a kick, not handheld noise.
    expect(light).toBeGreaterThan(2)
    // Strictly monotonic in weight: a jab must not shake like a launcher.
    expect(heavy).toBeGreaterThan(light * 1.4)
    expect(ko).toBeGreaterThan(heavy * 1.4)
  })

  it('stays quiet when nothing hit (no false kick from drift)', () => {
    // No impulse at all: only the handheld micro-drift runs. A camera that
    // shoves when nothing landed erases the language of impact, so idle must
    // read as essentially still.
    const idle = kick(0, DIR, 0, 40).peak
    expect(idle).toBeLessThan(1.5)
  })

  it('holds the kick through the hitstop freeze and plays it out on release', () => {
    // THE v9 fix. The kick spring is stepped on SIM-FRAME time, so in a frozen
    // gap (no sim frame advancing — e.g. the wall-clock pause between a capture
    // tool's frames, or the hitstop freeze) it is held, not decayed on wall time
    // as before, and only punches out as sim frames actually advance — which is
    // exactly when the filmstrip harness steps and captures. If the kick were
    // stepped on real time again, it would be spent during the freeze and this
    // test goes red.
    const { peakFreeze, peakRelease } = kick(0.26, DIR, 9, 30)
    expect(peakFreeze).toBeLessThan(2) // held ~still through the freeze
    expect(peakRelease).toBeGreaterThan(5) // then a clear kick after release
    expect(peakRelease).toBeGreaterThan(peakFreeze * 3)
  })

  it('bounds a rapid combo so the camera never runs away', () => {
    // The velocity impulse is capped, so a fast string of hits can't integrate
    // the camera off into the void. Ten heavy kicks in ten frames must not stack
    // into an order-of-magnitude larger displacement than one.
    const single = kick(0.26, DIR, 0, 40).peak

    const { cam, fc } = fresh()
    const rest = px(cam, WATCH)
    let peak = 0
    for (let f = 0; f < 40; f++) {
      if (f < 10) fc.addShake(0.5, DIR)
      fc.update(DT, DT, FRAMING)
      const p = px(cam, WATCH)
      peak = Math.max(peak, Math.hypot(p.x - rest.x, p.y - rest.y))
    }
    expect(Number.isFinite(peak)).toBe(true)
    expect(peak).toBeLessThan(single * 4)
  })
})
