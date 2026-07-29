/**
 * A match with a human in it.
 *
 * `HarnessSim` runs AI against AI so the capture tooling gets a deterministic
 * fight to photograph. This is its sibling for the case that actually matters:
 * one side driven by hardware. The only real difference is where each fighter's
 * `InputFrame` comes from, so that is the only thing this parameterises.
 *
 * Input is polled once per simulation frame, never per rendered frame. That
 * distinction is load-bearing: `InputSource.poll()` computes `pressed` by
 * diffing against the previous poll, so an extra call silently swallows a
 * button press and a skipped call silently repeats one. One sim step, one poll.
 *
 * Directions are absolute here (numpad, screen-relative). The simulation
 * converts to facing-relative itself, so neither the keyboard nor the pad has
 * to know which way anyone is looking.
 */

import type { FightState, InputFrame, StepResult } from '../fight/types'
import { createFight, step } from '../fight/sim'
import { makeAI, type Difficulty, type FighterAI } from '../fight/ai'
import { resolveSimFighter, type FighterPick } from '../fight/fighters'
import type { InputSource } from '../fight/input/sources'
import { neutralInput } from '../fight/input/sources'

export type Controller =
  | { kind: 'human'; source: InputSource }
  | { kind: 'cpu'; difficulty?: Difficulty; seed?: number }
  /**
   * Training dummy: stands still and never attacks. Every fighting game needs
   * one to learn combos against, and it is also the only honest way to test
   * that a control actually does what it claims — against a live CPU the
   * player spends most of the match in hitstun, so "pressing jump did nothing"
   * is indistinguishable from "jump is unwired".
   */
  | { kind: 'dummy' }

interface Driver {
  frame(state: FightState, index: 0 | 1): InputFrame
  dispose(): void
}

function makeDriver(c: Controller, fallbackSeed: number): Driver {
  if (c.kind === 'human') {
    return {
      frame: () => c.source.poll(),
      dispose: () => c.source.dispose?.(),
    }
  }
  if (c.kind === 'dummy') {
    return { frame: () => neutralInput(), dispose: () => {} }
  }
  const ai: FighterAI = makeAI({
    seed: c.seed ?? fallbackSeed,
    difficulty: c.difficulty ?? 'medium',
  })
  return {
    frame: (state, index) => ai.decide(state, index),
    dispose: () => {},
  }
}

export interface MatchSimOptions {
  /** Player-one pick: face + archetype. A bare archetype no longer type-checks
   *  — the skin must be named, which is the collapse-proofing this whole seam
   *  exists for (see `resolveSimFighter`). */
  p1: FighterPick
  p2: FighterPick
  controllers: [Controller, Controller]
  seed?: number
}

export class MatchSim {
  frame = 0
  private state: FightState
  private readonly drivers: [Driver, Driver]
  private readonly opts: MatchSimOptions

  constructor(opts: MatchSimOptions) {
    this.opts = opts
    const seed = opts.seed ?? 0x51ac
    this.state = createFight(resolveSimFighter(opts.p1), resolveSimFighter(opts.p2))
    this.drivers = [
      makeDriver(opts.controllers[0], seed),
      makeDriver(opts.controllers[1], (seed ^ 0x9e3779b9) >>> 0),
    ]
  }

  get initialState(): FightState {
    return this.state
  }

  get current(): FightState {
    return this.state
  }

  step(): StepResult {
    const inputs: [InputFrame, InputFrame] = [
      this.drivers[0].frame(this.state, 0),
      this.drivers[1].frame(this.state, 1),
    ]
    const res = step(this.state, inputs)
    this.state = res.state
    this.frame = this.state.frame
    return res
  }

  /**
   * Restart at round one. Reuses the existing drivers so a human's held keys
   * carry over rather than being observed as a fresh press on the first frame
   * of the new match.
   */
  restart(): void {
    this.state = createFight(resolveSimFighter(this.opts.p1), resolveSimFighter(this.opts.p2))
    this.frame = 0
  }

  dispose(): void {
    this.drivers[0].dispose()
    this.drivers[1].dispose()
  }
}
