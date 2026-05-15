import type { StatusEffect } from '../types'

const COLOR: Record<StatusEffect['key'], string> = {
  CONFUSED_ICP: '#7209B7',
  SHIPPING_MOMENTUM: '#06D6A0',
  HONEST_FEEDBACK: '#FFD60A',
  FOUNDER_MODE: '#E63946',
  PRICING_PRESSURE: '#F72585',
  LNO_PARALYSIS: '#7209B7',
  DISTRIBUTION_MOAT: '#06D6A0',
  PREVIEW_STATE: '#00B4D8',
  OUTCOME_DEBT: '#7209B7',
  HYPERGROWTH_BURN: '#F77F00',
}

// Short human-readable description for the native hover tooltip. The chip
// labels in-game are heavily abbreviated (F-MODE, LNO, SHIPPING) so first-time
// players can't infer what they mean from the chip alone. The description
// covers what the status does and which side it affects.
const DESCRIPTION: Record<StatusEffect['key'], string> = {
  CONFUSED_ICP: 'Confused ICP — takes +30% damage from all moves.',
  SHIPPING_MOMENTUM: 'Shipping Momentum — deals +20% damage while active.',
  HONEST_FEEDBACK: 'Honest Feedback — telegraphs intent; future setups land harder.',
  FOUNDER_MODE: 'Founder Mode — +10% damage; unlocks AIR-IS-A-CITY ult.',
  PRICING_PRESSURE: 'Pricing Pressure — deals 10% less damage while active.',
  LNO_PARALYSIS: 'LNO Paralysis — non-light moves deal half damage.',
  DISTRIBUTION_MOAT: 'Distribution Moat — takes 10% less damage and heals 10% HP/turn.',
  PREVIEW_STATE: 'Preview State — next missed move is forgiven.',
  OUTCOME_DEBT: 'Outcome Debt — DoT: lose 8% HP at start of each turn.',
  HYPERGROWTH_BURN: 'Hypergrowth Burn — DoT (10% HP/turn) but +25% damage dealt.',
}

export function StatusChip({ status }: { status: StatusEffect }) {
  const color = COLOR[status.key] ?? '#90E0EF'
  const tip = DESCRIPTION[status.key] ?? status.label
  return (
    <div
      className="px-2 py-1 font-display text-[7px] tracking-widest cursor-help"
      title={`${tip} · ${status.remaining} turn${status.remaining === 1 ? '' : 's'} left`}
      style={{
        background: `${color}33`,
        color,
        border: `1px solid ${color}`,
        boxShadow: 'inset -1px -1px 0 rgba(0,0,0,0.3)',
      }}
    >
      {status.label} ×{status.remaining}
    </div>
  )
}
