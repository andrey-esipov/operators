import { useEffect, useRef } from 'react'
import { Engine } from './core/Engine'
import { StageSubsystem } from './stage/StageSubsystem'
import { FighterSubsystem } from './fighter/FighterSubsystem'
import { LightRig } from './lighting/LightRig'
import { CameraDirector } from './camera/CameraDirector'
import { VfxSubsystem } from './vfx/VfxSubsystem'
import { PostPipeline } from './post/PostPipeline'
import type { FightEvent, FightRenderState } from './types'

export interface FightSceneHandle {
  engine: Engine
  setState(s: FightRenderState): void
  emit(e: FightEvent): void
  setTimeScale(v: number, snap?: boolean): void
}

interface Props {
  /** Latest render state. Read every frame; cheap to recreate. */
  state: FightRenderState
  /** Events queued since the last render. Consumed once. */
  events?: FightEvent[]
  /** Slow-motion factor. */
  timeScale?: number
  className?: string
  onReady?: (h: FightSceneHandle) => void
}

/**
 * Mounts the WebGL fight scene.
 *
 * React owns nothing but the canvas element — the engine runs its own frame
 * loop outside React's render cycle so combat animation never contends with
 * state updates. Props are pushed into the engine imperatively.
 */
export function FightScene3D({ state, events, timeScale = 1, className, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<Engine | null>(null)
  const stateRef = useRef(state)
  const consumedRef = useRef<FightEvent[]>([])
  stateRef.current = state

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false

    const engine = new Engine({ canvas, seed: 0xa11ce })
    engineRef.current = engine

    const light = new LightRig()
    const getLight = () => light

    void (async () => {
      await engine.add(light)
      if (disposed) return
      const post = new PostPipeline()
      await engine.add(
        new StageSubsystem(getLight),
        new FighterSubsystem(getLight),
        new VfxSubsystem(),
        new CameraDirector(),
        post,
      )
      if (disposed) return
      engine.setRenderDriver(post)
      engine.setState(stateRef.current)
      engine.start()
      onReady?.({
        engine,
        setState: (s) => engine.setState(s),
        emit: (e) => engine.emit(e),
        setTimeScale: (v, snap) => engine.setTimeScale(v, snap),
      })
    })()

    const parent = canvas.parentElement!
    const resize = () => {
      const r = parent.getBoundingClientRect()
      engine.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)))
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(parent)
    window.addEventListener('resize', resize)

    // Pause the loop when the tab is hidden — no point burning GPU offscreen.
    const onVis = () => (document.hidden ? engine.stop() : engine.start())
    document.addEventListener('visibilitychange', onVis)

    return () => {
      disposed = true
      ro.disconnect()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
      engine.dispose()
      engineRef.current = null
    }
    // Mount-only: the engine is driven imperatively from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push state every React commit.
  useEffect(() => {
    engineRef.current?.setState(state)
  }, [state])

  useEffect(() => {
    engineRef.current?.setTimeScale(timeScale)
  }, [timeScale])

  // Drain new events exactly once.
  useEffect(() => {
    if (!events || !engineRef.current) return
    for (const e of events) {
      if (consumedRef.current.includes(e)) continue
      engineRef.current.emit(e)
    }
    consumedRef.current = events
  }, [events])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  )
}
