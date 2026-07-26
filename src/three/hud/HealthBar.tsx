import { useMemo } from 'react'

interface Props {
  hp01: number
  mirror?: boolean
  accent: string
}

function hpGradient(hp: number, mirror: boolean): string {
  let c1: string, c2: string
  if (hp > 0.5) { c1 = '#4dffb0'; c2 = '#10c483' }
  else if (hp > 0.25) { c1 = '#ffe14a'; c2 = '#ff9d2c' }
  else { c1 = '#ff6a5a'; c2 = '#d20f2c' }
  return `linear-gradient(${mirror ? '270deg' : '90deg'}, ${c2}, ${c1})`
}

export function HealthBar({ hp01, mirror = false, accent }: Props) {
  const hp = Math.max(0, Math.min(1, hp01))
  const grad = useMemo(() => hpGradient(hp, mirror), [hp, mirror])
  const danger = hp > 0 && hp <= 0.25
  const pct = `${hp * 100}%`
  const anchor = mirror ? { right: 0 as const } : { left: 0 as const }

  return (
    <div className={`fh-hp ${mirror ? 'mirror' : ''} ${danger ? 'danger' : ''}`}>
      <div className="fh-hp-track">
        <div className="fh-hp-chip" style={{ ...anchor, width: pct }} />
        <div className="fh-hp-fill" style={{ ...anchor, width: pct, background: grad }} />
        <div className="fh-hp-core" style={{ ...anchor, width: pct }} />
        <div className="fh-hp-lead" style={{ color: accent, [mirror ? 'right' : 'left']: pct }} />
        <div className="fh-hp-ticks" />
      </div>
    </div>
  )
}
