import type { Move } from '../types'
import './movecard.css'

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
  /** Click handler. opts.ex is true when Shift was held — meaning the player
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
  // Signature bonus: ult with required status active deals +50%.
  const signatureReady = isUltimate && move.requiresSelfStatus && hasRequiredStatus
  const signatureHint = isUltimate && move.requiresSelfStatus && !hasRequiredStatus
  // EX-cast eligibility: non-ult moves can be EX-cast when super >= 50.
  const exAvailable = !isUltimate && usable && superMeter >= 50

  // Combo-ready: this combo move chains from a previous cast
  const comboReady =
    move.type === 'combo' &&
    move.combosFrom &&
    lastMoveId !== undefined &&
    lastMoveId !== null &&
    move.combosFrom.includes(lastMoveId)

  // "poor" = a resource gate that is NOT the ult-super gate and NOT a cooldown:
  // the player simply can't afford the momentum right now.
  const poor = !usable && !onCooldown && !ultGated

  const ariaLabel = `${TYPE_LABEL[move.type]} ${move.name} — ${move.baseDamage} damage, ${displayMomentum} momentum${
    onCooldown ? `, on cooldown ${cooldown} turns` : ''
  }${ultGated ? `, needs full super meter` : ''}${
    poor ? ', insufficient momentum' : ''
  }${
    signatureHint ? `. +50% signature bonus when ${move.requiresSelfStatus} is active.` : ''
  }${signatureReady ? `. SIGNATURE READY: +50% damage.` : ''}`

  const classes = [
    'mc',
    isUltimate ? 'is-ult' : '',
    usable ? 'is-usable' : 'is-locked',
    comboReady ? 'is-combo' : '',
    exAvailable ? 'is-ex' : '',
    poor ? 'is-poor' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const pipCount = Math.min(displayMomentum, 6)

  return (
    <button
      data-move-card={move.type}
      onClick={usable ? (e) => onClick(e.shiftKey && exAvailable ? { ex: true } : undefined) : undefined}
      disabled={!usable}
      aria-label={ariaLabel}
      title={`${move.description}${exAvailable ? ' — Shift+click for EX (+50 super, +50% damage)' : ''}`}
      className={classes}
      style={{ ['--accent' as string]: accent }}
    >
      <div className="mc-head">
        <span className="mc-cat">{TYPE_LABEL[move.type]}</span>
        {isUltimate && <span className="mc-super-tag">SUPER ART</span>}
        {hotkey && (
          <span className="mc-key" title={`Press ${hotkey} to cast${exAvailable ? ` (Shift+${hotkey} for EX)` : ''}`}>
            {hotkey}
          </span>
        )}
      </div>

      <div className="mc-body">
        <div className="mc-name">{move.name}</div>

        <div className="mc-stat">
          <span className="mc-dmg">
            <span className="mc-dmg-label" data-dmg-label>
              DMG
            </span>
            <span className="mc-dmg-num" data-dmg-num>
              {move.baseDamage}
            </span>
            {move.combosFrom && <span className="mc-dmg-bonus">+{move.comboBonus ?? 50}</span>}
            {move.selfHeal && <span className="mc-heal">+{move.selfHeal}HP</span>}
          </span>
          <span className="mc-cost">
            <span className="mc-cost-label">MOM</span>
            <span className="mc-pips">
              {Array.from({ length: pipCount }).map((_, i) => (
                <span key={i} className={`mc-pip${canAfford ? '' : ' is-empty'}`} />
              ))}
            </span>
          </span>
        </div>

        {(move.readsType || signatureHint || signatureReady) && (
          <div className="mc-chips">
            {move.readsType && <span className="mc-chip mc-chip-reads">READS {move.readsType.toUpperCase()}</span>}
            {signatureHint && (
              <span className="mc-chip mc-chip-sig" title={`+50% damage when ${move.requiresSelfStatus} is active`}>
                +50% W/ {move.requiresSelfStatus?.replace('_', ' ')}
              </span>
            )}
            {signatureReady && <span className="mc-chip mc-chip-sig is-ready">SIGNATURE +50%</span>}
          </div>
        )}

        {ultGated && isUltimate && (
          <div className="mc-lock">
            <div className="mc-lock-row">
              <span className="mc-lock-tag">
                <span className="mc-lock-ico" />
                CHARGE SUPER
              </span>
              <span className="mc-lock-sub">{Math.round(Math.min(100, superMeter))}/100</span>
            </div>
            <div className="mc-lock-meter">
              <div className="mc-lock-fill" style={{ width: `${Math.min(100, Math.max(0, superMeter))}%` }} />
            </div>
          </div>
        )}
      </div>

      {comboReady && <div className="mc-badge mc-badge-combo">COMBO READY</div>}
      {exAvailable && <div className="mc-badge mc-badge-ex">EX READY</div>}

      {onCooldown && (
        <div className="mc-veil">
          <div className="mc-veil-txt">{cooldown >= 99 ? 'NEXT ROUND' : `CD ${cooldown}T`}</div>
        </div>
      )}
    </button>
  )
}
