import { useEffect } from 'react'
import { useGame } from './state/game'
import { Music } from './lib/music'
import { MainMenu } from './screens/MainMenu'
import { CharacterSelect } from './screens/CharacterSelect'
import { StageSelect } from './screens/StageSelect'
import { PreFight } from './screens/PreFight'
import { CombatScreen } from './screens/CombatScreen'
import { RoundEnd } from './screens/RoundEnd'
import { MatchEnd } from './screens/MatchEnd'
import { ArcadeVictory } from './screens/ArcadeVictory'
import { QuoteBank } from './screens/QuoteBank'
import { HowToPlay } from './screens/HowToPlay'
import { FrameworkEncyclopedia } from './screens/FrameworkEncyclopedia'
import { Stats } from './screens/Stats'
import { attachQuoteBankSync, loadQuoteBank } from './lib/persist'

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
    if (phase === 'menu' || phase === 'character-select' || phase === 'stage-select' || phase === 'quote-bank' || phase === 'how-to-play') {
      Music.play('menu')
    } else if (phase === 'pre-fight' || phase === 'fight') {
      Music.play(selectedB === 'lenny' ? 'boss' : phase === 'fight' ? 'fight' : 'fight')
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
      {phase === 'menu' && <MainMenu />}
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
      {crtEnabled && <div className="crt-overlay" />}
    </div>
  )
}
