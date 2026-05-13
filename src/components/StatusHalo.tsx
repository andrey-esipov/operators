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
      {best && (
        <div
          className="absolute"
          style={{
            left: '50%',
            bottom: '8%',
            marginLeft: -160,
            width: 320,
            height: 320,
            borderRadius: '50%',
            background: `radial-gradient(ellipse at center 80%, ${best.color}55 0%, ${best.color}22 35%, transparent 60%)`,
            animation:
              best.style === 'pulse'  ? 'haloPulse 1.6s ease-in-out infinite' :
              best.style === 'swirl'  ? 'haloSwirl 4s linear infinite' :
                                        'haloSpark 0.7s steps(6) infinite',
            mixBlendMode: 'screen',
          }}
        />
      )}

      {/* Super-ready ring — always on top, gold, slow pulse */}
      {superReady && (
        <div
          className="absolute"
          style={{
            left: '50%',
            bottom: '6%',
            marginLeft: -180,
            width: 360,
            height: 360,
            borderRadius: '50%',
            border: '3px solid #FFD60A',
            background: 'radial-gradient(ellipse at center 80%, rgba(255,214,10,0.18) 0%, transparent 55%)',
            animation: 'superReady 1.4s ease-in-out infinite',
            boxShadow: '0 0 24px rgba(255,214,10,0.6) inset, 0 0 24px rgba(247,127,0,0.4)',
            mixBlendMode: 'screen',
          }}
        />
      )}

      <style>{`
        @keyframes haloPulse {
          0%, 100% { opacity: 0.45; transform: scale(1) }
          50%      { opacity: 0.9;  transform: scale(1.08) }
        }
        @keyframes haloSwirl {
          0%   { opacity: 0.6; transform: rotate(0deg) scale(1) }
          50%  { opacity: 0.9; transform: rotate(180deg) scale(1.1) }
          100% { opacity: 0.6; transform: rotate(360deg) scale(1) }
        }
        @keyframes haloSpark {
          0%,40%,60%,100% { opacity: 0.55 }
          50%,55%         { opacity: 1 }
        }
        @keyframes superReady {
          0%, 100% { opacity: 0.8; transform: scale(1) }
          50%      { opacity: 1;   transform: scale(1.04) }
        }
      `}</style>
    </div>
  )
}
