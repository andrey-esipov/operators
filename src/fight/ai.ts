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
import { REACH_BONUS, PARRY_WINDOW, CANCEL_WINDOW } from './constants'

interface Step {
  rel: Direction
  buttons?: Button[]
}

/** One link in a hit-confirmed combo route. `rel` is the facing-relative stick
 *  direction the button is pressed with; `motion` (if present) is the special's
 *  facing-relative numpad motion, buffered digit-by-digit during the previous
 *  move so the cancel is already charged when its window opens. */
interface ComboStep {
  id: string
  rel: Direction
  btn?: Button
  motion?: string
}

/** An in-flight combo route: the plan, how far along it is, and how many frames
 *  of the current link's motion have been fed. `age` is a watchdog so a dropped
 *  or whiffed route can never spin forever. */
interface ComboRun {
  plan: ComboStep[]
  idx: number
  mp: number
  age: number
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

/** Every fighter's move table, keyed by id. */
type MoveTable = ReturnType<typeof getFighterDef>['moves']

/**
 * The hit-confirm juggle route for whichever archetype the AI is driving, or
 * null if the character lacks the moves for one. Each archetype juggles in a
 * DIFFERENT SHAPE — a grappler and a shoto must not run the same string — and
 * that shape is chosen here by which launcher-canceller the character owns:
 *
 *   - Shoto (operator): a long rushdown light chain into the cr.HP launcher,
 *     caught in the air by Surge Palm and, with meter, the super. Seven hits.
 *   - Grappler (vanguard): a SHORT heavy chain into cr.HP, cancelled into the
 *     Rising Knee (dp.K) — itself a launcher, so it re-pops the victim for a
 *     stubby, high-commitment air hit. Four hits: a grappler converts less off
 *     a stray poke than a shoto, matching its shortest juggle allowance.
 *
 * The route is gated on the moves it actually needs (as the operator route
 * always was), so a character without them falls through to single-hit offence
 * rather than firing a string into the void.
 */
function comboRoute(moves: MoveTable, haveSuper: boolean): ComboStep[] | null {
  // Shoto: rushdown chain -> launcher -> Surge Palm (+ super with meter).
  if (['cr.LK', 'cr.LP', 'cr.HP', 'qcf.P'].every((id) => moves[id])) {
    const plan: ComboStep[] = [
      { id: 'cr.LK', rel: 2, btn: 'lk' },
      { id: 'cr.LP', rel: 2, btn: 'lp' },
      { id: 'cr.LK', rel: 2, btn: 'lk' },
      { id: 'cr.LP', rel: 2, btn: 'lp' },
      { id: 'cr.LK', rel: 2, btn: 'lk' },
      { id: 'cr.HP', rel: 2, btn: 'hp' },
      { id: 'qcf.P', rel: 6, btn: 'lp', motion: '236' },
    ]
    if (haveSuper) {
      const sup = Object.values(moves).find((m) => m.tag === 'super' && !!m.motion)
      if (sup && sup.motion) plan.push({ id: sup.id, rel: 6, btn: 'hp', motion: sup.motion })
    }
    return plan
  }
  // Grappler: short heavy chain -> launcher -> Rising Knee (dp.K) re-launch. No
  // super tail — the grappler's super is a command grab that cannot juggle.
  if (['cr.LK', 'cr.LP', 'cr.HP', 'dp.K'].every((id) => moves[id])) {
    return [
      { id: 'cr.LK', rel: 2, btn: 'lk' },
      { id: 'cr.LP', rel: 2, btn: 'lp' },
      { id: 'cr.HP', rel: 2, btn: 'hp' },
      { id: 'dp.K', rel: 6, btn: 'lk', motion: '623' },
    ]
  }
  return null
}

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
  /** Probability of reading a committed attack (or incoming fireball) and
   *  parrying it instead of blocking — the Third Strike defensive read. Higher
   *  tiers parry far more; a beginner almost never lands one. */
  parryChance: number
  /** Probability of gambling an invulnerable wakeup reversal when pressured on
   *  getup. Deliberately never certain — a reversal that always fires is a
   *  frame-perfect autopilot the attacker can't bait, which is exactly the
   *  "inhuman opponent" anti-pattern. A beginner AI mostly just eats the meaty;
   *  a hard AI makes you respect its getup. */
  reversalChance: number
}

