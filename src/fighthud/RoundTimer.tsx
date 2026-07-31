import { useRef } from 'react'
import { useHudTick } from './hudContext'

// Timer is stored in 60fps frames remaining. 10s and under goes red + blinks.
const FPS = 60
const LOW_SECONDS = 10

/** Centre round timer, counting down in whole seconds. Ref-driven. */
export function RoundTimer() {
  const numRef = useRef<HTMLDivElement>(null)
  const lastSecs = useRef(-1)

  useHudTick((frame) => {
    const secs = Math.max(0, Math.ceil(frame.state.timer / FPS))
    if (secs === lastSecs.current) return
    lastSecs.current = secs
    const el = numRef.current
    if (!el) return
    el.textContent = String(secs).padStart(2, '0')
    el.classList.toggle('low', secs <= LOW_SECONDS)
  })

  return (
    <div className="fhud-timerplate">
      <div ref={numRef} className="fhud-timernum" data-testid="fhud-timer">
        99
      </div>
    </div>
  )
}
