import type {
  BattleLogEntry,
  FighterDef,
  FighterRuntime,
  Move,
  ScenarioId,
  Side,
  StatusEffect,
  StatusKey,
} from '../types'
import { getFighter } from '../data/fighters'

export interface ApplyMoveInput {
  attackerSide: Side
  attackerDef: FighterDef
  defenderDef: FighterDef
  attackerRuntime: FighterRuntime
  defenderRuntime: FighterRuntime
  move: Move
  scenario: ScenarioId
  turn: number
  /** EX-cast: spend 50 super for +50% damage and signature VFX. Ignored
   *  on ultimates (the ult is its own super sink). */
  ex?: boolean
  /** Pure-random source. Provide a seedable rng for testing. */
  rng?: () => number
}

export interface ApplyMoveResult {
  attacker: FighterRuntime
  defender: FighterRuntime
  log: BattleLogEntry
  ko: boolean
  /** Was this move REJECTED (insufficient resources etc) */
  rejected?: { reason: string }
  flash?: 'crit' | 'combo' | 'ult' | 'ex' | 'signature'
  /** True when the cast was EX-amplified — additive to other flashes
   *  (e.g. an EX combo flashes as `combo` but still triggers EX audio/VFX). */
  ex?: boolean
  /** True when this hit just broke the defender's conviction (the moment
   *  CONVICTION SHATTERED triggers). The caller queues the cinematic and
   *  the follow-up auto-skip on the defender's next would-be turn. */
  shattered?: boolean
  /** True when this was an ULT landing on an already-shattered defender —
   *  the demo money shot. Caller plays a 4s Signature Sequence cinematic
   *  with echo hits + voice + huge damage. */
  signature?: boolean
}

const CRIT_CHANCE = 0.12
const CRIT_MULT = 1.6

// Faster super meter so ultimates feel reachable
const SUPER_GAIN_ON_LAND = 15
const SUPER_GAIN_ON_HIT = 20

// Conviction system — see FighterRuntime.conviction.
// Each move type chips a different amount of conviction off the defender.
// Light/setup chip slowly; heavy/combo chip noticeably; ult chunks it. The
// system lives outside the per-fighter move data so we don't have to touch
// 320 move definitions to balance it — tune here.
const CONV_DAMAGE: Record<'light' | 'heavy' | 'setup' | 'combo' | 'ultimate', number> = {
  light: 5,
  setup: 3,
  heavy: 12,
  combo: 15,
  ultimate: 40,
}
// Multipliers (additive on top of base):
//   crit → ×2  (a crit is a moment of operator clarity that rattles the foe)
//   ex   → ×1.5
const CONV_CRIT_MULT = 2
const CONV_EX_MULT = 1.5
// Conviction regen per turn (when not shattered).
const CONV_REGEN_PER_TURN = 5
// After being shattered + skipping a turn, conviction comes back partial.
const CONV_RESET_AFTER_SHATTER = 30
// Damage bonus applied to a hit landing on a shattered defender.
const SHATTER_DAMAGE_BONUS = 1.75

function decrementStatus(status: StatusEffect[]): StatusEffect[] {
  return status
    .map((s) => ({ ...s, remaining: s.remaining - 1 }))
    .filter((s) => s.remaining > 0)
}

function hasStatus(rt: FighterRuntime, key: StatusKey): boolean {
  return rt.status.some((s) => s.key === key)
}

function getStatus(rt: FighterRuntime, key: StatusKey): StatusEffect | undefined {
  return rt.status.find((s) => s.key === key)
}

function addStatuses(target: StatusEffect[], newOnes: StatusEffect[]): StatusEffect[] {
  const out = [...target]
  for (const n of newOnes) {
    const existing = out.findIndex((s) => s.key === n.key)
    if (existing >= 0) {
      // Refresh with max remaining
      out[existing] = {
        ...out[existing],
        remaining: Math.max(out[existing].remaining, n.remaining),
        magnitude: n.magnitude ?? out[existing].magnitude,
      }
    } else {
      out.push({ ...n })
    }
  }
  return out
}

