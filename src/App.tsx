import { useEffect, Suspense } from 'react'
import { useGame } from './state/game'
import { Music } from './lib/music'
import { MainMenu } from './screens/MainMenu'
import { SCREENS, prefetchScreen } from './screens/registry'
import { ScreenSkeleton } from './components/ScreenSkeleton'
import { StoryCutscene } from './components/StoryCutscene'
import { attachQuoteBankSync, loadQuoteBank } from './lib/persist'

export function App() {
  const phase = useGame((s) => s.phase)
  const crtEnabled = useGame((s) => s.crtEnabled)
  const selectedB = useGame((s) => s.selectedB)
  const musicEnabled = useGame((s) => s.musicEnabled)

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

  return (
    <div className="w-full h-full" style={{ background: '#0F0A1A' }}>
      {phase === 'menu' ? (
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
