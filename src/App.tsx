import { useCallback, useEffect, useState, Suspense, lazy } from 'react'
import { useGame } from './state/game'
import { Music } from './lib/music'
import { MainMenu } from './screens/MainMenu'
import { StartScreen } from './screens/StartScreen'
import { SCREENS, prefetchScreen } from './screens/registry'
import { ScreenSkeleton } from './components/ScreenSkeleton'
import { StoryCutscene } from './components/StoryCutscene'
import { attachQuoteBankSync, loadQuoteBank } from './lib/persist'

/** Renderer sandbox at `?lab=1`. Lazy so it never ships in the main chunk. */
const ThreeLab = lazy(() =>
  import('./three/dev/ThreeLab').then((m) => ({ default: m.ThreeLab })),
)

/** Real-time fight renderer harness at `?fight=1`. Lazy, dev-only. */
const FightHarness = lazy(() =>
  import('./three/dev/FightHarness').then((m) => ({ default: m.FightHarness })),
)

/** Standalone fighting-game HUD preview at `?fighthud=1`. Lazy, dev-only. */
const HudPreview = lazy(() =>
  import('./fighthud/preview/HudPreview').then((m) => ({ default: m.HudPreview })),
)

/** The real-time fighter, playable, at `?play=1`. Human on the left, CPU on
 *  the right. Unlike `?fight=1` this is the game rather than a dev harness. */
const PlayableMatch = lazy(() =>
  import('./play/PlayableMatch').then((m) => ({ default: m.PlayableMatch })),
)

/** Character + stage select at `?select=1`. The game's front door: lets a player
 *  pick a fighter and arena instead of hand-editing the query string. Lazy,
 *  since a match launched with an explicit matchup never mounts it. */
const FightSelect = lazy(() =>
  import('./fighthud/select/FightSelect').then((m) => ({ default: m.FightSelect })),
)

/** The live CPU-vs-CPU attract reel at `?attract=1`, standalone. The same
 *  component is the menu's idle reel; this route is the direct entry the perf
 *  harness drives and a way to link straight to the demo. Lazy, so the fight
 *  renderer it pulls in never weighs down the capture routes or a bare match. */
const AttractMode = lazy(() =>
  import('./screens/AttractMode').then((m) => ({ default: m.AttractMode })),
)

function isLabRoute(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('lab') === '1'
}

function isFightRoute(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('fight') === '1'
}

function isHudRoute(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('fighthud') === '1'
}

/** The legacy turn-based card game, now at `?cards=1`. */
function isCardsRoute(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('cards') === '1'
}

/** Character + stage select at `?select=1`. Deliberately NOT the bare-`/`
 *  landing: many capture tools boot `/` (often with no query at all) and wait
 *  for a live match on `window.__PLAY__`, so gating `/` behind select would
 *  break them mid-run. Select is the human front door; it writes an explicit
 *  matchup query and hands off to the match. */
function isSelectRoute(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('select') === '1'
}

/** The live attract reel at `?attract=1`. A distinct query no capture tool
 *  uses, so it can't be confused with a bare-`/` match or a `?fight=1` harness. */
function isAttractRoute(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('attract') === '1'
}

/** The fighter is the game, so it owns `/`. The dev routes above are tested
 *  first and still win; `?play=1` keeps working for tools that hardcode it. */
function isPlayRoute(): boolean {
  if (typeof window === 'undefined') return false
  return !isCardsRoute() && !isSelectRoute() && !isAttractRoute()
}

