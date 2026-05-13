/**
 * The OPERATORS wordmark — SVG-rendered for crisp scaling.
 * Heavy display font, gradient fill, drip accents, drop shadow.
 */
export function Logo({ size = 1 }: { size?: number }) {
  const w = 720 * size
  const h = 180 * size
  return (
    <svg
      viewBox="0 0 720 180"
      width={w}
      height={h}
      style={{ imageRendering: 'pixelated', shapeRendering: 'crispEdges' }}
    >
      <defs>
        <linearGradient id="op-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#FFD60A" />
          <stop offset="50%" stopColor="#F77F00" />
          <stop offset="100%" stopColor="#E63946" />
        </linearGradient>
        <linearGradient id="op-shine" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Shadow layer (offset) */}
      <text
        x="360"
        y="120"
        fontFamily="Press Start 2P, monospace"
        fontSize="76"
        textAnchor="middle"
        fill="rgba(0,0,0,0.7)"
        transform="translate(8 8) skewX(-6)"
        letterSpacing="6"
      >
        OPERATORS
      </text>

      {/* Stroke layer (white outline) */}
      <text
        x="360"
        y="120"
        fontFamily="Press Start 2P, monospace"
        fontSize="76"
        textAnchor="middle"
        stroke="#FFFFFF"
        strokeWidth="8"
        fill="none"
        transform="skewX(-6)"
        letterSpacing="6"
        paintOrder="stroke"
      >
        OPERATORS
      </text>

      {/* Gradient fill */}
      <text
        x="360"
        y="120"
        fontFamily="Press Start 2P, monospace"
        fontSize="76"
        textAnchor="middle"
        fill="url(#op-grad)"
        transform="skewX(-6)"
        letterSpacing="6"
      >
        OPERATORS
      </text>

      {/* Shine highlight on top */}
      <text
        x="360"
        y="120"
        fontFamily="Press Start 2P, monospace"
        fontSize="76"
        textAnchor="middle"
        fill="url(#op-shine)"
        transform="skewX(-6)"
        letterSpacing="6"
        opacity="0.6"
      >
        OPERATORS
      </text>

      {/* Subtitle */}
      <text
        x="360"
        y="160"
        fontFamily="Press Start 2P, monospace"
        fontSize="12"
        textAnchor="middle"
        fill="#FFFFFF"
        letterSpacing="6"
        opacity="0.9"
      >
        A TACTICAL FIGHTER ON LENNY'S PODCAST
      </text>
    </svg>
  )
}
