import { createContext, useContext, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { FightHudFrame } from './types'

/**
 * A single rAF loop, shared by every continuous HUD element.
 *
 * The reason this exists: health/meter/timer are *levels*, not edges, so
 * sampling them once per animation frame loses nothing — but doing it through
 * React state would re-render the tree 60×/second. Continuous widgets instead
 * register a tick and mutate their own DOM refs. The only React work the HUD
 * does at steady state is zero; discrete UI (combos, announcements) is driven
 * separately, off the synchronous event path, so it never polls.
 */
export type HudTickFn = (frame: FightHudFrame, dtMs: number) => void

export interface HudTickContextValue {
  frameRef: MutableRefObject<FightHudFrame | null>
  register: (fn: HudTickFn) => () => void
}

export const HudTickContext = createContext<HudTickContextValue | null>(null)

/** Subscribe a continuous updater to the HUD's rAF loop. */
export function useHudTick(fn: HudTickFn): void {
  const ctx = useContext(HudTickContext)
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!ctx) return
    return ctx.register((frame, dt) => ref.current(frame, dt))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
