// OPERATORS — core types

export type Side = 'a' | 'b'

export type MoveType = 'light' | 'heavy' | 'setup' | 'combo' | 'ultimate'

export type ScenarioId =
  | 'pre-pmf'
  | 'hypergrowth'
  | 'plateau'
  | 'ai-native'
  | 'monetization'
  | 'crisis'
  | 'ipo-prep'
  | 'distribution'

export type StatusKey =
  | 'CONFUSED_ICP'
  | 'SHIPPING_MOMENTUM'
  | 'HONEST_FEEDBACK'
  | 'FOUNDER_MODE'
  | 'PRICING_PRESSURE'
  | 'LNO_PARALYSIS'
  | 'DISTRIBUTION_MOAT'
  | 'PREVIEW_STATE'
  | 'OUTCOME_DEBT'
  | 'HYPERGROWTH_BURN'

export interface StatusEffect {
  key: StatusKey
  label: string
  /** turns remaining including the one in which it was applied */
  remaining: number
  /** numerical magnitude — interpreted per status */
  magnitude?: number
}

export interface Move {
  id: string
  name: string
  type: MoveType
  /** Momentum cost */
  momentum: number
  baseDamage: number
  /** Brief, displayed during cast */
  description: string
  /** Real quote text */
  quote: string
  /** Episode reference */
  episode: string
  /** Timestamp string e.g. "14:30" */
  timestamp: string
  /** Effects applied to defender */
  applies?: StatusEffect[]
  /** Effects applied to attacker (self-buff/self-burn) */
  selfApplies?: StatusEffect[]
  /** Combos: triggers if previous self-cast move id is in this list */
  combosFrom?: string[]
  /** Combo bonus damage if triggered */
  comboBonus?: number
  /** Combo banner title */
  comboTitle?: string
  /** Reads: hard-counters opponent moves of this type */
  readsType?: MoveType
  /** Heal for self when cast */
  selfHeal?: number
  /** Requires status to be active on self to cast */
  requiresSelfStatus?: StatusKey
}

export interface QuotePoolEntry {
  quote: string
  timestamp: string
}

export interface AIProfile {
  /** Aggression — multiplier on heavy / ultimate weight (default 1.0) */
  aggression: number
  /** Combo focus — multiplier on combo / setup weight (default 1.0) */
  comboFocus: number
  /** Ult rush — bias toward using ult ASAP once available (default 1.0) */
  ultRush: number
  /** Defensive bias — chance to play light/setup when below 30% HP (default 0) */
  defensiveBias: number
}

export interface FighterDef {
  id: string
  name: string
  shortName: string
  archetype: string
  /** 1-line bio shown in the UI — who they are, what they're known for. */
  bio: string
  /** Optional appearance description used only by the sprite generator
   *  (gpt-image-2 prompt). When set, the UI ignores this field. */
  spriteBio?: string
  /** AI personality — when this fighter is bot-controlled. Defaults to neutral. */
  ai?: AIProfile
  episode: string
  /** Hex accent color (player-side override) */
  accent: string
  /** Max HP */
  maxHp: number
  /** Scenario damage multipliers (default 1.0) */
  scenarioBonus: Partial<Record<ScenarioId, number>>
  moves: Move[]
  ult: Move
  voiceLines: {
    matchStart: string
    win: string
    lose: string
    ko: string
    crit: string
    ult: string
    trash: string[]
  }
  /** Sprite paths or null for placeholders */
  sprites?: {
    stance?: string
    attack?: string
    win?: string
    lose?: string
    ult?: string
  }
}

export interface Scenario {
  id: ScenarioId
  name: string
  description: string
  /** Stage background image path */
  stage: string
}

export interface FighterRuntime {
  defId: string
  hp: number
  maxHp: number
  momentum: number
  superMeter: number
  status: StatusEffect[]
  /** Last move id cast by this fighter — used for combo chains */
  lastMoveId: string | null
  /** Active READ: this fighter predicted opponent's next move type.
   *  If the prediction is correct, opponent's next attack does 50% dmg
   *  and the reader gains +20 super. */
  read: MoveType | null
  /** Per-move cooldown timer: moveId → turns remaining before it can be cast again. */
  cooldowns: Record<string, number>
  /** Permanent buff stacking (e.g. Gokul's Org Design ult) */
  permanentBuff?: number
}

export type Phase =
  | 'menu'
  | 'character-select'
  | 'stage-select'
  | 'pre-fight'
  | 'fight'
  | 'round-end'
  | 'match-end'
  | 'arcade-victory'
  | 'quote-bank'
  | 'how-to-play'
  | 'framework-encyclopedia'
  | 'stats'
  | 'fighter-spotlight'
  | 'generate-fighter'
  | 'marquee-matchups'
  | 'credits'

export interface BattleLogEntry {
  turn: number
  attacker: Side
  moveId: string
  moveName: string
  baseDamage: number
  scenarioMultiplier: number
  comboBonus: number
  critMultiplier: number
  finalDamage: number
  hpAfter: { a: number; b: number }
  quote: string
  episode: string
  timestamp: string
  comboTitle?: string
  flash?: 'crit' | 'combo' | 'ult'
  appliedStatuses: StatusKey[]
}

export interface RoundResult {
  winner: Side | 'time'
  turns: number
}

export interface GameState {
  phase: Phase
  fighterA: FighterRuntime | null
  fighterB: FighterRuntime | null
  scenario: ScenarioId
  round: 1 | 2 | 3
  roundsWon: { a: number; b: number }
  turn: number
  activeSide: Side
  log: BattleLogEntry[]
  /** Last entry id (UUID) for animations */
  lastFlash?: { kind: 'crit' | 'combo' | 'ult' | 'ko'; side: Side; id: number }
  /** When the final hit of a round lands, this carries the K.O. cinematic state. */
  koCinematic?: { winner: Side; loser: Side; comboTitle?: string; id: number }
  /** Sound cue queue for the audio system to consume */
  soundCue?: { kind: string; id: number }
  /** Selected fighters for next match */
  selectedA: string | null
  selectedB: string | null
  /** Arcade progression — current step (1-8) */
  arcadeStep: number
  /** Pre-built opponent queue for the current arcade run. Index = step.
   *  The final entry is always 'lenny' (boss). Built at startArcade based
   *  on difficulty: hard uses scenario specialists, easy/normal randomize
   *  to avoid the structural difficulty spike of always facing the
   *  opponent who has +30-50% bonus damage on that stage. */
  arcadeOpponentQueue: string[]
  /** Quote bank entries unlocked */
  quoteBank: Array<{ fighterId: string; moveId: string; ts: number }>
  /** CRT overlay enabled */
  crtEnabled: boolean
  /** Music master on/off (procedural chiptune via lib/music.ts) */
  musicEnabled: boolean
  /** Voice line TTS on/off (browser SpeechSynthesis) */
  voiceEnabled: boolean
  /** Last damage events for floating numbers */
  damagePulses: Array<{ id: number; side: Side; amount: number; kind: 'normal' | 'crit' | 'heal' }>
}
