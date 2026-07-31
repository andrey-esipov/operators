import type { FightRenderState } from '../types'
import type { Side } from '../../types'
import type { StatusMeta } from './statusMeta'

/**
 * Extended, presentational prop contract for the AAA fight HUD.
 *
 * The core snapshot (`state`) is the READ-ONLY engine contract
 * `FightRenderState`. Everything else is optional layered presentation that a
 * host drives from the `FightEvent` stream / turn state. When omitted, the HUD
 * still renders a complete, correct combat interface from `state` alone.
 */
export interface FightHudProps {
  /** The engine contract snapshot. Required. */
  state: FightRenderState

  /** Display names per side. Falls back to the fighter id, upper-cased. */
  names?: { a: string; b: string }
  /** Optional portrait image URLs per side. */
  portraits?: { a?: string; b?: string }

  /** Rounds won per side (drives the pip grid). */
  roundsWon?: { a: number; b: number }
  /** Rounds needed to win the match. pips-per-side = this value. Default 2. */
  roundsToWin?: number
  /** Round-clock ceiling in seconds (for context; timer shows `state.timeLeft`). */
  timeMax?: number

  /** Live combo state for the attacking side. */
  combo?: ComboState | null
  /** A one-shot announcer moment ("ROUND 1", "FIGHT!", "K.O."...). */
  announce?: AnnounceMoment | null
  /** Floating damage numbers, keyed by id so exits animate. */
  damageNumbers?: DamageNumber[]
  /** Turn-based move deck for the active fighter. */
  moveDeck?: MoveDeck | null

  /** Override the built-in status metadata (icon/label/color). */
  statusInfo?: (key: string) => StatusMeta
  /** Reference width the HUD was designed at. Default 1920. */
  designWidth?: number
}

export interface ComboState {
  side: Side
  hits: number
  /** Cumulative combo damage, optional. */
  damage?: number
  /** Bump id — change it to retrigger the pop animation. */
  id: number
}

export type AnnounceKind =
  | 'round'
  | 'fight'
  | 'ko'
  | 'perfect'
  | 'time-up'
  | 'double-ko'
  | 'win'

export interface AnnounceMoment {
  kind: AnnounceKind
  /** For 'round': the round number. */
  round?: number
  /** Freeform headline override. */
  text?: string
  /** Sub-line. */
  sub?: string
  /** Which side this favours (colours the type). */
  side?: Side
  /** Unique id so re-firing the same kind replays motion. */
  id: number
}

export interface DamageNumber {
  id: number
  side: Side
  value: number
  flavor?: 'light' | 'heavy' | 'crit' | 'combo' | 'ult' | 'ex' | 'signature'
  /** Normalised horizontal anchor 0..1 (screen space). Defaults per side. */
  x?: number
  /** Normalised vertical anchor 0..1. Defaults to 0.42. */
  y?: number
}

export interface MoveDeck {
  side: Side
  cards: MoveCardData[]
}

export interface MoveCardData {
  id: string
  name: string
  kind: 'light' | 'heavy' | 'setup' | 'combo' | 'ultimate'
  damage: number
  /** Momentum / resource cost, drawn as pips. */
  cost: number
  hotkey?: string
  disabled?: boolean
  /** Highlighted as the player's current selection — lifts and glows. */
  selected?: boolean
  /** For ultimates: super meter is full. */
  ready?: boolean
  onSelect?: () => void
}
