import { useEffect } from 'react'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'

export function MatchEnd() {
  const fighterA = useGame((s) => s.fighterA)
  const fighterB = useGame((s) => s.fighterB)
  const roundsWon = useGame((s) => s.roundsWon)
  const resetMatch = useGame((s) => s.resetMatch)
  const quoteBank = useGame((s) => s.quoteBank)

  useEffect(() => {
    if (roundsWon.a >= 2) Sfx.victory()
    else if (roundsWon.b >= 2) Sfx.defeat()
  }, [])

  if (!fighterA || !fighterB) return null
  const winnerSide: 'a' | 'b' = roundsWon.a >= 2 ? 'a' : 'b'
  const winner = winnerSide === 'a' ? getFighter(fighterA.defId)! : getFighter(fighterB.defId)!
  const loser = winnerSide === 'a' ? getFighter(fighterB.defId)! : getFighter(fighterA.defId)!

  const winnerLines = winner.voiceLines
  const loserLines = loser.voiceLines

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            winnerSide === 'a'
              ? 'radial-gradient(circle at center, #E6394644 0%, #1A0F2E 60%, #0F0A1A 100%)'
              : 'radial-gradient(circle at center, #00B4D844 0%, #0F1A2E 60%, #0F0A1A 100%)',
        }}
      />

      <div className="relative z-10 font-display tracking-widest text-center" style={{
        color: '#FFD60A',
        textShadow: '6px 6px 0 black, 0 0 24px #F77F00',
        fontSize: 96,
      }}>
        VICTORY
      </div>
      <div className="relative z-10 font-display text-2xl tracking-widest mt-2" style={{ color: winner.accent }}>
        {winner.name.toUpperCase()} WINS
      </div>

      <div className="relative z-10 mt-8 flex items-end gap-12">
        <div className="flex flex-col items-center opacity-50">
          <div style={{ width: 160, height: 230 }}>
            <Sprite fighter={loser} side={winnerSide === 'a' ? 'b' : 'a'} state="lose" />
          </div>
          <div className="font-display text-base tracking-widest mt-2 text-white/60">{loser.shortName}</div>
          <div className="font-body text-base italic text-white/40 mt-1 max-w-xs text-center px-2">"{loserLines.lose}"</div>
        </div>

        <div className="flex flex-col items-center">
          <div style={{ width: 220, height: 300 }}>
            <Sprite fighter={winner} side={winnerSide} state="win" />
          </div>
          <div className="font-display text-lg tracking-widest mt-3" style={{ color: winner.accent }}>{winner.shortName}</div>
          <div className="font-body text-xl italic text-white mt-1 max-w-md text-center px-2">"{winnerLines.win}"</div>
        </div>
      </div>

      <div className="relative z-10 mt-6 px-6 py-3 max-w-xl text-center" style={{
        background: 'rgba(15,10,26,0.7)',
        border: '2px solid #FFD60A',
      }}>
        <div className="font-display text-[10px] tracking-widest" style={{ color: '#FFD60A' }}>
          QUOTE BANK · {quoteBank.length} ENTRIES UNLOCKED THIS MATCH
        </div>
        <div className="font-body text-base text-white/70 mt-1">
          Every move you played added a real podcast quote to your library.
        </div>
      </div>

      <div className="relative z-10 mt-8 flex gap-4">
        <button
          onClick={() => {
            Sfx.menuSelect()
            resetMatch()
          }}
          className="px-6 py-3 font-display text-base tracking-widest"
          style={{
            background: 'linear-gradient(180deg, #F77F0044, #E6394644)',
            color: 'white',
            border: '2px solid #E63946',
            boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2)',
          }}
        >
          MAIN MENU
        </button>
      </div>
    </div>
  )
}
