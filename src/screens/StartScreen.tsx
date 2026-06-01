import { useEffect, useState } from 'react'
import { Logo } from '../components/Logo'
import { Sfx } from '../lib/audio'
import { SCENARIO_ORDER } from '../data/scenarios'

/**
 * Arcade boot gate — the first thing the player sees on a cold load.
 *
 * It exists for two reasons that happen to be the same reason. (1) Browsers
 * block audio until a real user gesture, so the menu always opened in dead
 * silence; (2) SF II (and every cab in the arcade) boots to a title screen
 * that waits for you to PRESS START. Turning the required first click into a
 * deliberate "press start" makes the silence intentional, and the press
 * unlocks the soundtrack so the Attract reel that follows finally has music.
 *
 * Press start → caller flips into the menu's Attract mode (with sound). The
 * next input there drops the player into the real menu, exactly as before.
 */
export function StartScreen({ onStart }: { onStart: () => void }) {
  // Any key also starts — matches the click/tap affordance on the container.
  useEffect(() => {
    function onKey() {
      Sfx.menuSelect()
      onStart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStart])

  // Slowly cycle the fight stages behind the title, heavily faded so the
  // prompt stays legible. Cross-fade by stacking all stages and toggling
  // opacity — they're reused by the Attract reel right after, so loading
  // them here also warms the cache.
  const [stageIdx, setStageIdx] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setStageIdx((i) => (i + 1) % SCENARIO_ORDER.length)
    }, 5000)
    return () => clearInterval(id)
  }, [])

  function handlePress() {
    Sfx.menuSelect()
    onStart()
  }

  return (
    <div
      onClick={handlePress}
      role="button"
      tabIndex={0}
      aria-label="Press start"
      className="fixed inset-0 flex flex-col items-center justify-center cursor-pointer select-none overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at center, #1A1230 0%, #0F0A1A 70%)' }}
    >
      {/* Faded cross-fading stage slideshow */}
      {SCENARIO_ORDER.map((id, i) => (
        <img
          key={id}
          src={`/stages/${id}.png`}
          alt=""
          aria-hidden
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{
            opacity: i === stageIdx ? 0.22 : 0,
            transition: 'opacity 1.8s ease-in-out',
            filter: 'blur(2px) saturate(0.9)',
          }}
        />
      ))}
      {/* Darken + vignette so the title and prompt stay readable over any stage */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(15,10,26,0.55) 0%, rgba(15,10,26,0.85) 70%, rgba(15,10,26,0.95) 100%)',
        }}
      />

      {/* ── Foreground content ── */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Title wordmark with a slow breathing glow. The arbitrary variant
            forces the SVG to scale to the container width so it never
            overflows on narrow / short viewports. */}
        <div className="start-title-glow w-full max-w-[960px] px-6 [&>svg]:w-full [&>svg]:h-auto">
          <Logo size={1.4} />
        </div>

        {/* The marquee prompt — large, pulsating call-to-action */}
        <div
          className="press-start-pulse"
          style={{
            marginTop: 96,
            fontFamily: 'Press Start 2P, monospace',
            fontSize: 64,
            letterSpacing: 5,
            color: '#FFD60A',
          }}
        >
          PRESS START
        </div>

        <div
          className="mt-8"
          style={{
            fontFamily: 'Press Start 2P, monospace',
            fontSize: 15,
            letterSpacing: 2,
            color: '#9D7BD8',
          }}
        >
          CLICK ANYWHERE · OR PRESS ANY KEY
        </div>
      </div>

      {/* Arcade footer strip */}
      <div
        className="absolute bottom-7 left-0 right-0 text-center z-10"
        style={{
          fontFamily: 'Press Start 2P, monospace',
          fontSize: 12,
          letterSpacing: 2,
          color: '#7B68A6',
        }}
      >
        INSERT COIN · 64 OPERATORS · 320 FRAMEWORKS · #LENNYSBUILDATHON
      </div>
    </div>
  )
}
