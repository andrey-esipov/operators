import { useCallback, useEffect, useState, Suspense, lazy } from 'react'
import { useGame } from './state/game'
import { Music } from './lib/music'
import { MainMenu } from './screens/MainMenu'
import { StartScreen } from './screens/StartScreen'
import { SCREENS, prefetchScreen } from './screens/registry'
import { ScreenSkeleton } from './components/ScreenSkeleton'
import { BootCard } from './screens/boot/BootCard'
import { StoryCutscene } from './components/StoryCutscene'
import { attachQuoteBankSync, loadQuoteBank } from './lib/persist'
import { decideRoute, SELECT_SEARCH } from './appRoute'
import { musicIntentFor } from './musicDirector'

/** Renderer sandbox at `?lab=1`. Lazy so it never ships in the main chunk. */
const ThreeLab = lazy(() =>
  import('./three/dev/ThreeLab').then((m) => ({ default: m.ThreeLab })),
)

/** Real-time fight renderer harness at `?fight=1`. Lazy, dev-only. */
const FightHarness = lazy(() =>
  import('./three/dev/FightHarness').then((m) => ({ default: m.FightHarness })),
)

/** Standalone fighting-game HUD preview at `?fighthud=1`. Lazy, dev-only. */
const HudPreview = lazy(() =>
  import('./fighthud/preview/HudPreview').then((m) => ({ default: m.HudPreview })),
)

/** The real-time fighter, playable, at `?play=1`. Human on the left, CPU on
 *  the right. Unlike `?fight=1` this is the game rather than a dev harness. */
const PlayableMatch = lazy(() =>
  import('./play/PlayableMatch').then((m) => ({ default: m.PlayableMatch })),
)

/** Character + stage select at `?select=1`. The game's front door: lets a player
 *  pick a fighter and arena instead of hand-editing the query string. Lazy,
 *  since a match launched with an explicit matchup never mounts it. */
const FightSelect = lazy(() =>
  import('./fighthud/select/FightSelect').then((m) => ({ default: m.FightSelect })),
)

/** The live CPU-vs-CPU attract reel at `?attract=1`, standalone. The same
 *  component is the menu's idle reel; this route is the direct entry the perf
 *  harness drives and a way to link straight to the demo. Lazy, so the fight
 *  renderer it pulls in never weighs down the capture routes or a bare match. */
const AttractMode = lazy(() =>
  import('./screens/AttractMode').then((m) => ({ default: m.AttractMode })),
)

/** The game's front door at bare `/`: title → attract reel → select → match.
 *  Lazy so the fighter renderer the reel pulls in never weighs down the capture
 *  routes; it loads only for a real buyer landing on the default URL. */
const FrontDoor = lazy(() =>
  import('./screens/FrontDoor').then((m) => ({ default: m.FrontDoor })),
)

/**
 * Route resolution lives in {@link decideRoute} (pure, node-tested). The one
 * behavioural change from "the fighter owns `/`": a bare landing with NO match
 * signal resolves to `frontdoor` (title → attract → select) instead of dropping
 * the visitor into a live match. Anything carrying `?play=1` or an explicit
 * matchup param still resolves to `play`, so every capture tool that passes a
 * matchup — and the `?play=1` escape hatch — is unaffected.
 *
 * ENTRY is read once from the real URL; in-app NAVIGATION is route-as-state (see
 * `navigate` below): we `history.pushState` the next search and mirror it into
 * `search`, so a menu hop renders a new surface WITHOUT a full-page reload. That
 * is what lets the WebGL context, the fighter atlases and the AudioContext
 * survive title → attract → select — a reload used to destroy all three on every
 * hop. Entry stays byte-identical, so deep links and the ~dozen capture tools
 * that pass an explicit matchup are unaffected.
 */
function initialSearch() {
  return typeof window === 'undefined' ? '' : window.location.search
}

