import type { Move } from '../types'

interface Props {
  move: Move
  canAfford: boolean
  isUltimate?: boolean
  superReady?: boolean
  onClick: () => void
}

const TYPE_COLOR: Record<Move['type'], string> = {
  light: '#90E0EF',
  heavy: '#E63946',
  setup: '#06D6A0',
  combo: '#FFD60A',
  ultimate: '#F72585',
}

const TYPE_LABEL: Record<Move['type'], string> = {
  light: 'LIGHT',
  heavy: 'HEAVY',
  setup: 'SETUP',
  combo: 'COMBO',
  ultimate: 'ULTIMATE',
}

export function MoveCard({ move, canAfford, isUltimate, superReady, onClick }: Props) {
  const usable = canAfford && (!isUltimate || superReady)
  const accent = TYPE_COLOR[move.type]

  return (
    <button
      onClick={usable ? onClick : undefined}
      disabled={!usable}
      className="relative px-3 py-2 text-left transition-transform hover:translate-y-[-2px]"
      style={{
        background: usable ? `linear-gradient(180deg, ${accent}22, ${accent}11)` : '#1A1230',
        border: `2px solid ${usable ? accent : '#2A1F33'}`,
        boxShadow: usable
          ? `inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.15), 0 0 0 1px rgba(0,0,0,0.5)`
          : 'inset -2px -2px 0 rgba(0,0,0,0.5)',
        cursor: usable ? 'pointer' : 'not-allowed',
        opacity: usable ? 1 : 0.45,
        minWidth: 180,
        flex: 1,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-[7px] tracking-widest" style={{ color: accent }}>
          {TYPE_LABEL[move.type]}
        </span>
        <span className="flex items-center gap-1">
          {Array.from({ length: move.momentum }).map((_, i) => (
            <span
              key={i}
              className="w-2 h-2"
              style={{ background: 'var(--color-pa-yellow)' }}
            />
          ))}
        </span>
      </div>
      <div className="font-display text-[10px] mt-1 tracking-wider" style={{ color: 'white' }}>
        {move.name}
      </div>
      <div className="font-body text-base mt-1 text-white/70 leading-tight">
        {move.description}
      </div>
      {isUltimate && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: superReady
              ? 'linear-gradient(180deg, rgba(247,37,133,0.0), rgba(247,37,133,0.15))'
              : 'rgba(0,0,0,0.6)',
            border: superReady ? '2px solid var(--color-sm-end)' : 'none',
            animation: superReady ? 'flash 1.8s infinite' : undefined,
          }}
        />
      )}
    </button>
  )
}
