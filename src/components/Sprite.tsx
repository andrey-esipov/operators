import { useEffect, useRef, useState } from 'react'
import type { FighterDef, Side } from '../types'

interface Props {
  fighter: FighterDef
  side: Side
  state: 'stance' | 'attack' | 'win' | 'lose' | 'ult'
  shake?: boolean
}

/**
 * Renders a fighter sprite.
 *
 * Auto-resolution order:
 *   1. fighter.sprites?.[state] (explicit override on the fighter def)
 *   2. /sprites/<id>/<state>.png (convention — what scripts/generate-fighter-sprites.ts writes)
 *   3. CSS-pixel-art placeholder
 *
 * The generated PNGs come with a solid #808080 background (gpt-image-2 prompted
 * flat gray bg). We chroma-key it out client-side in a <canvas> so the
 * sprite floats on the stage cleanly.
 */
export function Sprite({ fighter, side, state, shake }: Props) {
  const mirror = side === 'b' ? -1 : 1
  const resolvedState = state === 'ult' ? 'win' : state
  // Pose fallback chain: state → stance → placeholder
  const [stateFallback, setStateFallback] = useState<'stance' | 'attack' | 'win' | 'lose'>(resolvedState)
  // If incoming state changes, reset the fallback
  if (stateFallback !== resolvedState && stateFallback !== 'stance') {
    setStateFallback(resolvedState)
  }
  const candidate =
    fighter.sprites?.[state] ??
    `/sprites/${fighter.id}/${stateFallback}.png`

  const [errored, setErrored] = useState(false)
  function handleError() {
    if (stateFallback !== 'stance') {
      setStateFallback('stance')
    } else {
      setErrored(true)
    }
  }

  return (
    <div
      className={`relative w-full h-full ${shake ? 'shake' : 'idle-bob'}`}
      style={{
        ['--mirror' as unknown as string]: mirror,
        transform: `scaleX(${mirror})`,
        transformOrigin: 'center bottom',
      }}
    >
      {!errored ? (
        <KeyedSprite
          src={candidate}
          alt={fighter.name}
          onError={handleError}
        />
      ) : (
        <PlaceholderSprite fighter={fighter} state={state} />
      )}
    </div>
  )
}

/**
 * Loads an image to a canvas, chroma-keys near-gray pixels to transparent,
 * and renders the canvas. Pixel-perfect rendering preserved.
 */
function KeyedSprite({
  src,
  alt,
  onError,
}: {
  src: string
  alt: string
  onError: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = src
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0)
      const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const d = id.data
      // Chroma-key: any pixel close to mid-gray gets transparent.
      // Threshold tuned for gpt-image-2's #808080 prompt bg, which varies a bit.
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2]
        const gray = Math.abs(r - 128) < 28 && Math.abs(g - 128) < 28 && Math.abs(b - 128) < 28
        const sameChannels = Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && Math.abs(r - b) < 12
        if (gray && sameChannels) {
          d[i + 3] = 0
        }
      }
      ctx.putImageData(id, 0, 0)
      setLoaded(true)
    }
    img.onerror = () => onError()
  }, [src, onError])

  return (
    <canvas
      ref={canvasRef}
      aria-label={alt}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        imageRendering: 'pixelated',
        opacity: loaded ? 1 : 0,
        transition: 'opacity 0.18s',
        filter: 'drop-shadow(0 4px 0 rgba(0,0,0,0.5))',
      }}
    />
  )
}

/**
 * CSS-pixel-art placeholder. A blocky humanoid figure shaped from divs.
 * Looks intentional and consistent across all fighters until real sprites land.
 */
function PlaceholderSprite({ fighter, state }: { fighter: FighterDef; state: string }) {
  const accent = fighter.accent
  const initial = fighter.shortName.slice(0, 2)
  const attacking = state === 'attack' || state === 'ult'
  const fallen = state === 'lose'

  // Color helpers
  const shade = (color: string, pct: number) =>
    `color-mix(in srgb, ${color} ${100 - pct}%, ${pct > 0 ? 'black' : 'white'} ${Math.abs(pct)}%)`
  const dark = shade(accent, 25)
  const darker = shade(accent, 45)
  const light = shade(accent, -15)

  return (
    <svg
      viewBox="0 0 32 48"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMax meet"
      style={{ imageRendering: 'pixelated', shapeRendering: 'crispEdges' }}
    >
      <defs>
        <linearGradient id={`g-${fighter.id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={accent} />
        </linearGradient>
      </defs>

      {/* Shadow */}
      <ellipse cx="16" cy="46.5" rx="9" ry="1" fill="rgba(0,0,0,0.5)" />

      {/* Body — torso */}
      {!fallen && (
        <>
          {/* Legs */}
          <rect x="11" y="34" width="4" height="10" fill={darker} />
          <rect x="17" y="34" width="4" height="10" fill={darker} />
          <rect x="10" y="44" width="6" height="2" fill="black" />
          <rect x="16" y="44" width="6" height="2" fill="black" />

          {/* Torso */}
          <rect x="10" y="20" width="12" height="14" fill={`url(#g-${fighter.id})`} />
          <rect x="10" y="20" width="12" height="2" fill={light} />
          <rect x="10" y="32" width="12" height="2" fill={darker} />

          {/* Belt accent */}
          <rect x="10" y="26" width="12" height="1" fill={dark} />

          {/* Arms */}
          {attacking ? (
            <>
              {/* Forward attacking arm */}
              <rect x="22" y="22" width="8" height="3" fill={dark} />
              <rect x="29" y="20" width="3" height="6" fill={accent} />
            </>
          ) : (
            <>
              <rect x="7" y="22" width="3" height="8" fill={dark} />
              <rect x="22" y="22" width="3" height="8" fill={dark} />
              {/* Fists */}
              <rect x="6" y="29" width="4" height="3" fill={accent} />
              <rect x="22" y="29" width="4" height="3" fill={accent} />
            </>
          )}

          {/* Neck */}
          <rect x="14" y="17" width="4" height="3" fill={dark} />

          {/* Head */}
          <rect x="11" y="9" width="10" height="9" fill={shade(accent, -25)} />
          <rect x="11" y="9" width="10" height="1" fill="rgba(255,255,255,0.4)" />
          {/* Hair top */}
          <rect x="11" y="7" width="10" height="3" fill="black" />
          {/* Eyes */}
          <rect x="13" y="13" width="2" height="2" fill="white" />
          <rect x="17" y="13" width="2" height="2" fill="white" />
          <rect x="14" y="14" width="1" height="1" fill="black" />
          <rect x="18" y="14" width="1" height="1" fill="black" />
          {/* Mouth */}
          <rect x="14" y="16" width="4" height="1" fill="black" />
        </>
      )}
      {fallen && (
        <>
          {/* Lying down representation */}
          <rect x="6" y="40" width="20" height="4" fill={darker} />
          <rect x="6" y="40" width="20" height="1" fill={light} />
          <rect x="8" y="38" width="6" height="3" fill={shade(accent, -25)} />
          <rect x="9" y="39" width="1" height="1" fill="white" />
          <rect x="12" y="39" width="1" height="1" fill="white" />
        </>
      )}

      {/* Initial overlay (subtle) */}
      <text
        x="16"
        y="29"
        fontFamily="Press Start 2P, monospace"
        fontSize="3"
        fill="white"
        textAnchor="middle"
        opacity="0.7"
      >
        {initial}
      </text>
    </svg>
  )
}
