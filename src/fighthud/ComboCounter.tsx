import { AnimatePresence, motion } from 'framer-motion'

export interface ComboState {
  side: 0 | 1
  count: number
  damage: number
  /** Bumped on every new hit so the number re-pops. */
  key: number
}

interface Props {
  combo: ComboState | null
}

/**
 * Combo counter. Mounts on hit 2+, pops on each new hit (keyed re-animation),
 * and reads out accumulated damage. Placed on the attacker's side.
 */
export function ComboCounter({ combo }: Props) {
  const visible = combo != null && combo.count >= 2
  const side = combo?.side === 0 ? 'a' : 'b'

  return (
    <AnimatePresence>
      {visible && combo && (
        <motion.div
          key={`combo-${combo.side}`}
          className={`fhud-combo ${side}`}
          data-testid="fhud-combo"
          initial={{ opacity: 0, x: combo.side === 0 ? -30 : 30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
        >
          <motion.div
            className="fhud-combo-count"
            data-testid="fhud-combo-count"
            // Re-key on each hit so the pop replays.
            key={combo.key}
            initial={{ scale: 1.6 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 700, damping: 18 }}
          >
            {combo.count}
            <small>HITS</small>
          </motion.div>
          <div className="fhud-combo-dmg" data-testid="fhud-combo-dmg">
            {combo.damage} DMG
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
