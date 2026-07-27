import { useEffect } from 'react'
import './ceremony/devExpose'
import './ceremony/ceremony.css'
import { ShockRing, ImpactFlash, StageBackdrop, WinnerFloor } from './ceremony/CeremonyFX'
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
  const scenario = useGame((s) => s.scenario)

  const lastEntry = log[log.length - 1]
  // Winner derivation. HP is the source of truth at K.O. — whichever side is
  // still standing won the round. Fall back to the log only on a double-KO / time-up.
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
    // PERFECT rounds get a slightly longer beat to celebrate. Kept punchy —
    // round transitions should feel like punctuation, not a loading screen.
    const id = setTimeout(() => newRound(), isPerfect ? 3200 : 2400)
    return () => clearTimeout(id)
  }, [isPerfect, newRound])

  if (!fighterA || !fighterB || !winner || !loser || !winnerSide || !loserSide) return null

  const accent = winner.accent || '#FFD60A'

  return (
    <div className="cer-anim relative w-full h-full flex items-center justify-center overflow-hidden">
      <StageBackdrop scenario={scenario} tint={accent} dim={isPerfect ? 0.44 : 0.36} />
      {/* Rotating burst behind the winner — subtle over the real stage. */}
      <div className="cer-rays" style={{ opacity: 0.22 }} />
      <ImpactFlash duration={0.22} />

      <div className="relative z-10 flex flex-col items-center">
        {isPerfect && (
          <div
            className="font-display tracking-widest"
            style={{
              color: '#FFD60A',
              fontSize: 'clamp(24px, 4vw, 48px)',
              letterSpacing: '0.3em',
              textShadow: '6px 6px 0 black, 0 0 32px #F77F00, 0 0 64px #FFD60A',
              transform: 'skewX(-6deg)',
              animation: 'cer-title-crash 0.5s cubic-bezier(0.15,0.9,0.3,1) both',
            }}
          >
            ★ PERFECT ★
          </div>
        )}
        <div
          className="font-display tracking-widest"
          style={{
            color: '#FFFFFF',
            fontSize: 'clamp(58px, 10vw, 132px)',
            textShadow: '8px 8px 0 black, 0 0 32px #F77F00, 0 0 64px #E63946',
            animation: 'cer-title-crash 0.42s cubic-bezier(0.15,0.9,0.3,1) both',
          }}
        >
          K.O.
        </div>

        <div className="flex items-end gap-8 md:gap-14 mt-1">
          {/* Loser — slumped, dim, off to the side. */}
          <div
            className="flex flex-col items-center"
            style={{ animation: 'cer-loser-in 0.5s ease-out 0.15s both' }}
          >
            <div style={{ width: 'min(22vw, 210px)', height: 'min(30vh, 240px)' }}>
              <Sprite fighter={loser} side={loserSide} state="lose" />
            </div>
            <div
              className="font-display text-[10px] tracking-widest mt-1 text-white/60"
              style={{ textShadow: '2px 2px 0 black' }}
            >
              {loser.shortName} · DEFEATED
            </div>
          </div>

          {/* Winner — larger, rises into a hero pose, breathes, shock rings at the feet. */}
          <div className="flex flex-col items-center relative" style={{ animation: 'cer-hero-rise 0.55s cubic-bezier(0.15,0.9,0.3,1) 0.12s both' }}>
            <div className="absolute" style={{ left: '50%', bottom: '16%' }}>
              <ShockRing color={accent} size={190} thickness={4} delay={0.25} duration={0.6} />
            </div>
            <div className="relative" style={{ width: 'min(36vw, 380px)', height: 'min(54vh, 460px)' }}>
              <div
                className="cer-breathe"
                style={{
                  width: '100%', height: '100%',
                  filter: `drop-shadow(0 0 30px ${accent})`,
                }}
              >
                <Sprite fighter={winner} side={winnerSide} state="win" />
              </div>
              <WinnerFloor color={accent} />
            </div>
            <div
              className="font-display tracking-widest mt-1"
              style={{ color: accent, fontSize: 'clamp(16px, 2.4vw, 30px)', textShadow: '3px 3px 0 black' }}
            >
              {winner.shortName} WINS ROUND
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-3">
          <RoundDot won={roundsWon.a > 0} color="#E63946" />
          <RoundDot won={roundsWon.b > 0} color="#00B4D8" />
        </div>

        {lastEntry?.quote && (
          <div className="font-body text-xl italic text-white/80 mt-3 max-w-xl text-center px-6">
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
        width: 30,
        height: 30,
        background: won ? color : '#2A1F33',
        border: '3px solid white',
        boxShadow: won ? `0 0 14px ${color}` : 'none',
      }}
    />
  )
}
