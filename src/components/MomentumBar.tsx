import type { Side } from '../types'

interface Props {
  value: number
  side: Side
}

export function MomentumBar({ value, side }: Props) {
  return (
    <div className={`flex items-center gap-1 ${side === 'b' ? 'flex-row-reverse' : ''}`}>
      <span className="font-display text-[8px] tracking-widest text-white/70">MOM</span>
      <div className={`flex gap-1 ${side === 'b' ? 'flex-row-reverse' : ''}`}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="w-3 h-3"
            style={{
              background: i < value ? 'var(--color-pa-yellow)' : '#2A1F33',
              boxShadow: i < value ? 'inset -2px -2px 0 rgba(0,0,0,0.4), inset 2px 2px 0 rgba(255,255,255,0.3)' : 'none',
              border: '1px solid rgba(0,0,0,0.5)',
            }}
          />
        ))}
      </div>
    </div>
  )
}
