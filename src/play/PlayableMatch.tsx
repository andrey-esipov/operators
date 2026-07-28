import { useEffect, useRef, useState } from 'react'
import { FightRenderer } from '../three/fight/FightRenderer'
import { loadFighterAtlas } from '../three/fight/loadFighterAtlas'
import { STAGE_ORDER } from '../three/stage/StageRegistry'
import { MatchSim } from './MatchSim'
import { KeyboardSource, DEFAULT_KEYMAP } from '../fight/input/sources'
import { FightHud } from '../fighthud'
import type { FightHudHandle } from '../fighthud'
import { getFighter } from '../data/fighters'
import type { ScenarioId } from '../types'
import type { FightState } from '../fight/types'

declare global {
  interface Window {
    __PLAY__?: {
      ready: () => boolean
      state: () => FightState
      coverage: () => { lit: number; total: number; fraction: number }
    }
  }
}

/**
 * The fighter as an actual game: a human on the left stick, the CPU on the
 * right, a HUD over the top, and a rematch when it ends.
 *
 * Until this existed the real-time fighter was only reachable through dev
 * harnesses that ran AI against AI — `KeyboardSource` and `GamepadSource` were
 * written, exported and tested, but never constructed anywhere in the app. It
 * looked finished from the inside and was unplayable from the outside.
 *
 * Two rules this file exists to honour:
 *
 * 1. **One poll per simulation step.** The HUD push and the input poll both
 *    live inside the renderer's step callback, which the engine calls exactly
 *    once per simulated frame. Polling in a rAF loop instead would desync
 *    button-press edges from the frames that consume them.
 * 2. **Never re-render React from the game loop.** The HUD takes state through
 *    an imperative `push()` handle; React state here changes only when the
 *    match phase changes, which is a handful of times per fight.
 */

const DEFAULT_A = 'chesky'
const DEFAULT_B = 'lenny'

/** Archetype each roster face fights as, when not overridden by `?p1`/`?p2`. */
const DEFAULT_ARCHETYPE = 'operator'

type Phase = 'booting' | 'loading' | 'playing' | 'error'

export function PlayableMatch() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hudRef = useRef<FightHudHandle | null>(null)
  const [phase, setPhase] = useState<Phase>('booting')
  const [error, setError] = useState<string | null>(null)
  const [matchOver, setMatchOver] = useState(false)

  const params = new URLSearchParams(window.location.search)
  const stageParam = (params.get('stage') as ScenarioId) || 'ipo-prep'
  const aId = params.get('a') || DEFAULT_A
  const bId = params.get('b') || DEFAULT_B
  const p1 = params.get('p1') || DEFAULT_ARCHETYPE
  const p2 = params.get('p2') || 'vanguard'
  /** `?cpu=dummy` gives a training dummy instead of a live opponent. */
  const training = params.get('cpu') === 'dummy'

  const defA = getFighter(aId)
  const defB = getFighter(bId)

  const restartRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: FightRenderer | null = null
    let disposed = false

    const keyboard = new KeyboardSource(DEFAULT_KEYMAP)
    const sim = new MatchSim({
      p1,
      p2,
      controllers: [
        { kind: 'human', source: keyboard },
        training ? { kind: 'dummy' } : { kind: 'cpu', difficulty: 'medium' },
      ],
    })

    void (async () => {
      try {
        const scenario: ScenarioId = STAGE_ORDER.includes(stageParam) ? stageParam : 'ipo-prep'
        renderer = new FightRenderer(canvas, { scenario })
        await renderer.init()
        // Bail out *through* dispose, never around it: an early return leaks a
        // renderer that has already started its own rAF loop on this canvas,
        // and the orphan silently overdraws the live one.
        if (disposed) return renderer.dispose()

        setPhase('loading')
        const [atlasA, atlasB] = await Promise.all([loadFighterAtlas(aId), loadFighterAtlas(bId)])
        if (disposed) return renderer.dispose()
        await renderer.setFighterAssets(0, atlasA.assets, atlasA.atlas, defA?.accent ?? '#E63946')
        await renderer.setFighterAssets(1, atlasB.assets, atlasB.atlas, defB?.accent ?? '#4361EE')
        if (disposed) return renderer.dispose()

        renderer.setInitialState(sim.initialState)

        let lastOver = false
        renderer.setStep(() => {
          const res = sim.step()
          hudRef.current?.push(res.state, res.events)
          // The only React state this loop is allowed to touch, and only on
          // the frame it actually changes.
          const over = res.state.phase === 'match-end'
          if (over !== lastOver) {
            lastOver = over
            setMatchOver(over)
          }
          return res
        })

        restartRef.current = () => {
          sim.restart()
          renderer?.setInitialState(sim.current)
          setMatchOver(false)
        }

        // Dev-only probe. The point of this route is that a human can move the
        // fighter, and that claim needs to be testable from outside the app —
        // "it compiles" has never been evidence of anything here.
        if (import.meta.env.DEV) {
          window.__PLAY__ = {
            ready: () => true,
            state: () => sim.current,
            coverage: () => renderer!.fighterCoverage(),
          }
        }

        setPhase('playing')
      } catch (e) {
        if (disposed) return
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      }
    })()

    const parent = canvas.parentElement!
    const resize = () => {
      const r = parent.getBoundingClientRect()
      renderer?.engine.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)))
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(parent)

    return () => {
      disposed = true
      ro.disconnect()
      restartRef.current = null
      delete window.__PLAY__
      renderer?.dispose()
      sim.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Rematch. Bound outside the game loop so it works even while the sim is
  // sitting on the match-end freeze.
  useEffect(() => {
    if (!matchOver) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') restartRef.current?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [matchOver])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#05060a', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

      {phase === 'playing' && (
        <FightHud
          ref={hudRef}
          fighters={[
            { name: defA?.name ?? aId, accent: defA?.accent ?? '#E63946' },
            { name: defB?.name ?? bId, accent: defB?.accent ?? '#4361EE' },
          ]}
        />
      )}

      {phase !== 'playing' && (
        <div style={overlayStyle}>
          {phase === 'error' ? `failed to start — ${error}` : 'loading…'}
        </div>
      )}

      {phase === 'playing' && <ControlHint />}

      {matchOver && (
        <div style={{ ...overlayStyle, background: 'rgba(3,5,10,0.55)' }}>
          <div style={{ fontSize: 13, letterSpacing: '0.22em' }}>ENTER TO REMATCH</div>
        </div>
      )}
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  color: '#9fb4c8',
  font: '12px ui-monospace, monospace',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  pointerEvents: 'none',
}

/** Dismissable because a permanent keymap legend over the stage is the fastest
 *  way to make a fighting game look like a tutorial instead of a game. */
function ControlHint() {
  const [shown, setShown] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setShown(false), 6000)
    return () => window.clearTimeout(t)
  }, [])
  if (!shown) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 18,
        padding: '8px 16px',
        borderRadius: 999,
        background: 'rgba(5,8,14,0.62)',
        border: '1px solid rgba(159,180,200,0.16)',
        color: '#9fb4c8',
        font: '11px ui-monospace, monospace',
        letterSpacing: '0.1em',
        pointerEvents: 'none',
        backdropFilter: 'blur(6px)',
      }}
    >
      <span>WASD MOVE</span>
      <span>U I O PUNCH</span>
      <span>J K L KICK</span>
    </div>
  )
}

export default PlayableMatch
