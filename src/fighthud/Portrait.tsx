import { useEffect, useRef, useState } from 'react'
import { loadPortrait, rosterIdForName, type PortraitInfo } from './portraits'

interface Props {
  side: 'a' | 'b'
  rosterId?: string
  /** Fighter display name — used to resolve a roster atlas id when `rosterId` is absent. */
  name?: string
  accent: string
  /** Fallback single-letter badge when no portrait is available. */
  initial: string
}

// Crop the idle sprite to head + upper torso. Feet-anchored frames put the head
// near the top of the rect; trimming the sides as well zooms past the idle
// arm-spread so the face reads at name-plate size.
const TOP_FRACTION = 0.52
const SIDE_TRIM = 0.16
const BOX_H = 40 // px

/**
 * Fighter portrait. Crops an idle frame out of the sprite atlas via a CSS
 * transform (scale the frame width to the box, clip the top). Falls back to the
 * accent initial badge while loading or if the atlas is unavailable — so it is
 * always safe to render.
 */
export function Portrait({ side, rosterId, name, accent, initial }: Props) {
  const [info, setInfo] = useState<PortraitInfo | null>(null)
  const [failed, setFailed] = useState(false)
  const alive = useRef(true)

  const id = rosterId ?? rosterIdForName(name)

  useEffect(() => {
    alive.current = true
    setInfo(null)
    setFailed(false)
    if (id) {
      loadPortrait(id).then((p) => {
        if (!alive.current) return
        if (p) setInfo(p)
        else setFailed(true)
      })
    }
    return () => {
      alive.current = false
    }
  }, [id])

  // While a resolvable portrait is still loading, show a neutral accent tile —
  // never the letter badge. The badge is a genuine "no art" fallback (a fighter
  // with no atlas, or a failed load); flashing a debug letter for ~1 frame at
  // match start while the atlas fetch resolves would read as an unfinished HUD
  // in any capture that snapshots the intro.
  if (!info) {
    if (id && !failed) {
      return (
        <span
          className={`fhud-portrait loading ${side}`}
          style={{ width: `${BOX_H}px`, height: `${BOX_H}px`, ['--accent' as string]: accent }}
          data-testid={`fhud-portrait-${side}`}
          data-loading="1"
        />
      )
    }
    return (
      <span
        className={`fhud-badge ${side}`}
        style={{ background: accent }}
        data-testid={`fhud-badge-${side}`}
      >
        <span>{initial}</span>
      </span>
    )
  }

  const { rect, atlas } = info
  const cropX = rect.x + rect.w * SIDE_TRIM
  const cropW = rect.w * (1 - SIDE_TRIM * 2)
  const cropH = rect.h * TOP_FRACTION
  const scale = BOX_H / cropH
  const boxW = cropW * scale

  return (
    <span
      className={`fhud-portrait ${side}`}
      style={{ width: `${boxW}px`, height: `${BOX_H}px`, ['--accent' as string]: accent }}
      data-testid={`fhud-portrait-${side}`}
    >
      <img
        src={atlas}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transformOrigin: '0 0',
          transform: `scale(${scale}) translate(${-cropX}px, ${-rect.y}px)`,
          imageRendering: 'pixelated',
          maxWidth: 'none',
        }}
      />
    </span>
  )
}
