import { describe, it, expect } from 'vitest'
import { MockSim, STAGE_MIN_X, STAGE_MAX_X } from '../mockSim'

/**
 * The scripted sim only exists to drive the renderer harness, but the capture
 * tool is only trustworthy if the choreography keeps both fighters framed.
 *
 * A double-integration bug (walk() stored its delta as velocity and slideDecay()
 * then applied that same delta again) accelerated both fighters into the right
 * wall within one loop. The camera correctly refuses to pan past the stage
 * bound, so every screenshot framed two fighters crushed against the frame edge.
 * These tests fail if that drift comes back.
 */
describe('mockSim choreography stays framed', () => {
  const LOOP = 596

  const runLoop = () => {
    const sim = new MockSim()
    const samples: { frame: number; a: number; b: number; phase: string }[] = []
    for (let i = 0; i < LOOP; i++) {
      const { state } = sim.step()
      samples.push({
        frame: i,
        a: state.fighters[0].pos.x,
        b: state.fighters[1].pos.x,
        phase: sim.phase,
      })
    }
    return samples
  }

  it('never pins a fighter against the stage wall', () => {
    const samples = runLoop()
    // Touching the wall is legal choreography; living there is the bug.
    const wallish = samples.filter(
      (s) =>
        s.a <= STAGE_MIN_X + 1 || s.a >= STAGE_MAX_X - 1 ||
        s.b <= STAGE_MIN_X + 1 || s.b >= STAGE_MAX_X - 1,
    )
    expect(wallish.length, `frames pinned to a wall: ${wallish.length}/${LOOP}`).toBe(0)
  })

  it('keeps the pair midpoint near stage centre', () => {
    const samples = runLoop()
    // The camera can only pan a little before its frustum edge hits the stage
    // wall, so a midpoint far from centre pushes fighters out of frame
    // regardless of how well the camera tracks.
    const worst = samples.reduce(
      (acc, s) => {
        const mid = Math.abs((s.a + s.b) * 0.5)
        return mid > acc.mid ? { mid, frame: s.frame, phase: s.phase } : acc
      },
      { mid: 0, frame: -1, phase: '' },
    )
    expect(
      worst.mid,
      `midpoint drifted to ${worst.mid.toFixed(0)}cm at frame ${worst.frame} (${worst.phase})`,
    ).toBeLessThan(180)
  })

  it('keeps the fighters close enough to share a frame', () => {
    const samples = runLoop()
    // The camera dollies out to fit both; past this they are specks.
    const worst = samples.reduce(
      (acc, s) => {
        const sep = Math.abs(s.a - s.b)
        return sep > acc.sep ? { sep, frame: s.frame, phase: s.phase } : acc
      },
      { sep: 0, frame: -1, phase: '' },
    )
    expect(
      worst.sep,
      `separation hit ${worst.sep.toFixed(0)}cm at frame ${worst.frame} (${worst.phase})`,
    ).toBeLessThan(430)
  })

  it('replays identically so captures are repeatable', () => {
    const fmt = (s: { a: number; b: number; phase: string }) =>
      `${s.a.toFixed(4)}|${s.b.toFixed(4)}|${s.phase}`
    expect(runLoop().map(fmt)).toEqual(runLoop().map(fmt))
  })
})
