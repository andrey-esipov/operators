import { AnimatePresence, motion } from 'framer-motion'

export type AnnounceKind = 'round' | 'fight' | 'ko' | 'perfect' | 'time-over' | 'win'

export interface AnnounceState {
  kind: AnnounceKind
  kicker?: string
  main: string
  sub?: string
  color: string
  accent: string
  key: number
}

interface Props {
  announce: AnnounceState | null
}

/**
 * One layer of heavy display lettering. The word *is* the graphic — a dark
 * extruded back-copy carries the depth and stroke, a gradient-clipped front
 * copy carries the fill. No box is drawn behind it: a bounding plate is exactly
 * what makes an announcement read as a web toast rather than a fighting game.
 */
export function Word({
  text,
  color,
  accent,
  className,
  testid,
}: {
  text: string
  color: string
  accent: string
  className: string
  testid?: string
}) {
  return (
    <span className={`fhud-word ${className}`}>
      {/* Extruded depth + hard stroke. aria-hidden: the fill copy is the a11y text. */}
      <span className="fhud-word-shadow" aria-hidden>
        {text}
      </span>
      {/* Gradient fill: white top-highlight into the character colour ramp. */}
      <span
        className="fhud-word-fill"
        data-testid={testid}
        style={{
          backgroundImage: `linear-gradient(178deg, #fff 4%, ${color} 42%, ${accent} 96%)`,
        }}
      >
        {text}
      </span>
    </span>
  )
}

/**
 * Match punctuation — ROUND N, FIGHT!, K.O., PERFECT, TIME OVER, WINS.
 * One at a time; each replaces the last. Timing/dismissal is owned by the
 * FightHud root (event- and phase-driven), this is pure presentation.
 */
export function Announcements({ announce }: Props) {
  return (
    <AnimatePresence mode="wait">
      {announce && (
        <motion.div
          key={announce.key}
          className="fhud-announce"
          data-testid="fhud-announce"
          data-kind={announce.kind}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
        >
          {/* Speed-line sweep behind the lettering. */}
          <motion.div
            className="absolute inset-0"
            initial={{ x: '-100%', opacity: 0 }}
            animate={{ x: '100%', opacity: [0, 0.5, 0] }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{
              background: `linear-gradient(90deg, transparent 30%, ${announce.color}66 50%, transparent 70%)`,
              mixBlendMode: 'screen',
            }}
          />
          <motion.div
            className="fhud-announce-stack"
            initial={{ scale: 0.55, rotate: -7, y: 8 }}
            animate={{ scale: [0.55, 1.14, 1], rotate: [-7, 1.5, 0], y: [8, 0, 0] }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            {announce.kicker && (
              <Word
                text={announce.kicker}
                color={announce.color}
                accent={announce.accent}
                className="fhud-word-kicker"
              />
            )}
            <Word
              text={announce.main}
              color={announce.color}
              accent={announce.accent}
              className="fhud-word-main"
              testid="fhud-announce-main"
            />
            {announce.sub && (
              <Word
                text={announce.sub}
                color={announce.color}
                accent={announce.accent}
                className="fhud-word-sub"
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
