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

export interface ComboTier {
  /** Rank word shown above the number, or null for low combos. */
  label: string | null
  color: string
  glow: string
  /** Base size multiplier for the number at this tier. */
  scale: number
}

/**
 * Combo grading. As the hit count climbs the number grows, warms in colour,
 * and earns a rank word — the SF6/Strive "the longer you go, the louder the
 * HUD gets" feedback loop. Exported so a preview gallery can tune the curve.
 */
export function comboTier(count: number): ComboTier {
  if (count >= 18) return { label: 'LETHAL', color: '#ff4d6d', glow: '#ff0a54', scale: 1.5 }
  if (count >= 12) return { label: 'AMAZING', color: '#ff7b00', glow: '#ff9e00', scale: 1.34 }
  if (count >= 8) return { label: 'GREAT', color: '#ffd60a', glow: '#ff9500', scale: 1.2 }
  if (count >= 5) return { label: 'NICE', color: '#ffe98a', glow: '#ffb703', scale: 1.08 }
  return { label: null, color: '#ffd60a', glow: '#f77f00', scale: 1 }
}

/**
 * Combo counter. Mounts on hit 2+, pops on each new hit (keyed re-animation),
 * and reads out accumulated damage. Placed on the attacker's side. Higher hit
 * counts scale up, recolour, and surface a rank word.
 */
export function ComboCounter({ combo }: Props) {
  const visible = combo != null && combo.count >= 2
  const side = combo?.side === 0 ? 'a' : 'b'
  const tier = comboTier(combo?.count ?? 0)
  // Each successive hit pops harder as the combo grows.
  const popFrom = 1.4 + Math.min(combo?.count ?? 0, 24) * 0.03

  return (
    <AnimatePresence>
      {visible && combo && (
        <motion.div
          key={`combo-${combo.side}`}
          className={`fhud-combo ${side}`}
          data-testid="fhud-combo"
          data-tier={tier.label ?? 'base'}
          initial={{ opacity: 0, x: combo.side === 0 ? -30 : 30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
        >
          <AnimatePresence mode="wait">
            {tier.label && (
              <motion.div
                key={tier.label}
                className="fhud-combo-rank"
                data-testid="fhud-combo-rank"
                style={{ color: tier.color, textShadow: `2px 2px 0 #000, 0 0 14px ${tier.glow}` }}
                initial={{ opacity: 0, y: 6, scale: 1.3 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 600, damping: 18 }}
              >
                {tier.label}
              </motion.div>
            )}
          </AnimatePresence>
          <motion.div
            className="fhud-combo-count"
            data-testid="fhud-combo-count"
            style={{
              fontSize: `${64 * tier.scale}px`,
              color: tier.color,
              textShadow: `4px 4px 0 #000, 0 0 ${18 * tier.scale}px ${tier.glow}`,
            }}
            // Re-key on each hit so the pop replays.
            key={combo.key}
            initial={{ scale: popFrom }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 700, damping: 16 }}
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