export function applyMove(input: ApplyMoveInput): ApplyMoveResult {
  const {
    attackerSide,
    attackerDef,
    move,
    scenario,
    turn,
  } = input
  const rng = input.rng ?? Math.random

  let attacker: FighterRuntime = {
    ...input.attackerRuntime,
    status: [...input.attackerRuntime.status],
  }
  let defender: FighterRuntime = {
    ...input.defenderRuntime,
    status: [...input.defenderRuntime.status],
  }

  // Ultimates are clamped to 5 momentum system-wide. Authored values in
  // fighters.ts are 8; the gameplay design contract is "5 momentum + 100
  // super" so the meter and the momentum bar align (both fill in ~5 turns).
  const effectiveMomentum = move.type === 'ultimate' ? Math.min(move.momentum, 5) : move.momentum

  // EX-cast only applies to non-ult moves. Costs 50 super and gives +50%
  // damage. Skipping the gate on ults keeps the input handler simple
  // (Shift+B doesn't do anything special — the ult is already a super sink).
  const isEx = input.ex === true && move.type !== 'ultimate'

  // Cost gating
  if (attacker.momentum < effectiveMomentum) {
    return rejectionLog(attacker, defender, move, turn, attackerSide, 'Not enough momentum')
  }
  if (move.type === 'ultimate' && attacker.superMeter < 100) {
    return rejectionLog(attacker, defender, move, turn, attackerSide, 'Super meter not ready')
  }
  if (isEx && attacker.superMeter < 50) {
    return rejectionLog(attacker, defender, move, turn, attackerSide, 'EX needs 50 super')
  }
  // NOTE: `requiresSelfStatus` is intentionally NOT a hard gate anymore.
  // It's treated as a +50% signature damage bonus below — see signatureMult.
  // Previously this rejected the cast, which produced the "ult ready but
  // can't cast" UX failure the player complained about.

  // Cooldown gating — heavy/combo lock out for a couple of turns. Ult is
  // throttled by its meter cost alone (no in-round cooldown).
  const cdRemaining = attacker.cooldowns[move.id] ?? 0
  if (cdRemaining > 0) {
    return rejectionLog(attacker, defender, move, turn, attackerSide, `On cooldown (${cdRemaining})`)
  }

  // Spend momentum / super
  attacker.momentum -= effectiveMomentum
  if (move.type === 'ultimate') attacker.superMeter = 0
  else if (isEx) attacker.superMeter = Math.max(0, attacker.superMeter - 50)

  // Set cooldown on this move:
  //  - heavy / combo: 2 turns
  //  - ultimate / light / setup: no cooldown (super-meter cost throttles ult)
  const newCooldowns = { ...attacker.cooldowns }
  if (move.type === 'heavy' || move.type === 'combo') newCooldowns[move.id] = 2
  attacker.cooldowns = newCooldowns

  // READ resolution — did the defender correctly read this move's TYPE last turn?
  // If yes: damage halved + reader (defender) gains +20 super + attacker's
  // conviction takes a 30-point hit (the operator was *seen through*, which
  // rattles them more than any punch).
  const readCorrect = defender.read === move.type
  if (readCorrect) {
    defender.superMeter = Math.min(100, defender.superMeter + 20)
    attacker.conviction = Math.max(0, attacker.conviction - 30)
  }
  // Consume the read regardless of outcome — one shot.
  defender.read = null

  // ─── Damage calculation ───
  let scenarioMult = attackerDef.scenarioBonus[scenario] ?? 1.0
  // Permanent buff from prior Gokul ult etc
  if (attacker.permanentBuff && attacker.permanentBuff > 0) scenarioMult *= (1 + attacker.permanentBuff)

  // Combo detection (chain from previous move id)
  let comboBonus = 0
  let comboTitle: string | undefined
  if (move.combosFrom && attacker.lastMoveId && move.combosFrom.includes(attacker.lastMoveId)) {
    comboBonus = move.comboBonus ?? 50
    comboTitle = move.comboTitle
  }

  // Crit roll
  const isCrit = rng() < CRIT_CHANCE
  const critMult = isCrit ? CRIT_MULT : 1

  // CONFUSED_ICP on defender = +30% damage taken
  const confusedDef = getStatus(defender, 'CONFUSED_ICP')
  const confusedMult = confusedDef ? (1 + (confusedDef.magnitude ?? 0.3)) : 1

  // FOUNDER_MODE on attacker = +10% damage when present (passive)
  const founderBuff = hasStatus(attacker, 'FOUNDER_MODE') ? 1.1 : 1

  // Shipping momentum on attacker
  const shipping = getStatus(attacker, 'SHIPPING_MOMENTUM')
  const shipMult = shipping ? (1 + (shipping.magnitude ?? 0.2)) : 1

  // Hypergrowth burn on attacker = +25% damage dealt (paired with the DoT
  // self-damage applied in startTurn — the design contract is "burn fast,
  // hit harder"). Without this the status only hurts the bearer.
  const burnMult = hasStatus(attacker, 'HYPERGROWTH_BURN') ? 1.25 : 1

  // Pricing pressure on attacker = -10% damage dealt
  const priceMult = hasStatus(attacker, 'PRICING_PRESSURE') ? 0.9 : 1

  // LNO paralysis on attacker — if cast a non-light move while paralyzed, half damage
  let paralysisMult = 1
  if (hasStatus(attacker, 'LNO_PARALYSIS') && move.type !== 'light') paralysisMult = 0.5

  // Distribution moat on defender — 10% damage reduction
  const moat = hasStatus(defender, 'DISTRIBUTION_MOAT') ? 0.9 : 1

  // Read predict — defender called this move's type last turn, halve damage
  const readMult = readCorrect ? 0.5 : 1

  // Signature bonus — ultimates with a `requiresSelfStatus` field deal +50%
  // damage when that status is active. Previously this was a hard gate that
  // locked the player out; now it's a reward for setting up properly while
  // still letting the ult fire raw if conditions aren't perfect.
  const signatureMult = move.type === 'ultimate' && move.requiresSelfStatus && hasStatus(attacker, move.requiresSelfStatus)
    ? 1.5
    : 1

  // EX-cast bonus: +50% damage on non-ult moves. Pairs naturally with
  // combo/crit (an EX combo crit stacks all three multipliers).
  const exMult = isEx ? 1.5 : 1

  // SHATTER follow-up: if the defender is already shattered when this hit
  // lands, multiply HP damage by 1.75. This is the "punish window" — the
  // attacker chipped conviction to zero, the defender skipped a turn,
  // and the next hit is amplified. After the hit lands, shattered clears.
  const wasShattered = defender.shattered === true
  const shatterMult = wasShattered ? SHATTER_DAMAGE_BONUS : 1

  // Preview state — if defender about to whiff (next missed move forgiven). We don't whiff this turn.

  // Final damage
  const baseDamage = move.baseDamage
  const finalDamage = Math.round(
    (baseDamage + comboBonus) *
      scenarioMult *
      critMult *
      confusedMult *
      founderBuff *
      shipMult *
      burnMult *
      priceMult *
      paralysisMult *
      readMult *
      moat *
      signatureMult *
      exMult *
      shatterMult
  )

  // Apply damage to defender
  defender.hp = Math.max(0, defender.hp - finalDamage)

  // ─── Conviction chip ───
  // Every damaging hit also chips the defender's conviction. The chip
  // amount is move-type-driven (see CONV_DAMAGE) and amplified by crit /
  // EX. Reads contribute via castRead (not here). When conviction reaches
  // 0 the defender is shattered — the caller (game.ts) queues the
  // cinematic. The hit that triggers the shatter does NOT get the +75%
  // damage bonus; the bonus rewards the FOLLOW-UP hit after the defender
  // has skipped a turn.
  let shatteredNow = false
  if (finalDamage > 0 && !wasShattered) {
    const convChip = CONV_DAMAGE[move.type] * (isCrit ? CONV_CRIT_MULT : 1) * (isEx ? CONV_EX_MULT : 1)
    defender.conviction = Math.max(0, defender.conviction - convChip)
    if (defender.conviction <= 0 && !defender.shattered) {
      defender.shattered = true
      shatteredNow = true
    }
  } else if (finalDamage > 0 && wasShattered) {
    // The punish hit landed — clear shatter, partial conviction back.
    defender.shattered = false
    defender.conviction = CONV_RESET_AFTER_SHATTER
  }

  // Apply self-heal
  if (move.selfHeal) {
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + move.selfHeal)
  }

  // Apply status effects
  const appliedStatuses: StatusKey[] = []
  if (move.applies) {
    defender.status = addStatuses(defender.status, move.applies)
    appliedStatuses.push(...move.applies.map((s) => s.key))
  }
  if (move.selfApplies) {
    attacker.status = addStatuses(attacker.status, move.selfApplies)
    appliedStatuses.push(...move.selfApplies.map((s) => s.key))
  }

  // Super meter gain
  attacker.superMeter = Math.min(100, attacker.superMeter + SUPER_GAIN_ON_LAND)
  defender.superMeter = Math.min(100, defender.superMeter + SUPER_GAIN_ON_HIT)

  // Update last move id for combo chain
  attacker.lastMoveId = move.id

  // SIGNATURE — ult landing on an already-shattered defender. The visual
  // climax of a match: build super → chip conviction → time the ult on
  // the shatter window → SIGNATURE SEQUENCE cinematic.
  const isSignature = move.type === 'ultimate' && wasShattered

  // Flash priority: signature > ult > combo > crit > ex. EX is the
  // fallback when no other categorical flash applies; otherwise EX rides
  // along via `result.ex` so audio/VFX can layer EX cue on top of others.
  const flash: 'crit' | 'combo' | 'ult' | 'ex' | 'signature' | undefined =
    isSignature ? 'signature'
    : move.type === 'ultimate' ? 'ult'
    : comboBonus > 0 ? 'combo'
    : isCrit ? 'crit'
    : isEx ? 'ex'
    : undefined

  const ko = defender.hp <= 0

  const log: BattleLogEntry = {
    turn,
    attacker: attackerSide,
    moveId: move.id,
    moveName: move.name,
    baseDamage,
    scenarioMultiplier: Math.round(scenarioMult * 100) / 100,
    comboBonus,
    critMultiplier: critMult,
    finalDamage,
    hpAfter: { a: attackerSide === 'a' ? attacker.hp : defender.hp, b: attackerSide === 'a' ? defender.hp : attacker.hp },
    quote: move.quote,
    episode: move.episode,
    timestamp: move.timestamp,
    comboTitle,
    flash,
    ex: isEx || undefined,
    shattered: shatteredNow || undefined,
    appliedStatuses,
  }

  return {
    attacker,
    defender,
    log,
    ko,
    flash,
    ex: isEx || undefined,
    shattered: shatteredNow || undefined,
    signature: isSignature || undefined,
  }
}

