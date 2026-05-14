import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Announcer } from '../lib/announcer'

interface Props {
  title: string | null
  kind?: 'combo' | 'ult' | 'crit'
}

/**
 * Full-screen cinematic combo banner — SF II-grade impact.
 *
 * Layered effect:
 *   1. Diagonal speed-line streak across the screen (background flash)
 *   2. Skewed gold/magenta plate behind the text
 *   3. Comic-book "COMBO!" pre-text in smaller font above the title
 *   4. The combo title itself, oversized + heavy stroke + drop shadow
 *
 * Holds for ~1.6s (banner timeout in CombatScreen is 2.4s; we exit
 * before then so the screen clears for combat to resume).
 */
export function ComboBanner({ title, kind = 'combo' }: Props) {
  const color = kind === 'ult' ? '#F72585' : kind === 'crit' ? '#FFFFFF' : '#FFD60A'
  const accent = kind === 'ult' ? '#7209B7' : kind === 'crit' ? '#E63946' : '#F77F00'
  const label = kind === 'ult' ? '⚡ ULTIMATE' : kind === 'crit' ? '✦ CRITICAL' : '◇ COMBO'

  // Pair the visual banner with an announcer voice cue
  useEffect(() => {
    if (!title) return
    if (kind === 'ult') Announcer.ultimate()
    else if (kind === 'crit') Announcer.crit()
    else Announcer.combo()
  }, [title, kind])

  return (
    <AnimatePresence>
      {title && (
        <motion.div
          key={title}
          className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Speed-line background flash */}
          <motion.div
            className="absolute inset-0"
            initial={{ x: '-100%', opacity: 0 }}
            animate={{ x: '100%', opacity: [0, 0.6, 0] }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            style={{
              background: `linear-gradient(90deg, transparent 30%, ${color}88 50%, transparent 70%)`,
              mixBlendMode: 'screen',
            }}
          />

          {/* Diagonal speed-stripes */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `repeating-linear-gradient(
                -25deg,
                transparent 0 30px,
                ${color}22 30px 35px,
                transparent 35px 60px
              )`,
              opacity: 0.5,
              mixBlendMode: 'screen',
            }}
          />

          {/* Banner plate — skewed parallelogram */}
          <motion.div
            className="relative"
            initial={{ scale: 0.6, rotate: -8, opacity: 0 }}
            animate={{
              scale: [0.6, 1.12, 1.0],
              rotate: [-8, 2, 0],
              opacity: [0, 1, 1, 1, 0],
            }}
            transition={{
              duration: 1.6,
              times: [0, 0.15, 0.3, 0.8, 1],
              ease: 'easeOut',
            }}
          >
            {/* Plate fill */}
            <div
              className="px-10 py-5"
              style={{
                background: `linear-gradient(135deg, ${accent} 0%, ${color} 50%, ${accent} 100%)`,
                border: `4px solid black`,
                boxShadow: `
                  10px 10px 0 rgba(0,0,0,0.75),
                  0 0 36px ${color}AA,
                  inset -3px -3px 0 rgba(0,0,0,0.4),
                  inset 3px 3px 0 rgba(255,255,255,0.3)
                `,
                transform: 'skewX(-10deg)',
              }}
            >
              <div style={{ transform: 'skewX(10deg)' }}>
                {/* Kind label */}
                <div
                  className="font-display text-center"
                  style={{
                    color: 'black',
                    fontSize: 14,
                    letterSpacing: '0.4em',
                    textShadow: '2px 2px 0 rgba(255,255,255,0.4)',
                    marginBottom: 6,
                  }}
                >
                  {label}
                </div>
                {/* Title */}
                <div
                  className="font-display text-center"
                  style={{
                    color: 'white',
                    fontSize: 28,
                    letterSpacing: '0.18em',
                    textShadow: '4px 4px 0 black, 0 0 14px black',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {title}
                </div>
              </div>
            </div>

            {/* Echo/glow ring */}
            <motion.div
              className="absolute inset-0"
              initial={{ scale: 1, opacity: 0.8 }}
              animate={{ scale: 1.4, opacity: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              style={{
                border: `4px solid ${color}`,
                pointerEvents: 'none',
                transform: 'skewX(-10deg)',
                boxShadow: `0 0 24px ${color}`,
              }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
