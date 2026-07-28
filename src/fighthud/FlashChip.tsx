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

/** Brief centred chip for defensive reads — parry and throw-tech. */
export function FlashChip({ flash }: Props) {
  return (
    <AnimatePresence>
      {flash && (
        <motion.div
          key={flash.key}
          className="fhud-flash"
          data-testid="fhud-flash"
          data-kind={flash.kind}
          initial={{ opacity: 0, scale: 1.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
          transition={{ type: 'spring', stiffness: 600, damping: 16 }}
          style={{
            color: STYLE[flash.kind].color,
            background: `linear-gradient(135deg, ${STYLE[flash.kind].accent}, #0f0a1a)`,
            boxShadow: `5px 5px 0 rgba(0,0,0,0.6), 0 0 22px ${STYLE[flash.kind].color}aa`,
          }}
        >
          {STYLE[flash.kind].label}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
