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
import { REACH_BONUS } from './constants'

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
  /** Per-frame chance of taking a super opportunity when one exists and meter is
   *  up. Small numbers still fire reliably because opportunities span several
   *  frames; a higher tier simply cashes them in more often and sooner. */
  superChance: number
  /** Probability of reading a committed attack (or incoming fireball) and
   *  parrying it instead of blocking — the Third Strike defensive read. Higher
   *  tiers parry far more; a beginner almost never lands one. */
  parryChance: number
}

const TIERS: Record<Difficulty, Tier> = {
  // Slow to react, drops most blocks, barely techs — a beginner punching bag
  // that still occasionally defends itself.
  easy: { reactionFrames: 22, blockChance: 0.30, punishChance: 0.20, techChance: 0.10, aggression: 0.30, superChance: 0.05, parryChance: 0.05 },
  // Competent: blocks the obvious, punishes the slow, techs some throws.
  medium: { reactionFrames: 14, blockChance: 0.65, punishChance: 0.55, techChance: 0.40, aggression: 0.55, superChance: 0.12, parryChance: 0.28 },
  // Sharp but still human-shaped: an 8-frame read is fast, not frame-perfect.
  hard: { reactionFrames: 8, blockChance: 0.92, punishChance: 0.85, techChance: 0.70, aggression: 0.78, superChance: 0.22, parryChance: 0.6 },
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
  oppHealth: number
  /** Guard of the opponent's live strike (startup/active, not recovery), or null.
   *  Drives the parry direction: 'low' parries down, everything else forward. */
  attackGuard: string | null
  /** Nearest incoming enemy projectile heading at me: its horizontal distance and
   *  guard, or null. Lets the AI read a fireball and parry it. */
  projectile: { dist: number; guard: string } | null
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
  /** Cached lookup of this fighter's super (motion + cost), resolved once from
   *  its def. `null` means the character has no motion super. */
  private superInfo?: { motion: string; cost: number } | null

  constructor(opts: AIOptions = {}) {
    this.rng = makeRng(opts.seed ?? 0x51ac)
    this.tier = TIERS[opts.difficulty ?? 'medium']
    this.aggression = opts.aggression ?? this.tier.aggression
  }

  /** This fighter's super, or null. Cached because a fighter never changes id. */
  private getSuper(id: string): { motion: string; cost: number } | null {
    if (this.superInfo !== undefined) return this.superInfo
    const supers = Object.values(getFighterDef(id).moves).filter(
      (m) => m.tag === 'super' && !!m.motion,
    )
    // Prefer the cheapest super so the AI can actually afford to throw one.
    supers.sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0))
    const s = supers[0]
    this.superInfo = s && s.motion ? { motion: s.motion, cost: s.cost ?? 1000 } : null
    return this.superInfo
  }

  /** Begin a super: return the first motion input now and queue the rest, ending
   *  on a punch so `punchTriggered` fires. The motion is facing-relative, so it
   *  mirrors correctly on either side. */
  private startSuper(motion: string, facing: 1 | -1): InputFrame {
    const digits = motion.split('').map((c) => Number(c) as Direction)
    const rest = digits.slice(1)
    this.queue = rest.map((d, idx) =>
      idx === rest.length - 1 ? { rel: d, buttons: ['hp'] as Button[] } : { rel: d },
    )
    return frame(toward(digits[0], facing))
  }

  /** Snapshot the opponent this frame and return the read from reactionFrames
   *  ago — the freshest state this tier is allowed to have noticed. */
  private observe(state: FightState, me: 0 | 1): Obs {
    const meF = state.fighters[me]
    const opp = state.fighters[1 - me]
    const oppMove = opp.move ? getFighterDef(opp.id).moves[opp.move.id] : undefined
    // A strike is parryable only while it can still connect (startup + active),
    // not once it's whiffed into recovery. Throws and unblockables never parry.
    const liveStrike =
      opp.stance === 'attack' && !!oppMove && !!opp.move &&
      opp.move.frame <= oppMove.active[1] &&
      oppMove.hit.guard !== 'throw' && oppMove.hit.guard !== 'unblockable'
    // Nearest enemy fireball actually closing on me.
    let projectile: { dist: number; guard: string } | null = null
    for (const p of state.projectiles ?? []) {
      if (p.owner === me) continue
      const closing = Math.sign(p.vel.x) === Math.sign(meF.pos.x - p.pos.x)
      if (!closing) continue
      const d = Math.abs(p.pos.x - meF.pos.x)
      if (!projectile || d < projectile.dist) projectile = { dist: d, guard: p.hit.guard }
    }
    const cur: Obs = {
      grounded: opp.grounded,
      posY: opp.pos.y,
      dist: Math.abs(opp.pos.x - meF.pos.x),
      attacking: opp.stance === 'attack',
      inRecovery: !!oppMove && !!opp.move && opp.move.frame > oppMove.active[1],
      throwStartup:
        !!oppMove && !!opp.move && oppMove.hit.guard === 'throw' &&
        opp.move.frame <= oppMove.active[1],
      oppHealth: opp.health,
      attackGuard: liveStrike ? oppMove!.hit.guard : null,
      projectile,
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
    // The whole engagement sits REACH_BONUS further out than the boxes read at
    // face value (wider pushbox + matching reach), so every spacing band below is
    // shifted out by the same amount — the AI reads the same *relative* ranges it
    // always did, just at the fighters' true separation.
    const R = REACH_BONUS

    // Reading own state (stun/recovery) is instant — you always know your own
    // situation. Only the opponent read is delayed.
    const canAct = state.hitstop === 0 && me.stunRemaining === 0 &&
      (me.stance === 'idle' || me.stance === 'walk-fwd' || me.stance === 'walk-back' ||
        me.stance === 'crouch')
    if (!canAct) return frame(toward(downBack, facing))

    // Throw defence: read a close throw startup and roll the tier's tech chance,
    // pressing LP+LK to break it (option-selected with a down-back block).
    if (o.throwStartup && o.dist < 75 + R && this.rng.next() < this.tier.techChance) {
      return frame(toward(downBack, facing), ['lp', 'lk'])
    }

    // Super logic. A super the AI never throws is, to the player, a feature that
    // doesn't exist — so it deliberately looks for two spots: a round-closer
    // when the opponent is nearly dead and in range, and a big-whiff punish.
    const sup = this.getSuper(me.id)
    const haveSuper = !!sup && me.meter >= sup.cost
    if (haveSuper && o.dist < 175 + R && me.grounded) {
      // Round closer: opponent low enough that the super likely finishes it. A
      // healthy per-frame chance so a spectator actually sees the kill land.
      if (o.oppHealth <= 300 && this.rng.next() < 0.06 + this.aggression * 0.18) {
        return this.startSuper(sup!.motion, facing)
      }
      // Big-whiff punish: cash a caught recovery into the super instead of a poke.
      if (o.attacking && o.inRecovery && o.dist < 140 + R &&
          this.rng.next() < this.tier.punishChance) {
        return this.startSuper(sup!.motion, facing)
      }
    }

    // Read an incoming fireball and parry it head-on (tight window, meter reward)
    // instead of eating chip — the zoner-breaking answer a Third Strike player
    // reaches for. Distance-gated so the tap lands inside the parry window.
    if (o.projectile && o.projectile.dist < 80 && me.grounded &&
        this.rng.next() < this.tier.parryChance) {
      const pdir = o.projectile.guard === 'low' ? 2 : 6
      return frame(toward(pdir, facing))
    }

    // Anti-air: opponent airborne and in range -> rising uppercut (cr.HP). Gated
    // by the tier so easy whiffs it more often.
    if (!o.grounded && o.posY > 55 && o.dist < 175 + R) {
      if (this.rng.next() < 0.4 + this.tier.blockChance * 0.6) {
        return frame(toward(2, facing), ['hp'])
      }
      return frame(toward(back, facing)) // otherwise just retreat-guard
    }

    // React to a committed close attack.
    if (o.attacking && o.dist < 150 + R) {
      if (o.inRecovery && o.dist < 120 + R && this.rng.next() < this.tier.punishChance) {
        // Whiff punish: quarter-circle Surge Palm for a real reward.
        this.queue = [{ rel: 3 }, { rel: 6, buttons: ['hp'] }]
        return frame(toward(2, facing))
      }
      // Parry the read: tap INTO the attack (forward for highs, down for lows) in
      // its tight window instead of blocking. A fresh tap arms the parry, so this
      // single frame is enough; the reward (frame advantage + meter) makes it the
      // aggressive defensive option a skilled player picks over a safe block.
      if (o.attackGuard && this.rng.next() < this.tier.parryChance) {
        return frame(toward(o.attackGuard === 'low' ? 2 : 6, facing))
      }
      if (this.rng.next() < this.tier.blockChance) {
        return frame(toward(o.posY > 20 ? back : downBack, facing))
      }
    }

    // Spacing (uses the delayed distance too, so the AI commits to approaches).
    // A projectile character zones here instead of blindly walking in: it throws
    // fireballs from range to control space, which is the whole point of the
    // archetype. Melee-only characters have no `projectiles` table and fall
    // straight through to the approach, so their behaviour is unchanged.
    const zones = !!getFighterDef(me.id).projectiles
    if (o.dist > 165 + R) {
      if (zones && this.rng.next() < 0.45 + this.aggression * 0.2) {
        this.queue = [{ rel: 3 }, { rel: 6, buttons: ['hp'] }] // fast bolt fullscreen
        return frame(toward(2, facing))
      }
      if (this.rng.next() < 0.02 + this.aggression * 0.04) {
        return frame(toward(9, facing)) // jump toward
      }
      // A zoner would rather hold ground than close the gap for free.
      return frame(toward(zones ? 5 : fwd, facing))
    }
    if (o.dist > 95 + R) {
      if (zones && this.rng.next() < 0.30 + this.aggression * 0.2) {
        this.queue = [{ rel: 3 }, { rel: 6, buttons: ['lp'] }] // slow wall bolt
        return frame(toward(2, facing))
      }
      if (this.rng.next() < 0.05 + this.aggression * 0.1) {
        return frame(toward(2, facing), ['mk']) // cr.MK poke
      }
      return frame(toward(zones ? back : fwd, facing)) // zoner backs up to reset spacing
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