function rejectionLog(
  attacker: FighterRuntime,
  defender: FighterRuntime,
  move: Move,
  turn: number,
  attackerSide: Side,
  reason: string
): ApplyMoveResult {
  return {
    attacker,
    defender,
    log: {
      turn,
      attacker: attackerSide,
      moveId: move.id,
      moveName: move.name,
      baseDamage: 0,
      scenarioMultiplier: 1,
      comboBonus: 0,
      critMultiplier: 1,
      finalDamage: 0,
      hpAfter: {
        a: attackerSide === 'a' ? attacker.hp : defender.hp,
        b: attackerSide === 'a' ? defender.hp : attacker.hp,
      },
      quote: '',
      episode: '',
      timestamp: '',
      appliedStatuses: [],
    },
    ko: false,
    rejected: { reason },
  }
}

/**
 * Called at the start of a fighter's turn:
 *   - +1 momentum
 *   - decrement status remaining; remove expired
 *   - apply DoT effects (OUTCOME_DEBT, HYPERGROWTH_BURN)
 *   - report `koDueToDoT` so the caller can credit the round to the
 *     opponent when start-of-turn damage finishes a fighter off (instead
 *     of letting the next attacker grab undeserved K.O. attribution)
 */
export function startTurn(runtime: FighterRuntime): {
  runtime: FighterRuntime
  selfDamage: number
  selfHeal: number
  koDueToDoT: boolean
} {
  let selfDamage = 0
  let selfHeal = 0

  // DoT: outcome debt = take % HP per turn while active
  const debt = runtime.status.find((s) => s.key === 'OUTCOME_DEBT')
  if (debt) selfDamage += Math.round(runtime.maxHp * (debt.magnitude ?? 0.08))

  // DoT: hypergrowth burn — take % HP but already +25% damage dealt while active
  const burn = runtime.status.find((s) => s.key === 'HYPERGROWTH_BURN')
  if (burn) selfDamage += Math.round(runtime.maxHp * (burn.magnitude ?? 0.1))

  // Distribution Moat = heal % per turn. 5% (was 10%) — at 10% Spiegel's
  // 110 HP/turn heal outpaced every non-combo / non-ult cast even *after*
  // the moat's -10% damage cut, which made the matchup feel hopeless from
  // the offensive side. 5% keeps the buff strong (heavies break even,
  // combos and ults pull ahead) without making him invincible.
  const moat = runtime.status.find((s) => s.key === 'DISTRIBUTION_MOAT')
  if (moat) selfHeal += Math.round(runtime.maxHp * 0.05)

  const newHp = Math.max(0, Math.min(runtime.maxHp, runtime.hp - selfDamage + selfHeal))

  // Tick down cooldowns by 1 each turn
  const newCooldowns: Record<string, number> = {}
  for (const [id, turns] of Object.entries(runtime.cooldowns)) {
    if (turns - 1 > 0) newCooldowns[id] = turns - 1
  }

  // The fighter was alive before this start-of-turn tick and is at 0 HP
  // after the DoT — the round needs to end here, with credit to the
  // OPPONENT (i.e. whoever applied the DoT, or simply the other side).
  const koDueToDoT = runtime.hp > 0 && newHp <= 0 && selfDamage > selfHeal

  // Conviction regenerates a little each turn. We do NOT regen while
  // shattered — the fighter has to take the turn-skip first (game.ts clears
  // the shatter flag at the same time it credits a partial conviction
  // refund). So if shattered is still true here, we leave conviction alone.
  const nextConv = runtime.shattered
    ? runtime.conviction
    : Math.min(runtime.maxConviction, runtime.conviction + CONV_REGEN_PER_TURN)

  return {
    runtime: {
      ...runtime,
      hp: newHp,
      // +2 per turn (was +1) — combos + heavy chains reachable faster
      momentum: Math.min(10, runtime.momentum + 2),
      status: decrementStatus(runtime.status),
      cooldowns: newCooldowns,
      conviction: nextConv,
    },
    selfDamage,
    selfHeal,
    koDueToDoT,
  }
}

export function initialRuntime(defId: string, carryOverSuper = 0): FighterRuntime {
  const def = getFighter(defId)
  if (!def) throw new Error(`Unknown fighter: ${defId}`)
  return {
    defId,
    hp: def.maxHp,
    maxHp: def.maxHp,
    // Starting momentum 3 = light/setup/heavy all immediately playable
    momentum: 3,
    // Super meter carries across rounds (cap 100). Cross-round strategy:
    // bank meter for a clutch round-2 ult, or spend it now for tempo.
    superMeter: Math.max(0, Math.min(100, carryOverSuper)),
    status: [],
    lastMoveId: null,
    read: null,
    cooldowns: {},
    permanentBuff: 0,
    // Conviction resets each round. Tier 2 second-resource axis.
    conviction: 100,
    maxConviction: 100,
    shattered: false,
  }
}
