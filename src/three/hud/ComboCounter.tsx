import { AnimatePresence, motion } from 'framer-motion'
import type { ComboState } from './types'

interface Props {
  combo: ComboState | null
}

export function ComboCounter({ combo }: Props) {
  const show = combo != null && combo.hits >= 2
  const mirror = combo?.side === 'b'
  return (
    <AnimatePresence>
      {show && combo && (
        <motion.div
          key="combo"
          className="fh-combo"
          style={{ [mirror ? 'right' : 'left']: '9%' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.85, y: -10 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        >
          <motion.span
            key={combo.id}
            className="num"
            initial={{ scale: 1.5, rotate: mirror ? 4 : -4 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 700, damping: 18 }}
          >
            {combo.hits}
          </motion.span>
          <div className="stack">
            <span className="hits">HITS</span>
            <span className="word">COMBO</span>
            {combo.damage != null && (
              <span className="word" style={{ opacity: 0.85, color: '#fff', letterSpacing: '0.15em' }}>
                {Math.round(combo.damage)} DMG
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
