import type { Side } from '../types'

interface Props {
  value: number
  max: number
  side: Side
  /** True when the fighter is currently shattered — the bar pulses red. */
  shattered?: boolean
}

/**
 * Conviction bar — second resource axis below HP. Chipped by every hit
 * (light=5, heavy=12, combo=15, crit=×2, ult=40, read=30). Regens +5/turn.
 * At zero the fighter is shattered: skip a turn, attacker's next hit gets
 * +75% damage.
 *
 * Visual: slim ~120px slab in the operator's accent gradient (yellow →
 * orange → red as it depletes). Pulses red while shattered.
 */
export function ConvictionBar({ value, max, side, shattered }: Props) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  // Color shifts as conviction drops: full → goldenrod, half → orange,
  // critical → red. Sharp visual cue for "they're about to break."
  const fillColor =
    pct > 60 ? '#FFD60A'
    : pct > 30 ? '#F77F00'
    : '#E63946'

  return (
    <div className={`flex items-center gap-1 ${side === 'b' ? 'flex-row-reverse' : ''}`}>
      <span
        className="font-display text-[7px] tracking-widest"
        style={{ color: shattered ? '#E63946' : '#FFD60A' }}
      >
        {shattered ? 'SHATTERED' : 'CONV'}
      </span>
      <div
        className="h-1.5 relative"
        style={{
          width: '120px',
          background: '#1A1230',
          border: '1px solid rgba(0,0,0,0.5)',
          boxShadow: 'inset 0 0 4px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: fillColor,
            transition: 'width 0.25s ease-out, background 0.25s',
            boxShadow: shattered
              ? '0 0 10px #E63946'
              : pct < 30
              ? `0 0 6px ${fillColor}`
              : 'none',
            animation: shattered ? 'flash 0.35s infinite' : undefined,
            // Right-anchored fill for side B so the bar drains toward the
            // opposite edge (mirroring the HP bar convention).
            float: side === 'b' ? 'right' : undefined,
          }}
        />
      </div>
    </div>
  )
}
