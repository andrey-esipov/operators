import { ComboCounter } from '../ComboCounter'
import '../hud.css'

/**
 * Static tuning gallery for the combo counter, at `?fighthud=1&view=combos`.
 *
 * The demo AI tops out at 2 hits, so the scaling curve (colour/size/rank per
 * hit count) can't be exercised in a live match. This renders the counter at a
 * spread of counts in fixed cells so the ramp can be eyeballed and tuned. Each
 * cell is its own positioning context, so the absolutely-placed counter lands
 * inside it.
 */
const COUNTS = [2, 3, 4, 5, 6, 8, 10, 13, 18, 25]

export function ComboGallery() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'auto',
        background: 'radial-gradient(ellipse at 50% 20%, #3B2360 0%, #1A1230 55%, #0F0A1A 100%)',
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 4,
        padding: 8,
      }}
    >
      {COUNTS.map((count) => (
        <div
          key={count}
          style={{
            position: 'relative',
            height: 250,
            border: '1px solid #2a2440',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 6,
              left: 8,
              font: '11px ui-monospace, monospace',
              color: '#6f7f92',
              zIndex: 1,
            }}
          >
            count={count}
          </div>
          <ComboCounter combo={{ side: 0, count, damage: count * 45, key: count }} />
        </div>
      ))}
    </div>
  )
}

export default ComboGallery
