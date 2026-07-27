import { describe, expect, it } from 'vitest'
import { detectMotion, detectCharge, detectDoubleTap, encode } from '../input/motion'
import { MOTION_WINDOW } from '../constants'
import type { Direction } from '../types'
import { fightAtRange, inp, dir, NEU } from './helpers'
import { step } from '../sim'
import type { FightState } from '../types'

/** Build a packed input log from a list of facing-relative directions. */
function log(...dirs: Direction[]): number[] {
  return dirs.map((d) => encode(d, 0, 0))
}

describe('motion recognition (unit)', () => {
  it('accepts a clean 236 within the window', () => {
    expect(detectMotion(log(2, 3, 6), '236')).toBe(true)
  })

  it('tolerates stray diagonals rolled through the motion', () => {
    // 5 → 2 → 3 → 6 with the button a frame late still reads as a QCF.
    expect(detectMotion(log(5, 2, 3, 3, 6, 6), '236')).toBe(true)
  })

  it('rejects a 236 spread wider than the window', () => {
    const wide: Direction[] = [2]
    for (let i = 0; i < MOTION_WINDOW + 2; i++) wide.push(5)
    wide.push(3, 6)
    // The "2" has scrolled out of the window, so only "36" remains — no match.
    expect(detectMotion(wide, '236')).toBe(false)
  })

  it('recognises a dragon-punch 623', () => {
    expect(detectMotion(log(6, 2, 3), '623')).toBe(true)
    expect(detectMotion(log(2, 3, 6), '623')).toBe(false)
  })

  it('recognises a charge motion only after a full charge', () => {
    const held: Direction[] = []
    for (let i = 0; i < 45; i++) held.push(4)
    held.push(6)
    expect(detectCharge(held)).toBe(true)
    // A brief tap of back is not a charge.
    expect(detectCharge(log(4, 4, 6))).toBe(false)
  })

  it('recognises a double tap forward', () => {
    expect(detectDoubleTap(log(6, 5, 6), 6)).toBe(true)
    expect(detectDoubleTap(log(6, 5, 5, 5, 6), 6)).toBe(true)
    expect(detectDoubleTap(log(6), 6)).toBe(false)
  })
})

describe('motion recognition (integration through the sim)', () => {
  function feed(frames: ReturnType<typeof inp>[]): FightState {
    let s = fightAtRange(120) // out of range so nothing else interferes
    for (const f of frames) s = step(s, [f, NEU]).state
    return s
  }

  it('a quarter-circle-forward + punch produces the special', () => {
    // P1 faces right, so raw stick dirs equal relative dirs.
    const s = feed([dir(2), dir(3), inp(6, 'hp')])
    expect(s.fighters[0].move?.id).toBe('qcf.P')
  })

  it('the same buttons entered too slowly fall back to the normal', () => {
    const frames = [dir(2)]
    for (let i = 0; i < MOTION_WINDOW + 2; i++) frames.push(NEU)
    frames.push(dir(3), inp(6, 'hp'))
    const s = feed(frames)
    // Motion window lapsed → this is just a standing heavy punch.
    expect(s.fighters[0].move?.id).toBe('st.HP')
  })
})
