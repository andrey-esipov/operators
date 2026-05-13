import type { Side } from '../types'

interface Props {
  hp: number
  maxHp: number
  side: Side
  name: string
}

/** Segmented SF II-style HP bar. 20 segments + pulse when critical. */
export function HpBar({ hp, maxHp, side, name }: Props) {
  const pct = Math.max(0, Math.min(1, hp / maxHp))
  const filled = Math.round(pct * 20)
  const isCritical = pct > 0 && pct <= 0.25
  const color =
    pct > 0.6 ? 'var(--color-hp-good)' : pct > 0.3 ? 'var(--color-hp-warn)' : 'var(--color-hp-crit)'
  const accent = side === 'a' ? 'var(--color-pa-red)' : 'var(--color-pb-cyan)'

  return (
    <div className={`flex items-center gap-2 ${side === 'b' ? 'flex-row-reverse' : ''}`}>
      <div className="flex flex-col gap-1" style={{ width: 'min(50vw, 480px)' }}>
        <div className={`flex items-center gap-2 ${side === 'b' ? 'flex-row-reverse' : ''}`} style={{ color: accent }}>
          <span className="font-display text-[10px] tracking-widest">{name}</span>
          <span className="flex-1" />
          <span
            className="font-num text-2xl tabular-nums"
            style={{
              color: isCritical ? '#EF233C' : 'white',
              animation: isCritical ? 'hpCritPulse 0.9s ease-in-out infinite' : undefined,
            }}
          >
            {Math.ceil(hp)}
          </span>
        </div>
        <div
          className={`flex gap-[2px] h-4 ${side === 'b' ? 'flex-row-reverse' : ''} ${isCritical ? 'hp-crit' : ''}`}
        >
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 hp-segment"
              style={{
                color: i < filled ? color : '#2A1F33',
                opacity: i < filled ? 1 : 0.4,
                border: '1px solid rgba(0,0,0,0.5)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
