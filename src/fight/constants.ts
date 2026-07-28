/**
 * Tunables for the simulation. Everything here is authored in the contract's
 * units: distances in centimetres, velocities in cm/frame, accelerations in
 * cm/frame². Frame counts are in 60fps sim frames.
 *
 * These numbers are the "feel" of the game. Where a value is a deliberate
 * fighting-game convention rather than an arbitrary pick it is commented.
 */

import type { HitLevel } from './types'

/** Half the playable width. Walls sit at ±STAGE_HALF_W; corner carries here. */
export const STAGE_HALF_W = 480

/** Ground plane. Feet rest here; positive y is up. */
export const FLOOR_Y = 0

/** Where the two fighters start, mirrored about centre. ~2.5 char-widths apart. */
export const START_X = 150

/** Full-health value. Damage numbers are authored against this. */
export const MAX_HEALTH = 1000

/** Meter cap — two full bars. Supers cost one bar (1000). */
export const MAX_METER = 2000

/**
 * Global multiplier on all hit/block/throw meter gains. The per-move gains are
 * tuned for relative weight (a heavy builds more than a jab); this scales the
 * whole economy so a fighter actually banks a full bar within a round and can
 * spend it on a super. Without it meter peaked around 0.6 bars in a fight to KO,
 * so supers were literally unreachable. Tuned so a bar banks around the
 * mid-round mark (~frame 1000-1100), which gives the AI a real window to spend
 * it as a whiff punish mid-round rather than only as the killing blow.
 */
export const METER_MULT = 3.6

/** Meter the attacker banks for a whiffed move. Footsies — whiffing pokes at
 *  range to control space — should build toward a super, the way they do in a
 *  real fighter. Small, so it rewards throwing buttons without dwarfing hits. */
export const WHIFF_METER = 12

/**
 * Gravity. Paired with JUMP_VELOCITY this gives a ~44-frame jump arc peaking at
 * ~242cm — enough to clear a crouching opponent, which is the SF3/SF6 feel.
 */
export const GRAVITY = 1.0
export const JUMP_VELOCITY = 22

/** Ground movement. Forward is slightly faster than back, as is conventional. */
export const WALK_FWD_SPEED = 2.4
export const WALK_BACK_SPEED = 1.9

/** Horizontal speed committed at the instant of a diagonal jump. */
export const JUMP_H_SPEED = 3.2

/** Forward dash: a short committed burst. Backdash gives brief lower-body invuln. */
export const DASH_SPEED = 7.0
export const DASH_FRAMES = 13
export const BACKDASH_SPEED = 8.5
export const BACKDASH_FRAMES = 16
export const BACKDASH_INVULN = 7

/**
 * Recovery after touching the ground from a normal jump. Small on purpose —
 * enough that an empty jump-in isn't perfectly safe, not so much that it feels
 * sticky. Landing during an air attack keeps the move's own recovery instead.
 */
export const LANDING_LAG = 3

/** Hard knockdown then wake-up, in frames. A swept fighter is on the floor
 *  long enough to lose their turn but not so long it stalls the match.
 *
 *  OKIZEME — the getup game. Knockdown + wakeup are both fully invulnerable
 *  (combat.hurtboxesOf returns no boxes for either stance), so the downed
 *  fighter can't be hit until the frame they return to idle. That first
 *  actionable frame is the mixup, and it resolves as a rock-paper-scissors:
 *    - MEATY: the attacker times an active hitbox onto the wake frame. Beats a
 *      passive getup clean (it connects as the defender becomes vulnerable).
 *    - REVERSAL: the defender buffers a strike-invulnerable DP (e.g. dp.P,
 *      invuln frames 0-5) during the last ~3 wakeup frames so it fires on the
 *      first actionable frame. Its startup invuln eats the meaty and launches —
 *      a reversal beats a meaty. WAKEUP_FRAMES sits under MOTION_WINDOW (12) and
 *      the reversal's press lands inside ACTION_BUFFER (4) of the wake frame, so
 *      the motion is still live when the fighter can act; that's what makes the
 *      reversal reachable rather than a 1-frame trick.
 *    - BAIT: the attacker blocks instead of pressing. The reversal whiffs into
 *      its long recovery (dp.P recovers 20f, wildly unsafe) and the attacker
 *      punishes — a block beats a reversal.
 *  So meaty > passive, reversal > meaty, bait > reversal: a real triangle, none
 *  of it free. A zoner has no meterless reversal (only its full-invuln super),
 *  which is the archetype paying for its getup with meter. The AI plays this:
 *  see ai.ts's wakeup branch, a tier-scaled, once-per-knockdown gamble that a
 *  smart attacker baits. Proven end-to-end in okizeme.test.ts. */
