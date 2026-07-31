import { useRef } from 'react'
import { useHudTick } from './hudContext'
import { powerTier } from './meterModel'

interface Props {
  index: 0 | 1
}

// The sim caps meter at two full bars (MAX_METER = 2000); a super costs one
// bar (1000). We render two stocks and fill them left-to-right.
const BAR_UNIT = 1000
const BARS = 2

/** Segmented super gauge — two spendable stocks, each glows when full. */
export function SuperGauge({ index }: Props) {
  const side = index === 0 ? 'a' : 'b'
  const rowRef = useRef<HTMLDivElement>(null)
  const fillRefs = useRef<(HTMLDivElement | null)[]>([])
  const barRefs = useRef<(HTMLDivElement | null)[]>([])
  const lastFull = useRef<number[]>([-1, -1])
  const lastTier = useRef('')

  useHudTick((frame) => {
    const meter = frame.state.fighters[index].meter
    for (let i = 0; i < BARS; i++) {
      const filled = Math.max(0, Math.min(1, (meter - i * BAR_UNIT) / BAR_UNIT))
      const el = fillRefs.current[i]
      if (el) el.style.width = `${filled * 100}%`
      const full = filled >= 1 ? 1 : 0
      if (full !== lastFull.current[i]) {
        lastFull.current[i] = full
        barRefs.current[i]?.classList.toggle('full', full === 1)
      }
    }
    // Row-level POWER read — graded affordability, not a binary "charged" light.
    // 'ready' = one super in pocket; 'max' = the meter can pay for two. This is
    // the affordability counterpart to the health bar's danger read (finding #4).
    const tier = powerTier(meter)
    if (tier !== lastTier.current) {
      lastTier.current = tier
      const row = rowRef.current
      if (row) {
        row.classList.toggle('charged', tier !== 'charging')
        row.classList.toggle('maxed', tier === 'max')
      }
    }
  })

  return (
    <div ref={rowRef} className={`fhud-superrow ${side}`} data-testid={`fhud-super-${side}`}>
      <span className="fhud-superlabel">
        <span className="fhud-superlabel-txt">SUPER</span>
        <span className="fhud-superlabel-rdy">READY</span>
        <span className="fhud-superlabel-max">MAX</span>
      </span>
      <div className="fhud-superbars">
        {Array.from({ length: BARS }).map((_, i) => (
          <div
            key={i}
            ref={(el) => {
              barRefs.current[i] = el
            }}
            className="fhud-superbar"
            data-testid={`fhud-superbar-${side}-${i}`}
          >
            <div
              ref={(el) => {
                fillRefs.current[i] = el
              }}
              className="fhud-superfill"
              style={{ width: '0%' }}
            />
            <div className="fhud-superticks" />
          </div>
        ))}
      </div>
    </div>
  )
}
