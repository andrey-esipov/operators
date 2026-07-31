import { useContext, useRef, type CSSProperties } from 'react'
import { HudTickContext, useHudTick } from './hudContext'
import { Portrait } from './Portrait'
import type { FighterDisplay } from './types'
import { stepHealthBar } from './healthBarModel'

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
  const hud = useContext(HudTickContext)
  const wrapRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const trailRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const lastCrit = useRef<boolean | null>(null)
  const lastTier = useRef<number>(-1)

  useHudTick((frame, dt) => {
    // The bar's state is owned by the HUD root and mutated on the event path;
    // this component only eases it and writes the DOM. No private BarState, so
    // what draws is exactly what the root's hit processing produced.
    const bar = hud?.bars.current[index]
    if (!bar) return
    const f = frame.state.fighters[index]
    const target = Math.max(0, Math.min(1, f.health / f.maxHealth))

    stepHealthBar(bar, target, dt)

    const recoil = bar.recoil ?? 0
    if (mainRef.current) {
      mainRef.current.style.width = `${bar.main * 100}%`
      // Contact flare, scaled by weight — a crumple flashes the fill far harder
      // than a jab. Pure filter, no layout, no atlas. Cleared as recoil decays.
      mainRef.current.style.filter =
        recoil > 1e-3 ? `brightness(${(1 + recoil * 0.6).toFixed(3)}) saturate(${(1 + recoil * 0.3).toFixed(3)})` : ''
    }
    if (trailRef.current) trailRef.current.style.width = `${bar.trail * 100}%`
    // Recoil kick: jolt the trough outward (away from centre), heavier hits
    // kick further. translateX only — the track has no base transform, so this
    // never fights the housing's skew or the crit animation. Zero atlas bytes.
    if (trackRef.current) {
      const dir = index === 0 ? -1 : 1
      trackRef.current.style.transform = recoil > 1e-3 ? `translateX(${(dir * recoil * 5).toFixed(2)}px)` : ''
    }

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
          <div ref={trackRef} className="fhud-hptrack" data-testid={`fhud-hptrack-${side}`}>
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
