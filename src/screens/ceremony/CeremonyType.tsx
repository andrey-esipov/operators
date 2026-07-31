import type { CSSProperties, ReactNode } from 'react'

/**
 * Ceremony typography primitives — the AAA "power words" and designed
 * nameplates the four ceremony screens share. Everything here renders in the
 * heavy condensed display faces loaded by ceremony.css and re-enables crisp
 * font smoothing via the `.cer-type` marker so the type reads like a modern
 * fighting-game callout rather than the pixel UI used elsewhere.
 */

type Entrance = 'slam' | 'ko' | 'vs' | 'none'

const ENTRANCE_ANIM: Record<Entrance, string> = {
  slam: 'cer-word-slam 0.34s cubic-bezier(0.16,0.9,0.28,1) both',
  ko: 'cer-word-ko 0.42s cubic-bezier(0.14,0.92,0.26,1) both',
  vs: 'cer-vs-crash 0.46s cubic-bezier(0.15,0.9,0.3,1) both',
  none: 'none',
}

/**
 * Metallic gradient fills — the single biggest "AAA identity" lever for the
 * power words. A hot top highlight, a saturated core and a bright specular
 * band read as pressed metal / enamel rather than flat web type. Pass one to
 * PowerWord via `gradient`.
 */
export const CER_GRAD = {
  gold: 'linear-gradient(177deg,#fffefb 0%,#ffe9a3 26%,#ffc23d 46%,#f79313 58%,#ffd871 76%,#fff6d8 100%)',
  steel: 'linear-gradient(177deg,#ffffff 0%,#eaf1ff 24%,#a9bbda 50%,#7f93b6 60%,#dbe6fb 80%,#ffffff 100%)',
  crimson: 'linear-gradient(177deg,#ffe6ec 0%,#ff9fb2 28%,#ff375f 50%,#c81d3c 62%,#ff7d97 82%,#ffe0e8 100%)',
  ice: 'linear-gradient(177deg,#ffffff 0%,#d6f6ff 26%,#66d6ff 50%,#1f9fd6 62%,#a6ecff 82%,#ffffff 100%)',
} as const

/**
 * Build a hard 8-direction outline ring using layered text-shadows. Radius is
 * expressed in `em` so the keyline thickness tracks the font size across the
 * clamp() range. Produces the crisp "sticker" edge AAA callouts rely on.
 */
function ringShadow(radiusEm: number, color: string): string {
  const pts: string[] = []
  for (let a = 0; a < 360; a += 45) {
    const x = (Math.cos((a * Math.PI) / 180) * radiusEm).toFixed(3)
    const y = (Math.sin((a * Math.PI) / 180) * radiusEm).toFixed(3)
    pts.push(`${x}em ${y}em 0 ${color}`)
  }
  return pts.join(', ')
}

/**
 * A giant impact word with chromatic-aberration ghosts, a crisp outline and a
 * hard drop shadow so it survives over any stage art. `live` layers a subtle
 * breathing idle + chroma jitter on top of the entrance.
 */
export function PowerWord({
  children,
  size,
  color = '#FFFFFF',
  glow = '#F77F00',
  glow2,
  stroke = '#08040f',
  strokeWidth = 'clamp(2px, calc(0.5 * var(--cer-u)), 6px)',
  skew = -8,
  entrance = 'slam',
  delay = 0,
  live = true,
  chroma = true,
  idle = false,
  gradient,
  echo,
  echoOffset = '0.11em',
  className = '',
  style,
}: {
  children: ReactNode
  size: string
  color?: string
  glow?: string
  glow2?: string
  stroke?: string
  strokeWidth?: string
  skew?: number
  entrance?: Entrance
  delay?: number
  live?: boolean
  chroma?: boolean
  idle?: boolean
  gradient?: string
  echo?: string
  echoOffset?: string
  className?: string
  style?: CSSProperties
}) {
  const entranceAnim = entrance === 'none' ? '' : `${ENTRANCE_ANIM[entrance]} ${delay}s`
  const idleAnim = idle ? `cer-word-idle 1.6s ease-in-out ${delay + 0.5}s infinite` : ''
  const anim = [entranceAnim, idleAnim].filter(Boolean).join(', ') || undefined

  // A thick 8-direction "sticker" keyline in the stroke colour (em-based so it
  // scales with the font) reads as authored fighting-game type — it survives
  // over busy art far better than a soft glow. Layered: hard keyline on top,
  // then a hard drop shadow for weight, then the coloured glow bloom behind.
  const shadow = [
    ringShadow(0.03, stroke),
    'clamp(4px,calc(0.6 * var(--cer-u)),9px) clamp(5px,calc(0.7 * var(--cer-u)),11px) 0 rgba(0,0,0,0.9)',
    glow ? `0 0 clamp(16px,calc(2.2 * var(--cer-u)),38px) ${glow}` : '',
    glow2 ? `0 0 clamp(32px,calc(4.6 * var(--cer-u)),82px) ${glow2}` : '',
  ].filter(Boolean).join(', ')

  const fillStyle: CSSProperties = {
    fontSize: size,
    color,
    WebkitTextStroke: `${strokeWidth} ${stroke}`,
    // @ts-expect-error non-standard but harmless
    textStroke: `${strokeWidth} ${stroke}`,
    paintOrder: 'stroke fill',
    textShadow: shadow,
  }

  return (
    <span
      className={`cer-type cer-pw cer-pw--stack cer-display ${live ? 'cer-pw--live' : ''} ${className}`}
      style={{
        fontSize: size,
        transform: `skewX(${skew}deg)`,
        animation: anim,
        ...style,
      }}
    >
      {echo && (
        <span
          className="cer-pw__layer cer-pw__echo cer-display"
          aria-hidden
          style={{
            fontSize: size,
            color: echo,
            transform: `translate(${echoOffset}, ${echoOffset})`,
            textShadow: `${ringShadow(0.024, echo)}, 0 0 clamp(6px,calc(1 * var(--cer-u)),16px) ${echo}`,
          }}
        >
          {children}
        </span>
      )}
      {chroma && (
        <>
          <span className="cer-pw__layer cer-pw__ghost cer-pw__ghost--r cer-display" style={{ fontSize: size }} aria-hidden>
            {children}
          </span>
          <span className="cer-pw__layer cer-pw__ghost cer-pw__ghost--c cer-display" style={{ fontSize: size }} aria-hidden>
            {children}
          </span>
        </>
      )}
      <span className="cer-pw__layer cer-pw__fill cer-display" style={fillStyle}>
        {children}
      </span>
      {gradient && (
        <span
          className="cer-pw__layer cer-pw__metal cer-display"
          aria-hidden
          style={{
            fontSize: size,
            backgroundImage: gradient,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            color: 'transparent',
            textShadow: 'inset 0 2px 0 rgba(255,255,255,0.5)',
          }}
        >
          {children}
        </span>
      )}
    </span>
  )
}

