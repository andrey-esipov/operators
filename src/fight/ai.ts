/**
 * A CPU opponent with genuine difficulty tiers. It is not part of the
 * deterministic sim — it only produces InputFrames the sim consumes — but it is
 * itself deterministic given a seed, so AI-vs-AI matches replay identically.
 *
 * What separates the tiers is not a bigger damage number, it is *reaction time*
 * and *decision quality*. A human can't see a jump-in and anti-air it on the
 * same frame; neither should the AI. Each tier reads a delayed snapshot of the
 * opponent (reactionFrames old) and only reacts to that, so a jab it "didn't
 * see coming" lands, exactly as against a person. Harder tiers see fresher
 * state, block/punish/tech more reliably, and press their turn harder. An AI
 * that reacts on frame 1 or never blocks both feel fake; these sit in between.
 *
 * Behaviours, in priority order: tech a read throw, anti-air a jumping opponent,
 * block a committed attack, whiff-punish a move caught in recovery, and
 * otherwise walk into range and poke.
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

/** Relative -> absolute for the AI: forward means "toward the opponent". */
function toward(dir: Direction, facing: 1 | -1): Direction {
  if (facing === 1) return dir
  const flip: Record<Direction, Direction> = {
    1: 3, 2: 2, 3: 1, 4: 6, 5: 5, 6: 4, 7: 9, 8: 8, 9: 7,
  }
  return flip[dir]
}

export type Difficulty = 'easy' | 'medium' | 'hard'

interface Tier {
  /** How many frames stale the opponent read is — the human reaction lag. */
  reactionFrames: number
  /** Probability of blocking a committed attack it has "seen". */
  blockChance: number
  /** Probability of whiff-punishing a move caught in recovery. */
  punishChance: number
  /** Probability of teching a throw it reads coming. */
  techChance: number
  /** 0..1 offensive pressure. */
  aggression: number
}

const TIERS: Record<Difficulty, Tier> = {
  // Slow to react, drops most blocks, barely techs — a beginner punching bag
  // that still occasionally defends itself.
  easy: { reactionFrames: 22, blockChance: 0.30, punishChance: 0.20, techChance: 0.10, aggression: 0.30 },
  // Competent: blocks the obvious, punishes the slow, techs some throws.
  medium: { reactionFrames: 14, blockChance: 0.65, punishChance: 0.55, techChance: 0.40, aggression: 0.55 },
  // Sharp but still human-shaped: an 8-frame read is fast, not frame-perfect.
  hard: { reactionFrames: 8, blockChance: 0.92, punishChance: 0.85, techChance: 0.70, aggression: 0.78 },
}

/** What the AI reacts to — the opponent's state, snapshotted so we can react to
 *  a delayed copy and never with inhuman immediacy. */
interface Obs {
  grounded: boolean
  posY: number
  dist: number
  attacking: boolean
  inRecovery: boolean
  throwStartup: boolean
}

export interface AIOptions {
  seed?: number
  difficulty?: Difficulty
  /** Optional override of the tier's aggression (kept for back-compat). */
  aggression?: number
}

export class FighterAI {
  private queue: Step[] = []
  private readonly rng: Rng
  private readonly tier: Tier
  private readonly aggression: number
  private readonly obs: Obs[] = []

  constructor(opts: AIOptions = {}) {
    this.rng = makeRng(opts.seed ?? 0x51ac)
    this.tier = TIERS[opts.difficulty ?? 'medium']
    this.aggression = opts.aggression ?? this.tier.aggression
  }

