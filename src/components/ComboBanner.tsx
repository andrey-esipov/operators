import { AnimatePresence, motion } from 'framer-motion'

interface Props {
  title: string | null
  kind?: 'combo' | 'ult' | 'crit'
}

export function ComboBanner({ title, kind = 'combo' }: Props) {
  const color = kind === 'ult' ? '#F72585' : kind === 'crit' ? '#FFFFFF' : '#FFD60A'

  return (
    <AnimatePresence>
      {title && (
        <motion.div
          key={title}
          initial={{ x: '-120%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '120%', opacity: 0 }}
          transition={{ duration: 0.4, type: 'spring', stiffness: 200 }}
          className="absolute left-0 right-0 top-1/3 z-30 pointer-events-none"
          style={{ transform: 'skewX(-20deg)' }}
        >
          <div
            className="px-8 py-4 font-display text-2xl tracking-widest text-center"
            style={{
              background: `linear-gradient(90deg, transparent, ${color}aa, transparent)`,
              color,
              textShadow: `4px 4px 0 rgba(0,0,0,0.8), 0 0 12px ${color}`,
            }}
          >
            {title}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
