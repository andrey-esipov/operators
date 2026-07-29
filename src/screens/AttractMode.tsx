import { useCallback, useEffect, useRef, useState } from 'react'
import { FightRenderer } from '../three/fight/FightRenderer'
import { loadFighterAtlas } from '../three/fight/loadFighterAtlas'
import { AttractDirector } from './attract/attractDirector'
import './menu/menu.css'

interface Props {
  onExit: () => void
}

/**
 * Dev-only probe surface for the perf harness. Deliberately NOT `__PLAY__` /
 * `__FIGHT__` — those are owned by the playable route and the capture tools, and
 * a name collision would let an attract build answer a capture tool's poll with
 * the wrong world. `?attract=1` is the only route that exposes this.
 */
interface AttractProbe {
  ready: () => boolean
  steps: () => number
  matches: () => number
  kos: () => number
  /** Median fps over the recent sample window, or 0 before warmup. */
  fps: () => number
  matchup: () => string
  degraded: () => boolean
}

declare global {
  interface Window {
    __ATTRACT__?: AttractProbe
  }
}

/**
 * How long the branded title beat holds over the opening bout before it fades,
 * in ms. Long enough to read "OPERATORS", short enough that the fight is the
 * star — a demo reel that opens on a logo card and lingers sells nothing.
 */
const TITLE_BEAT_MS = 2600

/**
 * Sustained fps floor. A live sim on the menu that can't hold this after warmup
 * drops to the static fallback rather than shipping a stuttering title screen,
 * which is worse than a card. Set below any real hardware but above genuinely
 * unplayable — it is a safety net, not a normal path.
 */
const MIN_FPS = 30

/**
 * Frames to sample before the fps floor is allowed to trip. Skips the opening
 * atlas-decode hitch and the first bout's ramp so a one-off load stall can't
 * degrade an otherwise-smooth reel.
 */
const FPS_WARMUP_FRAMES = 300

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * SF II–style attract mode reel — a live CPU-vs-CPU demo fight from the real
 * engine, cut to the good part.
 *
 * Every arcade fighter since 1987 opens on a demo match; we shipped six static
 * cards under a header that promised one. This mounts `MatchSim` + `FightRenderer`
 * (the exact stack a paying player fights) driven by {@link AttractDirector}: a
 * pure brain that picks distinct matchups, primes meter so supers fire, and cuts
 * per round on the decisive KO. Any input exits instantly to the menu.
 *
 * Rotation uses a fresh canvas per bout (React `key`) rather than in-place asset
 * swaps: `Fighter.setAssets` rebinds texture uniforms without freeing the prior
 * `DataTexture`s, so only a full renderer dispose (which tears down the GL
 * context) frees fighter VRAM. Keying the canvas disposes the old renderer
 * before the next mounts — peak VRAM is one match's two fighters, never two
 * matches at once, so the reel stays inside the 512 MB atlas budget the
 * `atlasVramBudget` gate defends.
 */
