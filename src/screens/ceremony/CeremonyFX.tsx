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
