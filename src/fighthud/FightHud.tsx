import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { FightState, FightEvent, Stance } from '../fight/types'
import type { FightHudFrame, FightHudHandle, FightHudProps, FighterDisplay } from './types'
import { HudTickContext, type HudTickFn } from './hudContext'
import { HealthBar } from './HealthBar'
import { SuperGauge } from './SuperGauge'
import { RoundTimer } from './RoundTimer'
import { RoundPips } from './RoundPips'
import { ComboCounter, type ComboState } from './ComboCounter'
import { Announcements, type AnnounceState } from './Announcements'
import { FlashChip, type FlashState } from './FlashChip'
import { ScreenFx, type KoFxState, type WipeState, type ImpactState } from './ScreenFx'
import './hud.css'

const EMPTY_EVENTS: FightEvent[] = []

// Heavy-hit thresholds (of MAX_HEALTH ~1000) for the impact vignette.
const IMPACT_MIN = 42
const IMPACT_STRONG = 66

// Fallback identities when the caller doesn't pass display info. Warm-left /
// cool-right mirrors the rest of the game's player-A / player-B palette.
const FALLBACK: [FighterDisplay, FighterDisplay] = [
  { name: 'PLAYER 1', accent: '#E63946' },
  { name: 'PLAYER 2', accent: '#00B4D8' },
]

const ANNOUNCE_MS: Record<AnnounceState['kind'], number> = {
  round: 1500,
  fight: 1100,
  ko: 2400,
  perfect: 2400,
  'time-over': 1900,
  win: 2200,
}

/**
 * Root fighting-game HUD. Overlays the live fight and reads only the sim's
 * `FightState` + this frame's `FightEvent[]`.
 *
 * Data flow (see hudContext for the why):
 *   - Continuous levels (health, chip trail, meter, timer) are sampled on a
 *     single shared rAF and written straight to DOM — no React re-render.
 *   - Discrete edges (combo hits, announcements, parry/tech flashes, pips) are
 *     handled synchronously in `applyFrame` off the event list, so nothing is
 *     lost between animation frames, and they set state only when they change.
 *
 * Integration (two ways, pick one):
 *   - Imperative (preferred, zero-rerender): keep a ref and call it per frame.
 *       const hud = useRef<FightHudHandle>(null)
 *       <FightHud ref={hud} fighters={[a, b]} />
 *       // in the step loop: hud.current?.push(state, events)
 *   - Controlled (simpler): <FightHud state={state} events={events} fighters={[a,b]} />
 */
