import type { FightState, FightEvent } from '../fight/types'

/** Per-fighter display identity. Index 0 = left, 1 = right. */
export interface FighterDisplay {
  /** Full name shown on the HUD, e.g. "Brian Chesky". */
  name: string
  /** Accent colour (hex). Tints the name badge + bar rim. */
  accent: string
}

/** One frame handed to the HUD: authoritative state + that frame's events. */
export interface FightHudFrame {
  state: FightState
  events: FightEvent[]
}

export interface FightHudProps {
  /**
   * Controlled mode: pass the current sim state and this frame's events.
   * The HUD re-renders with the parent, but internally diffs so only discrete
   * UI (combo, announcements, pips) reconciles — continuous bars/timer are
   * driven imperatively and never trigger React work.
   *
   * Prefer the imperative `push()` handle (see FightHudHandle) for a true
   * zero-rerender 60fps overlay; `state`/`events` exist for simpler wiring.
   */
  state?: FightState
  events?: FightEvent[]
  /**
   * Optional per-fighter display identity (name + accent). The sim's fighter
   * `id` is a mechanics archetype ("operator"), not a face — pass the visual
   * roster identity here. Falls back to the archetype id + default palette.
   */
  fighters?: [FighterDisplay, FighterDisplay]
  className?: string
}

export interface FightHudHandle {
  /**
   * Imperative, allocation-light integration: call once per rendered sim frame
   * from inside the render loop. Events are processed synchronously (lossless),
   * continuous bars are eased on the HUD's own rAF. This does NOT cause a React
   * re-render unless a discrete UI element actually changes.
   */
  push(state: FightState, events: FightEvent[]): void
}
