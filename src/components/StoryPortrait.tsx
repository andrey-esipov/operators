import { useEffect, useState } from 'react'
import type { FighterDef, Side } from '../types'
import { Sprite } from './Sprite'

interface Props {
  fighter: FighterDef
  /** Which side of the cutscene stage this portrait sits on (drives mirror). */
  side: Side
  /** When true, the speaker is currently delivering their line; portrait
   *  brightens + glows. When false, dim and desaturated. */
  active?: boolean
  /** Display name label below the portrait (defaults to fighter.shortName). */
  label?: string
}

/**
 * Story-mode portrait card. Used in the pre-fight-dialogue + post-fight-reaction
 * cutscene beats. Tries to render `/public/story/portraits/{fighterId}.png` for
 * the bespoke close-up bust shot generated in Tier 3; falls back to the
 * existing stance sprite when no portrait is available.
 *
 * Active speaker gets accent rim-light + 1.0 opacity; inactive is dim + 0.55.
 */
export function StoryPortrait({ fighter, side, active = false, label }: Props) {
  const portraitSrc = `/story/portraits/${fighter.id}.png`
  const [usePortrait, setUsePortrait] = useState(true)

  // Probe whether a bespoke portrait exists. If it 404s, fall back to sprite.
  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => { if (!cancelled) setUsePortrait(true) }
    img.onerror = () => { if (!cancelled) setUsePortrait(false) }
    img.src = portraitSrc
    return () => { cancelled = true }
  }, [portraitSrc])

  const accent = fighter.accent ?? '#FFD60A'
  const mirror = side === 'b' ? -1 : 1

  return (
    <div
      className="flex flex-col items-center gap-2"
      style={{ width: 240 }}
    >
      <div
        className="relative"
        style={{
          width: 220,
          height: 240,
          background: `linear-gradient(180deg, ${accent}33, ${accent}0d)`,
          border: `3px solid ${active ? accent : '#3B2360'}`,
          boxShadow: active
            ? `0 0 24px ${accent}, inset -2px -2px 0 rgba(0,0,0,0.5)`
            : 'inset -2px -2px 0 rgba(0,0,0,0.5)',
          opacity: active ? 1 : 0.55,
          filter: active ? 'none' : 'saturate(0.5)',
          transition: 'opacity 0.25s, filter 0.25s, box-shadow 0.25s, border-color 0.25s',
          overflow: 'hidden',
          imageRendering: 'pixelated' as const,
        }}
      >
        {usePortrait ? (
          <img
            src={portraitSrc}
            alt={fighter.shortName}
            onError={() => setUsePortrait(false)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scaleX(${mirror})`,
              imageRendering: 'pixelated',
            }}
          />
        ) : (
          // Fallback: stance sprite, scaled to fit the portrait card. Position
          // crops the head/shoulders by anchoring top of sprite at the top of
          // the card and over-scaling.
          <div
            style={{
              width: '100%',
              height: '100%',
              transform: `scale(1.5) translateY(8%) scaleX(${mirror})`,
              transformOrigin: 'center top',
            }}
          >
            <Sprite fighter={fighter} side={side} state="stance" />
          </div>
        )}
        {/* Scanline overlay for arcade feel */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 2px, transparent 3px)',
            mixBlendMode: 'overlay' as const,
          }}
        />
      </div>
      <div
        className="font-display tracking-widest text-center"
        style={{
          color: active ? accent : '#9b8eb2',
          fontSize: 12,
          letterSpacing: '0.25em',
          textShadow: '2px 2px 0 black',
          transition: 'color 0.25s',
        }}
      >
        {label ?? fighter.shortName}
      </div>
    </div>
  )
}
