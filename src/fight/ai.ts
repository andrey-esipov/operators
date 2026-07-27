/**
 * A basic but competent CPU opponent. It is not part of the deterministic sim —
 * it only produces InputFrames the sim consumes — but it is itself deterministic
 * given a seed, so AI-vs-AI matches replay identically.
 *
 * Behaviours, in priority order: anti-air a jumping opponent, block a close
 * attack, whiff-punish a move caught in recovery, and otherwise walk into range
 * and poke. That is enough that it defends itself and takes its turn rather than
 * standing still as a punching bag.
 */

import type { Button, Direction, FightState, InputFrame } from './types'
import { getFighterDef } from './fighters'
import { makeRng, type Rng } from './rng'

interface Step {
  rel: Direction
  buttons?: Button[]
}

function frame(dir: Direction, buttons?: Button[]): InputFrame {
  const set = new Set<Button>(buttons ?? [])
  return { dir, held: set, pressed: set }
}

/** Relative → absolute for the AI: forward means "toward the opponent". */
function toward(dir: Direction, facing: 1 | -1): Direction {
  if (facing === 1) return dir
  const flip: Record<Direction, Direction> = {
    1: 3, 2: 2, 3: 1, 4: 6, 5: 5, 6: 4, 7: 9, 8: 8, 9: 7,
  }
  return flip[dir]
}

export interface AIOptions {
  seed?: number
  /** 0..1. Higher presses buttons more often and blocks a touch less. */
  aggression?: number
}

export class FighterAI {
  private queue: Step[] = []
  private readonly rng: Rng
  private readonly aggression: number

  constructor(opts: AIOptions = {}) {
    this.rng = makeRng(opts.seed ?? 0x51ac)
    this.aggression = opts.aggression ?? 0.5
  }

  decide(state: FightState, i: 0 | 1): InputFrame {
    const me = state.fighters[i]
    const opp = state.fighters[1 - i]
    const facing = me.facing

    // Play out a queued motion (a special takes several frames to input).
    if (this.queue.length > 0) {
      const step = this.queue.shift() as Step
      return frame(toward(step.rel, facing), step.buttons)
    }

    if (state.phase !== 'fight') return frame(5)

    const dist = Math.abs(opp.pos.x - me.pos.x)
    const back: Direction = 4 // relative back → toward() converts to absolute
    const downBack: Direction = 1
    const fwd: Direction = 6

    // Can't act (stun / recovery / hitstop): hold down-back so we block the
    // instant we recover, low by default.
    const canAct = state.hitstop === 0 && me.stunRemaining === 0 &&
      (me.stance === 'idle' || me.stance === 'walk-fwd' || me.stance === 'walk-back' ||
        me.stance === 'crouch')
    if (!canAct) return frame(toward(downBack, facing))

    // Anti-air: opponent airborne and in range → rising uppercut (cr.HP).
    if (!opp.grounded && opp.pos.y > 55 && dist < 175) {
      return frame(toward(2, facing), ['hp'])
    }

    // Block a committed close attack. A little randomness so it isn't a wall.
    if (opp.stance === 'attack' && dist < 150) {
      const oppMove = opp.move ? getFighterDef(opp.id).moves[opp.move.id] : undefined
      const inRecovery = !!oppMove && !!opp.move && opp.move.frame > oppMove.active[1]
      if (inRecovery && dist < 120) {
        // Whiff punish: quarter-circle Surge Palm for a real reward.
        this.queue = [{ rel: 3 }, { rel: 6, buttons: ['hp'] }]
        return frame(toward(2, facing))
      }
      if (this.rng.next() > this.aggression * 0.35) {
        return frame(toward(opp.pos.y > 20 ? back : downBack, facing))
      }
    }

    // Spacing.
    if (dist > 165) {
      // Approach, occasionally hop in.
      if (this.rng.next() < 0.03 + this.aggression * 0.03) {
        return frame(toward(9, facing)) // jump toward
      }
      return frame(toward(fwd, facing))
    }
    if (dist > 95) {
      if (this.rng.next() < 0.06 + this.aggression * 0.08) {
        return frame(toward(2, facing), ['mk']) // cr.MK poke
      }
      return frame(toward(fwd, facing))
    }
    // Point blank: press a light or convert into a special.
    const r = this.rng.next()
    if (r < 0.18 + this.aggression * 0.25) {
      this.queue = [{ rel: 3 }, { rel: 6, buttons: ['lp'] }] // cr.LK-ish into palm feint
      return frame(toward(2, facing), ['lk'])
    }
    if (r < 0.5) return frame(toward(2, facing), ['lp'])
    return frame(toward(downBack, facing)) // hold defense
  }
}

export function makeAI(opts?: AIOptions): FighterAI {
  return new FighterAI(opts)
}
