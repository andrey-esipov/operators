import { useEffect } from 'react'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { Sfx } from '../lib/audio'

export function RoundEnd() {
  const fighterA = useGame((s) => s.fighterA)
  const fighterB = useGame((s) => s.fighterB)
  const newRound = useGame((s) => s.newRound)
  const roundsWon = useGame((s) => s.roundsWon)
  const log = useGame((s) => s.log)

  useEffect(() => {
    Sfx.ko()
    const id = setTimeout(() => newRound(), 2800)
    return () => clearTimeout(id)
  }, [])

  if (!fighterA || !fighterB) return null
  const lastEntry = log[log.length - 1]
  const winnerSide = lastEntry?.attacker
  const winner = winnerSide === 'a' ? getFighter(fighterA.defId)! : getFighter(fighterB.defId)!

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at center, rgba(247,127,0,0.4) 0%, #1A0F2E 60%, #0F0A1A 100%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="font-display text-9xl tracking-widest" style={{
          color: '#FFFFFF',
          textShadow: '8px 8px 0 black, 0 0 32px #F77F00',
        }}>
          K.O.
        </div>
        <div className="font-display text-2xl tracking-widest text-white">
          {winner.shortName} WINS ROUND
        </div>
        <div className="flex gap-3 mt-2">
          <RoundDot won={roundsWon.a > 0} color="#E63946" />
          <RoundDot won={roundsWon.b > 0} color="#00B4D8" />
        </div>
        {lastEntry?.quote && (
          <div className="font-body text-xl italic text-white/80 mt-6 max-w-xl text-center">
            "{lastEntry.quote}" — {lastEntry.episode}
          </div>
        )}
      </div>
    </div>
  )
}

function RoundDot({ won, color }: { won: boolean; color: string }) {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        background: won ? color : '#2A1F33',
        border: '3px solid white',
        boxShadow: won ? `0 0 12px ${color}` : 'none',
      }}
    />
  )
}
