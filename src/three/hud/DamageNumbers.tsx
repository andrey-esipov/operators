import { AnimatePresence, motion } from 'framer-motion'
import type { DamageNumber } from './types'

interface Props {
  numbers: DamageNumber[]
}

const FLAVOR: Record<string, { size: number; c1: string; c2: string }> = {
  light: { size: 44, c1: '#ffffff', c2: '#c9d4ff' },
  heavy: { size: 62, c1: '#ffe14a', c2: '#ff9e2c' },
  crit: { size: 82, c1: '#ffffff', c2: '#ff5a4a' },
  combo: { size: 64, c1: '#fff2a8', c2: '#ffb020' },
  ex: { size: 64, c1: '#8affff', c2: '#17b6ff' },
  ult: { size: 88, c1: '#ffd6ff', c2: '#ff2fae' },
  signature: { size: 96, c1: '#ffffff', c2: '#ff2fae' },
}

export function DamageNumbers({ numbers }: Props) {
  return (
    <AnimatePresence>
      {numbers.map((n) => {
        const f = FLAVOR[n.flavor ?? 'heavy'] ?? FLAVOR.heavy
        const x = (n.x ?? (n.side === 'a' ? 0.3 : 0.7)) * 100
        const y = (n.y ?? 0.42) * 100
        const drift = n.side === 'a' ? -34 : 34
        const isCrit = n.flavor === 'crit' || n.flavor === 'ult' || n.flavor === 'signature'
        return (
          <motion.div
            key={n.id}
            className="fh-dmg"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              fontSize: f.size,
            }}
            initial={{ opacity: 0, scale: 0.25, y: 12 }}
            animate={{
              opacity: [0, 1, 1, 0],
              scale: [0.25, 1.42, 1, 0.95],
              y: [12, -32, -48, -74],
              x: [0, drift * 0.4, drift * 0.8, drift],
              rotate: n.side === 'a' ? [-9, -4, 0, 2] : [9, 4, 0, -2],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, times: [0, 0.16, 0.55, 1], ease: 'easeOut' }}
          >
            <span
              className="v"
              style={{
                backgroundImage: `linear-gradient(180deg, ${f.c1}, ${f.c2})`,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
                filter: `drop-shadow(0 5px 3px rgba(0,0,0,0.6)) drop-shadow(0 0 18px ${f.c2}aa)`,
              }}
            >
              {n.value}
            </span>
            {isCrit && (
              <span
                style={{
                  display: 'block',
                  fontFamily: 'var(--hud-tech)',
                  fontStyle: 'normal',
                  fontWeight: 700,
                  fontSize: f.size * 0.24,
                  letterSpacing: '0.3em',
                  textAlign: 'center',
                  color: f.c1,
                  marginTop: -4,
                  WebkitTextStroke: '1.5px var(--ink)',
                  paintOrder: 'stroke fill',
                }}
              >
                {n.flavor === 'ult' || n.flavor === 'signature' ? 'SUPER' : 'CRITICAL'}
              </span>
            )}
          </motion.div>
        )
      })}
    </AnimatePresence>
  )
}
