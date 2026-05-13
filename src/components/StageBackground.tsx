import type { ScenarioId } from '../types'

interface Props {
  scenario: ScenarioId
  shake?: boolean
}

/**
 * Procedural CSS pixel-art stage backgrounds.
 * Three parallax layers per stage. No external assets required.
 * Each scenario gets a unique color palette + skyline shape.
 */
const STAGE_THEMES: Record<ScenarioId, {
  skyTop: string
  skyBot: string
  midDark: string
  midLight: string
  floor: string
  accent: string
  silhouettes: string
}> = {
  'pre-pmf': {
    skyTop: '#1A0F2E', skyBot: '#3B2360',
    midDark: '#241936', midLight: '#3D2C5C',
    floor: '#1A1230', accent: '#F77F00', silhouettes: '#FCBF49',
  },
  hypergrowth: {
    skyTop: '#0F1F3D', skyBot: '#06B6D4',
    midDark: '#0A1530', midLight: '#1E3B6E',
    floor: '#0F1F3D', accent: '#06D6A0', silhouettes: '#90E0EF',
  },
  plateau: {
    skyTop: '#2D1A3F', skyBot: '#7209B7',
    midDark: '#1A0F2E', midLight: '#3B2360',
    floor: '#1A1230', accent: '#F72585', silhouettes: '#90E0EF',
  },
  'ai-native': {
    skyTop: '#001F2E', skyBot: '#0077B6',
    midDark: '#001A2E', midLight: '#00497A',
    floor: '#001F2E', accent: '#06D6A0', silhouettes: '#00B4D8',
  },
  monetization: {
    skyTop: '#1F0D1A', skyBot: '#7209B7',
    midDark: '#2D1233', midLight: '#5E2B6D',
    floor: '#1F0D1A', accent: '#FFD60A', silhouettes: '#F72585',
  },
  crisis: {
    skyTop: '#1F0A0A', skyBot: '#7A1F1F',
    midDark: '#2D0F0F', midLight: '#5E2B2B',
    floor: '#1F0A0A', accent: '#EF233C', silhouettes: '#FFD60A',
  },
  'ipo-prep': {
    skyTop: '#0F1A2E', skyBot: '#1B3A6E',
    midDark: '#0F1A2E', midLight: '#2D4B7A',
    floor: '#0F1A2E', accent: '#FCBF49', silhouettes: '#90E0EF',
  },
  distribution: {
    skyTop: '#3D1F00', skyBot: '#F77F00',
    midDark: '#5C2D0F', midLight: '#A05C1A',
    floor: '#2D1A0A', accent: '#FFD60A', silhouettes: '#FCBF49',
  },
}

export function StageBackground({ scenario, shake }: Props) {
  const t = STAGE_THEMES[scenario]
  return (
    <div className={`absolute inset-0 overflow-hidden ${shake ? 'shake' : ''}`}>
      {/* SKY layer */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, ${t.skyTop} 0%, ${t.skyBot} 80%)`,
        }}
      />
      {/* Sky stars / particles */}
      <SkyParticles color={t.silhouettes} />

      {/* MIDGROUND silhouette (buildings/structure) */}
      <SkylineLayer
        height={56}
        bottom={120}
        fillDark={t.midDark}
        fillLight={t.midLight}
        accent={t.accent}
        opacity={1}
        density={14}
      />
      {/* Closer mid layer */}
      <SkylineLayer
        height={80}
        bottom={92}
        fillDark={t.midLight}
        fillLight={t.silhouettes}
        accent={t.accent}
        opacity={0.95}
        density={9}
      />
      {/* FOREGROUND floor */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          height: 92,
          background: `linear-gradient(180deg, ${t.floor} 0%, color-mix(in srgb, ${t.floor} 60%, black) 100%)`,
          borderTop: `2px solid ${t.accent}`,
          boxShadow: `0 -8px 0 -4px ${t.accent}55`,
        }}
      />
      {/* Floor pixel grid */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          height: 92,
          background: `repeating-linear-gradient(90deg, transparent 0 60px, rgba(255,255,255,0.06) 60px 61px)`,
        }}
      />
    </div>
  )
}

function SkyParticles({ color }: { color: string }) {
  return (
    <div className="absolute inset-0 sway">
      {Array.from({ length: 30 }).map((_, i) => {
        const top = (i * 37) % 60
        const left = (i * 73) % 100
        const size = 1 + (i % 3)
        return (
          <div
            key={i}
            className="absolute"
            style={{
              top: `${top}%`,
              left: `${left}%`,
              width: size,
              height: size,
              background: color,
              opacity: 0.4 + (i % 4) * 0.1,
            }}
          />
        )
      })}
    </div>
  )
}

function SkylineLayer({
  height,
  bottom,
  fillDark,
  fillLight,
  accent,
  opacity,
  density,
}: {
  height: number
  bottom: number
  fillDark: string
  fillLight: string
  accent: string
  opacity: number
  density: number
}) {
  const widths = Array.from({ length: density }).map((_, i) => 30 + ((i * 17) % 60))
  return (
    <div
      className="absolute left-0 right-0"
      style={{
        bottom,
        height,
        display: 'flex',
        gap: 8,
        padding: '0 12px',
        opacity,
      }}
    >
      {widths.map((w, i) => {
        const h = 30 + ((i * 13) % (height - 10))
        const lit = i % 4 === 0
        return (
          <div
            key={i}
            style={{
              width: w,
              height: h,
              alignSelf: 'flex-end',
              background: lit
                ? `linear-gradient(180deg, ${fillLight} 0%, ${fillDark} 100%)`
                : fillDark,
              borderTop: `2px solid ${lit ? accent : fillLight}`,
              boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5)',
              position: 'relative',
            }}
          >
            {/* "Windows" */}
            {lit &&
              Array.from({ length: Math.floor(h / 10) }).map((_, r) => (
                <div
                  key={r}
                  className="absolute left-1 right-1"
                  style={{
                    top: r * 10 + 6,
                    height: 3,
                    background: accent,
                    opacity: r % 2 ? 0.5 : 0.9,
                  }}
                />
              ))}
          </div>
        )
      })}
    </div>
  )
}
