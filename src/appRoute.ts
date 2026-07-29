/**
 * Pure route decision for the top-level app shell.
 *
 * Split out of `App.tsx` on purpose: it takes a raw query string and returns a
 * {@link RouteKind}, with no React or DOM imports, so the reachability contract
 * — "a bare page load lands on the front door, a capture URL lands in a live
 * match" — can be gated in the node test runner. The bug this guards against is
 * structural: for a long stretch the fighter "owned `/`", so a buyer who opened
 * the game with no query string was dumped mid-fight instead of onto a title
 * screen, while every menu/attract/select screen sat unreachable behind query
 * strings nobody types. That defect is invisible to any test that only ever
 * visits `?cards=1`; the case the customer actually hits is the empty one.
 */
export type RouteKind =
  | 'lab'
  | 'fight'
  | 'hud'
  | 'select'
  | 'attract'
  | 'cards'
  | 'play'
  | 'frontdoor'

/**
 * Query keys whose mere presence means "boot straight into a live match, not
 * the front door." These are the params a matchup carries (`?a=..&b=..&stage=..`
 * etc.) plus `render`, which the smoke tool appends. Keeping the set explicit is
 * what makes the change surgical: any URL carrying one of these behaves exactly
 * as it did before, and ONLY a genuinely empty `/` becomes the front door — so
 * the ~dozen capture tools that pass an explicit matchup need no migration.
 *
 * `play` is handled separately (it is the documented `?play=1` escape hatch a
 * few tools hardcode) but lives here in spirit.
 */
export const MATCH_PARAMS = ['a', 'b', 'p1', 'p2', 'stage', 'cpu', 'render'] as const

/**
 * True when the query names an explicit match — either the `?play=1` escape
 * hatch or any matchup param. Presence-only (not `=== '1'`) for `play` so a tool
 * that hardcodes `?play=1` can never be misrouted to the front door.
 */
export function hasMatchSignal(params: URLSearchParams): boolean {
  if (params.has('play')) return true
  return MATCH_PARAMS.some((k) => params.has(k))
}

/**
 * Decide which top-level surface a query string maps to. Dev/tool routes win
 * first (unchanged precedence: lab → fight → hud → select → attract → cards),
 * then a match signal routes to the playable fighter, and a bare landing with
 * no signal at all falls through to the front door.
 */
export function decideRoute(search: string): RouteKind {
  const params = new URLSearchParams(search)
  if (params.get('lab') === '1') return 'lab'
  if (params.get('fight') === '1') return 'fight'
  if (params.get('fighthud') === '1') return 'hud'
  if (params.get('select') === '1') return 'select'
  if (params.get('attract') === '1') return 'attract'
  if (params.get('cards') === '1') return 'cards'
  if (hasMatchSignal(params)) return 'play'
  return 'frontdoor'
}

/**
 * In-app navigation targets — the pushState side of the route-as-state shell.
 *
 * {@link decideRoute} answers "what does this URL mean on entry"; these answer
 * "what URL do we push to reach a surface WITHOUT reloading." They are the exact
 * search strings the shell hands to `history.pushState`, kept here — beside
 * `decideRoute` and under the same node suite — so the round-trip that actually
 * matters is a proven invariant, not a hope:
 *
 *     decideRoute(SELECT_SEARCH)     === 'select'
 *     decideRoute(matchupSearch(m))  === 'play'
 *
 * Before the shell became route-as-state these lived as `window.location.search =
 * 'select=1'` and `window.location.assign('?a=..&b=..')` — full-page reloads that
 * threw away the WebGL context, the fighter atlases AND the AudioContext on every
 * menu hop (the "no commercial fighter reloads between screens" defect, and the
 * reason continuous BGM was impossible). Centralising them as pure builders is
 * what lets a node test prove a pushed nav lands on the intended screen; a
 * mismatch here would strand a click on a blank shell with no reload to hide it.
 */

/** Character/stage select. Both the front door and the standalone attract reel
 *  push this when the viewer chooses to leave the reel and pick a fighter. */
export const SELECT_SEARCH = '?select=1'

/** The six params a launched match carries: mirrors the {@link MATCH_PARAMS}
 *  `decideRoute` keys off and the exact keys PlayableMatch reads back off
 *  `location.search`. */
export interface MatchupSpec {
  a: string
  b: string
  p1: string
  p2: string
  stage: string
  cpu: string
}

/**
 * Build the `?a=..&b=..&p1=..&p2=..&stage=..&cpu=..` search a chosen matchup
 * launches into. URLSearchParams encodes each value, so a skin or stage id that
 * happened to contain a reserved character can't corrupt the query. Every field
 * is emitted, so `decideRoute` sees a match signal (→ `play`) and PlayableMatch
 * reads back exactly the pick the select screen made.
 */
export function matchupSearch(m: MatchupSpec): string {
  const q = new URLSearchParams({
    a: m.a,
    b: m.b,
    p1: m.p1,
    p2: m.p2,
    stage: m.stage,
    cpu: m.cpu,
  })
  return `?${q.toString()}`
}
