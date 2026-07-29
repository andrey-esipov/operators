/**
 * Attract-reel measurement instrument.
 *
 * The reel is the first moving image a buyer sees, so "is it worth watching?"
 * has to be a number, not a vibe. This module is the pure, headless answer: it
 * drives an {@link AttractDirector} exactly the way the React shell does — one
 * `step()` per rendered frame, `rotate()` on a cut — and classifies every
 * *rendered* frame as contact (the good part: a hit is landing, someone is in
 * hitstun, a super is freezing the world) or neutral (walking, spacing, whiff
 * startup, the victory pose). It also counts the highlights a viewer actually
 * sees — supers and KOs per bout — because contact *quantity* and contact
 * *quality* are different questions and the reel can be dense with jabs while
 * showing no supers.
 *
 * Measuring rendered frames (director `step()` calls), not sim frames, is the
 * load-bearing choice: it stays honest if the director ever time-compresses
 * neutral, because what it reports is what ends up on screen.
 *
 * `frameIsContact` is deliberately CONSERVATIVE — it counts a frame as contact
 * only on hard sim truth (hitstop, super-freeze, a contact event, or a
 * being-hit stance), never on attack startup or wake-up. So the contact
 * fraction it reports is a floor, not a flattering ceiling.
 */

import type { AttractDirector } from './attractDirector'
import type { FightEvent, FightState, Stance } from '../../fight/types'

/**
 * Events that mean something landed (or was defended in a real exchange). A
 * `whiff` is not here — a move that hit nothing is neutral spacing, not
 * contact — and a bare `block` is covered by the blockstun stance below, so a
 * blockstring reads as the exchange it is.
 */
const CONTACT_EVENTS: ReadonlySet<FightEvent['type']> = new Set([
  'hit',
  'counter-hit',
  'throw',
  'launch',
  'wall-bounce',
  'ko',
  'super-flash',
  'parry',
])

/** Stances that mean a fighter is inside an exchange (being hit or holding a
 *  block), as opposed to moving or winding up. Wake-up is intentionally absent:
 *  getting up is recovery, and counting it would inflate the contact number. */
const IN_EXCHANGE_STANCES: ReadonlySet<Stance> = new Set<Stance>([
  'hitstun',
  'blockstun',
  'juggle',
  'knockdown',
])

/**
 * Is this rendered frame contact (action) rather than neutral? Pure function of
 * sim truth for the frame plus the events it emitted, so it can never disagree
 * with what the renderer draws.
 */
export function frameIsContact(state: FightState, events: readonly FightEvent[]): boolean {
  if (state.hitstop > 0) return true
  if ((state.superFreeze ?? 0) > 0) return true
  for (const e of events) if (CONTACT_EVENTS.has(e.type)) return true
  for (const f of state.fighters) if (IN_EXCHANGE_STANCES.has(f.stance)) return true
  return false
}

export interface ReelMetrics {
  /** On-screen frames measured — one per director `step()` call. */
  renderedFrames: number
  /** Rendered frames classified as contact. */
  contactFrames: number
  /** contactFrames / renderedFrames — the headline "is it worth watching" number. */
  contactFraction: number
  /** Longest unbroken run of neutral rendered frames — the worst dead-air the
   *  viewer sits through in one stretch. */
  longestNeutralRun: number
  /** Distinct bouts observed across the window (>= 1). */
  bouts: number
  /** Total KO events seen. */
  kos: number
  /** Total super-flash events seen. */
  supers: number
  /** Bouts in which at least one super fired. */
  boutsWithSuper: number
  /** supers / bouts. */
  supersPerBout: number
  /** boutsWithSuper / bouts — the "does a super show every bout" number. */
  boutsWithSuperFraction: number
  /** kos / bouts. */
  kosPerBout: number
  /** Sim frames advanced (`dir.stepsTaken` delta) — the vacuity proof that a
   *  real sim ran rather than a frozen mount. */
  simFramesAdvanced: number
}

/**
 * Drive `dir` for `renderBudget` rendered frames and return what a viewer would
 * see. Mirrors the shell's loop: step once per frame, and when the director
 * asks to cut, rotate to the next bout (closing the current bout's highlight
 * tally). A partial final bout still counts — it is screen time too.
 */
export function measureReel(dir: AttractDirector, renderBudget: number): ReelMetrics {
  let contactFrames = 0
  let longestNeutralRun = 0
  let currentNeutralRun = 0
  let kos = 0
  let supers = 0

  const perBoutSupers: number[] = []
  const perBoutKos: number[] = []
  let curBoutSupers = 0
  let curBoutKos = 0

  const stepsBefore = dir.stepsTaken

  for (let i = 0; i < renderBudget; i++) {
    const res = dir.step()

    if (frameIsContact(res.state, res.events)) {
      contactFrames++
      currentNeutralRun = 0
    } else {
      currentNeutralRun++
      if (currentNeutralRun > longestNeutralRun) longestNeutralRun = currentNeutralRun
    }

    for (const e of res.events) {
      if (e.type === 'ko') {
        kos++
        curBoutKos++
      } else if (e.type === 'super-flash') {
        supers++
        curBoutSupers++
      }
    }

    if (dir.wantsRotate) {
      perBoutSupers.push(curBoutSupers)
      perBoutKos.push(curBoutKos)
      curBoutSupers = 0
      curBoutKos = 0
      dir.rotate()
    }
  }
  // Close the final, possibly-partial bout.
  perBoutSupers.push(curBoutSupers)
  perBoutKos.push(curBoutKos)

  const bouts = perBoutSupers.length
  const boutsWithSuper = perBoutSupers.filter((n) => n > 0).length

  return {
    renderedFrames: renderBudget,
    contactFrames,
    contactFraction: renderBudget > 0 ? contactFrames / renderBudget : 0,
    longestNeutralRun,
    bouts,
    kos,
    supers,
    boutsWithSuper,
    supersPerBout: bouts > 0 ? supers / bouts : 0,
    boutsWithSuperFraction: bouts > 0 ? boutsWithSuper / bouts : 0,
    kosPerBout: bouts > 0 ? kos / bouts : 0,
    simFramesAdvanced: dir.stepsTaken - stepsBefore,
  }
}
