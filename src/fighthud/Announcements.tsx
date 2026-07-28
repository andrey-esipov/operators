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
          {/* Speed-line sweep behind the plate. */}
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
            className="fhud-announce-plate"
            style={{
              background: `linear-gradient(135deg, ${announce.accent} 0%, ${announce.color} 50%, ${announce.accent} 100%)`,
              boxShadow: `10px 10px 0 rgba(0,0,0,0.7), 0 0 40px ${announce.color}aa`,
            }}
            initial={{ scale: 0.5, rotate: -8 }}
            animate={{ scale: [0.5, 1.12, 1], rotate: [-8, 2, 0] }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          >
            <div>
              {announce.kicker && (
                <div className="fhud-announce-kicker">{announce.kicker}</div>
              )}
              <div
                className="fhud-announce-main"
                data-testid="fhud-announce-main"
                style={{ color: '#fff' }}
              >
                {announce.main}
              </div>
              {announce.sub && (
                <div
                  className="fhud-announce-kicker"
                  style={{ marginTop: 8, marginBottom: 0 }}
                >
                  {announce.sub}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