export function App() {
  const phase = useGame((s) => s.phase)
  const crtEnabled = useGame((s) => s.crtEnabled)
  const selectedB = useGame((s) => s.selectedB)
  const musicEnabled = useGame((s) => s.musicEnabled)
  const [search, setSearch] = useState(initialSearch)
  const route = decideRoute(search)

  // In-app navigation without a reload: push the next search onto history and
  // mirror it into state so `route` recomputes. The old `window.location.search
  // = …` tore down the GL context, atlases and the AudioContext on every menu
  // hop; pushState keeps one persistent document — and the running soundtrack —
  // alive across screens. The URL still changes, so deep links, capture tools
  // and Back/Forward all keep working.
  const navigate = useCallback((nextSearch: string) => {
    if (typeof window === 'undefined') return
    const next = nextSearch.startsWith('?') ? nextSearch : `?${nextSearch}`
    window.history.pushState(null, '', `${window.location.pathname}${next}`)
    setSearch(next)
  }, [])

  // Back/Forward: re-derive the surface from the URL the browser restored.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPop = () => setSearch(window.location.search)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Arcade boot gate. Shown once per page load before anything else. The
  // press is a real user gesture, so it unlocks the soundtrack — the menu's
  // Attract reel that follows finally plays with music instead of in silence.
  const [started, setStarted] = useState(false)
  const handleStart = useCallback(() => {
    // We're inside a user-gesture stack frame here, so play() resolves
    // immediately instead of getting parked by the autoplay policy.
    if (musicEnabled) Music.play('menu')
    setStarted(true)
  }, [musicEnabled])

  useEffect(() => {
    loadQuoteBank()
    const unsubscribe = attachQuoteBankSync()
    return () => unsubscribe()
  }, [])

  // Soundtrack director. The persistent shell (2cec5fb) keeps one AudioContext
  // alive across every screen, so BGM can finally be continuous instead of dying
  // on each hop. WHAT plays is decided by `musicIntentFor` (pure, node-tested):
  // it keys on `route` for the real-time fighter — so a title -> attract ->
  // select transition holds the same 'menu' intent and never restarts the track
  // — and defers to the legacy `phase` machine only for the `cards` route. The
  // idempotent `Music.play` makes re-runs cheap; only crossing into a match
  // actually changes the track (Music cross-fades that boundary).
  useEffect(() => {
    const intent = musicIntentFor(route, phase, selectedB, musicEnabled)
    if (intent.kind === 'stop') {
      Music.stop()
      return
    }
    if (intent.kind === 'hold') return
    // 'fight' is played via playFight() so consecutive matches rotate
    // fight/fight-b; every other track plays directly.
    if (intent.track === 'fight') Music.playFight()
    else Music.play(intent.track)
  }, [route, phase, selectedB, musicEnabled])

  // Anticipatory prefetch: when the user lands on a phase, warm the chunks
  // they're most likely to navigate to next. Cached imports are cheap, so
  // over-prefetching is harmless. This is what keeps the Suspense skeleton
  // from appearing on the most common navigation paths.
  useEffect(() => {
    if (phase === 'menu') {
      prefetchScreen('character-select')
      prefetchScreen('marquee-matchups')
      prefetchScreen('how-to-play')
    } else if (phase === 'character-select' || phase === 'marquee-matchups') {
      prefetchScreen('stage-select')
      prefetchScreen('pre-fight')
      prefetchScreen('fight')
    } else if (phase === 'pre-fight') {
      prefetchScreen('fight')
      prefetchScreen('round-end')
    } else if (phase === 'fight') {
      prefetchScreen('round-end')
      prefetchScreen('match-end')
    } else if (phase === 'round-end') {
      prefetchScreen('match-end')
    } else if (phase === 'match-end') {
      prefetchScreen('arcade-victory')
    }
  }, [phase])

  const ActiveScreen = phase !== 'menu' && phase in SCREENS
    ? SCREENS[phase as keyof typeof SCREENS].Component
    : null

  if (route === 'lab') {
    return (
      <Suspense fallback={<div style={{ color: '#fff', padding: 24 }}>loading lab…</div>}>
        <ThreeLab />
      </Suspense>
    )
  }

  if (route === 'fight') {
    return (
      <Suspense fallback={<div style={{ color: '#fff', padding: 24 }}>loading fight…</div>}>
        <FightHarness />
      </Suspense>
    )
  }

  if (route === 'hud') {
    return (
      <Suspense fallback={<div style={{ color: '#fff', padding: 24 }}>loading hud…</div>}>
        <HudPreview />
      </Suspense>
    )
  }

  if (route === 'select') {
    return (
      <Suspense fallback={<BootCard label="Loading roster" />}>
        <FightSelect onLaunch={navigate} />
      </Suspense>
    )
  }

  if (route === 'attract') {
    return (
      <Suspense fallback={<BootCard label="Loading attract reel" />}>
        {/* Standalone `?attract=1` is the dev/capture reel route: pass `capture`
            so the tier is frozen for reproducible grades. The buyer front door
            (FrontDoor) mounts the same reel WITHOUT `capture` — see AttractMode. */}
        <AttractMode onExit={() => navigate(SELECT_SEARCH)} capture />
      </Suspense>
    )
  }

  if (route === 'play') {
    return (
      <Suspense fallback={<BootCard label="Entering match" />}>
        <PlayableMatch />
      </Suspense>
    )
  }

  if (route === 'frontdoor') {
    // Bare `/` with no match signal: the buyer's first impression. Title →
    // attract reel → character select, then a real match. `onPlay` hands off to
    // the human select screen, which writes an explicit matchup and lands back
    // on the `play` route above.
    return (
      <Suspense fallback={<BootCard />}>
        <FrontDoor onPlay={() => navigate(SELECT_SEARCH)} />
      </Suspense>
    )
  }

  // Only `route === 'cards'` reaches here: the legacy turn-based card game's
  // phase machine (StartScreen → MainMenu → its own screens). Left exactly as it
  // was — the front door above leads to the real-time fighter, never this.
  return (
    <div className="w-full h-full" style={{ background: '#0F0A1A' }}>
      {!started ? (
        <StartScreen onStart={handleStart} />
      ) : phase === 'menu' ? (
        <MainMenu />
      ) : phase === 'story-cutscene' ? (
        <StoryCutscene />
      ) : ActiveScreen ? (
        <Suspense fallback={<ScreenSkeleton phase={phase} />}>
          <ActiveScreen />
        </Suspense>
      ) : null}
      {crtEnabled && <div className="crt-overlay" />}
    </div>
  )
}
