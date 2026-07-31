import { AnimatePresence, motion } from 'framer-motion'
import type { HitLevel } from '../fight/types'
import { Word } from './Announcements'

export interface CounterState {
  /** Attacker side (0 = left, 1 = right). The callout leans toward them. */
  side: 0 | 1
  /** Heavy read → "PUNISH COUNTER"; light read → "COUNTER". */
  punish: boolean
  /** Bumped per counter so a second one re-pops. */
  key: number
}

interface Props {
  counter: CounterState | null
}

/**
 * Which counter-hits earn the loud "PUNISH COUNTER" read. A counter into a
 * launcher/crumple/sweep or a heavy is a full punish — the most satisfying
 * read in the game; light/medium counters get the plain "COUNTER".
 */
export function isPunish(level: HitLevel): boolean {
  return level === 'heavy' || level === 'launcher' || level === 'sweep' || level === 'crumple'
}

// Two identities, learnable at a glance (the SF6 language): a cold steel-cyan
// for a plain counter, the iconic violet-magenta for a punish counter.
const COUNTER = { color: '#8CE6FF', accent: '#0096C7' }
const PUNISH = { color: '#FF7BE5', accent: '#7B2FF7' }

/**
 * Counter-hit callout. Fires off the sim's dedicated `counter-hit` event
 * (emitted alongside the normal `hit`, so this draws without disturbing the
 * combo/impact consumers). The word *is* the graphic — no bounding plate — to
 * match the announcement house language. World-space sparks at the hit point
 * are the renderer's; this is the screen-space punctuation that names the read.
 */
export function CounterCallout({ counter }: Props) {
  const pal = counter?.punish ? PUNISH : COUNTER
  // Lean toward the attacker: the read belongs to whoever landed it.
  const lean = counter?.side === 0 ? -1 : 1

  return (
    <AnimatePresence>
      {counter && (
        <motion.div
          key={counter.key}
          className="fhud-counter"
          data-testid="fhud-counter"
          data-kind={counter.punish ? 'punish' : 'counter'}
          data-side={counter.side === 0 ? 'a' : 'b'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
        >
          {/* Radial danger tint blooming behind the word — screen-space only. */}
          <motion.div
            className="fhud-counter-bloom"
            style={{ background: `radial-gradient(60% 60% at 50% 42%, ${pal.color}40 0%, transparent 70%)` }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: [0, 0.9, 0], scale: [0.6, 1.25, 1.4] }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
          {/* Diagonal slash whipping in from the attacker's side. */}
          <motion.div
            className="fhud-counter-slash"
            style={{ background: `linear-gradient(90deg, transparent 8%, #fff 48%, ${pal.color} 52%, transparent 92%)` }}
            initial={{ x: `${lean * -120}%`, opacity: 0, scaleY: 0.3 }}
            animate={{ x: `${lean * 120}%`, opacity: [0, 1, 0], scaleY: [0.3, 1, 0.6] }}
            transition={{ duration: 0.34, ease: 'easeOut' }}
          />
          <motion.div
            className="fhud-counter-stack"
            initial={{ scale: 1.65, x: lean * 46, rotate: lean * 5, y: -4 }}
            animate={{ scale: [1.65, 0.92, 1], x: [lean * 46, 0, 0], rotate: [lean * 5, -1, 0], y: [-4, 0, 0] }}
            transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          >
            {counter.punish && (
              <Word text="PUNISH" color={pal.color} accent={pal.accent} className="fhud-counter-kicker" />
            )}
            <Word
              text="COUNTER"
              color={pal.color}
              accent={pal.accent}
              className="fhud-counter-main"
              testid="fhud-counter-main"
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
