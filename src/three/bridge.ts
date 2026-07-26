import type { FightEvent, FightRenderState, FighterPose, FighterVisualState, HitFlavor } from './types'
import type { BattleLogEntry, FighterRuntime, ScenarioId, Side } from '../types'
import { getFighter } from '../data/fighters'

/**
 * Game-state → render-state bridge.
 *
 * The renderer must never import the zustand store directly: it takes a plain
 * snapshot so it can also be driven by the dev harness, the attract reel, or a
 * screenshot script with fabricated state.
 */

export interface BridgeInput {
  scenario: ScenarioId
  a: FighterRuntime
  b: FighterRuntime
  activeSide: Side
  timeLeft: number
  round: number
  attackingSide: Side | null
  inFlightFlash?: HitFlavor
  cinematic: boolean
  /** Side that is currently in a losing/KO pose, if any. */
  koLoser?: Side | null
  /** Side that just got hit (drives the hurt pose). */
  hurtSide?: Side | null
}

export function toRenderState(input: BridgeInput): FightRenderState {
  return {
    scenario: input.scenario,
    a: toFighterState(input.a, 'a', input),
    b: toFighterState(input.b, 'b', input),
    timeLeft: input.timeLeft,
    round: input.round,
    cinematic: input.cinematic,
  }
}

function toFighterState(rt: FighterRuntime, side: Side, input: BridgeInput): FighterVisualState {
  const def = getFighter(rt.defId)
  return {
    id: rt.defId,
    side,
    accent: def?.accent ?? '#FFD60A',
    pose: resolvePose(rt, side, input),
    hp01: rt.maxHp > 0 ? clamp01(rt.hp / rt.maxHp) : 0,
    super01: clamp01(rt.superMeter / 100),
    conviction01: rt.maxConviction > 0 ? clamp01(rt.conviction / rt.maxConviction) : 0,
    superReady: rt.superMeter >= 100,
    shattered: rt.shattered,
    active: input.activeSide === side,
    statuses: rt.status.map((s) => s.key),
  }
}

function resolvePose(rt: FighterRuntime, side: Side, input: BridgeInput): FighterPose {
  if (input.koLoser === side) return 'lose'
  if (input.koLoser && input.koLoser !== side) return 'win'
  if (input.attackingSide === side) {
    return input.inFlightFlash === 'ult' || input.inFlightFlash === 'signature' ? 'ult' : 'attack'
  }
  if (input.hurtSide === side) return 'hurt'
  if (rt.shattered) return 'hurt'
  return 'stance'
}

/**
 * Convert a battle-log entry into the discrete events the renderer reacts to.
 * One entry can produce several events (cast → hit → shatter).
 */
export function eventsForLogEntry(entry: BattleLogEntry, maxHp: number): FightEvent[] {
  const out: FightEvent[] = []
  const flavor = flavorFor(entry)
  out.push({ kind: 'cast', attacker: entry.attacker, flavor })

  if (entry.finalDamage > 0) {
    const target: Side = entry.attacker === 'a' ? 'b' : 'a'
    out.push({
      kind: 'hit',
      attacker: entry.attacker,
      target,
      flavor,
      damage: entry.finalDamage,
      power: clamp01(entry.finalDamage / Math.max(1, maxHp * 0.45)),
      shattered: entry.shattered,
    })
    if (entry.shattered) out.push({ kind: 'shatter', side: target })
    if (entry.signature) out.push({ kind: 'signature', attacker: entry.attacker, target })
  } else {
    out.push({ kind: 'whiff', attacker: entry.attacker })
  }

  for (const s of entry.appliedStatuses) {
    out.push({ kind: 'status', side: entry.attacker === 'a' ? 'b' : 'a', status: s })
  }
  return out
}

function flavorFor(entry: BattleLogEntry): HitFlavor {
  if (entry.signature) return 'signature'
  if (entry.flash === 'signature') return 'signature'
  if (entry.flash === 'ult') return 'ult'
  if (entry.flash === 'crit') return 'crit'
  if (entry.flash === 'combo') return 'combo'
  if (entry.flash === 'ex') return 'ex'
  if (entry.ex) return 'ex'
  return entry.finalDamage >= 45 ? 'heavy' : 'light'
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Sprite URL convention used by the fighter renderer. */
export function spriteUrl(fighterId: string, pose: FighterPose): string {
  const file =
    pose === 'ult' ? 'win'
      : pose === 'hurt' ? 'lose'
      : pose === 'guard' ? 'stance'
      : pose
  return `/sprites/${fighterId}/${file}.png`
}
