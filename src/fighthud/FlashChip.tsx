import { AnimatePresence, motion } from 'framer-motion'

export interface FlashState {
  kind: 'parry' | 'throw-tech'
  key: number
}

interface Props {
  flash: FlashState | null
}

const STYLE: Record<FlashState['kind'], { label: string; color: string; accent: string }> = {
  parry: { label: 'PARRY', color: '#90E0EF', accent: '#0077B6' },
  'throw-tech': { label: 'TECH', color: '#FFD60A', accent: '#F77F00' },
}

/**
 * Defensive-read flash — parry and throw-tech. Parry is the game's signature
 * borrowed mechanic, so it earns real weight: an expanding shock ring and a
 * coloured screen-edge pulse behind a popping chip. Throw-tech gets the same
 * language, tuned down. One-shot; the FightHud root clears it after its life.
 */
export function FlashChip({ flash }: Props) {
  const s = flash ? STYLE[flash.kind] : null

  return (
    <AnimatePresence>
      {flash && s && (
        <motion.div
          key={flash.key}
          className="fhud-flash-wrap"
          data-testid="fhud-flash"
          data-kind={flash.kind}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
        >
          {/* Coloured screen-edge pulse — strongest for parry. */}
          <motion.div
            className="fhud-flash-edge"
            style={{
              background: `radial-gradient(ellipse at 50% 42%, transparent 46%, ${s.color}${
                flash.kind === 'parry' ? 'aa' : '66'
              } 100%)`,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, flash.kind === 'parry' ? 0.9 : 0.5, 0] }}
            transition={{ duration: 0.45, times: [0, 0.15, 1], ease: 'easeOut' }}
          />
          {/* Expanding shock ring. */}
          <motion.div
            className="fhud-flash-ring"
            style={{ borderColor: s.color, boxShadow: `0 0 26px ${s.color}` }}
            initial={{ scale: 0.2, opacity: 0.9 }}
            animate={{ scale: 3.4, opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
          {/* The label chip. */}
          <motion.div
            className="fhud-flash-chip"
            style={{
              color: s.color,
              background: `linear-gradient(135deg, ${s.accent}, #0f0a1a)`,
              boxShadow: `5px 5px 0 rgba(0,0,0,0.6), 0 0 26px ${s.color}cc`,
            }}
            initial={{ scale: 1.7, y: -6 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 15 }}
          >
            {s.label}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
