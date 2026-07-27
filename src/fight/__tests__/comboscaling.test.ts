import { describe, expect, it } from 'vitest'
import { scaleDamage } from '../combat'
import { fightAtRange, inp, NEU, run } from './helpers'
import { COMBO_SCALING } from '../constants'

describe('combo damage scaling', () => {
  it('scaleDamage matches the published curve with a floor', () => {
    // First two hits full, then the curve, clamped to the last entry.
    expect(scaleDamage(100, 0, 1)).toBe(100)
    expect(scaleDamage(100, 1, 1)).toBe(100)
    expect(scaleDamage(100, 2, 1)).toBe(90)
    expect(scaleDamage(100, 3, 1)).toBe(80)
    // Per-move scaling stacks multiplicatively.
    expect(scaleDamage(100, 2, 0.9)).toBe(81)
    // Never below the minimum-damage floor.
    expect(scaleDamage(10, 40, 0.5)).toBe(5)
    // Deep into a combo it clamps to the last scaling entry, not zero.
    const last = COMBO_SCALING[COMBO_SCALING.length - 1]
    expect(scaleDamage(1000, 50, 1)).toBe(Math.round(1000 * last))
  })

  it('a real chain deals strictly diminishing per-hit damage', () => {
    // P1 mashes jab into a rapid chain; P2 eats it (no block).
    const s = fightAtRange(60)
    const { events } = run(s, 60, () => inp(5, 'lp'), () => NEU)
    const hits = events.filter((e) => e.type === 'hit') as Extract<
      typeof events[number], { type: 'hit' }
    >[]

    expect(hits.length).toBeGreaterThanOrEqual(3)
    // The exact scaled values for a 30-damage jab: 30, 30, 27, 24, …
    expect(hits[0].damage).toBe(30)
    expect(hits[1].damage).toBe(30)
    expect(hits[2].damage).toBe(27)
    // Damage is monotonically non-increasing across the combo.
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].damage).toBeLessThanOrEqual(hits[i - 1].damage)
    }
  })
})
