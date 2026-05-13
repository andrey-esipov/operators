import type { Side } from '../types'

interface Props {
  value: number
  side: Side
}

/** Segmented super meter. 10 segments. Pulses when full. */
export function SuperMeter({ value, side }: Props) {
  const filled = Math.round((value / 100) * 10)
  const full = value >= 100

  return (
    <div className={`flex items-center gap-1 ${side === 'b' ? 'flex-row-reverse' : ''}`}>
      <span className="font-display text-[8px] tracking-widest" style={{ color: 'var(--color-sm-end)' }}>SUPER</span>
      <div className={`flex gap-[2px] h-2 ${side === 'b' ? 'flex-row-reverse' : ''}`} style={{ width: '160px' }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="flex-1"
            style={{
              background:
                i < filled
                  ? `linear-gradient(90deg, var(--color-sm-start), var(--color-sm-end))`
                  : '#2A1F33',
              boxShadow: full && i < filled ? '0 0 8px var(--color-sm-end)' : 'none',
              opacity: full ? (i % 2 === 0 ? 1 : 0.7) : 1,
              transition: 'opacity 0.2s',
              border: '1px solid rgba(0,0,0,0.5)',
            }}
          />
        ))}
      </div>
    </div>
  )
}
