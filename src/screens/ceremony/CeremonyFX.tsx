import './ceremony.css'

/**
 * Shared ceremony visual primitives. Kept tiny and dependency-free so the four
 * ceremony screens can compose the same kinetic language (shock rings, speed
 * streaks, impact flashes) without duplicating markup.
 */

export function ShockRing({
  color,
  delay = 0,
  size = 120,
  thickness = 4,
  duration = 0.5,
}: {
  color: string
  delay?: number
  size?: number
  thickness?: number
  duration?: number
}) {
  return (
    <div
      className="cer-shock"
      style={{
        width: size,
        height: size,
        border: `${thickness}px solid ${color}`,
        boxShadow: `0 0 20px ${color}`,
        animation: `cer-shock-ring ${duration}s cubic-bezier(0.15,0.7,0.3,1) ${delay}s both`,
      }}
    />
  )
}

export function ImpactFlash({ delay = 0, duration = 0.28 }: { delay?: number; duration?: number }) {
  return (
    <div
      className="absolute inset-0 pointer-events-none z-40"
      style={{
        background: 'white',
        mixBlendMode: 'screen',
        opacity: 0,
        animation: `cer-impact-flash ${duration}s ease-out ${delay}s both`,
      }}
    />
  )
}

export function SpeedStreaks({ color = 'rgba(255,255,255,0.55)' }: { color?: string }) {

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {[10, 28, 46, 62, 78, 90].map((top, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            top: `${top}%`,
            left: 0,
            width: '55%',
            height: i % 2 ? 3 : 5,
            background: `linear-gradient(90deg, transparent, ${color})`,
            animation: `cer-streak ${0.5 + (i % 3) * 0.08}s ease-out ${i * 0.04}s both`,
          }}
        />
      ))}
    </div>
  )
}

/**
 * Real stage backdrop for the result screens. Reuses the same pixel-art stage
 * art the fight/VS screens use, heavily darkened with a vignette so the winner
 * pops and text stays readable. Grounds the ceremony in the arena instead of a
 * flat gradient void. `tint` adds a soft accent wash keyed to the winner.
 */
export function StageBackdrop({
  scenario,
  tint,
  dim = 0.4,
}: {
  scenario: string
  tint?: string
  dim?: number
}) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <img
        src={`/stages/${scenario}.png`}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          imageRendering: 'pixelated',
          // Desaturate + crush the busy teal art so it reads as a graded
          // backdrop, not a competing midground — the callout must own contrast.
          filter: `brightness(${dim}) saturate(0.6) contrast(1.22)`,
          transform: 'scale(1.06)',
        }}
      />
      {/* Duotone grade wash — pushes the whole frame toward the screen's key
          colour so it stops reading muddy and gains a graphic, authored grade. */}
      {tint && (
        <div
          className="absolute inset-0"
          style={{ background: tint, mixBlendMode: 'overlay', opacity: 0.5 }}
        />
      )}
      {tint && (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at 50% 46%, ${tint}66 0%, ${tint}1f 32%, transparent 62%)`,
            mixBlendMode: 'screen',
          }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 14%, rgba(0,0,0,0.86) 100%)' }}
      />
      <div className="absolute inset-0 pointer-events-none crt-overlay" />
    </div>
  )
}

/** Warm elliptical pool the winner stands in — sells weight on the ground. */
export function WinnerFloor({ color }: { color: string }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: '50%',
        bottom: '-2%',
        width: '78%',
        height: 34,
        transform: 'translateX(-50%)',
        background: `radial-gradient(ellipse at center, ${color}cc 0%, ${color}44 45%, transparent 72%)`,
        filter: 'blur(2px)',
        animation: 'cer-floor-pulse 2.8s ease-in-out infinite',
      }}
    />
  )
}