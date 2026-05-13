import quotePoolJson from '../data/quote-pool.json'
import type { Move, QuotePoolEntry } from '../types'
import { getFighter } from '../data/fighters'

const POOL = quotePoolJson as Record<string, QuotePoolEntry[]>

/**
 * Returns a quote+timestamp for a move cast.
 *
 * 60% chance: signature move quote (from fighter def)
 * 40% chance: random quote from fighter's quotePool (real verbatim podcast quote)
 *
 * Falls back to signature quote if pool is empty.
 */
export function pickQuoteForMove(fighterId: string, move: Move): { quote: string; timestamp: string; episode: string } {
  const pool = POOL[fighterId] ?? []
  const useFlavor = pool.length > 0 && Math.random() < 0.4
  if (useFlavor) {
    const flavor = pool[Math.floor(Math.random() * pool.length)]
    const fighter = getFighter(fighterId)
    return {
      quote: flavor.quote,
      timestamp: flavor.timestamp,
      episode: fighter?.episode ?? '',
    }
  }
  return {
    quote: move.quote,
    timestamp: move.timestamp,
    episode: move.episode,
  }
}

export function getQuotePoolSize(fighterId: string): number {
  return (POOL[fighterId] ?? []).length
}
