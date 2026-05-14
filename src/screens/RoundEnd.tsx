import { useEffect } from 'react'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { Sfx } from '../lib/audio'
import { Sprite } from '../components/Sprite'
import type { Side } from '../types'

export function RoundEnd() {
  const fighterA = useGame((s) => s.fighterA)
  const fighterB = useGame((s) => s.fighterB)
  const newRound = useGame((s) => s.newRound)
  const roundsWon = useGame((s) => s.roundsWon)
  const log = useGame((s) => s.log)

  const lastEntry = log[log.length - 1]
  // Winner derivation. HP is the source of truth at K.O. — whichever side is
  // still standing won the round. Falling back to `lastEntry.attacker` was
  // fragile because the log entry's attacker reflects who CAST the last move,
  // which can desync from who actually KO'd in edge cases (status DoT applied
  // by a move that didn't directly land lethal damage, time-up entries, etc).
  // We only fall back to the log when both sides are still alive (time-up).
  const winnerSide: Side | null =
    fighterA && fighterB
      ? fighterB.hp <= 0 && fighterA.hp > 0 ? 'a'
        : fighterA.hp <= 0 && fighterB.hp > 0 ? 'b'
        : (lastEntry?.attacker ?? null)
      : null
  const loserSide: Side | null = winnerSide === 'a' ? 'b' : winnerSide === 'b' ? 'a' : null
  const winner = winnerSide && fighterA && fighterB
    ? winnerSide === 'a' ? getFighter(fighterA.defId)! : getFighter(fighterB.defId)!
    : null
  const loser = loserSide && fighterA && fighterB
    ? loserSide === 'a' ? getFighter(fighterA.defId)! : getFighter(fighterB.defId)!
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

  if (!fighterA || !fighterB || !winner || !loser || !winnerSide || !loserSide) return null

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
        <div className="flex items-end gap-10">
          <div className="flex flex-col items-center opacity-55">
            <div style={{ width: 110, height: 150 }}>
              <Sprite fighter={loser} side={loserSide} state="lose" />
            </div>
            <div
              className="font-display text-[10px] tracking-widest mt-1 text-white/60"
              style={{ textShadow: '2px 2px 0 black' }}
            >
              {loser.shortName} · DEFEATED
            </div>
          </div>
          <div className="flex flex-col items-center">
            <div style={{ width: 140, height: 180 }}>
              <Sprite fighter={winner} side={winnerSide} state="win" />
            </div>
            <div
              className="font-display text-2xl tracking-widest mt-2"
              style={{ color: winner.accent, textShadow: '3px 3px 0 black' }}
            >
              {winner.shortName} WINS ROUND
            </div>
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
