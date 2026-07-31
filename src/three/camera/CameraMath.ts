import * as THREE from 'three'

/**
 * Physics + signal helpers for the camera director.
 *
 * A fighting-game camera must feel like it has *mass*: it accelerates, carries
 * momentum, overshoots and settles. Linear interpolation can't do that, so the
 * director drives every channel (position, look-target, fov, roll) through
 * critically-tunable spring–dampers instead. The integrators here are
 * sub-stepped so they stay stable and framerate-independent even when a stray
 * frame spikes to 100 ms.
 */

const MAX_STEP = 1 / 120

/** A single scalar spring–damper. `omega` = stiffness, `zeta` = damping ratio. */
export class Spring1 {
  value: number
  vel = 0
  constructor(initial = 0) {
    this.value = initial
  }
  set(v: number) {
    this.value = v
    this.vel = 0
  }
  /** Kick the spring's velocity (impulse). */
  kick(v: number) {
    this.vel += v
  }
  step(target: number, omega: number, zeta: number, dt: number) {
    if (dt <= 0) return this.value
    const k = omega * omega
    const c = 2 * zeta * omega
    let remaining = dt
    while (remaining > 1e-6) {
      const h = Math.min(MAX_STEP, remaining)
      const a = -k * (this.value - target) - c * this.vel
      this.vel += a * h
      this.value += this.vel * h
      remaining -= h
    }
    return this.value
  }
}

/** A three-axis spring–damper sharing one omega/zeta across all axes. */
export class Spring3 {
  value = new THREE.Vector3()
  vel = new THREE.Vector3()
  private tmp = new THREE.Vector3()
  constructor(x = 0, y = 0, z = 0) {
    this.value.set(x, y, z)
  }
  set(v: THREE.Vector3) {
    this.value.copy(v)
    this.vel.set(0, 0, 0)
  }
  kick(v: THREE.Vector3) {
    this.vel.add(v)
  }
  step(target: THREE.Vector3, omega: number, zeta: number, dt: number) {
    if (dt <= 0) return this.value
    const k = omega * omega
    const c = 2 * zeta * omega
    let remaining = dt
    while (remaining > 1e-6) {
      const h = Math.min(MAX_STEP, remaining)
      // a = -k*(x - target) - c*v
      this.tmp.copy(this.value).sub(target).multiplyScalar(-k)
      this.tmp.addScaledVector(this.vel, -c)
      this.vel.addScaledVector(this.tmp, h)
      this.value.addScaledVector(this.vel, h)
      remaining -= h
    }
    return this.value
  }
}

/** Exponential decay toward zero — framerate independent. */
export function decayTo(v: number, rate: number, dt: number, target = 0): number {
  return target + (v - target) * Math.exp(-rate * dt)
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export function easeInOut(t: number): number {
  t = clamp01(t)
  return t * t * (3 - 2 * t)
}
export function easeOutCubic(t: number): number {
  t = clamp01(t)
  const u = 1 - t
  return 1 - u * u * u
}
export function easeInCubic(t: number): number {
  t = clamp01(t)
  return t * t * t
}
/** Anticipation-then-overshoot ease (a "back" ease) for whip moves. */
export function easeOutBack(t: number, s = 1.7): number {
  t = clamp01(t) - 1
  return t * t * ((s + 1) * t + s) + 1
}

/**
 * Fractal value noise in 1D — several octaves of smoothed hash summed so the
 * handheld drift and shake read as organic camera-operator motion rather than
 * a single sine or white noise. Deterministic for a given input.
 */
export function fbm1(x: number, seed = 0): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  for (let o = 0; o < 3; o++) {
    sum += (valNoise1(x * freq + seed * 17.13) * 2 - 1) * amp
    amp *= 0.5
    freq *= 2.03
  }
  return sum
}

export function valNoise1(x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  const a = hash1(i)
  const b = hash1(i + 1)
  return a + (b - a) * u
}

function hash1(i: number): number {
  const x = Math.sin(i * 127.1) * 43758.5453
  return x - Math.floor(x)
}
