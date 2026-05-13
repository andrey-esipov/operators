import { AnimatePresence, motion } from 'framer-motion'
import type { Side } from '../types'

interface Props {
  pulses: Array<{ id: number; side: Side; amount: number; kind: 'normal' | 'crit' | 'heal' }>
}

export function DamageFloats({ pulses }: Props) {
  return (
    <AnimatePresence>
      {pulses.map((p) => (
        <motion.div
          key={p.id}
          initial={{ y: 0, opacity: 1 }}
          animate={{ y: -90, opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
          className="absolute font-num text-5xl tabular-nums z-20 pointer-events-none"
          style={{
            color: p.kind === 'crit' ? '#FFFFFF' : p.kind === 'heal' ? '#06D6A0' : '#FFD60A',
            textShadow: '3px 3px 0 rgba(0,0,0,0.8)',
            top: '38%',
            left: p.side === 'a' ? '22%' : '72%',
            transform: 'translateX(-50%)',
          }}
        >
          {p.kind === 'heal' ? '+' : '−'}{p.amount}
        </motion.div>
      ))}
    </AnimatePresence>
  )
}
