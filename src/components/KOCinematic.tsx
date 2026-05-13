import { useEffect, useState } from 'react'
import type { Side } from '../types'
import { getFighter } from '../data/fighters'

interface Props {
  winner: Side
  loser: Side
  winnerId: string | null
  loserId: string | null
  id: number
}

/**
 * 2.4s K.O. cinematic that overlays the combat screen.
 *
 * Beat 0 (0-150ms):    white flash (impact freeze)
 * Beat 1 (150-1100ms): slow-mo "K.O." banner crashes in from off-screen
 * Beat 2 (1100-2400ms): banner holds with particle burst + winner taunt
 *
 * The state machine in src/state/game.ts owns the timing — this component
 * just renders the visual sequence keyed off the `id` prop.
 */
export function KOCinematic({ winner, loser, winnerId, loserId, id }: Props) {
  const [beat, setBeat] = useState(0)
  const winnerDef = winnerId ? getFighter(winnerId) : null
  const loserDef = loserId ? getFighter(loserId) : null
  // Suppress unused vars
  void winner; void loser

  useEffect(() => {
    setBeat(0)
    const t1 = setTimeout(() => setBeat(1), 150)
    const t2 = setTimeout(() => setBeat(2), 1100)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [id])

  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      {/* White flash — impact freeze */}
      {beat === 0 && (
        <div
          className="absolute inset-0"
          style={{
            background: 'white',
            animation: 'koFlash 150ms linear',
          }}
        />
      )}

      {/* Slow-mo / desaturation veil during beats 1-2 */}
      {beat >= 1 && (
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%)',
            backdropFilter: 'saturate(0.4) contrast(1.2)',
          }}
        />
      )}

      {/* K.O. banner */}
      {beat >= 1 && (
        <div
          className="absolute left-0 right-0 flex flex-col items-center justify-center"
          style={{
            top: '32%',
            animation: 'koBannerCrash 0.55s cubic-bezier(0.2, 0.9, 0.3, 1)',
          }}
        >
          <div
            className="font-display tracking-widest"
            style={{
              color: '#FFD60A',
              fontSize: 96,
              letterSpacing: '0.18em',
              textShadow:
                '6px 6px 0 black, 0 0 24px #F77F00, 0 0 48px #E63946',
              transform: 'skewX(-6deg)',
            }}
          >
            K.O.!
          </div>
          {beat === 2 && winnerDef && (
            <div
              className="font-display tracking-widest mt-4"
              style={{
                color: 'white',
                fontSize: 14,
                letterSpacing: '0.3em',
                textShadow: '2px 2px 0 black',
                animation: 'koSubFade 0.4s ease-out',
              }}
            >
              {winnerDef.shortName} WINS
            </div>
          )}
        </div>
      )}

      {/* Particle burst on beat 2 */}
      {beat === 2 && <ParticleBurst id={id} />}

      {/* Voice line bubble bottom-right */}
      {beat === 2 && winnerDef && (
        <div
          className="absolute bottom-24 right-8 max-w-md p-3"
          style={{
            background: 'rgba(0,0,0,0.7)',
            border: `2px solid ${winnerDef.accent}`,
            boxShadow: `0 0 14px ${winnerDef.accent}AA, inset -2px -2px 0 rgba(0,0,0,0.5)`,
            animation: 'koTaunt 0.4s ease-out',
          }}
        >
          <div
            className="font-display text-[8px] tracking-widest mb-1"
            style={{ color: winnerDef.accent }}
          >
            {winnerDef.shortName}
          </div>
          <div className="font-body italic text-base text-white leading-snug">
            &ldquo;{winnerDef.voiceLines.ko}&rdquo;
          </div>
        </div>
      )}

      {/* Loser collapse glow */}
      {beat >= 1 && loserDef && (
        <div
          className="absolute"
          style={{
            left: loser === 'a' ? '15%' : '60%',
            top: '40%',
            width: 240,
            height: 240,
            background: `radial-gradient(circle, ${loserDef.accent}88 0%, transparent 60%)`,
            opacity: 0.5,
            animation: 'koLoserDim 1.2s ease-out forwards',
          }}
        />
      )}
    </div>
  )
}

/** Canvas-based 4×4 pixel particle burst — 60 short-lived particles with gravity. */
function ParticleBurst({ id }: { id: number }) {
  // Re-run only when id changes
  const seed = id
  return (
    <svg
      className="absolute inset-0 w-full h-full"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      {Array.from({ length: 60 }).map((_, i) => {
        // Deterministic pseudo-random from seed
        const angle = (i / 60) * Math.PI * 2 + ((seed * 13) % 360) * (Math.PI / 180)
        const speed = 18 + ((i * 7 + seed) % 22)
        const dx = Math.cos(angle) * speed
        const dy = Math.sin(angle) * speed - 12
        const hue = ['#FFD60A', '#F77F00', '#E63946', '#FFFFFF'][i % 4]
        const size = (i % 3) + 1
        return (
          <rect
            key={`${seed}-${i}`}
            x={50}
            y={45}
            width={size}
            height={size}
            fill={hue}
            style={{
              animation: `koParticle 1.1s linear forwards`,
              animationDelay: `${(i * 8) % 60}ms`,
              ['--dx' as unknown as string]: `${dx}`,
              ['--dy' as unknown as string]: `${dy}`,
            }}
          />
        )
      })}
    </svg>
  )
}