  /** Snapshot the opponent this frame and return the read from reactionFrames
   *  ago — the freshest state this tier is allowed to have noticed. */
  private observe(state: FightState, me: 0 | 1): Obs {
    const meF = state.fighters[me]
    const opp = state.fighters[1 - me]
    const oppMove = opp.move ? getFighterDef(opp.id).moves[opp.move.id] : undefined
    const cur: Obs = {
      grounded: opp.grounded,
      posY: opp.pos.y,
      dist: Math.abs(opp.pos.x - meF.pos.x),
      attacking: opp.stance === 'attack',
      inRecovery: !!oppMove && !!opp.move && opp.move.frame > oppMove.active[1],
      throwStartup:
        !!oppMove && !!opp.move && oppMove.hit.guard === 'throw' &&
        opp.move.frame <= oppMove.active[1],
    }
    this.obs.push(cur)
    const idx = this.obs.length - 1 - this.tier.reactionFrames
    return idx >= 0 ? this.obs[idx] : this.obs[0]
  }

  decide(state: FightState, i: 0 | 1): InputFrame {
    const me = state.fighters[i]
    const facing = me.facing
    // Always advance the observation ring, even when replaying a queued motion,
    // so reaction timing stays honest.
    const o = this.observe(state, i)

    // Play out a queued motion (a special takes several frames to input).
    if (this.queue.length > 0) {
      const step = this.queue.shift() as Step
      return frame(toward(step.rel, facing), step.buttons)
    }

    if (state.phase !== 'fight') return frame(5)

    const back: Direction = 4
    const downBack: Direction = 1
    const fwd: Direction = 6

    // Reading own state (stun/recovery) is instant — you always know your own
    // situation. Only the opponent read is delayed.
    const canAct = state.hitstop === 0 && me.stunRemaining === 0 &&
      (me.stance === 'idle' || me.stance === 'walk-fwd' || me.stance === 'walk-back' ||
        me.stance === 'crouch')
    if (!canAct) return frame(toward(downBack, facing))

    // Throw defence: read a close throw startup and roll the tier's tech chance,
    // pressing LP+LK to break it (option-selected with a down-back block).
    if (o.throwStartup && o.dist < 75 && this.rng.next() < this.tier.techChance) {
      return frame(toward(downBack, facing), ['lp', 'lk'])
    }

    // Anti-air: opponent airborne and in range -> rising uppercut (cr.HP). Gated
    // by the tier so easy whiffs it more often.
    if (!o.grounded && o.posY > 55 && o.dist < 175) {
      if (this.rng.next() < 0.4 + this.tier.blockChance * 0.6) {
        return frame(toward(2, facing), ['hp'])
      }
      return frame(toward(back, facing)) // otherwise just retreat-guard
    }

    // React to a committed close attack.
    if (o.attacking && o.dist < 150) {
      if (o.inRecovery && o.dist < 120 && this.rng.next() < this.tier.punishChance) {
        // Whiff punish: quarter-circle Surge Palm for a real reward.
        this.queue = [{ rel: 3 }, { rel: 6, buttons: ['hp'] }]
        return frame(toward(2, facing))
      }
      if (this.rng.next() < this.tier.blockChance) {
        return frame(toward(o.posY > 20 ? back : downBack, facing))
      }
    }

    // Spacing (uses the delayed distance too, so the AI commits to approaches).
    if (o.dist > 165) {
      if (this.rng.next() < 0.02 + this.aggression * 0.04) {
        return frame(toward(9, facing)) // jump toward
      }
      return frame(toward(fwd, facing))
    }
    if (o.dist > 95) {
      if (this.rng.next() < 0.05 + this.aggression * 0.1) {
        return frame(toward(2, facing), ['mk']) // cr.MK poke
      }
      return frame(toward(fwd, facing))
    }
    // Point blank: press a light, throw, or convert into a special.
    const r = this.rng.next()
    if (r < 0.08 + this.aggression * 0.12) {
      return frame(toward(5, facing), ['lp', 'lk']) // go for a throw in the scramble
    }
    if (r < 0.22 + this.aggression * 0.25) {
      this.queue = [{ rel: 3 }, { rel: 6, buttons: ['lp'] }] // stagger into a special
      return frame(toward(2, facing), ['lk'])
    }
    if (r < 0.55) return frame(toward(2, facing), ['lp'])
    return frame(toward(downBack, facing)) // hold defense
  }
}

export function makeAI(opts?: AIOptions): FighterAI {
  return new FighterAI(opts)
}
