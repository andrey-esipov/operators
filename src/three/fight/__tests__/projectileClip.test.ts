import { describe, it, expect } from 'vitest'
import { frameAt } from '../ProjectileLayer'
import type { ProjectileClip } from '../loadProjectileAtlas'

/**
 * The projectile lifecycle (spawn once → travel loop → impact once) is driven
 * entirely by `frameAt`: it maps an elapsed tick count onto a clip's frame and,
 * for one-shots, reports when the clip has ended so the layer can promote
 * spawn→travel and retire a spent impact. The two failure modes that matter are
 * a one-shot that never reports `done` (a bolt that spawns and then freezes on
 * its spawn pose forever) and a loop that stalls on one frame (a static blob) —
 * both would satisfy a naive "a projectile was drawn" check, so they get an
 * explicit guard here.
 */
describe('frameAt clip resolution', () => {
  // ion-bolt's real spawn clip: 4 frames (indices 0..3), 2 ticks each.
  const spawn: ProjectileClip = { frames: [0, 1, 2, 3], durations: [2, 2, 2, 2], loop: false }
  // ion-bolt's real travel loop: 8 frames (indices 4..11), 3 ticks each.
  const travel: ProjectileClip = {
    frames: [4, 5, 6, 7, 8, 9, 10, 11],
    durations: [3, 3, 3, 3, 3, 3, 3, 3],
    loop: true,
  }

  it('walks a one-shot clip frame by frame', () => {
    expect(frameAt(spawn, 0)).toEqual({ idx: 0, done: false })
    expect(frameAt(spawn, 1)).toEqual({ idx: 0, done: false })
    expect(frameAt(spawn, 2)).toEqual({ idx: 1, done: false })
    expect(frameAt(spawn, 5)).toEqual({ idx: 2, done: false })
    expect(frameAt(spawn, 7)).toEqual({ idx: 3, done: false })
  })

  it('reports done and holds the last frame once a one-shot ends', () => {
    // total = 8 ticks. At/after that the clip is finished.
    expect(frameAt(spawn, 8)).toEqual({ idx: 3, done: true })
    expect(frameAt(spawn, 40)).toEqual({ idx: 3, done: true })
    // A spawn that never reports done would leave the bolt stuck on its spawn
    // pose — the exact "renders one frame then never advances" failure.
    expect(frameAt(spawn, 8).done).toBe(true)
  })

  it('wraps a looping clip and never reports done', () => {
    expect(frameAt(travel, 0)).toEqual({ idx: 4, done: false })
    expect(frameAt(travel, 3)).toEqual({ idx: 5, done: false })
    // total = 24 ticks; tick 24 wraps back to the first travel frame.
    expect(frameAt(travel, 24)).toEqual({ idx: 4, done: false })
    expect(frameAt(travel, 27)).toEqual({ idx: 5, done: false })
    // Sampled across a couple of loops the index must keep moving, not stall.
    const seen = new Set<number>()
    for (let t = 0; t < 48; t++) seen.add(frameAt(travel, t).idx)
    expect(seen.size).toBe(8)
  })

  it('degrades safely on an empty clip', () => {
    const empty: ProjectileClip = { frames: [], durations: [], loop: false }
    expect(frameAt(empty, 0).done).toBe(true)
  })
})