export const KNOCKDOWN_FRAMES = 40
export const WAKEUP_FRAMES = 10

/** Default pushbox width; individual move frames may override. Fighters this
 *  wide can never occupy the same space — see collision separation.
 *
 *  Sized to the *visible* character, not a token box. The generated sprites
 *  stand in wide, planted fighting stances ~120cm across; a 62cm pushbox let two
 *  bodies interpenetrate until they read as a single character with duplicated
 *  limbs. Widening it to 100cm keeps the opaque bodies apart. Because a wider
 *  body would otherwise put every move out of range, REACH_BONUS below extends
 *  every move's reach by the same amount, so the spacing game is unchanged. */
export const PUSHBOX_W = 100
export const PUSHBOX_H = 170

/** Added to every attack's forward reach when frame data is expanded. When the
 *  pushbox widened from 62 to 100cm, fighters stood 38cm further apart at point
 *  blank, which would have made every close normal whiff and broken every combo
 *  route. Extending all reach by that same 38cm shifts the whole engagement
 *  outward in lock-step: connect margins, combo links and footsies whiff-space
 *  are all preserved — only the absolute separation grew. One knob, applied in
 *  mkMove, instead of re-authoring dozens of hitboxes by hand. */
export const REACH_BONUS = 38

/** How knockback bleeds off. Ground knockback decays fast (friction); air
 *  knockback is governed by gravity instead. Lowered from 0.82 so the slide
 *  front-loads: at 0.75 a knocked-back fighter covers ~82% of the total in the
 *  first 6 frames after hitstop, so contact reads as an impulse and snap rather
 *  than a long gentle drift. Total slide for an initial impulse v0 is
 *  v0/(1-0.75) = 4·v0, which is why the raw kbx numbers below look modest. */
export const GROUND_FRICTION = 0.82
export const AIR_DRAG = 0.98

/**
 * Knockback readability. The hand-authored kbx/kby on each move were tuned when
 * the game read as weightless — a launcher lifted a 180cm fighter just ~36cm
 * (a quarter of body height) and a heavy drifted ~12cm. These multipliers scale
 * the authored impulse, once, in mkHit, so every fighter and move scales in
 * lock-step and the relative authoring is preserved (a heavy still out-hits a
 * medium, a jab still barely moves you).
 *
 * The split by level encodes ROLE, not just strength: launchers keep a SMALL
 * horizontal factor (the victim must stay catchable for a juggle — their story
 * is vertical, see KB_Y_SCALE) while heavies, the combo-enders that blow the
 * opponent away, get the large factor. Lights and mediums stay low so hit-
 * confirms and cancel combos still link. Throws are excluded entirely (see
 * mkHit): their toss distance is authored directly and must not be scaled.
 */
export const KB_X_SCALE: Record<HitLevel, number> = {
  light: 1.4,
  medium: 1.9,
  heavy: 4.5,
  launcher: 1.3,
  sweep: 2.2,
  crumple: 1.5,
}

/** Vertical (launcher) knockback multiplier. A launcher must send the victim at
 *  least as high as they can leap under their own power — a neutral jump peaks at
 *  ~231 units (JUMP_VELOCITY 22), and a launcher that lifts them less reads as a
 *  physicality inversion (measured: the old launcher hit only ~36, a fifth of a
 *  jump). At 2.6 the weakest launcher (warden cr.HP, base kby 8.5) clears the jump
 *  apex; the authored spread then places stronger launchers and DPs higher, which
 *  is correct — a reversal uppercut should out-launch a crouching normal. Apex
 *  grows with the square of kby (apex = kby(kby-1)/2, gravity decrements before
 *  integrating), and airtime tracks the jump's, so the arc reads like a jump, not
 *  slow-motion. */
