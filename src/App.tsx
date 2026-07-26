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

function isLabRoute(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('lab') === '1'
}

export function App() {
  const phase = useGame((s) => s.phase)
  const crtEnabled = useGame((s) => s.crtEnabled)
  const selectedB = useGame((s) => s.selectedB)
  const musicEnabled = useGame((s) => s.musicEnabled)
  const [lab] = useState(isLabRoute)

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
