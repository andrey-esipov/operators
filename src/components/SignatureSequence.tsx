import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getFighter } from '../data/fighters'
import type { Side } from '../types'

interface Props {
  attackerSide: Side
  defenderSide: Side
  tagline: string
  fighterId: string
  ko: boolean
  id: number
}

/**
 * SIGNATURE SEQUENCE — the climactic 4-second overlay when an ult lands on
 * a shattered defender. The buildathon money shot.
 *
 * Beat sheet:
 *   0.0s — wash desaturates, attacker accent rim-lights from screen edge
 *   0.3s — "SIGNATURE" pre-title slides in
 *   0.6s — tagline drops in giant Press Start 2P
 *   1.2s — echo-hit flash #1 (yellow burst)
 *   1.8s — echo-hit flash #2 (magenta burst)
 *   2.4s — echo-hit flash #3 (white shockwave)
 *   3.0s — fighter shortname + "·" + episode chip
 *   3.5s — slow fade-out
 *
 * Pure visuals — no game-state mutation. game.ts owns the state advance
 * after the cinematic ends.
 */
export function SignatureSequence({ attackerSide, defenderSide, tagline, fighterId, ko, id }: Props) {
  const def = getFighter(fighterId)
  const accent = def?.accent ?? '#F72585'

  // Echo-hit timing — set state for sparkle bursts at progressive intervals.
  const [echoes, setEchoes] = useState<number>(0)
  useEffect(() => {
    const t1 = setTimeout(() => setEchoes(1), 1200)
    const t2 = setTimeout(() => setEchoes(2), 1800)
    const t3 = setTimeout(() => setEchoes(3), 2400)
    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3)
    }
  }, [id])

  // Echo origin is the defender's chest (mirrors HitSparks placement).
  const echoCx = defenderSide === 'a' ? 22 : 78

  return (
    <motion.div
      key={id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-50 pointer-events-none overflow-hidden"
    >
      {/* Black wash with attacker-side rim-light */}
      <div
        className="absolute inset-0"
        style={{
          background: attackerSide === 'a'
            ? `linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.85) 100%)`
            : `linear-gradient(270deg, transparent 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.85) 100%)`,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: attackerSide === 'a'
            ? `radial-gradient(circle at 0% 50%, ${accent}33 0%, transparent 40%)`
            : `radial-gradient(circle at 100% 50%, ${accent}33 0%, transparent 40%)`,
        }}
      />

      {/* CRT scanlines for arcade feel */}
      <div
        className="absolute inset-0 opacity-20 mix-blend-overlay"
        style={{
          background: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.1) 0px, rgba(255,255,255,0.1) 1px, transparent 2px, transparent 3px)',
        }}
      />

      {/* "SIGNATURE" pre-title */}
      <motion.div
        initial={{ x: attackerSide === 'a' ? -80 : 80, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.35, ease: 'easeOut' }}
        className="absolute"
        style={{
          top: '32%',
          [attackerSide === 'a' ? 'left' : 'right']: '12%',
          fontSize: 14,
          letterSpacing: '0.4em',
          color: accent,
          textShadow: `2px 2px 0 black, 0 0 12px ${accent}`,
          fontFamily: 'var(--font-display, "Press Start 2P")',
        }}
      >
        ★ SIGNATURE ★
      </motion.div>

      {/* Main tagline */}
      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.55, type: 'spring', damping: 14, stiffness: 220 }}
        className="absolute left-0 right-0 text-center"
        style={{
          top: '40%',
          fontFamily: 'var(--font-display, "Press Start 2P")',
          fontSize: tagline.length > 28 ? 30 : 44,
          letterSpacing: '0.12em',
          color: '#FFFFFF',
          textShadow: `5px 5px 0 black, 0 0 28px ${accent}, 0 0 56px ${accent}`,
          transform: 'skewX(-5deg)',
          padding: '0 6%',
          lineHeight: 1.1,
        }}
      >
        {tagline}
      </motion.div>

      {/* Operator credit */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 3.0, duration: 0.3 }}
        className="absolute left-0 right-0 text-center"
        style={{
          top: '60%',
          fontFamily: 'var(--font-display, "Press Start 2P")',
          fontSize: 12,
          letterSpacing: '0.4em',
          color: accent,
          textShadow: '2px 2px 0 black',
        }}
      >
        — {def?.shortName ?? '???'} · {def?.episode ?? ''}
      </motion.div>

      {/* K.O. tag if this was lethal */}
      {ko && (
        <motion.div
          initial={{ scale: 1.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 3.4, duration: 0.3 }}
          className="absolute left-0 right-0 text-center"
          style={{
            top: '70%',
            fontFamily: 'var(--font-display, "Press Start 2P")',
            fontSize: 28,
            letterSpacing: '0.3em',
            color: '#E63946',
            textShadow: '4px 4px 0 black, 0 0 24px #E63946',
          }}
        >
          ☠ K.O.
        </motion.div>
      )}

      {/* Echo-hit bursts (SVG sparkles at the defender's body) */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
        <AnimatePresence>
          {echoes >= 1 && <EchoBurst key="e1" cx={echoCx} cy={48} color="#FFD60A" />}
          {echoes >= 2 && <EchoBurst key="e2" cx={echoCx} cy={52} color="#F72585" />}
          {echoes >= 3 && <EchoBurst key="e3" cx={echoCx} cy={50} color="#FFFFFF" big />}
        </AnimatePresence>
      </svg>
    </motion.div>
  )
}

function EchoBurst({ cx, cy, color, big }: { cx: number; cy: number; color: string; big?: boolean }) {
  const r0 = big ? 6 : 4
  return (
    <>
      <circle cx={cx} cy={cy} r={r0} fill="none" stroke={color} strokeWidth={big ? 1.2 : 0.8}
        style={{ animation: `sigRing 0.6s ease-out forwards`, filter: `drop-shadow(0 0 6px ${color})` }}
      />
      {Array.from({ length: big ? 24 : 14 }).map((_, i) => {
        const angle = (i / (big ? 24 : 14)) * Math.PI * 2
        const speed = big ? 30 : 22
        const dx = Math.cos(angle) * speed
        const dy = Math.sin(angle) * speed
        const size = big ? 1.4 : 1.0
        return (
          <rect
            key={i}
            x={cx - size / 2}
            y={cy - size / 2}
            width={size}
            height={size}
            fill={color}
            style={{
              animation: `sigParticle 0.7s ease-out forwards`,
              filter: `drop-shadow(0 0 ${size * 2}px ${color})`,
              ['--dx' as unknown as string]: `${dx}`,
              ['--dy' as unknown as string]: `${dy}`,
            }}
          />
        )
      })}
      <style>{`
        @keyframes sigParticle {
          0%   { transform: translate(0, 0); opacity: 1 }
          100% { transform: translate(calc(var(--dx) * 1%), calc(var(--dy) * 1%)); opacity: 0 }
        }
        @keyframes sigRing {
          0%   { r: ${r0}; opacity: 1 }
          100% { r: 30; opacity: 0; stroke-width: 0.2 }
        }
      `}</style>
    </>
  )
}