export const KB_Y_SCALE = 2.6

/**
 * Wall bounce. A juggled fighter slammed into the wall hard enough rebounds off
 * it — the combo-extending "wall splat" of a modern fighter. DAMP is how much
 * horizontal speed survives the bounce; MIN_VEL gates it so a gentle drift into
 * the corner just pins (and only pins once) instead of pinballing.
 */
export const WALL_BOUNCE_DAMP = 0.5
export const WALL_BOUNCE_MIN_VEL = 3.0

/** A hit stops decaying knockback below this so tiny drifts don't linger. */
export const VEL_EPSILON = 0.05

/** Round + match rules. 99 seconds is the arcade standard. */
export const ROUND_TIME_FRAMES = 99 * 60
export const ROUNDS_TO_WIN = 2

/** Cosmetic-but-deterministic phase lengths, in frames. */
export const INTRO_FRAMES = 90
export const KO_FRAMES = 90
export const ROUND_END_FRAMES = 120

/**
 * Damage scaling by combo length. Indexed by how many hits have ALREADY
 * landed in the current combo: the 1st and 2nd hits are full, then each hit
 * decays. Clamped to the final entry so long strings bottom out rather than
 * reaching zero. This is the SF6-style "combo scaling" curve.
 */
export const COMBO_SCALING = [
  1.0, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.35, 0.3, 0.25, 0.2,
]

/** No single hit in a combo may be scaled below this fraction of its base. */
export const MIN_SCALE = 0.2

/** Absolute damage floor so a heavily-scaled hit still does something. */
export const MIN_DAMAGE = 5

/**
 * Chip damage a BLOCKABLE strike special or super deals on block, as a fraction
 * of its raw damage. Normals never chip (blocking a poke must be free, or turtle
 * pressure collapses — airblock.test.ts locks "chip on st.HP is 0"); throws are
 * unblockable so the concept does not apply; but a committed fireball, dragon
 * punch or rush that the defender blocks should still cost them something. That
 * "grey life" is what keeps a cornered opponent from blocking forever and gives
 * a chip-KO its tension. Derived centrally and rounded so per-move chip can't
 * drift; any chip authored explicitly on a move (warden's bolts, the crumple
 * supers) overrides this and is left exactly as written.
 */
export const SPECIAL_CHIP_RATIO = 0.125

/** Juggle allowance a launcher grants: the number of airborne hits a juggle
 *  permits. Each airborne hit spends one; at zero further hits whiff, which is
 *  what makes infinite air combos impossible.
 *
 *  This is the SHOTO BASELINE and the default a `FighterDef` falls back to when
 *  it does not set its own `juggleAllowance`. It is deliberately a per-archetype
 *  knob (see def.ts): a grappler's juggles are short and brutal (they want the
 *  knockdown into okizeme, not a long air combo), a zoner's are a short
 *  repositioning tool, and the all-rounder shoto gets the full route. The
 *  per-archetype values DERIVE from this constant as offsets (BASELINE, -1, -2)
 *  so the whole spread scales if the baseline ever moves — one knob, not three
 *  copies. `juggleScale` is parameterised by the launch's starting allowance so
 *  the gravity arc keeps the same SHAPE at every allowance; only the number of
 *  steps differs. */
export const JUGGLE_ALLOWANCE = 4

