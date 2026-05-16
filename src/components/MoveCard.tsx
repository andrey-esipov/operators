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
  /** Current super meter of the caster (0-100). Used to gate EX availability. */
  superMeter?: number
  /** Click handler. `opts.ex` is true when Shift was held — meaning the player
   *  wants to spend 50 super for a +50% damage EX-cast. */
  onClick: (opts?: { ex?: boolean }) => void
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
  superMeter = 0,
  onClick,
}: Props) {
  const onCooldown = cooldown > 0
  // Ultimates are gated only by super meter now. requiresSelfStatus is a
  // +50% damage bonus, not a hard gate — see applyMove.ts.
  const ultGated = isUltimate && !superReady
  const usable = canAfford && !ultGated && !onCooldown
  const accent = TYPE_COLOR[move.type]
  // Ult momentum is clamped to 5 system-wide; display the effective cost.
  const displayMomentum = isUltimate ? Math.min(move.momentum, 5) : move.momentum
  // Signature bonus: ult with required status active deals +50%. Show a
  // non-gating hint so the player knows the buff is what they want, not
  // that the move is locked.
  const signatureReady = isUltimate && move.requiresSelfStatus && hasRequiredStatus
  const signatureHint = isUltimate && move.requiresSelfStatus && !hasRequiredStatus
  // EX-cast eligibility: non-ult moves can be EX-cast when super ≥ 50.
  // We show a cyan affordance badge so the player knows they have the
  // option. Clicking with Shift held (or pressing Shift+hotkey) triggers it.
  const exAvailable = !isUltimate && usable && superMeter >= 50

  // Combo-ready: this combo move chains from a previous cast
  const comboReady =
    move.type === 'combo' &&
    move.combosFrom &&
    lastMoveId !== undefined &&
    lastMoveId !== null &&
    move.combosFrom.includes(lastMoveId)

  const ariaLabel = `${TYPE_LABEL[move.type]} ${move.name} — ${move.baseDamage} damage, ${displayMomentum} momentum${
    onCooldown ? `, on cooldown ${cooldown} turns` : ''
  }${
    ultGated ? `, needs full super meter` : ''
  }${
    !usable && !onCooldown && !ultGated ? ', insufficient momentum' : ''
  }${
    signatureHint ? `. +50% signature bonus when ${move.requiresSelfStatus} is active.` : ''
  }${
    signatureReady ? `. SIGNATURE READY: +50% damage.` : ''
  }`

  return (
    <button
      onClick={
        usable
          ? (e) => onClick(e.shiftKey && exAvailable ? { ex: true } : undefined)
          : undefined
      }
      disabled={!usable}
      aria-label={ariaLabel}
      title={`${move.description}${exAvailable ? ' — Shift+click for EX (+50 super, +50% damage)' : ''}`}
      className="relative px-2 py-1.5 text-left transition-transform hover:translate-y-[-2px]"
      style={{
        background: usable ? `linear-gradient(180deg, ${accent}33, ${accent}11)` : '#1A1230',
        border: `2px solid ${comboReady ? '#FFD60A' : exAvailable ? '#00E5FF' : usable ? accent : '#2A1F33'}`,
        boxShadow: comboReady
          ? `0 0 12px #FFD60A, inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.2)`
          : exAvailable
          ? `0 0 10px #00E5FF, inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.15)`
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
          {Array.from({ length: Math.min(displayMomentum, 10) }).map((_, i) => (
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
            NEEDS SUPER (100/100)
          </div>
        </div>
      )}
      {/* Signature bonus hint — non-gating, just tells the player that
       *  activating the buff before casting the ult deals +50% damage. */}
      {signatureHint && (
        <div
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 font-display text-[6px] tracking-widest px-1.5 py-0.5"
          style={{
            background: '#7209B7',
            color: '#FFD60A',
            border: '1px solid black',
            whiteSpace: 'nowrap',
          }}
          title={`+50% damage when ${move.requiresSelfStatus} is active`}
        >
          +50% W/ {move.requiresSelfStatus?.replace('_', ' ')}
        </div>
      )}
      {signatureReady && (
        <div
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 font-display text-[6px] tracking-widest px-1.5 py-0.5"
          style={{
            background: '#FFD60A',
            color: '#0F0A1A',
            border: '1px solid black',
            whiteSpace: 'nowrap',
            animation: 'flash 1.2s infinite',
          }}
        >
          ★ SIGNATURE +50%
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
          title={`Press ${hotkey} to cast${exAvailable ? ` (Shift+${hotkey} for EX)` : ''}`}
        >
          {hotkey}
        </div>
      )}
      {exAvailable && (
        <div
          className="absolute top-0.5 left-0.5 font-display text-[7px] tracking-widest"
          style={{
            background: '#00E5FF',
            color: '#0F0A1A',
            border: '1px solid black',
            padding: '1px 3px',
            lineHeight: 1,
            animation: 'flash 1.6s infinite',
          }}
          title="Shift+click or Shift+hotkey for EX: -50 super, +50% damage"
        >
          ⚡EX
        </div>
      )}
    </button>
  )
}
