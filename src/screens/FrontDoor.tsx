import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { StartScreen } from './StartScreen'

/**
 * The live attract reel is the heavy part of the front door — it pulls in the
 * whole fight renderer. Keep it lazy so a bare `/` paints the title instantly
 * and only downloads the fighter chunk once the viewer moves past the title.
 */
const AttractMode = lazy(() =>
  import('./AttractMode').then((m) => ({ default: m.AttractMode })),
)

interface Props {
  /** Invoked when the viewer wants to play — routed to character select. */
  onPlay: () => void
}

type Beat = 'title' | 'attract'

/**
 * Idle timeout on the title before the attract reel takes over on its own, in
 * ms. A buyer who lands and just looks should still be shown live gameplay
 * rather than a card that sits forever — but not so fast the wordmark can't be
 * read. The title screen animates a stage slideshow underneath, so this is a
 * lull, not a freeze.
 */
const IDLE_TO_ATTRACT_MS = 6000

/**
 * The game's front door at bare `/`.
 *
 * For a long stretch the fighter "owned `/`", so opening the game with no query
 * string dropped the buyer straight into a live match with a keyboard legend
 * over it — a tech-demo first impression for a product whose title screen is the
 * one surface whose whole job is to sell it. Every arcade fighter since 1987
 * opens on a title and a CPU-vs-CPU demo; this wires the pieces that already
 * existed (title, attract reel, select) into that flow.
 *
 * Flow: {@link StartScreen} (PRESS START) → {@link AttractMode} (a live demo
 * fight from the real engine) → character select (`?select=1`) → the match.
 * This mirrors the card game's own StartScreen→attract pattern, but every step
 * leads to `PlayableMatch` — the real-time fighter — never the legacy card
 * battler's phase machine. Any input on the title advances to the reel; any
 * input on the reel goes to select; so the whole door is one keypress from play
 * at every step and nothing is a forced sit-through.
 */
export function FrontDoor({ onPlay }: Props) {
  const [beat, setBeat] = useState<Beat>('title')
  const goAttract = useCallback(() => setBeat('attract'), [])

  // Passive viewer: let the reel take over on its own so the showcase is seen
  // even by someone who never touches the keyboard.
  useEffect(() => {
    if (beat !== 'title') return
    const id = window.setTimeout(goAttract, IDLE_TO_ATTRACT_MS)
    return () => window.clearTimeout(id)
  }, [beat, goAttract])

  if (beat === 'title') {
    return <StartScreen onStart={goAttract} />
  }

  return (
    <Suspense fallback={<div style={{ color: '#fff', padding: 24 }}>loading attract…</div>}>
      <AttractMode onExit={onPlay} />
    </Suspense>
  )
}