/**
 * Counter-hit: a strike that lands while the victim is in a committed attacking
 * state — its startup (a pre-emptive interrupt) or its recovery (a whiff-punish),
 * but NOT its own active frames, which is a clean trade. It is the mechanic that
 * pays for READING the opponent rather than mashing: a poke that beats a button
 * should not score the same as a poke thrown at nobody.
 *
 * The reward is tuned to be felt without being a gimmick kill:
 *  - DAMAGE ×1.3: a meaningful bump on the confirm, applied to the base before
 *    combo scaling (a counter is almost always the first hit, so it lands near
 *    full value and seeds a bigger route).
 *  - HITSTUN +6f: enough extra advantage that a follow-up which does NOT combo on
 *    a normal hit now links — i.e. it opens routes that don't otherwise exist,
 *    which is the whole point of the mechanic.
 *  - HITSTOP +6f: YES, a counter freezes distinctly harder — it must read as a
 *    bigger EVENT, not a barely-perceptible tick. A counter that doesn't hit the
 *    brakes harder than a normal hit reads as a normal hit no matter what the HUD
 *    says; the extra freeze is the tactile half of the feedback (SF6/Tekken/GGST
 *    all do this — the freeze is how you FEEL the counter before you read it).
 *    Sized to the TOP of SF6's punish-counter band (+3-6f), not GGST's mid CH
 *    (+8f). Both were on the table and the anchor decides it: this game's
 *    aesthetic is the Street Fighter lineage, and Strive is deliberately more
 *    exaggerated than SF is — borrowing its emphasis number while claiming an SF
 *    read is how a house style drifts one "just a bit punchier" at a time. +6
 *    is still double the old +4 that sat inside a normal hit's noise floor, and
 *    it keeps a heavy counter at 21f rather than 23f (383ms), which overshot the
 *    band it was supposedly calibrated to. The felt-floor guard in
 *    hitstop.coherence.test.ts pins >=6, so this sits exactly on that floor:
 *    tuning it down any further is RED, not a judgement call.
 *  - JUGGLE +1: a counter-hit LAUNCHER grants one extra juggle unit, so the extra
 *    hitstun/height actually converts into a longer air route. Kept to +1 so it
 *    extends a combo without opening an infinite (allowance still terminates).
 */
export const COUNTER_DAMAGE_MULT = 1.3
export const COUNTER_HITSTUN_BONUS = 6
export const COUNTER_HITSTOP_BONUS = 6
export const COUNTER_JUGGLE_BONUS = 1

/**
 * Juggle gravity scaling. Each successive airborne hit imparts less upward
 * knockback than the last, so a juggle *decays* — the victim gets visibly
 * heavier and the arcs step down rather than repeating at full height. Without
 * this a second launcher (Surge Palm after cr.HP) re-launched to the identical
 * apex, so a route read as two disjoint full-height pops with a near-full
 * descent between them, and only JUGGLE_ALLOWANCE stopped a full-height loop.
 *
 * The scale applies to airborne hits only — the first (grounded) launch keeps
 * its full authored height. Measured against a real AI juggle: the second pop
 * drops from apex 262 to ~186, which pulls the victim back into hitbox range
 * sooner (tighter, more legible juggle) while the same physics still guarantee
 * termination. STEP is the per-extension falloff; FLOOR keeps a deep juggle
 * from imparting zero (which would look like the hit missed).
 */
export const JUGGLE_GRAVITY_STEP = 0.16
export const JUGGLE_GRAVITY_FLOOR = 0.4

/**
 * ─── The combo system, in one place ─────────────────────────────────────────
 *
 * A combo is a string of hits with no neutral gap — the victim never leaves
 * hitstun/juggle between links. Three mechanisms build one:
 *
 *   1. CHAINS/LINKS — a normal's `cancels` list says what tags it may cancel
 *      into. Lights cancel into ['normal','special','super'] (so light→light→
 *      medium chains); mediums/heavies into ['special','super']. Specials
 *      cancel into ['super']. That is the whole cancel graph:
 *          light → medium/heavy → special → super
 *   2. LAUNCH + JUGGLE — a launcher (cr.HP, DP) pops the victim airborne with
 *      JUGGLE_ALLOWANCE hits of air time; each follow-up spends one, and its
 *      upward knockback is taxed by JUGGLE_GRAVITY_STEP per hit so the arcs step
 *      down. Gravity scaling + the allowance together guarantee it ends.
 *   3. SCALING — COMBO_SCALING taxes each successive hit so a 10-hit route beats
 *      a 3-hit route without tripling it. MIN_SCALE / MIN_DAMAGE keep the tail
 *      from reaching zero.
 *
 * A cancel is only allowed once a move has *connected* (attackConnected) and
 * only within its cancel window: the active frames plus CANCEL_WINDOW frames of
 * early recovery. That early-recovery slack is what makes a hit-confirm humanly
 * (and AI-ly) bufferable rather than a one-frame link — see build.ts.
 */
export const CANCEL_WINDOW = 6

