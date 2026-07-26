import { AnimatePresence, motion } from 'framer-motion'
import type { AnnounceMoment } from './types'

interface Props {
  moment: AnnounceMoment | null
}

interface Style {
  text: string
  sub?: string
  c1: string
  c2: string
  stroke: string
  size: string
  skew: number
}

function resolve(m: AnnounceMoment): Style {
  switch (m.kind) {
    case 'round':
      return {
        text: m.text ?? `ROUND ${m.round ?? 1}`,
        sub: m.sub,
        c1: '#ffffff', c2: '#c7d2ff', stroke: '#05060c',
        size: 'clamp(64px, 13vw, 220px)', skew: -8,
      }
    case 'fight':
      return {
        text: m.text ?? 'FIGHT!', sub: m.sub,
        c1: '#fff2a8', c2: '#ff8a3c', stroke: '#05060c',
        size: 'clamp(80px, 17vw, 300px)', skew: -10,
      }
    case 'ko':
      return {
        text: m.text ?? 'K.O.', sub: m.sub,
        c1: '#ffffff', c2: '#ff2e46', stroke: '#05060c',
        size: 'clamp(100px, 22vw, 400px)', skew: -8,
      }
    case 'double-ko':
      return {
        text: m.text ?? 'DOUBLE K.O.', sub: m.sub,
        c1: '#ffffff', c2: '#ff2e46', stroke: '#05060c',
        size: 'clamp(64px, 12vw, 220px)', skew: -8,
      }
    case 'perfect':
      return {
        text: m.text ?? 'PERFECT', sub: m.sub ?? 'FLAWLESS VICTORY',
        c1: '#fff6c8', c2: '#ffb020', stroke: '#3a1e00',
        size: 'clamp(70px, 14vw, 240px)', skew: -8,
      }
    case 'time-up':
      return {
        text: m.text ?? 'TIME UP', sub: m.sub,
        c1: '#ffffff', c2: '#ffd23c', stroke: '#05060c',
        size: 'clamp(64px, 12vw, 220px)', skew: -8,
      }
    case 'win':
      return {
        text: m.text ?? 'WINNER', sub: m.sub,
        c1: '#ffffff', c2: m.side === 'b' ? '#17b6ff' : '#ff4d5e', stroke: '#05060c',
        size: 'clamp(64px, 12vw, 220px)', skew: -8,
      }
  }
}

export function Announcer({ moment }: Props) {
  return (
    <AnimatePresence mode="wait">
      {moment && (
        <motion.div
          key={moment.id}
          className="fh-announce"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
        >
          <Impact m={moment} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Impact({ m }: { m: AnnounceMoment }) {
  const s = resolve(m)
  const hasBurst = m.kind === 'ko' || m.kind === 'perfect' || m.kind === 'fight' || m.kind === 'double-ko'
  return (
    <div style={{ position: 'relative', textAlign: 'center' }}>
      {/* Radial speed-line burst for heavy impact moments. */}
      {hasBurst && (
        <motion.div
          className="fh-burst"
          style={{ color: s.c2 }}
          initial={{ opacity: 0, scale: 0.2, rotate: 0 }}
          animate={{ opacity: [0, 0.5, 0.2], scale: [0.2, 1, 1.05], rotate: 8 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        />
      )}
      {/* Speed streak that flies through on impact */}
      <motion.div
        style={{
          position: 'absolute',
          top: '50%', left: '-60%', right: '-60%', height: '0.5em',
          transform: 'translateY(-50%)',
          background: `linear-gradient(90deg, transparent, ${s.c2}, transparent)`,
          filter: 'blur(6px)',
          mixBlendMode: 'screen',
        }}
        initial={{ scaleX: 0.2, opacity: 0 }}
        animate={{ scaleX: [0.2, 1.6, 1], opacity: [0, 0.9, 0] }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
      />
      <motion.div
        className="big"
        style={{
          fontSize: s.size,
          transform: `skewX(${s.skew}deg)`,
          backgroundImage: `linear-gradient(180deg, ${s.c1} 30%, ${s.c2} 100%)`,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          WebkitTextStroke: `clamp(2px, 0.4vw, 6px) ${s.stroke}`,
          paintOrder: 'stroke fill',
          filter: `drop-shadow(0 8px 0 rgba(0,0,0,0.35)) drop-shadow(0 0 32px ${s.c2}88)`,
        }}
        initial={{ scale: 2.6, opacity: 0, y: -10 }}
        animate={{
          scale: [2.6, 0.92, 1.04, 1],
          opacity: [0, 1, 1, 1],
        }}
        transition={{ duration: 0.5, times: [0, 0.45, 0.72, 1], ease: [0.16, 1, 0.3, 1] }}
      >
        {s.text}
      </motion.div>
      {s.sub && (
        <motion.div
          className="sub"
          style={{ color: s.c2 }}
          initial={{ opacity: 0, y: 12, letterSpacing: '1.2em' }}
          animate={{ opacity: 1, y: 0, letterSpacing: '0.55em' }}
          transition={{ delay: 0.28, duration: 0.4, ease: 'easeOut' }}
        >
          {s.sub}
        </motion.div>
      )}
    </div>
  )
}
