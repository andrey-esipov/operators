import { useEffect, useRef, useState } from 'react'
import { FightRenderer } from '../fight/FightRenderer'
import { MockSim } from '../fight/mockSim'
import { HarnessSim } from '../../fight/harnessSim'
import { loadFighterAtlas } from '../fight/loadFighterAtlas'
import { STAGE_ORDER } from '../stage/StageRegistry'
import type { ScenarioId } from '../../types'
import { getFighter } from '../../data/fighters'

/**
 * Dev harness for the real-time fight renderer at `?fight=1`.
 *
 * It drives the FightRenderer from the real simulation against the frozen
 * contract, loads two fighters' atlases, and exposes `window.__FIGHT__` so the
 * screenshot tooling can drive it deterministically.
 *
 * Two independent axes, which is easy to confuse:
 *   - `a`/`b` pick the VISUALS (sprite atlases: chesky, lenny, ...).
 *   - `p1`/`p2` pick the MECHANICS (sim archetypes: operator, vanguard, warden).
 * A shoto and a zoner can wear the same face; that is intentional.
 *
 * `?sim=mock` falls back to the scripted MockSim. That exists only because the
 * scripted beats hit every VFX path on a fixed schedule, which is useful when
 * bisecting a rendering problem in isolation from AI behaviour. It is not the game.
 *
 * The automation surface steps the ENGINE, which advances the same renderer the
 * user sees — there is no separate offscreen path that could screenshot a
 * different scene than the one on screen.
 */

const DEFAULT_A = 'chesky'
const DEFAULT_B = 'lenny'

declare global {
  interface Window {
    __FIGHT__?: {
      ready: () => boolean
    /** Freeze the rAF loop so stepFixed is the only clock (deterministic). */
    pause: () => void
    resume: () => void
    /** Step the engine N fixed frames (deterministic capture). */
    step: (n?: number, dtMs?: number) => void
    /** Let it settle by stepping a batch. */
    settle: (n?: number) => void
    /** Advance to (approximately) an absolute sim frame within the loop. */
    seek: (frames: number) => void
    phase: () => string
    frame: () => number
    setStage: (id: ScenarioId) => void
    /**
     * Pixels the fighters themselves paint, measured by an isolated offscreen
     * render. The one check an invisible fighter cannot pass.
     */
    coverage: () => {
      lit: number
      total: number
      fraction: number
      bbox: { minX: number; maxX: number; minY: number; maxY: number } | null
    }
    /**
     * Pixels the live projectiles paint, measured the same isolated-readback
     * way. Sampled across a span of frames it discriminates "never drew" and
     * "flashed one spawn frame then vanished" from a genuinely sustained bolt.
     */
    projCoverage: () => {
      lit: number
      total: number
      fraction: number
      bbox: { minX: number; maxX: number; minY: number; maxY: number } | null
    }
    /** Count of mounted projectile sprites (liveness only, not proof of paint). */
    projCount: () => number
    /** Latest super-activation freeze: frames remaining + owner. For capture
     *  tooling to log the super envelope frame by frame. */
    superFreeze: () => { freeze: number; who: 0 | 1 | null }
    renderer: FightRenderer | null
    }
  }
}

export function FightHarness() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState('booting')
  const params = new URLSearchParams(window.location.search)
  const stageParam = (params.get('stage') as ScenarioId) || 'ipo-prep'
  const aId = params.get('a') || DEFAULT_A
  const bId = params.get('b') || DEFAULT_B
  const useMock = params.get('sim') === 'mock'
  const p1 = params.get('p1') || undefined
  const p2 = params.get('p2') || undefined
  const seedParam = Number(params.get('seed'))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let renderer: FightRenderer | null = null
    let disposed = false
    const sim = useMock
      ? new MockSim()
      : new HarnessSim({ p1, p2, seed: Number.isFinite(seedParam) && seedParam ? seedParam : undefined })

    void (async () => {
      const scenario: ScenarioId = STAGE_ORDER.includes(stageParam) ? stageParam : 'ipo-prep'
      renderer = new FightRenderer(canvas, { scenario })
      await renderer.init()
      // Bail out *through* dispose, never around it. An early `return` here
      // leaks a renderer that has already started its own rAF loop on this
      // canvas, and a second loop silently overdraws the live one.
      if (disposed) return renderer.dispose()

      setStatus('loading sprites')
      const accentA = getFighter(aId)?.accent ?? '#E63946'
      const accentB = getFighter(bId)?.accent ?? '#4361EE'
      const [atlasA, atlasB] = await Promise.all([loadFighterAtlas(aId), loadFighterAtlas(bId)])
      if (disposed) return renderer.dispose()
      await renderer.setFighterAssets(0, atlasA.assets, atlasA.atlas, accentA)
      await renderer.setFighterAssets(1, atlasB.assets, atlasB.atlas, accentB)
      if (disposed) return renderer.dispose()

      renderer.setInitialState(sim.step().state)
      renderer.setStep(() => sim.step())

      window.__FIGHT__ = {
        ready: () => true,
        pause: () => renderer!.engine.stop(),
        resume: () => renderer!.engine.start(),
        step: (n = 1, dtMs = 1000 / 60) => renderer!.engine.stepFixed(n, dtMs),
        settle: (n = 30) => renderer!.engine.stepFixed(n, 1000 / 60),
        seek: (frames: number) => renderer!.engine.stepFixed(frames, 1000 / 60),
        phase: () => sim.phase,
        frame: () => sim.frame,
        setStage: (id) => renderer!.setStage(id),
        coverage: () => renderer!.fighterCoverage(),
        projCoverage: () => renderer!.projectileCoverage(),
        projCount: () => renderer!.projectileCount,
        superFreeze: () => renderer!.superFreezeState,
        renderer,
      }
      setStatus('running')
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
      delete window.__FIGHT__
      renderer?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#05060a' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div
        style={{
          position: 'absolute', left: 12, top: 10, font: '12px ui-monospace, monospace',
          color: '#9fb4c8', letterSpacing: '0.04em', pointerEvents: 'none', textShadow: '0 1px 2px #000',
        }}
      >
        fight harness · {aId} vs {bId} · {status}
      </div>
    </div>
  )
}

export default FightHarness