/**
 * Throws. A throw is unblockable but has short range and can be *teched*: if the
 * victim attempts their own throw within THROW_TECH_WINDOW frames of being
 * grabbed, both fighters break apart instead. That window is the whole game of
 * throw/tech — too wide and throws never land, too tight and they're
 * un-escapable. TECH_PUSH is how far the break shoves each fighter; TECH_FRAMES
 * is the shared recovery so a tech resets to neutral rather than giving either
 * side a turn.
 */
export const THROW_TECH_WINDOW = 5
export const THROW_TECH_PUSH = 5.0
export const THROW_TECH_FRAMES = 14

/** Input buffer depth kept per fighter, in frames. Covers the longest motion
 *  window plus charge detection. */
export const INPUT_LOG_LEN = 60

/** Leniency, in frames, for linking normals and completing motions. */
export const MOTION_WINDOW = 12
export const DP_WINDOW = 12
export const CHARGE_MIN = 40
export const CHARGE_RELEASE_WINDOW = 10
export const DOUBLE_TAP_WINDOW = 9

/**
 * Input buffer, in frames. A button pressed this many frames before a fighter
 * becomes actionable (the tail of blockstun, hitstun, a dash, or a move's
 * recovery) still comes out on the first free frame, instead of being dropped
 * because the finger was a hair early. Every modern fighter does this; without
 * it a player who inputs at the natural moment — as the stun visibly ends —
 * gets nothing, and the game feels unresponsive in a way they can't name. On
 * the ground any button press while actionable is consumed into a move that
 * frame (so the next frame is non-actionable), which means an *unconsumed*
 * press in the log can only have occurred during a non-actionable stretch —
 * so replaying the most recent press within this window can never double-fire
 * during continuous neutral play. Kept short so it buffers intent, not mashing.
 */
export const ACTION_BUFFER = 4

/**
 * Parry (Third-Strike-style). The defining defensive mechanic of our reference
 * game: tap toward an incoming high/overhead (or straight down for a low) in a
 * tight window just before it lands, take no damage, and come out massively plus
 * with meter in hand. Getting the window right is the whole feel — too wide and
 * it replaces blocking, too tight and nobody lands it.
 */
// Leniency: a fresh directional tap this many frames before contact still
// parries. Deliberately tighter than a motion window — parry is a read.
export const PARRY_WINDOW = 7
// Freeze on a successful parry, both fighters, for that crisp Third-Strike
// flash. Equal for both, so it does not change the frame advantage.
export const PARRY_FREEZE = 14
// Meter rewarded to the parrying defender.
export const PARRY_METER = 120
// Brief recovery the parrier owes before acting. Kept far below any attacker's
// move recovery so a parry is always a genuine plus — you get your turn.
export const PARRY_LOCK = 2

/**
 * Super-activation freeze, in frames at 60fps. When a super comes out the world
 * holds for a beat before the damage travels — the single most expensive moment
 * in a fighting game, and the one the genre always freezes for (SF6 Critical Art,
 * Tekken Rage Art, Strive Overdrive) so the audience understands something
 * enormous is happening and the opponent gets the "I'm about to eat this" beat.
 *
 * WHY 60. The genre band is ~40-90 frames. 40 (0.67s) reads as rushed — the beat
 * is over before it lands. 90 (1.5s) drags inside a 60-second round, especially
 * if two supers fire. 60 is exactly one second: long enough to register as a
 * held, deliberate stop, short enough to keep tempo, and it matches SF6's
 * Critical Art superflash almost exactly. Unlike hitstop this does NOT freeze the
 * super's owner — their wind-up animates through it (see sim.step) — and, like
 * hitstop, it does not consume round time (the freeze returns before the timer
 * tick), so a super is never a way to run out the clock.
 */
export const SUPER_FREEZE_FRAMES = 60

/** How far past the wall a projectile travels before it despawns. A little
 *  slack so a fireball visibly reaches the corner rather than popping at it. */
export const PROJECTILE_MARGIN = 60

/** Camera framing. The renderer derives its shot from these; the sim only
 *  reports where the action is and how tight to frame it. */
export const CAMERA_MIN_ZOOM = 1.0
export const CAMERA_MAX_ZOOM = 1.6
export const CAMERA_TIGHT_DIST = 160
export const CAMERA_WIDE_DIST = 620
