import type { Move } from '../types'

interface Props {
  move: Move
  canAfford: boolean
  isUltimate?: boolean
  superReady?: boolean
  /** id of the last move cast by the same fighter (for combo chain highlight) */
  lastMoveId?: string | null
  /** Does this fighter currently have the requireSelfStatus active? */
  hasRequiredStatus?: boolean
  /** Cooldown turns remaining for this move (0 = ready) */
  cooldown?: number
  /** Single-letter keyboard shortcut to display on the card (e.g. "Z") */
  hotkey?: string
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

export function MoveCard({
  move,
  canAfford,
  isUltimate,
  superReady,
  lastMoveId,
  hasRequiredStatus,
  cooldown = 0,
  hotkey,
  onClick,
}: Props) {
  const onCooldown = cooldown > 0
  const ultGated = isUltimate && (!superReady || (move.requiresSelfStatus && !hasRequiredStatus))
  const usable = canAfford && !ultGated && !onCooldown
  const accent = TYPE_COLOR[move.type]

  // Combo-ready: this combo move chains from a previous cast
  const comboReady =
    move.type === 'combo' &&
    move.combosFrom &&
    lastMoveId !== undefined &&
    lastMoveId !== null &&
    move.combosFrom.includes(lastMoveId)

  return (
    <button
      onClick={usable ? onClick : undefined}
      disabled={!usable}
      className="relative px-2 py-1.5 text-left transition-transform hover:translate-y-[-2px]"
      style={{
        background: usable ? `linear-gradient(180deg, ${accent}33, ${accent}11)` : '#1A1230',
        border: `2px solid ${comboReady ? '#FFD60A' : usable ? accent : '#2A1F33'}`,
        boxShadow: comboReady
          ? `0 0 12px #FFD60A, inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.2)`
          : usable
          ? `inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.15), 0 0 0 1px rgba(0,0,0,0.5)`
          : 'inset -2px -2px 0 rgba(0,0,0,0.5)',
        cursor: usable ? 'pointer' : 'not-allowed',
        opacity: usable ? 1 : 0.45,
        minWidth: 170,
        flex: 1,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-[7px] tracking-widest" style={{ color: accent }}>
          {TYPE_LABEL[move.type]}
        </span>
        <span className="flex items-center gap-1">
          {Array.from({ length: Math.min(move.momentum, 10) }).map((_, i) => (
            <span
              key={i}
              className="w-1.5 h-1.5"
              style={{
                background: canAfford ? 'var(--color-pa-yellow)' : '#444',
              }}
            />
          ))}
        </span>
      </div>
      <div className="font-display text-[10px] mt-1 tracking-wider" style={{ color: 'white' }}>
        {move.name}
      </div>
      <div className="flex items-baseline gap-1 mt-1 font-num text-base">
        <span style={{ color: accent }} className="font-display text-[9px] tracking-wider">DMG</span>
        <span className="text-white tabular-nums">{move.baseDamage}</span>
        {move.combosFrom && (
          <span className="font-display text-[7px] tracking-widest ml-1" style={{ color: '#FFD60A' }}>
            +{move.comboBonus ?? 50}
          </span>
        )}
        {move.selfHeal && (
          <span className="font-display text-[7px] tracking-widest ml-1" style={{ color: '#06D6A0' }}>
            HEAL {move.selfHeal}
          </span>
        )}
      </div>
      <div className="font-body text-sm mt-0.5 text-white/70 leading-tight">{move.description}</div>
      {comboReady && (
        <div
          className="absolute -top-2 left-1/2 -translate-x-1/2 font-display text-[7px] tracking-widest px-1.5 py-0.5"
          style={{
            background: '#FFD60A',
            color: '#0F0A1A',
            border: '1px solid black',
            animation: 'flash 1.2s infinite',
            whiteSpace: 'nowrap',
          }}
        >
          COMBO READY
        </div>
      )}
      {move.readsType && (
        <div
          className="absolute -bottom-2 right-1 font-display text-[6px] tracking-widest px-1 py-0.5"
          style={{
            background: '#00B4D8',
            color: '#0F0A1A',
            border: '1px solid black',
          }}
        >
          READS {move.readsType.toUpperCase()}
        </div>
      )}
      {ultGated && isUltimate && (
        <div
          className="absolute inset-0 pointer-events-none flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)' }}
        >
          <div className="font-display text-[7px] tracking-widest text-white text-center px-2">
            {!superReady ? (
              <>NEEDS SUPER ({Math.round(((move.momentum < 100 ? 100 : 0)))}/100)</>
            ) : (
              <>NEEDS {move.requiresSelfStatus?.replace('_', ' ')}</>
            )}
          </div>
        </div>
      )}
      {onCooldown && (
        <div
          className="absolute inset-0 pointer-events-none flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
        >
          <div className="font-display text-[10px] tracking-widest text-white text-center" style={{ textShadow: '2px 2px 0 black' }}>
            CD {cooldown >= 99 ? 'NEXT ROUND' : `${cooldown}T`}
          </div>
        </div>
      )}
      {isUltimate && !ultGated && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            border: '2px solid var(--color-sm-end)',
            boxShadow: 'inset 0 0 16px var(--color-sm-end)',
            animation: 'flash 1.6s infinite',
          }}
        />
      )}
      {hotkey && (
        <div
          className="absolute top-0.5 right-0.5 font-display text-[8px] tracking-widest"
          style={{
            background: 'rgba(0,0,0,0.75)',
            color: usable ? accent : '#666',
            border: `1px solid ${usable ? accent : '#444'}`,
            padding: '1px 4px',
            minWidth: 14,
            textAlign: 'center',
            lineHeight: 1,
          }}
          title={`Press ${hotkey} to cast`}
        >
          {hotkey}
        </div>
      )}
    </button>
  )
}
