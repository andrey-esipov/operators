import { AnimatePresence, motion } from 'framer-motion'

export interface KoFxState {
  key: number
}
export interface WipeState {
  key: number
  color: string
  accent: string
}
export interface ImpactState {
  key: number
  strong: boolean
}

interface Props {
  ko: KoFxState | null
  wipe: WipeState | null
  impact: ImpactState | null
}

/**
 * Screen-space fight juice, owned by the HUD layer (world-space hitsparks,
 * sprite flashes and camera shake belong to the renderer — see report).
 *
 *   - KO: a white flash, an expanding shockwave ring, and a slow dark vignette
 *     that grips the screen for a beat — the "everything stops" KO moment.
 *   - Round wipe: a skewed colour bar that sweeps the frame on round start.
 *   - Impact: a brief edge vignette on heavy hits, selling the hitstop window
 *     that is otherwise dead air on the HUD side.
 *
 * All are one-shot: keyed remounts replay the animation, and the FightHud root
 * clears each back to null after its lifetime so it can fire again.
 */
export function ScreenFx({ ko, wipe, impact }: Props) {
  return (
    <>
      <AnimatePresence>
        {ko && (
          <motion.div
            key={ko.key}
            className="fhud-fx-ko"
            data-testid="fhud-fx-ko"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
          >
            <motion.div
              className="fhud-fx-flash"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.8, 0] }}
              transition={{ duration: 0.32, times: [0, 0.05, 1], ease: 'easeOut' }}
            />
            <motion.div
              className="fhud-fx-shock"
              initial={{ scale: 0, opacity: 0.85 }}
              animate={{ scale: 6.5, opacity: 0 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            />
            <motion.div
              className="fhud-fx-vignette"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.82, 0.42, 0] }}
              transition={{ duration: 1.1, times: [0, 0.1, 0.5, 1], ease: 'easeOut' }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {wipe && (
          <motion.div
            key={wipe.key}
            className="fhud-fx-wipe"
            data-testid="fhud-fx-wipe"
            style={{
              skewX: -12,
              background: `linear-gradient(100deg, transparent 26%, ${wipe.color}ee 44%, #ffffffdd 50%, ${wipe.accent}ee 56%, transparent 74%)`,
            }}
            initial={{ x: '-130%' }}
            animate={{ x: '130%' }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {impact && (
          <motion.div
            key={impact.key}
            className="fhud-fx-impact"
            data-testid="fhud-fx-impact"
            data-strong={impact.strong ? '1' : '0'}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, impact.strong ? 0.55 : 0.32, 0] }}
            transition={{ duration: impact.strong ? 0.26 : 0.18, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
