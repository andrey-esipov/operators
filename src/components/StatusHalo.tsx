import type { StatusEffect } from '../types'

interface Props {
  status: StatusEffect[]
  /** Whether super meter is at 100 (adds a separate gold glow) */
  superReady: boolean
}

interface HaloDef {
  color: string
  glow: string
  /** Visual style: 'pulse' (steady), 'swirl' (rotating), 'spark' (random flash) */
  style: 'pulse' | 'swirl' | 'spark'
  /** Z-priority — higher wins when multiple statuses active */
  priority: number
}

const HALOS: Record<string, HaloDef> = {
  FOUNDER_MODE:      { color: '#E63946', glow: '#FFD60A', style: 'pulse',  priority: 10 },
  SHIPPING_MOMENTUM: { color: '#06D6A0', glow: '#06D6A0', style: 'spark',  priority: 5 },
  HONEST_FEEDBACK:   { color: '#FFD60A', glow: '#FFD60A', style: 'pulse',  priority: 4 },
  DISTRIBUTION_MOAT: { color: '#FCBF49', glow: '#F77F00', style: 'pulse',  priority: 7 },
  PREVIEW_STATE:     { color: '#00B4D8', glow: '#00B4D8', style: 'pulse',  priority: 6 },
  HYPERGROWTH_BURN:  { color: '#EF233C', glow: '#F77F00', style: 'spark',  priority: 8 },
  CONFUSED_ICP:      { color: '#7209B7', glow: '#7209B7', style: 'swirl',  priority: 9 },
  PRICING_PRESSURE:  { color: '#F72585', glow: '#F72585', style: 'swirl',  priority: 7 },
  LNO_PARALYSIS:     { color: '#5A2EE0', glow: '#5A2EE0', style: 'swirl',  priority: 9 },
  OUTCOME_DEBT:      { color: '#EF233C', glow: '#F72585', style: 'swirl',  priority: 8 },
}

/**
 * Aura ring rendered behind a fighter sprite, telegraphing active buffs/debuffs.
 *
 * - Picks the highest-priority active status and animates accordingly.
 * - If super meter is ready (≥100), ALSO renders a gold "ult-ready" ring
 *   on top.
 */
export function StatusHalo({ status, superReady }: Props) {
  // Find highest-priority halo
  let best: HaloDef | null = null
  for (const s of status) {
    const h = HALOS[s.key]
    if (h && (!best || h.priority > best.priority)) best = h
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Status aura — a soft elliptical halo near the fighter's feet,
          sized to live inside the sprite container without bleeding out. */}
      {best && (
        <div
          className="absolute"
          style={{
            left: '50%',
            bottom: '2%',
            marginLeft: -90,
            width: 180,
            height: 60,
            borderRadius: '50%',
            background: `radial-gradient(ellipse at center, ${best.color}77 0%, ${best.color}33 40%, transparent 70%)`,
            animation:
              best.style === 'pulse'  ? 'haloPulse 1.6s ease-in-out infinite' :
              best.style === 'swirl'  ? 'haloSwirl 4s linear infinite' :
                                        'haloSpark 0.7s steps(6) infinite',
            filter: 'blur(2px)',
          }}
        />
      )}

      {/* Super-ready indicator — small floating "⚡ ULT" tag above the fighter's
          head, instead of the giant overlapping circle. Subtle but readable. */}
      {superReady && (
        <div
          className="absolute"
          style={{
            left: '50%',
            top: '0%',
            transform: 'translateX(-50%)',
            animation: 'superReady 1.4s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        >
          <div
            className="font-display px-2 py-0.5"
            style={{
              color: '#FFD60A',
              fontSize: 9,
              letterSpacing: '0.2em',
              background: 'rgba(15,10,26,0.85)',
              border: '1px solid #FFD60A',
              boxShadow: '0 0 10px #FFD60A, inset -1px -1px 0 rgba(0,0,0,0.4)',
              textShadow: '0 0 4px #F77F00',
            }}
          >
            ⚡ ULT
          </div>
        </div>
      )}

      <style>{`
        @keyframes haloPulse {
          0%, 100% { opacity: 0.55; transform: scaleY(1) }
          50%      { opacity: 0.95; transform: scaleY(1.4) }
        }
        @keyframes haloSwirl {
          0%   { opacity: 0.7; transform: rotate(0deg) }
          50%  { opacity: 1;   transform: rotate(180deg) }
          100% { opacity: 0.7; transform: rotate(360deg) }
        }
        @keyframes haloSpark {
          0%,40%,60%,100% { opacity: 0.6 }
          50%,55%         { opacity: 1 }
        }
        @keyframes superReady {
          0%, 100% { opacity: 0.85; transform: translateX(-50%) translateY(0) }
          50%      { opacity: 1;    transform: translateX(-50%) translateY(-3px) }
        }
      `}</style>
    </div>
  )
}
