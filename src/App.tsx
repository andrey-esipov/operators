import { useEffect, lazy, Suspense } from 'react'
import { useGame } from './state/game'
import { Music } from './lib/music'
import { MainMenu } from './screens/MainMenu'
import { attachQuoteBankSync, loadQuoteBank } from './lib/persist'

// Lazy-load every non-menu screen. The MainMenu is on the boot path; everything
// else loads on demand. This defers quote-pool.json (107KB, used by combat +
// spotlight), episode-youtube.json, framer-motion, and per-screen layout code
// out of the initial bundle — meaningful on Replit's cold-start.
const CharacterSelect = lazy(() => import('./screens/CharacterSelect').then((m) => ({ default: m.CharacterSelect })))
const StageSelect = lazy(() => import('./screens/StageSelect').then((m) => ({ default: m.StageSelect })))
const PreFight = lazy(() => import('./screens/PreFight').then((m) => ({ default: m.PreFight })))
const CombatScreen = lazy(() => import('./screens/CombatScreen').then((m) => ({ default: m.CombatScreen })))
const RoundEnd = lazy(() => import('./screens/RoundEnd').then((m) => ({ default: m.RoundEnd })))
const MatchEnd = lazy(() => import('./screens/MatchEnd').then((m) => ({ default: m.MatchEnd })))
const ArcadeVictory = lazy(() => import('./screens/ArcadeVictory').then((m) => ({ default: m.ArcadeVictory })))
const QuoteBank = lazy(() => import('./screens/QuoteBank').then((m) => ({ default: m.QuoteBank })))
const HowToPlay = lazy(() => import('./screens/HowToPlay').then((m) => ({ default: m.HowToPlay })))
const FrameworkEncyclopedia = lazy(() => import('./screens/FrameworkEncyclopedia').then((m) => ({ default: m.FrameworkEncyclopedia })))
const Stats = lazy(() => import('./screens/Stats').then((m) => ({ default: m.Stats })))
const FighterSpotlight = lazy(() => import('./screens/FighterSpotlight').then((m) => ({ default: m.FighterSpotlight })))
const GenerateFighter = lazy(() => import('./screens/GenerateFighter').then((m) => ({ default: m.GenerateFighter })))
const MarqueeMatchups = lazy(() => import('./screens/MarqueeMatchups').then((m) => ({ default: m.MarqueeMatchups })))
const Credits = lazy(() => import('./screens/Credits').then((m) => ({ default: m.Credits })))

function ScreenFallback() {
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: '#0F0A1A' }}>
      <div
        className="font-display text-xs tracking-widest"
        style={{ color: '#FFD60A', textShadow: '2px 2px 0 black', animation: 'flash 1s linear infinite' }}
      >
        ◇ LOADING ◇
      </div>
    </div>
  )
}

export function App() {
  const phase = useGame((s) => s.phase)
  const mode = useGame((s) => s.mode)
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
      // Check who won — for simplicity play victory; combat screen handles defeat sting on K.O.
      Music.play('victory')
    } else if (phase === 'arcade-victory') {
      Music.play('victory')
    }
  }, [phase, selectedB, musicEnabled])

  return (
    <div className="w-full h-full" style={{ background: '#0F0A1A' }}>
      {phase === 'menu' ? (
        <MainMenu />
      ) : (
        <Suspense fallback={<ScreenFallback />}>
          {phase === 'character-select' && <CharacterSelect />}
          {phase === 'stage-select' && <StageSelect />}
          {phase === 'pre-fight' && <PreFight />}
          {phase === 'fight' && <CombatScreen mode={mode} />}
          {phase === 'round-end' && <RoundEnd />}
          {phase === 'match-end' && <MatchEnd />}
          {phase === 'arcade-victory' && <ArcadeVictory />}
          {phase === 'quote-bank' && <QuoteBank />}
          {phase === 'how-to-play' && <HowToPlay />}
          {phase === 'framework-encyclopedia' && <FrameworkEncyclopedia />}
          {phase === 'stats' && <Stats />}
          {phase === 'fighter-spotlight' && <FighterSpotlight />}
          {phase === 'generate-fighter' && <GenerateFighter />}
          {phase === 'marquee-matchups' && <MarqueeMatchups />}
          {phase === 'credits' && <Credits />}
        </Suspense>
      )}
      {crtEnabled && <div className="crt-overlay" />}
    </div>
  )
}
