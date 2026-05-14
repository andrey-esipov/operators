import { useEffect } from 'react'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { Sfx } from '../lib/audio'
import { Sprite } from '../components/Sprite'

export function RoundEnd() {
  const fighterA = useGame((s) => s.fighterA)
  const fighterB = useGame((s) => s.fighterB)
  const newRound = useGame((s) => s.newRound)
  const roundsWon = useGame((s) => s.roundsWon)
  const log = useGame((s) => s.log)

  // PERFECT round: winner's HP never dropped — i.e. defender took 0 damage
  // across all log entries on the winner's side. We check by inspecting
  // the most-recent hpAfter for the winner. A round is PERFECT iff the
  // winning side is still at full HP at the moment of K.O.
  const lastEntry = log[log.length - 1]
  const winnerSide = lastEntry?.attacker
  const winner = winnerSide && fighterA && fighterB
    ? winnerSide === 'a' ? getFighter(fighterA.defId)! : getFighter(fighterB.defId)!
    : null
  const isPerfect = !!(
    winner && winnerSide && fighterA && fighterB &&
    (winnerSide === 'a' ? fighterA.hp === fighterA.maxHp : fighterB.hp === fighterB.maxHp)
  )

  useEffect(() => {
    Sfx.ko()
    // PERFECT rounds get an extra beat to celebrate — 3600ms vs 2800ms.
    const id = setTimeout(() => newRound(), isPerfect ? 3600 : 2800)
    return () => clearTimeout(id)
  }, [isPerfect, newRound])

  if (!fighterA || !fighterB || !winner) return null

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: isPerfect
            ? 'radial-gradient(circle at center, rgba(255,214,10,0.55) 0%, #2A1B3D 50%, #0F0A1A 100%)'
            : 'radial-gradient(circle at center, rgba(247,127,0,0.4) 0%, #1A0F2E 60%, #0F0A1A 100%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-4">
        {/* PERFECT banner — sits above the K.O. when the round was flawless.
            This is the moment players screenshot and share. */}
        {isPerfect && (
          <div
            className="font-display tracking-widest"
            style={{
              color: '#FFD60A',
              fontSize: 56,
              letterSpacing: '0.3em',
              textShadow: '6px 6px 0 black, 0 0 32px #F77F00, 0 0 64px #FFD60A',
              transform: 'skewX(-6deg)',
              animation: 'perfectBannerCrash 0.6s cubic-bezier(0.2, 0.9, 0.3, 1)',
            }}
          >
            ★ PERFECT ★
          </div>
        )}
        <div className="font-display text-9xl tracking-widest" style={{
          color: '#FFFFFF',
          textShadow: '8px 8px 0 black, 0 0 32px #F77F00',
        }}>
          K.O.
        </div>
        <div className="flex items-center gap-4">
          <div style={{ width: 80, height: 110 }}>
            <Sprite fighter={winner} side={winnerSide!} state="win" />
          </div>
          <div className="font-display text-2xl tracking-widest" style={{ color: winner.accent, textShadow: '3px 3px 0 black' }}>
            {winner.shortName} WINS ROUND
          </div>
        </div>
        <div className="flex gap-3 mt-2">
          <RoundDot won={roundsWon.a > 0} color="#E63946" />
          <RoundDot won={roundsWon.b > 0} color="#00B4D8" />
        </div>
        {lastEntry?.quote && (
          <div className="font-body text-xl italic text-white/80 mt-6 max-w-xl text-center px-6">
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
