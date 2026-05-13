import { useGame } from './state/game'
import { MainMenu } from './screens/MainMenu'
import { CharacterSelect } from './screens/CharacterSelect'
import { PreFight } from './screens/PreFight'
import { CombatScreen } from './screens/CombatScreen'
import { RoundEnd } from './screens/RoundEnd'
import { MatchEnd } from './screens/MatchEnd'

export function App() {
  const phase = useGame((s) => s.phase)
  const crtEnabled = useGame((s) => s.crtEnabled)

  return (
    <div className="w-full h-full" style={{ background: '#0F0A1A' }}>
      {phase === 'menu' && <MainMenu />}
      {phase === 'character-select' && <CharacterSelect />}
      {phase === 'pre-fight' && <PreFight />}
      {phase === 'fight' && <CombatScreen mode="vs" />}
      {phase === 'round-end' && <RoundEnd />}
      {phase === 'match-end' && <MatchEnd />}
      {crtEnabled && <div className="crt-overlay" />}
    </div>
  )
}
