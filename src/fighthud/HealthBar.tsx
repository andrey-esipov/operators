import { useRef, type CSSProperties } from 'react'
import { useHudTick } from './hudContext'
import { Portrait } from './Portrait'
import type { FighterDisplay } from './types'
import { stepHealthBar, type BarState } from './healthBarModel'

interface Props {
  index: 0 | 1
  display: FighterDisplay
}

const CRIT_PCT = 0.25

// Front-bar colour tier (good / warn / crit) is toggled as a class so the CSS
// can own the per-side ramp *direction* (the fill runs a horizontal hue ramp,
// mirrored on the right fighter). A flat single hue reads as a UI control; a
// yellow→amber→orange ramp across the bar reads as a gauge (SF6 / Tekken).
const TIER_CLASS = ['tier-good', 'tier-warn', 'tier-crit']

/**
 * Two-layer health bar. The colored `main` fill is the live value; the pale
 * `trail` lags behind on damage to show the recoverable/lost chunk. Both are
 * driven by direct DOM writes on the shared rAF — zero React re-renders while
 * the bar drains.
 */
export function HealthBar({ index, display }: Props) {
  const side = index === 0 ? 'a' : 'b'
  const wrapRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const trailRef = useRef<HTMLDivElement>(null)

  const bar = useRef<BarState>({ main: 1, trail: 1, holdMs: 0 })
  const lastCrit = useRef<boolean | null>(null)
  const lastTier = useRef<number>(-1)

  useHudTick((frame, dt) => {
    const f = frame.state.fighters[index]
    const target = Math.max(0, Math.min(1, f.health / f.maxHealth))

    stepHealthBar(bar.current, target, dt)

    if (mainRef.current) mainRef.current.style.width = `${bar.current.main * 100}%`
    if (trailRef.current) trailRef.current.style.width = `${bar.current.trail * 100}%`

    // Front-bar colour shifts good → warn → crit as a coarse read. Toggled as a
    // class (not an inline background) so the CSS owns the horizontal hue ramp
    // and its per-side mirroring. Only rewritten on tier change.
    const tier = target > 0.6 ? 0 : target > 0.3 ? 1 : 2
    if (tier !== lastTier.current && mainRef.current) {
      lastTier.current = tier
      mainRef.current.classList.remove('tier-good', 'tier-warn', 'tier-crit')
      mainRef.current.classList.add(TIER_CLASS[tier])
    }

    const crit = target > 0 && target <= CRIT_PCT
    if (crit !== lastCrit.current) {
      lastCrit.current = crit
      wrapRef.current?.classList.toggle('crit', crit)
    }
  })

  const initial = display.name.trim().charAt(0).toUpperCase() || '?'

  return (
    <div ref={wrapRef} className={`fhud-hpwrap ${side}`}>
      <Portrait side={side} rosterId={display.rosterId} name={display.name} accent={display.accent} initial={initial} />
      <div className="fhud-hpcol">
        <div className="fhud-nameband">
          <span
            className="fhud-name"
            style={{ ['--accent' as string]: display.accent } as CSSProperties}
          >
            <span>{display.name}</span>
          </span>
        </div>
        <div className="fhud-hphousing">
          <div className="fhud-hptrack" data-testid={`fhud-hptrack-${side}`}>
            <div ref={trailRef} className="fhud-hptrail" data-testid={`fhud-hptrail-${side}`} />
            <div ref={mainRef} className="fhud-hpfill" data-testid={`fhud-hpfill-${side}`}>
              <div className="fhud-hphazard" />
            </div>
            <div className="fhud-hpgloss" />
            <div className="fhud-hpnotches" />
          </div>
        </div>
      </div>
    </div>
  )
}
