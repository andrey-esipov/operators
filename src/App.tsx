import { useEffect } from 'react'
import { useGame } from './state/game'
import { MainMenu } from './screens/MainMenu'
import { CharacterSelect } from './screens/CharacterSelect'
import { PreFight } from './screens/PreFight'
import { CombatScreen } from './screens/CombatScreen'
import { RoundEnd } from './screens/RoundEnd'
import { MatchEnd } from './screens/MatchEnd'
import { ArcadeVictory } from './screens/ArcadeVictory'
import { QuoteBank } from './screens/QuoteBank'
import { attachQuoteBankSync, loadQuoteBank } from './lib/persist'

export function App() {
  const phase = useGame((s) => s.phase)
  const mode = useGame((s) => s.mode)
  const crtEnabled = useGame((s) => s.crtEnabled)

  useEffect(() => {
    loadQuoteBank()
    const unsubscribe = attachQuoteBankSync()
    return () => unsubscribe()
  }, [])

  return (
    <div className="w-full h-full" style={{ background: '#0F0A1A' }}>
      {phase === 'menu' && <MainMenu />}
      {phase === 'character-select' && <CharacterSelect />}
      {phase === 'pre-fight' && <PreFight />}
      {phase === 'fight' && <CombatScreen mode={mode} />}
      {phase === 'round-end' && <RoundEnd />}
      {phase === 'match-end' && <MatchEnd />}
      {phase === 'arcade-victory' && <ArcadeVictory />}
      {phase === 'quote-bank' && <QuoteBank />}
      {crtEnabled && <div className="crt-overlay" />}
    </div>
  )
}
