// Self-contained status metadata for the HUD. Keeps the HUD reusable: it does
// not import game data. Consumers may override via FightHud's `statusInfo`.

export type StatusKind = 'buff' | 'debuff'

export interface StatusMeta {
  label: string
  icon: string
  kind: StatusKind
  color: string
}

const META: Record<string, StatusMeta> = {
  CONFUSED_ICP: { label: 'CONFUSED', icon: '❓', kind: 'debuff', color: '#b06bff' },
  SHIPPING_MOMENTUM: { label: 'SHIPPING', icon: '🚀', kind: 'buff', color: '#35f0b0' },
  HONEST_FEEDBACK: { label: 'FEEDBACK', icon: '🎯', kind: 'buff', color: '#ffd23c' },
  FOUNDER_MODE: { label: 'FOUNDER', icon: '🔥', kind: 'buff', color: '#ff6a4d' },
  PRICING_PRESSURE: { label: 'PRICING', icon: '💸', kind: 'debuff', color: '#ff2fae' },
  LNO_PARALYSIS: { label: 'LNO', icon: '🧊', kind: 'debuff', color: '#b06bff' },
  DISTRIBUTION_MOAT: { label: 'MOAT', icon: '🛡️', kind: 'buff', color: '#35f0b0' },
  PREVIEW_STATE: { label: 'PREVIEW', icon: '👁️', kind: 'buff', color: '#33e0ff' },
  OUTCOME_DEBT: { label: 'DEBT', icon: '⏳', kind: 'debuff', color: '#b06bff' },
  HYPERGROWTH_BURN: { label: 'BURN', icon: '📈', kind: 'debuff', color: '#ff8a3c' },
}

const FALLBACK: StatusMeta = { label: '', icon: '✦', kind: 'buff', color: '#8affff' }

export function statusMeta(key: string): StatusMeta {
  return META[key] ?? { ...FALLBACK, label: key.replace(/_/g, ' ').slice(0, 8) }
}
