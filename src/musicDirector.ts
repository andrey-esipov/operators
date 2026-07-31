import type { RouteKind } from './appRoute'
import type { Phase } from './types'
import type { TrackId } from './lib/music'

/**
 * Shell music director — decides WHAT the soundtrack should be doing, as a pure
 * function of the shell's route + the legacy phase machine. No Web Audio here:
 * this only names an intent; `App` is the thin adapter that calls `Music`.
 *
 * WHY THIS EXISTS. Until the persistent shell landed (`2cec5fb`) a reload tore
 * down the AudioContext on every screen hop, so continuous BGM was impossible
 * and the only music wiring was an inline effect keyed on the *legacy card
 * game's* `phase`. The real-time fighter is driven by `route`, and its screens
 * (FrontDoor/AttractMode/FightSelect/PlayableMatch) never touch `phase` — so
 * `phase` stays `'menu'` for the entire title -> attract -> select -> match
 * flow. The consequence: fight music never played in a real match, and menu
 * music started only *incidentally* (a phase effect meant for a different game
 * happening to fire once at mount). That is the orphaned-wiring defect this
 * project keeps finding: a correct thing authored, connected to the wrong
 * driver, running by accident.
 *
 * Keying the decision on `route` makes it intentional and, critically,
 * CONTINUOUS: every front-of-house route resolves to the SAME `'menu'` intent,
 * so a title -> attract -> select transition never changes the track and the
 * idempotent `Music.play('menu')` never restarts it. Only crossing into a match
 * changes the intent (to the fight/boss track), which is the one boundary a
 * cross-fade should smooth.
 *
 * The legacy `cards` route still owns its own `phase` state machine, so for that
 * route (and only that route) the decision defers to `phase`, preserving the
 * prior behaviour exactly.
 *
 * Pure and import-free at runtime (all three imports are `import type`, erased
 * at compile) so it is node-testable with zero mocks and adds no module edge to
 * the Web Audio engine.
 */
export type MusicIntent =
  | { readonly kind: 'stop' }
  | { readonly kind: 'hold' }
  | { readonly kind: 'play'; readonly track: TrackId }

/** Phases (legacy card game) that hold the menu soundtrack. */
const MENU_PHASES: ReadonlySet<Phase> = new Set<Phase>([
  'menu',
  'character-select',
  'stage-select',
  'quote-bank',
  'how-to-play',
  'credits',
  'story-cutscene',
])

/** Phases that play the victory fanfare. */
const VICTORY_PHASES: ReadonlySet<Phase> = new Set<Phase>([
  'match-end',
  'arcade-victory',
  'story-ending',
])

/** The combat soundtrack for a given opponent: the boss theme is reserved for
 *  Lenny, everyone else gets the rotating fight track (the `'fight'` intent is
 *  what the adapter maps onto `Music.playFight()` for fight/fight-b variety). */
function combatTrack(selectedB: string | null): TrackId {
  return selectedB === 'lenny' ? 'boss' : 'fight'
}

/**
 * Each route's soundtrack ROLE. `combat` plays the fight/boss track; the
 * front-of-house routes (title/attract/select plus the dev surfaces) hold the
 * menu track; `cards` defers to the legacy phase machine below.
 *
 * This is a TOTAL map over {@link RouteKind} (`satisfies Record<RouteKind, …>`),
 * and that totality is the whole point. The first cut of this director keyed
 * combat off `route === 'play' || route === 'fight'` and returned menu for
 * everything ELSE — so a ninth route added later (a training mode, a versus
 * surface, a replay viewer) would silently inherit MENU music on what may well
 * be a match. That is a quieter cousin of the very orphan this director exists
 * to kill — "combat plays the wrong track" instead of "combat plays no track" —
 * and it would ship green, because the music IS playing and nothing type-errors.
 * As a total record, adding a RouteKind without classifying it here is a COMPILE
 * error, which forces the decision to be made rather than defaulted.
 */
type RouteMusicRole = 'combat' | 'front-of-house' | 'cards'

export const ROUTE_MUSIC = {
  frontdoor: 'front-of-house',
  attract: 'front-of-house',
  select: 'front-of-house',
  lab: 'front-of-house',
  hud: 'front-of-house',
  fight: 'combat',
  play: 'combat',
  cards: 'cards',
} as const satisfies Record<RouteKind, RouteMusicRole>

/**
 * Decide the soundtrack intent for the current shell state.
 *
 * @param route        the resolved top-level surface (from `decideRoute`)
 * @param phase        the legacy card game's phase (only consulted for `cards`)
 * @param selectedB    right-hand fighter id (selects boss vs. fight theme)
 * @param musicEnabled the user's music toggle
 */
export function musicIntentFor(
  route: RouteKind,
  phase: Phase,
  selectedB: string | null,
  musicEnabled: boolean,
): MusicIntent {
  if (!musicEnabled) return { kind: 'stop' }

  // Every route declares its soundtrack role in ROUTE_MUSIC (total over
  // RouteKind), so a route can never fall through to a default — front-of-house
  // (frontdoor/attract/select) and the dev surfaces (fight/hud/lab) hold the
  // menu track; a combat surface switches to the fight/boss track.
  const role = ROUTE_MUSIC[route]
  if (role === 'combat') return { kind: 'play', track: combatTrack(selectedB) }
  if (role === 'front-of-house') return { kind: 'play', track: 'menu' }

  // role === 'cards': the legacy card game defers to its own phase machine.
  if (MENU_PHASES.has(phase)) return { kind: 'play', track: 'menu' }
  if (phase === 'pre-fight' || phase === 'fight') {
    return { kind: 'play', track: combatTrack(selectedB) }
  }
  if (VICTORY_PHASES.has(phase)) return { kind: 'play', track: 'victory' }
  // round-end and the informational screens hold whatever is playing.
  return { kind: 'hold' }
}
