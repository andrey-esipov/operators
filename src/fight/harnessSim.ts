/**
 * A drop-in replacement for the renderer's throwaway `MockSim`, backed by the
 * REAL simulation. It exposes the exact surface the harness consumes —
 * `step(): StepResult`, `get phase(): string`, `frame: number` — so swapping it
 * in is a one-line change on the renderer side.
 *
 * Both fighters are driven by the tiered AI, so this is a genuine CPU-vs-CPU
 * match: it opens in footsies, walks people down, lands combos, blocks, throws,
 * and eventually KOs — the full vocabulary the renderer needs to exercise. It
 * is deterministic: same seed in, same fight out, every run. That matters
 * because the screenshot tool advances to absolute frame numbers and must land
 * on the same moment each time.
 *
 * The `phase` string is a human-readable label for "what beat is this?", derived
 * from the authoritative state and this frame's events. It is presentation only
 * — nothing in the sim depends on it — so a mislabelled beat can never desync a
 * fight.
 */

import type { FightState, FightEvent, InputFrame, StepResult } from './types'
import { createFight, step } from './sim'
import { makeAI, type FighterAI, type Difficulty } from './ai'

export interface HarnessSimOptions {
  /** Master seed. The two AIs are derived from it so a mirror match doesn't
   *  lock-step into a stalemate. */
  seed?: number
  /** Left/right character ids (default: a shoto vs the grappler for variety). */
  p1?: string
  p2?: string
  /** Per-side difficulty. Defaults chosen to produce a lively, readable fight. */
  difficulty1?: Difficulty
  difficulty2?: Difficulty
}

/** Split a master seed into two decorrelated seeds (golden-ratio hash) so the
 *  two AIs make different choices and the match actually develops. */
function splitSeed(seed: number): [number, number] {
  const a = seed >>> 0
  const b = (seed ^ 0x9e3779b9) >>> 0
  return [a, b]
}

export class HarnessSim {
  frame = 0
  private state: FightState
  private readonly ai: [FighterAI, FighterAI]
  private label = 'intro'

  constructor(opts: HarnessSimOptions = {}) {
    const p1 = opts.p1 ?? 'operator'
    const p2 = opts.p2 ?? 'vanguard'
    const [s0, s1] = splitSeed(opts.seed ?? 0x51ac)
    this.state = createFight(p1, p2)
    this.ai = [
      makeAI({ seed: s0, difficulty: opts.difficulty1 ?? 'hard' }),
      makeAI({ seed: s1, difficulty: opts.difficulty2 ?? 'medium' }),
    ]
  }

  get phase(): string {
    return this.label
  }

  /** The initial state before any stepping, for setInitialState-style priming. */
  get initialState(): FightState {
    return this.state
  }

  step(): StepResult {
    const inputs: [InputFrame, InputFrame] = [
      this.ai[0].decide(this.state, 0),
      this.ai[1].decide(this.state, 1),
    ]
    const res = step(this.state, inputs)
    this.state = res.state
    this.frame = this.state.frame
    this.label = labelFor(this.state, res.events)
    return res
  }
}

/**
 * Turn authoritative state + this frame's events into a readable beat label.
 * Event-driven moments (a hit landing, a super flash) win over standing state,
 * so the label names the most salient thing that just happened.
 */
function labelFor(s: FightState, events: FightEvent[]): string {
  // Non-fight phases map straight through — these are the screens humans look
  // for (intro, KO freeze, round/match end).
  switch (s.phase) {
    case 'intro': return 'intro'
    case 'ko': return 'ko'
    case 'round-end': return 'round-end'
    case 'match-end': return 'match-end'
  }

  // Salient one-frame events first.
  for (const e of events) {
    if (e.type === 'super-flash') return 'super'
    if (e.type === 'ko') return 'ko'
    if (e.type === 'parry') return 'parry'
    if (e.type === 'throw') return 'throw'
    if (e.type === 'wall-bounce') return 'wall-bounce'
    if (e.type === 'knockdown') return 'knockdown'
    if (e.type === 'launch') return 'juggle'
    if (e.type === 'block') return 'blocked'
    if (e.type === 'hit') return 'hit'
    if (e.type === 'round-start') return 'round-start'
  }

  const [a, b] = s.fighters
  // Someone mid-super (the super move ids start with 'super').
  if (a.move?.id.startsWith('super') || b.move?.id.startsWith('super')) return 'super'

  const stances = [a.stance, b.stance]
  if (stances.includes('juggle') || stances.includes('knockdown')) return 'juggle'
  if (stances.includes('hitstun')) return 'hitstun'
  if (stances.includes('blockstun')) return 'blocked'
  if (stances.includes('throw-tech')) return 'throw-tech'
  if (stances.includes('attack')) return 'attack'
  if (stances.includes('jump-rise') || stances.includes('jump-fall')) return 'jump'
  if (stances.includes('dash') || stances.includes('backdash')) return 'dash'

  // Grounded neutral: are they jockeying for space, or sitting still?
  const dist = Math.abs(a.pos.x - b.pos.x)
  if (stances.includes('walk-fwd') || stances.includes('walk-back') || stances.includes('crouch')) {
    return dist < 170 ? 'footsies' : 'neutral'
  }
  return 'neutral'
}
