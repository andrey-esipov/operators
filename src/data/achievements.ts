import { FIGHTERS } from './fighters'

const ROSTER_SIZE = FIGHTERS.length
const ROSTER_HALF = Math.ceil(ROSTER_SIZE / 2)

export interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  /** Stat key on PlayerStats to compare; threshold is what triggers unlock */
  check: (stats: PlayerStats) => boolean
  tier: 'bronze' | 'silver' | 'gold'
}

export interface PlayerStats {
  totalMatches: number
  totalWins: number
  totalKOs: number
  totalCombos: number
  totalCrits: number
  totalUlts: number
  totalQuotes: number
  fightersBeaten: string[]
  fightersUsed: string[]
  arcadeRunsCompleted: number
  lennyDefeats: number
  dailyStreak: number
  hardModeWins: number
  /** Times you Shattered an opponent's Conviction (counts the chip-to-zero hit). */
  totalShatters: number
  /** Times you landed a Signature Sequence (ult on a shattered defender). */
  totalSignatures: number
  /** EX-cast moves landed. */
  totalEx: number
  /** Story Mode runs completed (cleared chapter 8). */
  totalStoryRuns: number
  /** Set of fighter IDs the player has completed Story Mode with. */
  storyOperatorsCleared: string[]
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first-blood',
    name: 'FIRST BLOOD',
    description: 'Win your first match.',
    icon: '🥇',
    tier: 'bronze',
    check: (s) => s.totalWins >= 1,
  },
  {
    id: 'combo-rookie',
    name: 'COMBO ROOKIE',
    description: 'Land 10 combos.',
    icon: '◇',
    tier: 'bronze',
    check: (s) => s.totalCombos >= 10,
  },
  {
    id: 'combo-pro',
    name: 'CHAIN MASTER',
    description: 'Land 50 combos.',
    icon: '◆',
    tier: 'silver',
    check: (s) => s.totalCombos >= 50,
  },
  {
    id: 'crit-king',
    name: 'CRITICAL THINKER',
    description: 'Land 25 critical hits.',
    icon: '✦',
    tier: 'silver',
    check: (s) => s.totalCrits >= 25,
  },
  {
    id: 'ult-spammer',
    name: 'ULT KING',
    description: 'Cast 25 ultimates.',
    icon: '⚡',
    tier: 'silver',
    check: (s) => s.totalUlts >= 25,
  },
  {
    id: 'quote-collector-25',
    name: 'WISDOM SEEKER',
    description: 'Unlock 25 quotes.',
    icon: '◊',
    tier: 'bronze',
    check: (s) => s.totalQuotes >= 25,
  },
  {
    id: 'quote-collector-100',
    name: 'FRAMEWORK SCHOLAR',
    description: 'Unlock 100 quotes.',
    icon: '◈',
    tier: 'silver',
    check: (s) => s.totalQuotes >= 100,
  },
  {
    id: 'roster-half',
    name: 'OPERATOR FAMILIAR',
    description: `Win as ${ROSTER_HALF} different fighters.`,
    icon: '⚐',
    tier: 'silver',
    check: (s) => s.fightersUsed.length >= ROSTER_HALF,
  },
  {
    id: 'roster-full',
    name: 'POLYMATH',
    description: `Win as ALL ${ROSTER_SIZE} fighters.`,
    icon: '♛',
    tier: 'gold',
    check: (s) => s.fightersUsed.length >= ROSTER_SIZE,
  },
  {
    id: 'beat-roster-half',
    name: 'GIANT-KILLER',
    description: `Defeat ${ROSTER_HALF} unique fighters.`,
    icon: '⚔',
    tier: 'silver',
    check: (s) => s.fightersBeaten.length >= ROSTER_HALF,
  },
  {
    id: 'beat-lenny',
    name: 'BEAT THE HOST',
    description: 'Defeat Lenny in Arcade Mode.',
    icon: '★',
    tier: 'gold',
    check: (s) => s.lennyDefeats >= 1,
  },
  {
    id: 'beat-lenny-hard',
    name: 'PATTERN-BREAKER',
    description: 'Defeat Lenny on HARD difficulty.',
    icon: '✪',
    tier: 'gold',
    check: (s) => s.hardModeWins >= 1 && s.lennyDefeats >= 1,
  },
  {
    id: 'arcade-finish',
    name: 'GAUNTLET CLEARED',
    description: 'Complete an Arcade run.',
    icon: '⛓',
    tier: 'silver',
    check: (s) => s.arcadeRunsCompleted >= 1,
  },
  {
    id: 'daily-streak-7',
    name: 'DAILY HABIT',
    description: 'Play 7 daily challenges in a row.',
    icon: '☼',
    tier: 'silver',
    check: (s) => s.dailyStreak >= 7,
  },
  {
    id: 'ko-master',
    name: 'K.O. MACHINE',
    description: 'Score 50 K.O.s total.',
    icon: '☠',
    tier: 'silver',
    check: (s) => s.totalKOs >= 50,
  },
  {
    id: 'first-shatter',
    name: 'FIRST SHATTER',
    description: 'Break an opponent\'s Conviction.',
    icon: '⚡',
    tier: 'bronze',
    check: (s) => s.totalShatters >= 1,
  },
  {
    id: 'shatter-streak',
    name: 'PATTERN-MATCHER',
    description: 'Shatter Conviction 10 times.',
    icon: '◆',
    tier: 'silver',
    check: (s) => s.totalShatters >= 10,
  },
  {
    id: 'first-signature',
    name: 'SIGNATURE MOMENT',
    description: 'Land an Ult on a shattered defender.',
    icon: '★',
    tier: 'silver',
    check: (s) => s.totalSignatures >= 1,
  },
  {
    id: 'signature-master',
    name: 'OPERATOR ICON',
    description: 'Land 10 Signature Sequences.',
    icon: '★',
    tier: 'gold',
    check: (s) => s.totalSignatures >= 10,
  },
  {
    id: 'first-story',
    name: 'WELCOME TO THE SHOW',
    description: 'Complete your first Story Mode chapter.',
    icon: '◇',
    tier: 'bronze',
    check: (s) => s.totalStoryRuns >= 1 || s.storyOperatorsCleared.length >= 1,
  },
  {
    id: 'tournament-champion',
    name: 'TOURNAMENT CHAMPION',
    description: 'Finish all 8 chapters with any operator.',
    icon: '♛',
    tier: 'gold',
    check: (s) => s.totalStoryRuns >= 1,
  },
  {
    id: 'operators-champion',
    name: 'PATTERN MATCHED',
    description: 'Finish Story Mode with 5 different operators.',
    icon: '★',
    tier: 'gold',
    check: (s) => (s.storyOperatorsCleared?.length ?? 0) >= 5,
  },
  {
    id: 'match-veteran',
    name: 'VETERAN',
    description: 'Play 100 total matches.',
    icon: '⌘',
    tier: 'gold',
    check: (s) => s.totalMatches >= 100,
  },
]

