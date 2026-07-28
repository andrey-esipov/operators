import { useEffect, useMemo, useRef, useState } from 'react'
import { HarnessSim } from '../../fight'
import type { FightState } from '../../fight/types'
import { getFighter } from '../../data/fighters'
import { FightHud } from '../FightHud'
import type { FightHudHandle, FighterDisplay } from '../types'
import { ComboGallery } from './ComboGallery'

/**
 * Standalone HUD preview at `?fighthud=1`.
 *
 * It drives the REAL simulation (HarnessSim, CPU vs CPU) and pushes each frame
 * into <FightHud> via the imperative handle — the same integration the fight
 * harness will use. No Three.js: the stage here is a flat gradient with two
 * placeholder bodies, so the only thing under test is the HUD itself.
 *
 * `window.__FIGHTHUD__` exposes a deterministic step surface for the probe:
 * pausing the loop and advancing exact frame counts, plus a state snapshot so a
 * test can assert the HUD against the same numbers the sim reports.
 */

const STAGE_HALF_W = 480

declare global {
  interface Window {
    __FIGHTHUD__?: {
      ready: () => boolean
      pause: () => void
      resume: () => void
      /** Advance the sim exactly n frames, pushing each into the HUD. */
      step: (n?: number) => void
      frame: () => number
      phase: () => string
      state: () => FightState
    }
  }
}

function useQuery() {
  return useMemo(() => new URLSearchParams(window.location.search), [])
}

function LiveHudPreview() {
  const q = useQuery()
  const aId = q.get('a') || 'chesky'
  const bId = q.get('b') || 'lenny'
  const startPaused = q.get('paused') === '1'

  const hudRef = useRef<FightHudHandle>(null)
  const simRef = useRef<HarnessSim | null>(null)
  const pausedRef = useRef(startPaused)
  const [posA, setPosA] = useState({ x: -150, y: 0 })
  const [posB, setPosB] = useState({ x: 150, y: 0 })
  const [status, setStatus] = useState('booting')

  const fighters: [FighterDisplay, FighterDisplay] = useMemo(() => {
    const a = getFighter(aId)
    const b = getFighter(bId)
    return [
      { name: a?.name ?? aId.toUpperCase(), accent: a?.accent ?? '#E63946', rosterId: aId },
      { name: b?.name ?? bId.toUpperCase(), accent: b?.accent ?? '#00B4D8', rosterId: bId },
    ]
  }, [aId, bId])

  useEffect(() => {
    const sim = new HarnessSim({ p1: q.get('p1') || undefined, p2: q.get('p2') || undefined })
    simRef.current = sim
    let latest = sim.initialState

    // One deterministic advance: step the sim, push to HUD, sync placeholders.
    const advance = () => {
      const { state, events } = sim.step()
      latest = state
      hudRef.current?.push(state, events)
      setPosA({ x: state.fighters[0].pos.x, y: state.fighters[0].pos.y })
      setPosB({ x: state.fighters[1].pos.x, y: state.fighters[1].pos.y })
      return state
    }

    // Prime frame 0 so bars start full rather than empty.
    advance()
    setStatus('running')

    window.__FIGHTHUD__ = {
      ready: () => true,
      pause: () => {
        pausedRef.current = true
      },
      resume: () => {
        pausedRef.current = false
      },
      step: (n = 1) => {
        for (let i = 0; i < n; i++) advance()
      },
      frame: () => sim.frame,
      phase: () => sim.phase,
      state: () => latest,
    }

    let raf = 0
    let acc = 0
    let last = performance.now()
    const loop = (t: number) => {
      const dt = t - last
      last = t
      if (!pausedRef.current) {
        // Fixed 60Hz stepping, decoupled from display refresh.
        acc += dt
        let guard = 0
        while (acc >= 1000 / 60 && guard < 4) {
          advance()
          acc -= 1000 / 60
          guard++
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      delete window.__FIGHTHUD__
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toScreen = (x: number) => 50 + (x / STAGE_HALF_W) * 42

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background:
          'radial-gradient(ellipse at 50% 20%, #3B2360 0%, #1A1230 55%, #0F0A1A 100%)',
      }}
    >
      {/* Floor */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '26%',
          background: 'linear-gradient(180deg, #2a2016, #14100a)',
          borderTop: '3px solid #000',
          boxShadow: 'inset 0 8px 20px rgba(0,0,0,0.6)',
        }}
      />
      {/* Placeholder bodies so the HUD has spatial context. */}
      {[
        { p: posA, c: fighters[0].accent, k: 'a' },
        { p: posB, c: fighters[1].accent, k: 'b' },
      ].map(({ p, c, k }) => (
        <div
          key={k}
          style={{
            position: 'absolute',
            left: `${toScreen(p.x)}%`,
            bottom: `calc(26% + ${p.y * 0.18}px)`,
            transform: 'translateX(-50%)',
            width: 74,
            height: 150,
            background: `linear-gradient(180deg, ${c}, #0f0a1a)`,
            border: '3px solid #000',
            boxShadow: '4px 6px 0 rgba(0,0,0,0.5)',
          }}
        />
      ))}

      <FightHud ref={hudRef} fighters={fighters} />

      <div
        style={{
          position: 'absolute',
          left: 12,
          bottom: 8,
          font: '11px ui-monospace, monospace',
          color: '#6f7f92',
          pointerEvents: 'none',
        }}
      >
        fighthud preview · {aId} vs {bId} · {status}
      </div>
    </div>
  )
}

export default HudPreview

/**
 * Route entry. Dispatches between the live sim preview and static tuning
 * galleries by `?view=`, so no hooks run conditionally.
 */
export function HudPreview() {
  const view = new URLSearchParams(window.location.search).get('view')
  if (view === 'combos') return <ComboGallery />
  return <LiveHudPreview />
}
