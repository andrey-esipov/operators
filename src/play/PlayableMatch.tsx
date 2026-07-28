import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
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
      /** Freeze the sim so a capture's label and its pixels describe one moment. */
      pause: () => void
      resume: () => void
      paused: () => boolean
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
  // Controls belong to the pre-round beat. Once the round is live the player is
  // busy and a legend on screen is just a dev overlay.
  const [fightStarted, setFightStarted] = useState(false)

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
        let announced = false
        // Capture tools need the world to hold still. Reading state and then
        // taking a DPR-2 screenshot of a 3200x1800 page takes long enough for
        // the sim to advance a dozen frames, so an unpaused capture can label a
        // shot `hitstun` and show a fighter who has already recovered — the shot
        // and its label describing different moments. Freezing the step is the
        // only way the label can be trusted.
        let frozen = false
        renderer.setStep(() => {
          if (frozen) return { state: sim.current, events: [] }
          const res = sim.step()
          hudRef.current?.push(res.state, res.events)
          // The only React state this loop is allowed to touch, and only on
          // the frame it actually changes.
          const over = res.state.phase === 'match-end'
          if (over !== lastOver) {
            lastOver = over
            setMatchOver(over)
          }
          // The control hint belongs to the pre-round moment, not the match.
          // One transition, one setState, once per mount.
          if (!announced && res.state.phase === 'fight') {
            announced = true
            setFightStarted(true)
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
            pause: () => {
              frozen = true
            },
            resume: () => {
              frozen = false
            },
            paused: () => frozen,
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

      {phase === 'playing' && <ControlHint hide={fightStarted} />}

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
function ControlHint({ hide }: { hide: boolean }) {
  const [visible, setVisible] = useState(true)
  const [mounted, setMounted] = useState(true)
  const bornAt = useRef(Date.now())

  useEffect(() => {
    // Dismiss the moment the player demonstrates they know the controls. The
    // timer is only a fallback for someone who never presses anything — a hint
    // that outlives its usefulness is what makes a game look like a tutorial.
    const dismiss = () => setVisible(false)
    window.addEventListener('keydown', dismiss, { once: true })
    const t = window.setTimeout(dismiss, 6000)
    return () => {
      window.removeEventListener('keydown', dismiss)
      window.clearTimeout(t)
    }
  }, [])

  // The round going live is the real deadline — no fighting game leaves a
  // control legend up over a live match. But the intro is only ~1.5s, measured,
  // which is not long enough to read three groups of keys, so the round start
  // is honoured no earlier than a readable floor. Pressing anything still
  // clears it instantly, so this only ever extends the hint for someone who
  // hasn't worked out the controls yet.
  useEffect(() => {
    if (!hide) return
    const READABLE_MS = 3200
    const remaining = Math.max(0, READABLE_MS - (Date.now() - bornAt.current))
    const t = window.setTimeout(() => setVisible(false), remaining)
    return () => window.clearTimeout(t)
  }, [hide])

  // Stay mounted until the fade finishes, otherwise it pops out of existence.
  useEffect(() => {
    if (visible) return
    const t = window.setTimeout(() => setMounted(false), 420)
    return () => window.clearTimeout(t)
  }, [visible])

  if (!mounted) return null

  const cap: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 22,
    height: 22,
    padding: '0 5px',
    borderRadius: 5,
    // A keycap is a physical object: lit from above, darker at the bottom lip,
    // sitting slightly proud of its surface. Flat rectangles read as web UI.
    background: 'linear-gradient(180deg,#39445a 0%,#232c3c 46%,#161d29 100%)',
    border: '1px solid rgba(150,180,215,0.34)',
    borderTopColor: 'rgba(200,225,255,0.5)',
    borderBottomColor: 'rgba(0,0,0,0.72)',
    boxShadow:
      '0 1px 0 rgba(255,255,255,0.16) inset, 0 -2px 3px rgba(0,0,0,0.45) inset, 0 2px 3px rgba(0,0,0,0.55)',
    color: '#e6eef8',
    font: '700 11px/1 Inter, system-ui, sans-serif',
    letterSpacing: '0.02em',
    textShadow: '0 1px 1px rgba(0,0,0,0.6)',
  }

  const group = (keys: string[], label: string) => (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-flex', gap: 3 }}>
        {keys.map((k) => (
          <kbd key={k} style={cap}>
            {k}
          </kbd>
        ))}
      </span>
      <span
        style={{
          color: 'rgba(214,229,245,0.86)',
          font: '600 10px/1 Inter, system-ui, sans-serif',
          letterSpacing: '0.24em',
          textIndent: '0.24em',
          textShadow: '0 1px 3px rgba(0,0,0,0.9)',
        }}
      >
        {label}
      </span>
    </span>
  )

  const divider = (
    <span
      style={{
        width: 1,
        alignSelf: 'stretch',
        margin: '2px 0 12px',
        background: 'linear-gradient(180deg,transparent,rgba(150,180,215,0.26),transparent)',
      }}
    />
  )

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 30,
        transform: `translateX(-50%) translateY(${visible ? 0 : 8}px)`,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 18,
        padding: '20px 44px 16px',
        // A scrim, not a panel. It has to reach fully transparent well inside
        // its own box or the falloff stops being a falloff and becomes an edge —
        // which is exactly what a rounded translucent rectangle looks like
        // sitting on top of a game.
        background:
          'radial-gradient(closest-side at 50% 48%, rgba(6,10,17,0.72) 0%, rgba(6,10,17,0.46) 38%, rgba(6,10,17,0.14) 68%, rgba(6,10,17,0) 88%)',
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 380ms ease, transform 380ms ease',
      }}
    >
      {group(['W', 'A', 'S', 'D'], 'MOVE')}
      {divider}
      {group(['U', 'I', 'O'], 'PUNCH')}
      {divider}
      {group(['J', 'K', 'L'], 'KICK')}
    </div>
  )
}

export default PlayableMatch
