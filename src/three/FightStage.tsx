import { useEffect, useMemo, useRef, useState } from 'react'
import { FightScene3D } from './FightScene3D'
import { FightHud } from './hud/FightHud'
import { eventsForLogEntry, toRenderState, type BridgeInput } from './bridge'
import type { FightEvent } from './types'
import type { AnnounceMoment, ComboState, DamageNumber, MoveDeck } from './hud/types'
import type { BattleLogEntry } from '../types'

interface Props extends BridgeInput {
  /** Full battle log. New entries are converted to renderer events exactly once. */
  log: BattleLogEntry[]
  names?: { a: string; b: string }
  portraits?: { a?: string; b?: string }
  roundsWon?: { a: number; b: number }
  combo?: ComboState | null
  announce?: AnnounceMoment | null
  damageNumbers?: DamageNumber[]
  moveDeck?: MoveDeck | null
  /** Slow-motion factor for crit freeze / cinematics. */
  timeScale?: number
}

const NO_EVENTS: FightEvent[] = []

/**
 * The complete AAA fight presentation: WebGL scene underneath, HUD on top.
 *
 * This is the single seam between the game and the render layer. It converts
 * store state into the renderer's read-only contract via `bridge`, so nothing
 * in `src/three` ever reaches into zustand.
 */
export function FightStage({
  log,
  names,
  portraits,
  roundsWon,
  combo = null,
  announce = null,
  damageNumbers = [],
  moveDeck = null,
  timeScale = 1,
  ...bridge
}: Props) {
  const state = useMemo(
    () => toRenderState(bridge),
    // Recreating the snapshot is cheap; recompute whenever any input changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      bridge.scenario,
      bridge.a,
      bridge.b,
      bridge.activeSide,
      bridge.timeLeft,
      bridge.round,
      bridge.attackingSide,
      bridge.inFlightFlash,
      bridge.cinematic,
      bridge.koLoser,
      bridge.hurtSide,
    ],
  )

  // Emit renderer events for log entries we haven't seen yet. Tracking a count
  // rather than diffing arrays keeps this O(new entries) and makes a round
  // reset (log -> []) self-healing.
  const seenRef = useRef(0)
  const [events, setEvents] = useState<FightEvent[]>(NO_EVENTS)
  const maxHp = bridge.a.maxHp

  useEffect(() => {
    if (log.length < seenRef.current) {
      // New round / rematch — the log was cleared.
      seenRef.current = log.length
      return
    }
    if (log.length === seenRef.current) return
    const fresh = log.slice(seenRef.current).flatMap((e) => eventsForLogEntry(e, maxHp))
    seenRef.current = log.length
    if (fresh.length) setEvents(fresh)
  }, [log, maxHp])

  return (
    <div className="absolute inset-0">
      <FightScene3D state={state} events={events} timeScale={timeScale} />
      <FightHud
        state={state}
        names={names}
        portraits={portraits}
        roundsWon={roundsWon}
        combo={combo}
        announce={announce}
        damageNumbers={damageNumbers}
        moveDeck={moveDeck}
      />
    </div>
  )
}

export default FightStage
