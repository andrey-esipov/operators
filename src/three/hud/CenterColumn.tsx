import { motion } from 'framer-motion'

interface Props {
  timeLeft: number
  round: number
  roundsWon: { a: number; b: number }
  roundsToWin: number
  accentA: string
  accentB: string
}

export function CenterColumn({ timeLeft, round, roundsWon, roundsToWin, accentA, accentB }: Props) {
  const t = Math.max(0, Math.ceil(timeLeft))
  const low = t <= 10
  const pips = Math.max(1, roundsToWin)

  return (
    <div
      className="fh-center"
      style={{ ['--acc-a' as string]: accentA, ['--acc-b' as string]: accentB }}
    >
      <div className="fh-timer-plate">
        <div className="fh-round-label">ROUND {round}</div>
        <motion.div
          key={t}
          className={`fh-timer ${low ? 'low' : ''}`}
          initial={{ scale: 1.16, opacity: 0.5 }}
          animate={
            low
              ? { scale: [1, 1.12, 1], opacity: 1 }
              : { scale: 1, opacity: 1 }
          }
          transition={
            low
              ? { duration: 0.85, repeat: Infinity, ease: 'easeInOut' }
              : { type: 'spring', stiffness: 500, damping: 30 }
          }
        >
          {String(t).padStart(2, '0')}
        </motion.div>
      </div>
      <div className="fh-pips">
        <div className="fh-pipset">
          {Array.from({ length: pips }, (_, i) => (
            <div key={i} className={`fh-pip a ${roundsWon.a > i ? 'won' : ''}`} />
          ))}
        </div>
        <div className="fh-pipset">
          {Array.from({ length: pips }, (_, i) => (
            <div key={i} className={`fh-pip b ${roundsWon.b > i ? 'won' : ''}`} />
          ))}
        </div>
      </div>
    </div>
  )
}
