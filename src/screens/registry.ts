import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { Phase } from '../types'

// Each entry pairs the lazy-loaded component with a callable prefetcher.
// The prefetcher kicks off the dynamic import without rendering — call it
// from `onMouseEnter` (menu buttons) or `useEffect` (anticipated next phase)
// so the chunk is already in cache by the time the user actually navigates.
// Calling the same loader twice is cheap: it returns the cached promise.
interface ScreenEntry {
  Component: LazyExoticComponent<ComponentType<unknown>>
  prefetch: () => Promise<unknown>
}

function make<T extends string>(
  key: T,
  factory: () => Promise<{ [K in T]: ComponentType<unknown> }>
): ScreenEntry {
  const load = () => factory().then((m) => ({ default: m[key] }))
  return {
    Component: lazy(load),
    prefetch: () => factory(),
  }
}

export const SCREENS = {
  'character-select': make('CharacterSelect', () => import('./CharacterSelect')),
  'stage-select': make('StageSelect', () => import('./StageSelect')),
  'pre-fight': make('PreFight', () => import('./PreFight')),
  fight: make('CombatScreen', () => import('./CombatScreen')),
  'round-end': make('RoundEnd', () => import('./RoundEnd')),
  'match-end': make('MatchEnd', () => import('./MatchEnd')),
  'arcade-victory': make('ArcadeVictory', () => import('./ArcadeVictory')),
  'quote-bank': make('QuoteBank', () => import('./QuoteBank')),
  'how-to-play': make('HowToPlay', () => import('./HowToPlay')),
  'framework-encyclopedia': make('FrameworkEncyclopedia', () => import('./FrameworkEncyclopedia')),
  stats: make('Stats', () => import('./Stats')),
  'fighter-spotlight': make('FighterSpotlight', () => import('./FighterSpotlight')),
  'generate-fighter': make('GenerateFighter', () => import('./GenerateFighter')),
  'marquee-matchups': make('MarqueeMatchups', () => import('./MarqueeMatchups')),
  credits: make('Credits', () => import('./Credits')),
} satisfies Partial<Record<Phase, ScreenEntry>>

/** Type-safe prefetcher for use in event handlers and useEffect. */
export function prefetchScreen(phase: keyof typeof SCREENS): void {
  // Fire and forget; cached on subsequent calls.
  void SCREENS[phase].prefetch()
}
