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

export function StatusChip({ status }: { status: StatusEffect }) {
  const color = COLOR[status.key] ?? '#90E0EF'
  return (
    <div
      className="px-2 py-1 font-display text-[7px] tracking-widest"
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