/**
 * Designed fighter nameplate — an angular slab with a leading accent bar, the
 * fighter's short name in the heavy display face and a condensed sub line.
 * `tag` renders a small kicker (e.g. 1P / CPU / FINAL BOSS) above the name.
 */
export function Nameplate({
  name,
  sub,
  color,
  align,
  tag,
  tagStyle,
  size = 'clamp(30px, calc(4.4 * var(--cer-u)), 66px)',
}: {
  name: string
  sub?: string
  color: string
  align: 'left' | 'right'
  tag?: string
  tagStyle?: CSSProperties
  size?: string
}) {
  const isLeft = align === 'left'
  return (
    <div className={`cer-type ${isLeft ? 'text-left' : 'text-right'}`} style={{ display: 'inline-block' }}>
      {tag && (
        <div
          className="cer-cond"
          style={{
            display: 'inline-block',
            fontSize: 'clamp(9px, calc(1 * var(--cer-u)), 13px)',
            fontWeight: 700,
            letterSpacing: '0.34em',
            color: '#fff',
            background: color,
            padding: '2px 10px 2px 12px',
            marginBottom: 6,
            marginLeft: isLeft ? 0 : 'auto',
            transform: 'skewX(-13deg)',
            boxShadow: `0 0 14px ${color}`,
            textShadow: '1px 1px 0 rgba(0,0,0,0.6)',
            ...tagStyle,
          }}
        >
          <span style={{ display: 'inline-block', transform: 'skewX(13deg)' }}>{tag}</span>
        </div>
      )}
      <div
        style={{
          position: 'relative',
          display: 'inline-block',
          transform: 'skewX(-13deg)',
          background: `linear-gradient(150deg, rgba(10,6,18,0.94) 0%, ${color}cc 130%)`,
          border: '2px solid rgba(255,255,255,0.9)',
          boxShadow: `7px 7px 0 rgba(0,0,0,0.55), 0 0 26px ${color}aa, inset 0 0 22px rgba(0,0,0,0.5)`,
          padding: isLeft ? '4px 22px 6px 16px' : '4px 16px 6px 22px',
        }}
      >
        {/* leading accent bar on the outer edge */}
        <span
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            [isLeft ? 'left' : 'right']: 0,
            width: 7,
            background: color,
            boxShadow: `0 0 16px ${color}`,
          }}
        />
        <div
          className="cer-display"
          style={{
            fontSize: size,
            lineHeight: 0.94,
            color: '#fff',
            letterSpacing: '0.01em',
            textShadow: `3px 3px 0 rgba(0,0,0,0.85), 0 0 20px ${color}`,
            transform: 'skewX(13deg)',
          }}
        >
          {name}
        </div>
      </div>
      {sub && (
        <div
          className="cer-cond"
          style={{
            fontSize: 'clamp(10px, calc(1.15 * var(--cer-u)), 15px)',
            fontWeight: 600,
            letterSpacing: '0.24em',
            color: 'rgba(255,255,255,0.82)',
            marginTop: 7,
            textShadow: '1px 1px 0 rgba(0,0,0,0.8)',
          }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

/** A small condensed kicker/label used above titles and in HUD rows. */
export function Kicker({
  children,
  color = 'rgba(255,255,255,0.75)',
  className = '',
  style,
}: {
  children: ReactNode
  color?: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      className={`cer-type cer-cond ${className}`}
      style={{
        fontWeight: 600,
        letterSpacing: '0.4em',
        textTransform: 'uppercase',
        color,
        fontSize: 'clamp(10px, calc(1.15 * var(--cer-u)), 15px)',
        textShadow: '1px 1px 0 rgba(0,0,0,0.8)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