export function App() {
  const phase = useGame((s) => s.phase)
  const crtEnabled = useGame((s) => s.crtEnabled)
  const selectedB = useGame((s) => s.selectedB)
  const musicEnabled = useGame((s) => s.musicEnabled)
  const [lab] = useState(isLabRoute)
  const [fight] = useState(isFightRoute)
  const [hud] = useState(isHudRoute)
  const [select] = useState(isSelectRoute)
  const [attract] = useState(isAttractRoute)
  const [play] = useState(isPlayRoute)

  // Arcade boot gate. Shown once per page load before anything else. The
  // press is a real user gesture, so it unlocks the soundtrack — the menu's
  // Attract reel that follows finally plays with music instead of in silence.
  const [started, setStarted] = useState(false)
  const handleStart = useCallback(() => {
    // We're inside a user-gesture stack frame here, so play() resolves
    // immediately instead of getting parked by the autoplay policy.
    if (musicEnabled) Music.play('menu')
    setStarted(true)
  }, [musicEnabled])

  useEffect(() => {
    loadQuoteBank()
    const unsubscribe = attachQuoteBankSync()
    return () => unsubscribe()
  }, [])

  // Music: switch tracks based on phase. Lenny gets the boss theme.
  useEffect(() => {
    if (!musicEnabled) {
      Music.stop()
      return
    }
    if (phase === 'menu' || phase === 'character-select' || phase === 'stage-select' || phase === 'quote-bank' || phase === 'how-to-play' || phase === 'credits') {
      Music.play('menu')
    } else if (phase === 'pre-fight' || phase === 'fight') {
      if (selectedB === 'lenny') {
        Music.play('boss')
      } else {
        // Rotate fight / fight-b each match for variety
        Music.playFight()
      }
    } else if (phase === 'round-end') {
      // hold current track
    } else if (phase === 'match-end') {
      Music.play('victory')
    } else if (phase === 'arcade-victory' || phase === 'story-ending') {
      Music.play('victory')
    } else if (phase === 'story-cutscene') {
      // Hold the menu track during cutscenes — fades into fight on handoff.
      Music.play('menu')
    }
  }, [phase, selectedB, musicEnabled])

  // Anticipatory prefetch: when the user lands on a phase, warm the chunks
  // they're most likely to navigate to next. Cached imports are cheap, so
  // over-prefetching is harmless. This is what keeps the Suspense skeleton
  // from appearing on the most common navigation paths.
  useEffect(() => {
    if (phase === 'menu') {
      prefetchScreen('character-select')
      prefetchScreen('marquee-matchups')
      prefetchScreen('how-to-play')
    } else if (phase === 'character-select' || phase === 'marquee-matchups') {
      prefetchScreen('stage-select')
      prefetchScreen('pre-fight')
      prefetchScreen('fight')
    } else if (phase === 'pre-fight') {
      prefetchScreen('fight')
      prefetchScreen('round-end')
    } else if (phase === 'fight') {
      prefetchScreen('round-end')
      prefetchScreen('match-end')
    } else if (phase === 'round-end') {
      prefetchScreen('match-end')
    } else if (phase === 'match-end') {
      prefetchScreen('arcade-victory')
    }
  }, [phase])

  const ActiveScreen = phase !== 'menu' && phase in SCREENS
    ? SCREENS[phase as keyof typeof SCREENS].Component
    : null

  if (lab) {
    return (
      <Suspense fallback={<div style={{ color: '#fff', padding: 24 }}>loading lab…</div>}>
        <ThreeLab />
      </Suspense>
    )
  }

  if (fight) {
    return (
      <Suspense fallback={<div style={{ color: '#fff', padding: 24 }}>loading fight…</div>}>
        <FightHarness />
      </Suspense>
    )
  }

  if (hud) {
    return (
      <Suspense fallback={<div style={{ color: '#fff', padding: 24 }}>loading hud…</div>}>
        <HudPreview />
      </Suspense>
    )
  }

  if (select) {
    return (
      <Suspense fallback={<div style={{ color: '#fff', padding: 24 }}>loading select…</div>}>
        <FightSelect />
      </Suspense>
    )
  }

  if (attract) {
    return (
      <Suspense fallback={<div style={{ color: '#fff', padding: 24 }}>loading attract…</div>}>
        <AttractMode onExit={() => { window.location.search = 'select=1' }} />
      </Suspense>
    )
  }

  if (play) {
    return (
      <Suspense fallback={<div style={{ color: '#fff', padding: 24 }}>loading match…</div>}>
        <PlayableMatch />
      </Suspense>
    )
  }

  return (
    <div className="w-full h-full" style={{ background: '#0F0A1A' }}>
      {!started ? (
        <StartScreen onStart={handleStart} />
      ) : phase === 'menu' ? (
        <MainMenu />
      ) : phase === 'story-cutscene' ? (
        <StoryCutscene />
      ) : ActiveScreen ? (
        <Suspense fallback={<ScreenSkeleton phase={phase} />}>
          <ActiveScreen />
        </Suspense>
      ) : null}
      {crtEnabled && <div className="crt-overlay" />}
    </div>
  )
}
