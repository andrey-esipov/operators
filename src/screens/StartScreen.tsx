import { useEffect, useState } from 'react'
import { Sfx } from '../lib/audio'
import { FIGHTERS } from '../data/fighters'
import { SCENARIO_ORDER } from '../data/scenarios'
import './menu/menu.css'

/**
 * Arcade boot gate — the first thing the player sees on a cold load.
 *
 * Browsers block audio until a real user gesture, so the menu always
 * opened in dead silence; and every arcade cab boots to a title that
 * waits for PRESS START. Turning the required first click into a
 * deliberate "press start" makes the silence intentional and unlocks the
 * soundtrack for the Attract reel that follows.
 *
 * Press start → caller flips into the menu's Attract mode (with sound).
 */
export function StartScreen({ onStart }: { onStart: () => void }) {
  useEffect(() => {
    function onKey() {
      Sfx.menuSelect()
      onStart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStart])

  // Slow cross-fading stage slideshow behind the title, heavily graded so
  // the wordmark and prompt stay legible. Preloading the stages here also
  // warms the cache for the Attract reel that follows.
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

  const frameworks = FIGHTERS.reduce((s, f) => s + f.moves.length + 1, 0)

  return (
    <div
      onClick={handlePress}
      role="button"
      tabIndex={0}
      aria-label="Press start"
      className="ss-root"
    >
      {/* Cross-fading stage backdrop */}
      {SCENARIO_ORDER.map((id, i) => (
        <img
          key={id}
          src={`/stages/${id}.png`}
          alt=""
          aria-hidden
          decoding="async"
          className={`ss-bg ${i === stageIdx ? 'ss-bg-anim' : ''}`}
          style={{ opacity: i === stageIdx ? 0.55 : 0 }}
        />
      ))}
      <div className="ss-grade" />
      <div className="ss-scan" />
      <div className="ss-grain" />

      <div className="ss-corners" aria-hidden>
        <span /><span /><span /><span />
      </div>

      <div className="ss-content">
        <div className="ss-eyebrow">A Tactical Fighter on Lenny&rsquo;s Podcast</div>
        <h1 className="ss-logo" data-text="OPERATORS">OPERATORS</h1>
        <div className="ss-rule" />
        <div className="ss-cta ss-cta-anim">PRESS START</div>
        <div className="ss-sub">Click anywhere · or press any key</div>
      </div>

      <div className="ss-foot">
        <span className="dot">●</span> Insert Coin &nbsp;·&nbsp; {FIGHTERS.length} Operators
        &nbsp;·&nbsp; {frameworks} Frameworks &nbsp;·&nbsp; #LennysBuildathon
      </div>
    </div>
  )
}