const TIERS: Record<Difficulty, Tier> = {
  // Slow to react, drops most blocks, barely techs — a beginner punching bag
  // that still occasionally defends itself.
  easy: { reactionFrames: 22, blockChance: 0.30, punishChance: 0.20, techChance: 0.10, aggression: 0.30, parryChance: 0.05, reversalChance: 0.10 },
  // Competent: blocks the obvious, punishes the slow, techs some throws.
  medium: { reactionFrames: 14, blockChance: 0.65, punishChance: 0.55, techChance: 0.40, aggression: 0.55, parryChance: 0.28, reversalChance: 0.24 },
  // Sharp but still human-shaped: an 8-frame read is fast, not frame-perfect.
  hard: { reactionFrames: 8, blockChance: 0.92, punishChance: 0.85, techChance: 0.70, aggression: 0.78, parryChance: 0.6, reversalChance: 0.42 },
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
  /** Nearest incoming enemy projectile heading at me, or null. `eta` is the
   *  number of frames from NOW until it reaches parry range, already corrected
   *  for this tier's reaction delay — so the AI taps when the bolt truly
   *  arrives, not when a stale snapshot claims it is close (by which point the
   *  real bolt has flown past). That correction is what makes fireball parry a
   *  reachable action instead of dead code. */
  projectile: { eta: number; guard: string } | null
}

export interface AIOptions {
  seed?: number
  difficulty?: Difficulty
  /** Optional override of the tier's aggression (kept for back-compat). */
  aggression?: number
}

export class FighterAI {
  private queue: Step[] = []
  private combo: ComboRun | null = null
  private readonly rng: Rng
  /** A SEPARATE stream for the wakeup-reversal roll. Reversal is the newest
   *  behaviour and it must not perturb the main decision cadence: if it drew from
   *  `rng`, every knockdown would shift the shared stream and silently re-roll
   *  every other tuned decision downstream (which broke the throw-tech and combo
   *  baselines). Seeding it off the same seed keeps the AI fully deterministic
   *  while making the reversal additive to everything that came before it. */
  private readonly revRng: Rng
  private readonly tier: Tier
  private readonly aggression: number
  private readonly obs: Obs[] = []
  /** Cached lookup of this fighter's super (motion + cost), resolved once from
   *  its def. `null` means the character has no motion super. */
  private superInfo?: { motion: string; cost: number } | null
  /** Cached lookup of this fighter's invulnerable meterless reversal (a DP-style
   *  special with startup invuln + a motion), or `null` for archetypes that have
   *  none — a zoner is meant to have no getup escape but its super. */
  private reversalInfo?: { motion: string; btn: Button } | null
  /** Latched so the wakeup reversal is rolled at most once per knockdown, never
   *  re-rolled every frame of the getup (which would inflate the real rate far
   *  past the tier value and make it near-certain). Re-armed once we're actionable
   *  and no longer knocked down. */
  private wakeupArmed = true

