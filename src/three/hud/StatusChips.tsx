import { AnimatePresence, motion } from 'framer-motion'
import type { StatusMeta } from './statusMeta'
import { statusMeta as defaultMeta } from './statusMeta'

interface Props {
  statuses: string[]
  mirror?: boolean
  info?: (key: string) => StatusMeta
}

export function StatusChips({ statuses, mirror = false, info = defaultMeta }: Props) {
  return (
    <div className={`fh-status-row ${mirror ? 'mirror' : ''}`}>
      <AnimatePresence mode="popLayout">
        {statuses.map((key) => {
          const m = info(key)
          return (
            <motion.div
              key={key}
              layout
              className={`fh-chip ${m.kind}`}
              style={{ ['--chip' as string]: m.color }}
              initial={{ opacity: 0, y: -10, scale: 0.6 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5, y: -8 }}
              transition={{ type: 'spring', stiffness: 520, damping: 26 }}
              title={key}
            >
              <span className="icdot">{m.kind === 'buff' ? '+' : '!'}</span>
              <span className="lb">{m.label}</span>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
