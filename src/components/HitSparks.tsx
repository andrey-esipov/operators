import { useEffect, useState } from 'react'
import type { Side } from '../types'

interface Spark {
  id: number
  side: Side
  kind: 'light' | 'heavy' | 'crit' | 'combo' | 'ult'
}

interface Props {
  /** Latest hit event — bumped per damaging move */
  trigger: { id: number; side: Side; kind: 'light' | 'heavy' | 'crit' | 'combo' | 'ult' } | null
}

/**
 * Particle bursts at the defender's body when a hit lands.
 *
 * Particle count + color depend on the hit kind:
 *   light   — 12 small white/cyan sparks
 *   heavy   — 24 orange/red shards
 *   crit    — 40 white shockwave + ring expansion
 *   combo   — 32 gold + magenta dual-color burst
 *   ult     — 60 multi-color radial explosion + ring
 *
 * The burst originates roughly at chest-level of the defender's sprite
 * container, slightly inside from the side they're standing on.
 */
export function HitSparks({ trigger }: Props) {
  const [sparks, setSparks] = useState<Spark[]>([])

  useEffect(() => {
    if (!trigger) return
    const spark = { id: trigger.id, side: trigger.side, kind: trigger.kind }
    setSparks((s) => [...s, spark])
    // Clean up old sparks
    const t = setTimeout(() => {
      setSparks((s) => s.filter((sp) => sp.id !== spark.id))
    }, 900)
    return () => clearTimeout(t)
  }, [trigger?.id])

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {sparks.map((s) => (
        <SingleBurst key={s.id} {...s} />
      ))}
    </div>
  )
}

function SingleBurst({ id, side, kind }: Spark) {
  // Impact origin: defender's chest-level. Side A is on the left ~22%,
  // side B is on the right ~78% — sparks burst from the DEFENDER, which
  // is the side OPPOSITE the attacker (side here = attacker, so flip).
  const defenderSide: Side = side === 'a' ? 'b' : 'a'
  const cx = defenderSide === 'a' ? 22 : 78
  const cy = 50

  const config: Record<Spark['kind'], { count: number; colors: string[]; speed: number; ring: boolean }> = {
    light:  { count: 14, colors: ['#FFFFFF', '#90E0EF', '#00B4D8'],            speed: 14, ring: false },
    heavy:  { count: 26, colors: ['#F77F00', '#E63946', '#FFD60A'],            speed: 22, ring: true  },
    crit:   { count: 42, colors: ['#FFFFFF', '#FFFFFF', '#FFD60A'],            speed: 28, ring: true  },
    combo:  { count: 34, colors: ['#FFD60A', '#F72585', '#FFFFFF'],            speed: 24, ring: true  },
    ult:    { count: 60, colors: ['#F72585', '#7209B7', '#FFD60A', '#FFFFFF'], speed: 32, ring: true  },
  }
  const c = config[kind]

  return (
    <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
      {/* Shockwave ring on heavy / crit / combo / ult */}
      {c.ring && (
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill="none"
          stroke={c.colors[0]}
          strokeWidth={0.8}
          style={{
            animation: 'hitRing 0.55s ease-out forwards',
            filter: `drop-shadow(0 0 4px ${c.colors[0]})`,
          }}
        />
      )}

      {/* Inner white flash on crits/ults */}
      {(kind === 'crit' || kind === 'ult') && (
        <circle
          cx={cx}
          cy={cy}
          r={6}
          fill="white"
          style={{
            animation: 'hitFlash 0.25s ease-out forwards',
            transformOrigin: `${cx}% ${cy}%`,
          }}
        />
      )}

      {/* Radial particles */}
      {Array.from({ length: c.count }).map((_, i) => {
        const angle = (i / c.count) * Math.PI * 2 + ((id * 13) % 360) * (Math.PI / 180)
        const speed = c.speed + ((i * 7 + id) % 8)
        const dx = Math.cos(angle) * speed
        const dy = Math.sin(angle) * speed - 2
        const color = c.colors[i % c.colors.length]
        const size = 0.8 + (i % 3) * 0.4
        return (
          <rect
            key={i}
            x={cx - size / 2}
            y={cy - size / 2}
            width={size}
            height={size}
            fill={color}
            style={{
              animation: `hitParticle 0.7s ease-out forwards`,
              animationDelay: `${(i * 6) % 40}ms`,
              filter: `drop-shadow(0 0 ${size * 1.5}px ${color})`,
              ['--dx' as unknown as string]: `${dx}`,
              ['--dy' as unknown as string]: `${dy}`,
            }}
          />
        )
      })}

      <style>{`
        @keyframes hitParticle {
          0%   { transform: translate(0, 0); opacity: 1 }
          100% { transform: translate(calc(var(--dx) * 1%), calc(var(--dy) * 1%)); opacity: 0 }
        }
        @keyframes hitRing {
          0%   { r: 4;  opacity: 1; stroke-width: 1.0 }
          100% { r: 22; opacity: 0; stroke-width: 0.2 }
        }
        @keyframes hitFlash {
          0%   { r: 6;  opacity: 0.95 }
          100% { r: 14; opacity: 0 }
        }
      `}</style>
    </svg>
  )
}
