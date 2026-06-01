import { useEffect } from 'react'
import { Logo } from '../components/Logo'
import { Sfx } from '../lib/audio'

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
      {/* Title wordmark with a slow breathing glow. The arbitrary variant
          forces the SVG to scale to the container width so it never
          overflows on narrow / short viewports. */}
      <div className="start-title-glow w-full max-w-[700px] px-6 [&>svg]:w-full [&>svg]:h-auto">
        <Logo size={1.1} />
      </div>

      {/* The marquee prompt — large, pulsating call-to-action */}
      <div
        className="press-start-pulse"
        style={{
          marginTop: 80,
          fontFamily: 'Press Start 2P, monospace',
          fontSize: 48,
          letterSpacing: 4,
          color: '#FFD60A',
        }}
      >
        PRESS START
      </div>

      <div
        className="mt-6"
        style={{
          fontFamily: 'Press Start 2P, monospace',
          fontSize: 11,
          letterSpacing: 2,
          color: '#7B68A6',
        }}
      >
        CLICK ANYWHERE · OR PRESS ANY KEY
      </div>

      {/* Arcade footer strip */}
      <div
        className="absolute bottom-6 left-0 right-0 text-center"
        style={{
          fontFamily: 'Press Start 2P, monospace',
          fontSize: 9,
          letterSpacing: 2,
          color: '#6B5A94',
        }}
      >
        INSERT COIN · 64 OPERATORS · 320 FRAMEWORKS · #LENNYSBUILDATHON
      </div>
    </div>
  )
}