export function emptyStats(): PlayerStats {
  return {
    totalMatches: 0,
    totalWins: 0,
    totalKOs: 0,
    totalCombos: 0,
    totalCrits: 0,
    totalUlts: 0,
    totalQuotes: 0,
    fightersBeaten: [],
    fightersUsed: [],
    arcadeRunsCompleted: 0,
    lennyDefeats: 0,
    dailyStreak: 0,
    hardModeWins: 0,
    totalShatters: 0,
    totalSignatures: 0,
    totalEx: 0,
    totalStoryRuns: 0,
    storyOperatorsCleared: [],
  }
}

const STATS_KEY = 'operators:player-stats'
const UNLOCKED_KEY = 'operators:achievements-unlocked'

export function loadStats(): PlayerStats {
  if (typeof window === 'undefined') return emptyStats()
  try {
    const raw = window.localStorage.getItem(STATS_KEY)
    if (!raw) return emptyStats()
    const parsed = JSON.parse(raw)
    return { ...emptyStats(), ...parsed }
  } catch {
    return emptyStats()
  }
}

export function saveStats(s: PlayerStats) {
  try {
    window.localStorage.setItem(STATS_KEY, JSON.stringify(s))
  } catch {
    // quota / private mode
  }
}

export function loadUnlocked(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(UNLOCKED_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw))
  } catch {
    return new Set()
  }
}

export function saveUnlocked(unlocked: Set<string>) {
  try {
    window.localStorage.setItem(UNLOCKED_KEY, JSON.stringify([...unlocked]))
  } catch {
    // quota / private mode
  }
}

/** Returns the list of achievements newly unlocked this update. */
export function checkAndUnlock(stats: PlayerStats): Achievement[] {
  const unlocked = loadUnlocked()
  const newly: Achievement[] = []
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.id)) continue
    if (a.check(stats)) {
      unlocked.add(a.id)
      newly.push(a)
    }
  }
  if (newly.length > 0) saveUnlocked(unlocked)
  return newly
}