export const FightHud = forwardRef<FightHudHandle, FightHudProps>(function FightHud(
  { state, events, fighters, className },
  ref,
) {
  const frameRef = useRef<FightHudFrame | null>(null)
  const ticks = useRef(new Set<HudTickFn>())

  // ── Discrete UI state (only these ever re-render) ──────────────────────
  const [wins, setWins] = useState<[number, number]>([0, 0])
  const [combo, setCombo] = useState<ComboState | null>(null)
  const [announce, setAnnounce] = useState<AnnounceState | null>(null)
  const [flash, setFlash] = useState<FlashState | null>(null)
  const [koFx, setKoFx] = useState<KoFxState | null>(null)
  const [wipe, setWipe] = useState<WipeState | null>(null)
  const [impact, setImpact] = useState<ImpactState | null>(null)

  // ── Mutable bookkeeping across frames (no re-render) ───────────────────
  const keySeq = useRef(0)
  const prevPhase = useRef<FightState['phase'] | null>(null)
  const prevStance = useRef<[Stance | null, Stance | null]>([null, null])
  const koThisRound = useRef(false)
  // Display names, kept fresh so applyFrame (a stable callback) can name the
  // match winner without re-subscribing when the fighters prop identity changes.
  const dispRef = useRef<[FighterDisplay, FighterDisplay]>(FALLBACK)
  const comboAccum = useRef<{ defender: 0 | 1; damage: number }>({ defender: 0, damage: 0 })
  const comboTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const koFxTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wipeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const impactTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pushAnnounce = useCallback((a: Omit<AnnounceState, 'key'>, hold = false) => {
    const withKey = { ...a, key: ++keySeq.current }
    setAnnounce(withKey)
    if (announceTimer.current) clearTimeout(announceTimer.current)
    // Held banners (the match-end WINS) stay until the next beat replaces them —
    // the match is over, there is nothing to reveal underneath.
    if (!hold) announceTimer.current = setTimeout(() => setAnnounce(null), ANNOUNCE_MS[a.kind])
  }, [])

  const applyFrame = useCallback(
    (s: FightState, evs: FightEvent[]) => {
      frameRef.current = { state: s, events: evs }

      // Win pips — cheap compare, set only on change.
      setWins((prev) => (prev[0] === s.wins[0] && prev[1] === s.wins[1] ? prev : [s.wins[0], s.wins[1]]))

      // ── Event-driven edges ──────────────────────────────────────────
      for (const e of evs) {
        switch (e.type) {
          case 'hit': {
            const defender = (1 - e.attacker) as 0 | 1
            const count = s.fighters[defender].comboCount
            if (count <= 1 || comboAccum.current.defender !== defender) {
              comboAccum.current = { defender, damage: e.damage }
            } else {
              comboAccum.current.damage += e.damage
            }
            setCombo({
              side: e.attacker,
              count,
              damage: comboAccum.current.damage,
              key: ++keySeq.current,
            })
            if (comboTimer.current) clearTimeout(comboTimer.current)
            comboTimer.current = setTimeout(() => setCombo(null), 1400)

            // Heavy-hit impact vignette — sell the hitstop window.
            if (e.damage >= IMPACT_MIN) {
              setImpact({ key: ++keySeq.current, strong: e.damage >= IMPACT_STRONG })
              if (impactTimer.current) clearTimeout(impactTimer.current)
              impactTimer.current = setTimeout(() => setImpact(null), 300)
            }
            break
          }
          case 'parry': {
            setFlash({ kind: 'parry', key: ++keySeq.current })
            if (flashTimer.current) clearTimeout(flashTimer.current)
            flashTimer.current = setTimeout(() => setFlash(null), 550)
            break
          }
          case 'round-start': {
            koThisRound.current = false
            // Colour bar sweeps the frame as the round title lands.
            setWipe({ key: ++keySeq.current, color: '#F72585', accent: '#7209B7' })
            if (wipeTimer.current) clearTimeout(wipeTimer.current)
            wipeTimer.current = setTimeout(() => setWipe(null), 960)
            pushAnnounce({
              kind: 'round',
              kicker: 'ROUND',
              main: String(e.round),
              color: '#F72585',
              accent: '#7209B7',
            })
            break
          }
          case 'ko': {
            koThisRound.current = true
            // Full-screen KO punctuation: flash + shockwave + slow vignette.
            setKoFx({ key: ++keySeq.current })
            if (koFxTimer.current) clearTimeout(koFxTimer.current)
            koFxTimer.current = setTimeout(() => setKoFx(null), 1600)
            const winner = (1 - e.who) as 0 | 1
            const perfect = s.fighters[winner].health >= s.fighters[winner].maxHealth
            pushAnnounce({
              kind: perfect ? 'perfect' : 'ko',
              main: 'K.O.',
              sub: perfect ? 'PERFECT' : undefined,
              color: perfect ? '#FFD60A' : '#FFD60A',
              accent: perfect ? '#E63946' : '#F77F00',
            })
            break
          }
        }
      }

      // ── Throw-tech: no dedicated event, detect the stance edge ───────
      for (let i = 0 as 0 | 1; i < 2; i = (i + 1) as 0 | 1) {
        const st = s.fighters[i].stance
        if (st === 'throw-tech' && prevStance.current[i] !== 'throw-tech') {
          setFlash({ kind: 'throw-tech', key: ++keySeq.current })
          if (flashTimer.current) clearTimeout(flashTimer.current)
          flashTimer.current = setTimeout(() => setFlash(null), 550)
        }
        prevStance.current[i] = st
      }

      // ── Phase transitions ────────────────────────────────────────────
      const prev = prevPhase.current
      if (prev !== s.phase) {
        if (prev === 'intro' && s.phase === 'fight') {
          pushAnnounce({ kind: 'fight', main: 'FIGHT!', color: '#FFD60A', accent: '#F77F00' })
        } else if (s.phase === 'round-end' && !koThisRound.current) {
          // Reached the time limit without a KO.
          pushAnnounce({ kind: 'time-over', main: 'TIME OVER', color: '#90E0EF', accent: '#0077B6' })
        } else if (s.phase === 'match-end') {
          // The KO banner has long cleared and the winner has had a beat to
          // pose; land the WINS plate on the victor. Winner is whoever holds
          // the round lead (ties break to the healthier fighter — double-KO).
          const w =
            s.wins[0] > s.wins[1]
              ? 0
              : s.wins[1] > s.wins[0]
                ? 1
                : s.fighters[0].health >= s.fighters[1].health
                  ? 0
                  : 1
          pushAnnounce(
            { kind: 'win', kicker: dispRef.current[w].name, main: 'WINS', color: '#FFE24A', accent: '#F77F00' },
            true,
          )
        }
        prevPhase.current = s.phase
      }
    },
    [pushAnnounce],
  )

  // ── Single shared rAF loop for continuous widgets ──────────────────────
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (t: number) => {
      const dt = Math.min(64, t - last)
      last = t
      const f = frameRef.current
      if (f) ticks.current.forEach((fn) => fn(f, dt))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ── Controlled-mode bridge ─────────────────────────────────────────────
  useEffect(() => {
    if (state) applyFrame(state, events ?? EMPTY_EVENTS)
  }, [state, events, applyFrame])

  // ── Imperative handle (preferred) ──────────────────────────────────────
  useImperativeHandle(ref, () => ({ push: (s, e) => applyFrame(s, e) }), [applyFrame])

  useEffect(
    () => () => {
      if (comboTimer.current) clearTimeout(comboTimer.current)
      if (announceTimer.current) clearTimeout(announceTimer.current)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      if (koFxTimer.current) clearTimeout(koFxTimer.current)
      if (wipeTimer.current) clearTimeout(wipeTimer.current)
      if (impactTimer.current) clearTimeout(impactTimer.current)
    },
    [],
  )

  const register = useCallback((fn: HudTickFn) => {
    ticks.current.add(fn)
    return () => {
      ticks.current.delete(fn)
    }
  }, [])

  const ctx = useMemo(() => ({ frameRef, register }), [register])
  const disp = fighters ?? FALLBACK
  dispRef.current = disp

  return (
    <HudTickContext.Provider value={ctx}>
      <div className={`fhud-root ${className ?? ''}`} data-testid="fhud-root">
        {/* Screen FX sit behind the readable HUD text but over the stage. */}
        <ScreenFx ko={koFx} wipe={wipe} impact={impact} />

        <div className="fhud-topbar">
          <HealthBar index={0} display={disp[0]} />
          <div className="fhud-center">
            <RoundTimer />
            <RoundPips wins={wins} />
          </div>
          <HealthBar index={1} display={disp[1]} />
        </div>

        <SuperGauge index={0} />
        <SuperGauge index={1} />

        <ComboCounter combo={combo} />
        <FlashChip flash={flash} />
        <Announcements announce={announce} />
      </div>
    </HudTickContext.Provider>
  )
})