  constructor(opts: AIOptions = {}) {
    this.rng = makeRng(opts.seed ?? 0x51ac)
    this.revRng = makeRng((opts.seed ?? 0x51ac) ^ 0x5eed)
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

  /** This fighter's invulnerable reversal, or null. A reversal is a special that
   *  carries startup invuln AND a motion (so it can be buffered on wakeup). We
   *  read the trigger button from the id suffix — `.K` is kick-triggered, every
   *  other reversal is punch — matching how `select` gates each motion. */
  private getReversal(id: string): { motion: string; btn: Button } | null {
    if (this.reversalInfo !== undefined) return this.reversalInfo
    const cand = Object.values(getFighterDef(id).moves).find(
      (m) => m.tag === 'special' && !!m.motion &&
        m.frames.some((fr) => fr.invuln === 'strike' || fr.invuln === 'full'),
    )
    this.reversalInfo = cand && cand.motion
      ? { motion: cand.motion, btn: cand.id.endsWith('.K') ? 'hk' : 'hp' }
      : null
    return this.reversalInfo
  }

  /** Feed a reversal motion, ending on its trigger button. Identical shape to
   *  `startSuper` but the terminal button varies (punch vs kick). */
  private startReversal(motion: string, btn: Button, facing: 1 | -1): InputFrame {
    const digits = motion.split('').map((c) => Number(c) as Direction)
    const rest = digits.slice(1)
    this.queue = rest.map((d, idx) =>
      idx === rest.length - 1 ? { rel: d, buttons: [btn] } : { rel: d },
    )
    return frame(toward(digits[0], facing))
  }

  /** Advance an in-flight combo route by one frame. Returns the input to play,
   *  or null when the route is finished, dropped, or hit-confirms as blocked (so
   *  the caller falls back to normal decision-making rather than feeding a super
   *  into a guarding opponent). Only ever called outside hitstop. */
  private stepCombo(state: FightState, i: 0 | 1): InputFrame | null {
    const c = this.combo!
    const me = state.fighters[i]
    const opp = state.fighters[1 - i]
    const facing = me.facing
    c.age++
    if (c.age > 90) return null // watchdog: a route can never spin forever
    const next = c.plan[c.idx]
    if (!next) return null // route complete
    const prev = c.plan[c.idx - 1]

    // Knocked out of our own string (reversal, trade, throw) -> abandon it.
    if (me.stance === 'hitstun' || me.stance === 'juggle' ||
        me.stance === 'knockdown' || me.stance === 'blockstun') {
      return null
    }

    const mv = me.move ? getFighterDef(me.id).moves[me.move.id] : null
    const connected = me.stance === 'attack' && me.attackConnected &&
      !!me.move && me.move.id === prev.id
    const inWindow = !!mv && !!me.move &&
      me.move.frame >= mv.active[0] &&
      me.move.frame < mv.active[1] + 1 + CANCEL_WINDOW
    // Hit-confirm: the victim must be in a *hit* reaction, not blockstun. This is
    // what stops the AI committing a metered super into a blocked string.
    const victimHit = opp.stance === 'hitstun' || opp.stance === 'juggle'

    if (connected && inWindow) {
      if (!victimHit) return null // blocked (or traded) -> confirm says stop
      c.idx++
      c.mp = 0
      return frame(toward(next.rel, facing), next.btn ? [next.btn] : undefined)
    }

    // Our move ended and we're neutral again with nothing pending -> the previous
    // link whiffed; there is nothing left to cancel, so the route is over.
    if (c.age > 2 && !me.move &&
        (me.stance === 'idle' || me.stance === 'crouch' ||
         me.stance === 'walk-fwd' || me.stance === 'walk-back')) {
      return null
    }

    // Pre-charge the next link's motion, one digit per frame, clamped at the last
    // digit so a quarter-circle never over-spells into the super motion (236 held
    // stays 236, it never becomes 236236). By the time the cancel window opens the
    // motion is already buffered and the button press fires the special cleanly.
    if (next.motion) {
      const dg = next.motion.split('').map((ch) => Number(ch) as Direction)
      const d = dg[Math.min(c.mp, dg.length - 1)]
      c.mp++
      return frame(toward(d, facing))
    }

    // Plain chained normal: wait in crouch for the previous move's cancel window.
    return frame(toward(2, facing))
  }

  /** Fire the opener of this archetype's hit-confirm juggle route (built by
   *  `comboRoute`) and latch the rest of the plan for `stepCombo` to drive. The
   *  launcher must follow a light (only lights cancel into a heavy normal), which
   *  is why every route opens light-into-heavy. Returns the opener input, or null
   *  if this character has no route — in which case the caller falls through to
   *  single-hit offence. */
   private startCombo(state: FightState, i: 0 | 1, haveSuper: boolean): InputFrame | null {
    const me = state.fighters[i]
    const moves = getFighterDef(me.id).moves
    const plan = comboRoute(moves, haveSuper)
    if (!plan) return null
    this.combo = { plan, idx: 1, mp: 0, age: 0 }
    return frame(toward(plan[0].rel, me.facing), plan[0].btn ? [plan[0].btn] : undefined)
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
    // Nearest enemy fireball actually closing on me, expressed as a reaction-
    // corrected ETA. The obs is consumed reactionFrames later, by which point a
    // bolt has flown reactionFrames*speed further; folding that delay in here is
    // what lets the AI tap at the moment the bolt genuinely arrives.
    const PARRY_CONTACT = 52 // centre distance at which a bolt overlaps the hurtbox
    let projectile: { eta: number; guard: string } | null = null
    for (const p of state.projectiles ?? []) {
      if (p.owner === me) continue
      const closing = Math.sign(p.vel.x) === Math.sign(meF.pos.x - p.pos.x)
      if (!closing) continue
      const speed = Math.abs(p.vel.x)
      if (speed < 0.01) continue
      const d = Math.abs(p.pos.x - meF.pos.x)
      const eta = (d - PARRY_CONTACT) / speed - this.tier.reactionFrames
      if (!projectile || eta < projectile.eta) projectile = { eta, guard: p.hit.guard }
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

    // Freeze during hitstop. The whole sim is frozen on these frames, so any
    // input is discarded — but the harness still polls decide() every frame, so
    // without this guard a queued motion or combo link would drain into the void
    // and desync the route from the move it is trying to cancel. Observation
    // already ran above, so reaction timing is unaffected.
    if (state.hitstop > 0) return frame(5)

    // Continue a hit-confirmed combo route before anything else: cancelling a
    // move mid-attack is the one thing the generic canAct gate below forbids, so
    // the router owns those frames until the route lands, drops, or is blocked.
    if (this.combo) {
      const step = this.stepCombo(state, i)
      if (step) return step
      this.combo = null
    }

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

    // Okizeme — the getup gamble. On the last frames of wakeup, under close
    // pressure, roll the tier's reversal chance and, on a hit, buffer an
    // invulnerable DP so it fires on the first actionable frame: it beats a meaty
    // clean (its startup invuln eats the attack, then launches) but whiffs into a
    // full punish if the attacker simply blocks. Rolled ONCE per knockdown (the
    // arm latch) and never certain, so it's a read the attacker baits, not a wall.
    // Only when genuinely pressured — a reversal into empty space is a free punish
    // the AI should never hand out. A zoner has no meterless reversal and skips it.
    if (me.stance === 'wakeup' && this.wakeupArmed && me.stunRemaining <= 3) {
      this.wakeupArmed = false
      const rev = this.getReversal(me.id)
      if (rev && o.dist < 100 + REACH_BONUS &&
          this.revRng.next() < this.tier.reversalChance) {
        return this.startReversal(rev.motion, rev.btn, facing)
      }
    }
    // Re-arm only once we're back to neutral, so the next knockdown gets a fresh
    // single roll rather than inheriting this one's spent latch.
    if (canAct) this.wakeupArmed = true

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
    // reaches for. Gated on the reaction-corrected ETA so the tap arms the parry
    // window exactly as the bolt arrives: tap when it lands inside our window.
    if (o.projectile && me.grounded &&
        o.projectile.eta >= 1 && o.projectile.eta <= PARRY_WINDOW - 1 &&
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
        // Whiff punish. The opponent is committed to recovery and cannot block or
        // tech, so at light range we cash the caught whiff into the full
        // hit-confirmed BnB — the reliable way the AI lands a long route. It only
        // fires on a *read* whiff (opponent in recovery), so it never starts a
        // speculative string in a defensive scramble the way a raw point-blank
        // commit would, which is what keeps the tech/parry game intact.
        if (o.dist < 95 + R) {
          const opener = this.startCombo(state, i, haveSuper)
          if (opener) return opener
        }
        // Out of light range, or an archetype without the route: a single Surge.
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
    // Point blank: throw, poke, or hold defense. Combos are NOT started
    // speculatively here — a raw point-blank string whiffs in a defensive
    // scramble and eats throws (it can't tech mid-string), which flattens the
    // tier's defensive read. The AI's long routes come from the whiff-punish
    // read above, where the opponent is committed and the string is guaranteed
    // to connect.
    //
    // The throw rate scales with aggression and is pulled down from its old flat
    // floor so a low tier actually backs off: throws are unblockable, so a
    // turtling beginner who can't yet tech should not eat one every few frames.
    // The poke rate is left alone — pokes are the whiff-punish bait the AI's own
    // combo game feeds on, so starving them silently guts combo consistency.
    const r = this.rng.next()
    if (r < 0.05 + this.aggression * 0.10) {
      return frame(toward(5, facing), ['lp', 'lk']) // go for a throw in the scramble
    }
    if (r < 0.55) return frame(toward(2, facing), ['lp'])
    return frame(toward(downBack, facing)) // hold defense
  }
}

export function makeAI(opts?: AIOptions): FighterAI {
  return new FighterAI(opts)
}
