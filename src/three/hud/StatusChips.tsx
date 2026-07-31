import { AnimatePresence, motion } from 'framer-motion'
import type { StatusMeta } from './statusMeta'
import { statusMeta as defaultMeta } from './statusMeta'

interface Props {
  statuses: string[]
  mirror?: boolean
  info?: (key: string) => StatusMeta
  maxVisible?: number
}

export function StatusChips({ statuses, mirror = false, info = defaultMeta, maxVisible = 2 }: Props) {
  const visible = statuses.slice(0, maxVisible)
  const overflow = statuses.length - visible.length
  return (
    <div className={`fh-status-row ${mirror ? 'mirror' : ''}`}>
      <AnimatePresence mode="popLayout">
        {visible.map((key) => {
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
        {overflow > 0 && (
          <motion.div
            key="overflow"
            layout
            className="fh-chip more"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: 'spring', stiffness: 520, damping: 26 }}
          >
            <span className="lb">+{overflow}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