export function AttractMode({ onExit }: Props) {
  const dirRef = useRef<AttractDirector | null>(null)
  if (dirRef.current === null) dirRef.current = new AttractDirector()

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rotateArmedRef = useRef(false)
  const [segment, setSegment] = useState(0)
  const [degraded, setDegraded] = useState(false)
  const [showTitle, setShowTitle] = useState(true)

  // Any input leaves at once. The director is told first so its `exitPending`
  // contract flips the same tick (the gate asserts that zero-frame window), then
  // the parent tears the overlay down. Idempotent — double-firing is harmless.
  const exit = useCallback(() => {
    dirRef.current?.requestExit()
    onExit()
  }, [onExit])

  // Global listeners, not just root handlers: the canvas can hold focus and a
  // keypress that lands on it would otherwise never reach the root. A demo you
  // have to sit through is worse than no demo, so every key and pointer exits.
  useEffect(() => {
    const onKey = () => exit()
    const onPointer = () => exit()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [exit])

  useEffect(() => {
    const id = window.setTimeout(() => setShowTitle(false), TITLE_BEAT_MS)
    return () => window.clearTimeout(id)
  }, [])

  // Mount a fresh renderer per bout. Mirrors PlayableMatch's proven lifecycle:
  // construct → init → (bail *through* dispose if unmounted) → load both atlases
  // → bind assets → seed initial state → drive the director's step. On a keyed
  // canvas swap React runs this segment's cleanup (dispose) before the next
  // segment's setup, so the old GL context — and its fighter textures — is gone
  // before the next match loads. That ordering is the whole VRAM argument.
  useEffect(() => {
    if (degraded) return
    const canvas = canvasRef.current
    if (!canvas) return
    const dir = dirRef.current!

    // A rotation was requested for THIS segment. Advance the director now, while
    // the previous renderer is already disposed, so the old renderer never steps
    // the newly-built sim (which would flash the new bout through old textures).
    if (rotateArmedRef.current) {
      dir.rotate()
      rotateArmedRef.current = false
    }

    let renderer: FightRenderer | null = null
    let disposed = false

    void (async () => {
      try {
        const m = dir.matchup
        renderer = new FightRenderer(canvas, { scenario: m.stage })
        await renderer.init()
        if (disposed) return renderer.dispose()
        const [atlasA, atlasB] = await Promise.all([
          loadFighterAtlas(m.a.skin),
          loadFighterAtlas(m.b.skin),
        ])
        if (disposed) return renderer.dispose()
        await renderer.setFighterAssets(0, atlasA.assets, atlasA.atlas, m.a.accent)
        await renderer.setFighterAssets(1, atlasB.assets, atlasB.atlas, m.b.accent)
        if (disposed) return renderer.dispose()
        renderer.setInitialState(dir.initialState)
        // The engine's internal rAF calls this once per frame. The director owns
        // the sim; we just pump it. No audio: attract runs before any user
        // gesture, so a live AudioContext would be autoplay-suspended anyway —
        // wiring it would only add a second atlas of decode work for silence.
        renderer.setStep(() => dir.step())
      } catch {
        // No WebGL, a 404 atlas, a lost context: fall to the branded card rather
        // than a black rectangle. The reel degrades; it never breaks.
        if (!disposed) setDegraded(true)
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
      renderer?.dispose()
    }
  }, [segment, degraded])

  // One persistent rAF loop for the whole mount (survives segment swaps): it
  // asks the director when to cut, measures frame rate, and publishes the probe.
  useEffect(() => {
    if (degraded) return
    let raf = 0
    let last = performance.now()
    let frames = 0
    const fpsSamples: number[] = []

    const tick = (now: number) => {
      const dt = now - last
      last = now
      // Ignore absurd deltas (tab backgrounded, first frame) so they can't
      // poison the median either way.
      if (dt > 0 && dt < 500) {
        fpsSamples.push(1000 / dt)
        if (fpsSamples.length > 120) fpsSamples.shift()
        frames++
      }

      const dir = dirRef.current!
      // Edge-triggered cut: arm exactly once per KO so the poll can't advance the
      // reel twice before the new segment mounts and disarms it.
      if (dir.wantsRotate && !rotateArmedRef.current) {
        rotateArmedRef.current = true
        setSegment((s) => s + 1)
      }

      if (frames >= FPS_WARMUP_FRAMES && median(fpsSamples) > 0 && median(fpsSamples) < MIN_FPS) {
        setDegraded(true)
        return
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    if (import.meta.env.DEV) {
      window.__ATTRACT__ = {
        ready: () => dirRef.current !== null,
        steps: () => dirRef.current?.stepsTaken ?? 0,
        matches: () => dirRef.current?.matchesShown ?? 0,
        kos: () => dirRef.current?.kos ?? 0,
        fps: () => median(fpsSamples),
        matchup: () => {
          const m = dirRef.current?.matchup
          return m ? `${m.a.skin} vs ${m.b.skin} @ ${m.stage}` : ''
        },
        degraded: () => degraded,
      }
    }

    return () => {
      cancelAnimationFrame(raf)
      if (import.meta.env.DEV) delete window.__ATTRACT__
    }
  }, [degraded])

  useEffect(() => {
    return () => dirRef.current?.dispose()
  }, [])

  if (degraded) {
    // Static fallback: the reel could not hold frame rate (or WebGL was
    // unavailable). A branded card that still exits on input beats a stutter.
    return (
      <div
        className="am-root"
        onClick={exit}
        onKeyDown={exit}
        tabIndex={-1}
        style={{ background: 'radial-gradient(circle at 50% 32%, #150C26 0%, #07050E 100%)' }}
      >
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 14,
          }}
        >
          <div className="am-eyebrow" style={{ fontSize: 15 }}>A 2D FIGHTING GAME</div>
          <div className="am-logo" style={{ fontSize: 132 }}>OPERATORS</div>
        </div>
        <div className="am-vignette" aria-hidden />
        <div className="am-scan" aria-hidden />
        <div className="am-grain" aria-hidden />
        <div
          className="am-prompt"
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 44, zIndex: 41,
            textAlign: 'center', fontSize: 40, pointerEvents: 'none',
          }}
        >
          PRESS&nbsp; START
        </div>
      </div>
    )
  }

  return (
    <div
      className="am-root"
      onClick={exit}
      onKeyDown={exit}
      tabIndex={-1}
      style={{ background: '#05060a' }}
    >
      <canvas
        key={segment}
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />

      {/* Branded title beat over the opening bout, then it fades to the fight. */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, zIndex: 30, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
          pointerEvents: 'none',
          opacity: showTitle ? 1 : 0,
          transition: 'opacity 700ms ease',
          background: showTitle ? 'rgba(5,6,10,0.42)' : 'rgba(5,6,10,0)',
        }}
      >
        <div className="am-eyebrow" style={{ fontSize: 15 }}>A 2D FIGHTING GAME</div>
        <div className="am-logo" style={{ fontSize: 132 }}>OPERATORS</div>
      </div>

      {/* Atmosphere overlays over the live fight. */}
      <div className="am-vignette" aria-hidden />
      <div className="am-scan" aria-hidden />
      <div className="am-grain" aria-hidden />

      <div
        className="am-prompt"
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 44, zIndex: 41,
          textAlign: 'center', fontSize: 40, pointerEvents: 'none',
        }}
      >
        PRESS&nbsp; START
      </div>
    </div>
  )
}
