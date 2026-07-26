import { useEffect, useRef, useState } from 'react'
import './hud.css'
import type { FightHudProps } from './types'
import { PlayerPanel } from './PlayerPanel'
import { CenterColumn } from './CenterColumn'
import { ComboCounter } from './ComboCounter'
import { DamageNumbers } from './DamageNumbers'
import { Announcer } from './Announcer'
import { MoveDeck } from './MoveDeck'

/**
 * AAA fight HUD. Renders a complete, kinetic combat interface over a live 3D
 * scene. Core state is the engine contract `FightRenderState`; all other props
 * are optional layered presentation.
 */
export function FightHud({
  state,
  names,
  portraits,
  roundsWon = { a: 0, b: 0 },
  roundsToWin = 2,
  combo = null,
  announce = null,
  damageNumbers = [],
  moveDeck = null,
  statusInfo,
  designWidth = 1920,
}: FightHudProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  // Uniform scale so the HUD holds its authored proportions from 720p → 4K.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const compute = () => {
      const w = el.clientWidth || window.innerWidth
      // Clamp so it never becomes microscopic or cartoonishly large.
      setScale(Math.max(0.66, Math.min(2, w / designWidth)))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    window.addEventListener('resize', compute)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', compute)
    }
  }, [designWidth])

  const nameA = names?.a ?? state.a.id.toUpperCase()
  const nameB = names?.b ?? state.b.id.toUpperCase()

  return (
    <div className="fight-hud" ref={ref} aria-hidden={false}>
      <div className="fh-topscrim" />
      {moveDeck && <div className="fh-botscrim" />}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top center',
          width: `${100 / scale}%`,
          height: `${100 / scale}%`,
          left: `${(100 - 100 / scale) / 2}%`,
        }}
      >
        {/* Top bars: player panels flanking the center column. */}
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: 20,
            right: 20,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 20,
          }}
        >
          <PlayerPanel
            fighter={state.a}
            name={nameA}
            portrait={portraits?.a}
            statusInfo={statusInfo}
          />
          <PlayerPanel
            fighter={state.b}
            name={nameB}
            portrait={portraits?.b}
            mirror
            statusInfo={statusInfo}
          />
        </div>

        <CenterColumn
          timeLeft={state.timeLeft}
          round={state.round}
          roundsWon={roundsWon}
          roundsToWin={roundsToWin}
          accentA={state.a.accent}
          accentB={state.b.accent}
        />

        {!state.cinematic && <ComboCounter combo={combo} />}
        <DamageNumbers numbers={damageNumbers} />
        <MoveDeck deck={moveDeck} />
      </div>
      {/* Announcer lives at the true viewport root so its full-screen takeover
          (vignette + letterbox) is not distorted by the HUD scale transform. */}
      <Announcer moment={announce} />
    </div>
  )
}

export default FightHud
