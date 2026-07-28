import { describe, it, expect } from 'vitest'
import { clashing, type ClashPoint } from '../ProjectileFx'

/**
 * `clashing` is the pure trigger behind the projectile clash crackle. The burst
 * itself is a bright additive flash that no pixel diff can prove (a new object
 * can't be differenced away), so the honest test is on the DECISION: does the
 * renderer decide to crackle here? Every case below is written so a plausible
 * mutation of the predicate flips it — that is the proof it can fail.
 */

const at = (owner: 0 | 1, x: number, y: number): ClashPoint => ({ owner, x, y })

describe('clashing (projectile clash trigger)', () => {
  it('fires for opposing owners within the threshold', () => {
    expect(clashing(at(0, 0, 0), at(1, 0.4, 0), 0.7)).toBe(true)
  })

  it('does NOT fire for opposing owners beyond the threshold', () => {
    expect(clashing(at(0, 0, 0), at(1, 1.2, 0), 0.7)).toBe(false)
  })

  it('never fires between a fighter\'s OWN two bolts, even overlapping', () => {
    // The owner guard is the whole point: a zoner\'s own spread must not crackle
    // against itself. Drop the guard and this flips true.
    expect(clashing(at(0, 0, 0), at(0, 0, 0), 0.7)).toBe(false)
    expect(clashing(at(1, 0.1, 0.1), at(1, 0, 0), 0.7)).toBe(false)
  })

  it('is inclusive exactly at the threshold distance', () => {
    // Distance exactly 0.7 on X. `<` instead of `<=` (or a hair-off threshold)
    // turns this red.
    expect(clashing(at(0, 0, 0), at(1, 0.7, 0), 0.7)).toBe(true)
    expect(clashing(at(0, 0, 0), at(1, 0.7001, 0), 0.7)).toBe(false)
  })

  it('measures true 2-D distance, not just horizontal gap', () => {
    // Same x, but a full threshold apart in y -> still within range. A predicate
    // that only compared dx would wrongly report these as touching when far in y,
    // and would miss this genuine vertical cross. Here dy=0.5,dx=0.5 -> dist
    // ~0.707 > 0.7 so it must be FALSE; collapsing to dx-only (0.5<=0.7) flips it.
    expect(clashing(at(0, 0, 0), at(1, 0.5, 0.5), 0.7)).toBe(false)
    // ...and a purely vertical cross within range must still fire.
    expect(clashing(at(0, 0, 0), at(1, 0, 0.6), 0.7)).toBe(true)
  })
})
