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
  flash?: 'crit' | 'combo' | 'ult'
}

const CRIT_CHANCE = 0.12
const CRIT_MULT = 1.6

// Faster super meter so ultimates feel reachable
const SUPER_GAIN_ON_LAND = 15
const SUPER_GAIN_ON_HIT = 20

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

  // Cost gating
  if (attacker.momentum < move.momentum) {
    return rejectionLog(attacker, defender, move, turn, attackerSide, 'Not enough momentum')
  }
  if (move.type === 'ultimate' && attacker.superMeter < 100) {
    return rejectionLog(attacker, defender, move, turn, attackerSide, 'Super meter not ready')
  }
  if (move.requiresSelfStatus && !hasStatus(attacker, move.requiresSelfStatus)) {
    return rejectionLog(attacker, defender, move, turn, attackerSide, `Requires ${move.requiresSelfStatus}`)
  }

  // Spend momentum / super
  attacker.momentum -= move.momentum
  if (move.type === 'ultimate') attacker.superMeter = 0

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

  // Pricing pressure on attacker = -10% damage dealt
  const priceMult = hasStatus(attacker, 'PRICING_PRESSURE') ? 0.9 : 1

  // LNO paralysis on attacker — if cast a non-light move while paralyzed, half damage
  let paralysisMult = 1
  if (hasStatus(attacker, 'LNO_PARALYSIS') && move.type !== 'light') paralysisMult = 0.5

  // Distribution moat on defender — 10% damage reduction
  const moat = hasStatus(defender, 'DISTRIBUTION_MOAT') ? 0.9 : 1

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
      priceMult *
      paralysisMult *
      moat
  )

  // Apply damage to defender
  defender.hp = Math.max(0, defender.hp - finalDamage)

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

  const ko = defender.hp <= 0

  const flash: 'crit' | 'combo' | 'ult' | undefined =
    move.type === 'ultimate' ? 'ult' : comboBonus > 0 ? 'combo' : isCrit ? 'crit' : undefined

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
    appliedStatuses,
  }

  return { attacker, defender, log, ko, flash }
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
 */
export function startTurn(runtime: FighterRuntime): {
  runtime: FighterRuntime
  selfDamage: number
  selfHeal: number
} {
  let selfDamage = 0
  let selfHeal = 0

  // DoT: outcome debt = take % HP per turn while active
  const debt = runtime.status.find((s) => s.key === 'OUTCOME_DEBT')
  if (debt) selfDamage += Math.round(runtime.maxHp * (debt.magnitude ?? 0.08))

  // DoT: hypergrowth burn — take % HP but already +25% damage dealt while active
  const burn = runtime.status.find((s) => s.key === 'HYPERGROWTH_BURN')
  if (burn) selfDamage += Math.round(runtime.maxHp * (burn.magnitude ?? 0.1))

  // Distribution Moat = heal % per turn
  const moat = runtime.status.find((s) => s.key === 'DISTRIBUTION_MOAT')
  if (moat) selfHeal += Math.round(runtime.maxHp * 0.1)

  const newHp = Math.max(0, Math.min(runtime.maxHp, runtime.hp - selfDamage + selfHeal))

  return {
    runtime: {
      ...runtime,
      hp: newHp,
      // +2 per turn (was +1) — combos + heavy chains reachable faster
      momentum: Math.min(10, runtime.momentum + 2),
      status: decrementStatus(runtime.status),
    },
    selfDamage,
    selfHeal,
  }
}

export function initialRuntime(defId: string): FighterRuntime {
  const def = getFighter(defId)
  if (!def) throw new Error(`Unknown fighter: ${defId}`)
  return {
    defId,
    hp: def.maxHp,
    maxHp: def.maxHp,
    // Starting momentum 3 = light/setup/heavy all immediately playable
    momentum: 3,
    superMeter: 0,
    status: [],
    lastMoveId: null,
    read: null,
    permanentBuff: 0,
  }
}
