// OPERATORS — core types

export type Side = 'a' | 'b'

export type MoveType = 'light' | 'heavy' | 'setup' | 'combo' | 'ultimate'

/**
 * Functional discipline of the operator. Used by CharacterSelect to filter
 * the roster down to "I want to play a PM" / "I want a growth specialist"
 * / etc. — fighter-game equivalent of country flags or fighting style.
 */
export type Discipline =
  | 'product'      // PM, product strategy, product leadership
  | 'design'       // designers, design leadership
  | 'engineering'  // CTOs, eng leaders, builders
  | 'growth'       // growth, distribution, marketing
  | 'ai'           // AI / ML founders, applied AI leaders
  | 'capital'      // VCs, founder-funders, investor-operators
  | 'ops'          // operations, org design, hiring, leadership
  | 'host'         // Lenny — sui generis

/**
 * Era buckets mapped to Lenny's Podcast episode ranges. "Season"-style
 * grouping for the filter UI; arbitrary cut-offs but mnemonically useful.
 */
export type Era =
  | 'early'   // ep 1-99 (foundations)
  | 'mid'     // ep 100-199 (growth phase)
  | 'recent' // ep 200+ (current canon)

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
  /** Functional discipline — used by CharacterSelect filter chips. Optional;
   *  the data layer provides a `getDiscipline()` helper that falls back to a
   *  lookup table so existing entries don't all need to inline this field. */
  discipline?: Discipline
  /** Era bucket — used by CharacterSelect filter chips. Optional, same
   *  fallback pattern as `discipline`. */
  era?: Era
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
  /** Voice ID for Azure 4o TTS (gpt-4o-mini-tts) in Story Mode pre-rendered
   *  narration. Default fallback if unset: 'alloy'. Lenny narrator uses 'onyx'. */
  ttsVoice?: TtsVoice
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
  /** Conviction (0-100). Chipped by every hit; regens +5/turn. When it
   *  hits zero, the fighter is SHATTERED — they skip their next turn and
   *  the attacker's follow-up hit deals +75% damage. The mechanical
   *  parallel to a fighter losing their cool under operator pressure. */
  conviction: number
  /** Max conviction (always 100; surfaced so the bar can compute fill %). */
  maxConviction: number
  /** Shattered: this fighter is stunned. On their turn-start they auto-pass.
   *  Cleared by the attacker's next damage hit (which gets the +75% bonus). */
  shattered: boolean
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
  | 'story-cutscene'
  | 'story-ending'
  | 'quote-bank'
  | 'how-to-play'
  | 'framework-encyclopedia'
  | 'stats'
  | 'fighter-spotlight'
  | 'generate-fighter'
  | 'marquee-matchups'
  | 'credits'

/** Beat within a Story Mode cutscene. Drives StoryCutscene's render +
 *  the state machine's "what's next" decision in advanceStoryBeat. */
export type StoryBeat =
  | 'chapter-intro'        // Lenny narrates the year/setting, sets up the chapter
  | 'pre-fight-dialogue'   // Player + opponent exchange 2-3 lines before FIGHT
  | 'post-fight-reaction'  // Winner reacts; opponent concedes or taunts
  | 'chapter-outro'        // Pull-quote freeze frame with episode citation
  | 'ending-splash'        // Final career-ending screen after chapter 8

/** Voice IDs supported by Azure 4o TTS (gpt-4o-mini-tts). Used for the
 *  pre-rendered Story Mode VO. Per-fighter mapping in fighters.ts. */
export type TtsVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'

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
  flash?: 'crit' | 'combo' | 'ult' | 'ex' | 'signature'
  /** EX-cast: true if this move was Shift-cast for +50 super / +50% damage. */
  ex?: boolean
  /** Set when this hit broke the defender's conviction (CONVICTION SHATTERED). */
  shattered?: boolean
  /** Set when this ult landed on a shattered defender — Signature Sequence. */
  signature?: boolean
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
  lastFlash?: { kind: 'crit' | 'combo' | 'ult' | 'ex' | 'signature'; side: Side; id: number }
  /** When the final hit of a round lands, this carries the K.O. cinematic state. */
  koCinematic?: { winner: Side; loser: Side; comboTitle?: string; id: number }
  /** When a hit breaks a fighter's conviction, this carries the cinematic.
   *  The shattered fighter's turn is consumed by the cinematic (~2.4s) and
   *  the attacker gets a follow-up turn with a +75% damage bonus on their
   *  next damaging hit. */
  shatterCinematic?: { shatteredSide: Side; id: number }
  /** SIGNATURE SEQUENCE — the climactic moment when an ult lands on a
   *  shattered opponent. 4s cinematic with echo hits, voice line, and
   *  the operator's iconic combo title. The buildathon money shot. */
  signatureCinematic?: {
    attackerSide: Side
    defenderSide: Side
    tagline: string
    fighterId: string
    id: number
    /** Whether the signature K.O.'d the defender. */
    ko: boolean
  }
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
  /** Story Mode — set when mode === 'story'. Reuses arcadeStep/arcadeOpponentQueue
   *  for fight progression; this holds story-specific data (which arc to use). */
  storyState?: {
    /** The player's chosen operator (sticky across all 8 chapters). */
    playerFighterId: string
    /** Which arc to use: 'career' = marquee 8 bespoke, 'tournament' = procedural shared. */
    arcMode: 'tournament' | 'career'
  }
  /** Active Story Mode cutscene. When set, phase is 'story-cutscene' and
   *  StoryCutscene renders. Cleared when the player advances or the timer fires. */
  storyCutscene?: {
    /** Which beat of the chapter we're playing (drives the layout). */
    beat: StoryBeat
    /** 1-indexed chapter number (1..8). Chapter 8 = Lenny boss. */
    chapter: number
    /** The body text for this beat. May be multi-line. */
    text: string
    /** Speaker for dialogue beats. For chapter-intro/outro/ending, falls back to Lenny. */
    speakerId?: string
    /** Opponent at this chapter — used by pre-fight-dialogue to render the second portrait. */
    opponentId?: string
    /** Optional accent override (e.g. scenario.accent). */
    accent?: string
    /** Rerender key — bump on every new cutscene so animations restart. */
    id: number
  }
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
