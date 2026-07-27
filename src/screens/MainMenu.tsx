import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGame } from '../state/game'
import { Sfx } from '../lib/audio'
import { FIGHTERS, FEATURED_ROSTER, getFighter } from '../data/fighters'
import { SCENARIO_ORDER } from '../data/scenarios'
import { Sprite } from '../components/Sprite'
import { PULL_QUOTES } from '../data/pull-quotes'
import { AttractMode } from './AttractMode'
import { prefetchScreen } from './registry'
import type { Phase } from '../types'
import './menu/menu.css'

const prefersReduced =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function MainMenu() {
  const setPhase = useGame((s) => s.setPhase)
  const setMode = useGame((s) => s.setMode)
  const toggleMusic = useGame((s) => s.toggleMusic)
  const music = useGame((s) => s.musicEnabled)
  const toggleVoice = useGame((s) => s.toggleVoice)
  const voice = useGame((s) => s.voiceEnabled)
  const difficulty = useGame((s) => s.difficulty)
  const setDifficulty = useGame((s) => s.setDifficulty)

  // Cycle through hand-curated pull quotes every 7 seconds
  const allQuotes = useMemo(() => {
    const arr = [...PULL_QUOTES]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }, [])
  const [quoteIdx, setQuoteIdx] = useState(0)
  useEffect(() => {
    if (allQuotes.length === 0) return
    const id = setInterval(() => setQuoteIdx((i) => (i + 1) % allQuotes.length), 7000)
    return () => clearInterval(id)
  }, [allQuotes.length])

  // Featured fighters — only ones with hand-curated sprite art.
  const featured = useMemo(() => {
    const out = FEATURED_ROSTER.map((id) => getFighter(id)).filter(
      (f): f is (typeof FIGHTERS)[number] => !!f,
    )
    return out.length > 0 ? out : FIGHTERS
  }, [])

  // Rotating VS spotlight on the right — a fresh pairing every 3.4s.
  const [focusIdx, setFocusIdx] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFocusIdx((i) => (i + 1) % featured.length), 3400)
    return () => clearInterval(id)
  }, [featured.length])

  // Attract mode: defaults ON at first menu load; any explicit input drops
  // into the real menu; 10s idle on the menu re-arms the reel. (unchanged)
  const [attract, setAttract] = useState(true)
  useEffect(() => {
    if (attract) {
      function exit() {
        setAttract(false)
      }
      window.addEventListener('pointerdown', exit)
      window.addEventListener('keydown', exit)
      window.addEventListener('touchstart', exit)
      window.addEventListener('wheel', exit)
      return () => {
        window.removeEventListener('pointerdown', exit)
        window.removeEventListener('keydown', exit)
        window.removeEventListener('touchstart', exit)
        window.removeEventListener('wheel', exit)
      }
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastX = 0,
      lastY = 0
    function reset() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setAttract(true), 10_000)
    }
    function onMove(e: PointerEvent) {
      const dx = Math.abs(e.clientX - lastX)
      const dy = Math.abs(e.clientY - lastY)
      if (dx + dy > 40) {
        lastX = e.clientX
        lastY = e.clientY
        reset()
      }
    }
    reset()
    window.addEventListener('pointerdown', reset)
    window.addEventListener('keydown', reset)
    window.addEventListener('wheel', reset)
    window.addEventListener('touchstart', reset)
    window.addEventListener('pointermove', onMove)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('pointerdown', reset)
      window.removeEventListener('keydown', reset)
      window.removeEventListener('wheel', reset)
      window.removeEventListener('touchstart', reset)
      window.removeEventListener('pointermove', onMove)
    }
  }, [attract])

  // Operator of the Day — deterministic from today's date.
  const operatorOfDay = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    let h = 0
    for (let i = 0; i < today.length; i++) h = (h * 31 + today.charCodeAt(i)) >>> 0
    return featured[h % featured.length]
  }, [featured])

  // Selection state for the primary nav (mouse + keyboard unified).
  const [activeId, setActiveId] = useState('story')
  const [leaving, setLeaving] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Authored menu-out transition, then navigate.
  const leaveTo = useCallback((fn: () => void) => {
    Sfx.menuSelect()
    if (prefersReduced) {
      fn()
      return
    }
    setLeaving(true)
    window.setTimeout(fn, 320)
  }, [])

  const go = useCallback(
    (mode: 'vs' | 'arcade' | 'practice' | 'story') => {
      leaveTo(() => {
        setMode(mode)
        setPhase('character-select')
      })
    },
    [leaveTo, setMode, setPhase],
  )
  const goPhase = useCallback(
    (p: Phase) => leaveTo(() => setPhase(p)),
    [leaveTo, setPhase],
  )

  const select = useCallback((id: string) => {
    setActiveId((prev) => {
      if (prev !== id) Sfx.menuMove()
      return id
    })
  }, [])

  // Roving keyboard nav across every menu control, in visual order.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const key = e.key
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(key)) return
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-menu-item]') ?? [],
    )
    if (items.length === 0) return
    e.preventDefault()
    const cur = items.findIndex((el) => el === document.activeElement)
    const forward = key === 'ArrowDown' || key === 'ArrowRight'
    let next: number
    if (cur === -1) next = forward ? 0 : items.length - 1
    else next = (cur + (forward ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }, [])

  const currentQuote = allQuotes[quoteIdx]
  const focusFighter = featured[focusIdx % featured.length]
  const opposingFighter = featured[(focusIdx + Math.floor(featured.length / 2)) % featured.length]

  if (attract) {
    return <AttractMode onExit={() => setAttract(false)} />
  }

  const animClass = prefersReduced ? '' : 'mm-anim'

  const stats = `${FIGHTERS.length} OPERATORS · ${FIGHTERS.reduce(
    (s, f) => s + f.moves.length + 1,
    0,
  )} FRAMEWORKS · ${SCENARIO_ORDER.length} STAGES`

  return (
    <div
      ref={rootRef}
      className={`mm-root ${animClass} ${leaving ? 'mm-leaving' : ''}`}
      onKeyDown={onKeyDown}
    >
      {/* ── Background: depth-of-field hero art ── */}
      <img
        src="/menu/title-hero.png"
        alt=""
        aria-hidden
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
        className={`mm-bg-art ${animClass}`}
      />
      <div className="mm-scrim-left" />
      <div className={`mm-godray ${animClass}`} />
      <div className="mm-scrim-frame" />
      <div className="mm-scan" />

      {/* Operator of the day — top-right pill */}
      <div className="mm-otd" style={{ ['--accent' as string]: operatorOfDay.accent }}>
        <span className="mm-otd-k">☼ OP OF THE DAY</span>
        <span className="mm-otd-v">{operatorOfDay.shortName}</span>
      </div>

      <div className="mm-stage">
        {/* ── LEFT: title + nav + utility ── */}
        <div className="mm-left">
          <div>
            <div className={`mm-eyebrow ${animClass ? 'mm-title-in' : ''}`}>
              A TACTICAL FIGHTER ON LENNY&rsquo;S PODCAST
            </div>
            <h1 className={`mm-title ${animClass ? 'mm-title-in d1' : ''}`}>
              OPERATORS
              <span className="mm-title-under" />
            </h1>
            <div className={`mm-subtitle ${animClass ? 'mm-title-in d3' : ''}`}>{stats}</div>
          </div>

          {/* Primary navigation — one clear winner (STORY), then modes. */}
          <nav className="mm-nav" aria-label="Main menu">
            <PrimaryItem
              id="story"
              label="STORY MODE"
              sub="8 chapters on Lenny's Podcast · your career, one fight at a time"
              accent="#F72585"
              active={activeId === 'story'}
              onSelect={() => select('story')}
              onActivate={() => go('story')}
              onPrefetch={() => prefetchScreen('character-select')}
            />
            <SecondaryItem
              id="vs"
              label="VS MODE"
              sub="local 2-player hot seat"
              hint="2P"
              accent="#00B4D8"
              active={activeId === 'vs'}
              onSelect={() => select('vs')}
              onActivate={() => go('vs')}
              onPrefetch={() => prefetchScreen('character-select')}
            />
            <SecondaryItem
              id="marquee"
              label="MARQUEE"
              sub="curated dream matchups"
              hint="★"
              accent="#FFD60A"
              active={activeId === 'marquee'}
              onSelect={() => select('marquee')}
              onActivate={() => goPhase('marquee-matchups')}
              onPrefetch={() => prefetchScreen('marquee-matchups')}
            />
            <SecondaryItem
              id="practice"
              label="PRACTICE"
              sub="train freely, no stakes"
              hint="◇"
              accent="#FCBF49"
              active={activeId === 'practice'}
              onSelect={() => select('practice')}
              onActivate={() => go('practice')}
              onPrefetch={() => prefetchScreen('character-select')}
            />
          </nav>

          {/* Lower cluster: rotating quote + de-emphasised utilities. */}
          <div className="mm-lower">
            <div className={`mm-quote ${animClass ? 'mm-quote-in' : ''}`} key={quoteIdx}>
              {currentQuote ? (
                <span>
                  &ldquo;{currentQuote.quote}&rdquo;{' '}
                  <cite>
                    — {currentQuote.who} · {currentQuote.episode}
                  </cite>
                </span>
              ) : (
                <span style={{ opacity: 0.4 }}>…loading verbatim quotes…</span>
              )}
            </div>

            <div className="mm-util">
              <div className="mm-util-row">
                <span className="mm-util-label">LIBRARY</span>
                <Chip label="HOW TO PLAY" onClick={() => goPhase('how-to-play')} onHover={() => prefetchScreen('how-to-play')} />
                <Chip label="ENCYCLOPEDIA" onClick={() => goPhase('framework-encyclopedia')} onHover={() => prefetchScreen('framework-encyclopedia')} />
                <Chip label="QUOTE BANK" onClick={() => goPhase('quote-bank')} onHover={() => prefetchScreen('quote-bank')} />
                <Chip label="STATS" onClick={() => goPhase('stats')} onHover={() => prefetchScreen('stats')} />
              </div>
              <div className="mm-util-row">
                <span className="mm-util-label">SETTINGS</span>
                <Chip
                  toggle
                  label={
                    <>
                      DIFFICULTY ·{' '}
                      <span className="mm-toggle-on">{difficulty.toUpperCase()}</span>
                    </>
                  }
                  title="EASY: weak bots · NORMAL: random bots · HARD: scenario specialists"
                  onClick={() => {
                    Sfx.menuMove()
                    setDifficulty(
                      difficulty === 'easy' ? 'normal' : difficulty === 'normal' ? 'hard' : 'easy',
                    )
                  }}
                />
                <Chip
                  toggle
                  label={
                    <>
                      MUSIC ·{' '}
                      <span className={music ? 'mm-toggle-on' : 'mm-toggle-off'}>
                        {music ? 'ON' : 'OFF'}
                      </span>
                    </>
                  }
                  title="Toggle background music"
                  onClick={toggleMusic}
                />
                <Chip
                  toggle
                  label={
                    <>
                      VOICE ·{' '}
                      <span className={voice ? 'mm-toggle-on' : 'mm-toggle-off'}>
                        {voice ? 'ON' : 'OFF'}
                      </span>
                    </>
                  }
                  title="Toggle fighter voice lines (browser TTS)"
                  onClick={toggleVoice}
                />
                <Chip label="CREDITS" onClick={() => goPhase('credits')} onHover={() => prefetchScreen('credits')} />
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: featured VS showcase ── */}
        <div className="mm-right">
          <div className="mm-right-focus" />
          <div className="mm-showcase-tag">◇ TONIGHT&rsquo;S CARD ◇</div>
          <div className="mm-showcase-floor" />
          <div className="mm-showcase">
            <ShowcaseFighter fighter={focusFighter} side="a" anim={animClass} />
            <div className="mm-vs">VS</div>
            <ShowcaseFighter fighter={opposingFighter} side="b" anim={animClass} />
          </div>
          <div className={`mm-press ${animClass}`}>◇ CHOOSE YOUR MODE ◇</div>
        </div>
      </div>

      <div className="mm-seam" />

      <div className="mm-foot">
        v1.0 · #LENNYSBUILDATHON · OPERATORS.REPLIT.APP
      </div>
    </div>
  )
}

/* ── Nav items ──────────────────────────────────────────────────────── */

interface ItemProps {
  id: string
  label: string
  sub: string
  accent: string
  active: boolean
  onSelect: () => void
  onActivate: () => void
  onPrefetch?: () => void
}

function PrimaryItem({ label, sub, accent, active, onSelect, onActivate, onPrefetch }: ItemProps) {
  return (
    <button
      data-menu-item
      className={`mm-item mm-primary ${active ? 'mm-active' : ''}`}
      style={{ ['--accent' as string]: accent }}
      onClick={onActivate}
      onMouseEnter={() => {
        onSelect()
        onPrefetch?.()
      }}
      onFocus={() => {
        onSelect()
        onPrefetch?.()
      }}
      aria-label={`${label} — ${sub}`}
    >
      <span className="mm-caret">▶</span>
      <span className="mm-tag">START HERE</span>
      <div className="mm-item-label">♛ {label}</div>
      <div className="mm-item-sub">{sub}</div>
    </button>
  )
}

function SecondaryItem({
  label,
  sub,
  accent,
  active,
  hint,
  onSelect,
  onActivate,
  onPrefetch,
}: ItemProps & { hint?: string }) {
  return (
    <button
      data-menu-item
      className={`mm-item mm-secondary ${active ? 'mm-active' : ''}`}
      style={{ ['--accent' as string]: accent }}
      onClick={onActivate}
      onMouseEnter={() => {
        onSelect()
        onPrefetch?.()
      }}
      onFocus={() => {
        onSelect()
        onPrefetch?.()
      }}
      aria-label={`${label} — ${sub}`}
    >
      <span className="mm-caret">▶</span>
      <div className="mm-item-label">{label}</div>
      <div className="mm-item-sub">{sub}</div>
      {hint && <span className="mm-item-key">{hint}</span>}
    </button>
  )
}

function Chip({
  label,
  onClick,
  onHover,
  title,
  toggle,
}: {
  label: React.ReactNode
  onClick: () => void
  onHover?: () => void
  title?: string
  toggle?: boolean
}) {
  return (
    <button
      data-menu-item
      className={`mm-chip ${toggle ? 'mm-toggle' : ''}`}
      onClick={onClick}
      onMouseEnter={() => {
        Sfx.menuMove()
        onHover?.()
      }}
      onFocus={() => onHover?.()}
      title={title}
    >
      {label}
    </button>
  )
}

/* ── Right showcase fighter ─────────────────────────────────────────── */
function ShowcaseFighter({
  fighter,
  side,
  anim,
}: {
  fighter: (typeof FIGHTERS)[number]
  side: 'a' | 'b'
  anim: string
}) {
  return (
    <div
      key={fighter.id}
      className={`mm-fighter mm-showcase-entry ${anim}`}
      style={{
        ['--faccent' as string]: fighter.accent,
        filter: `drop-shadow(0 0 22px ${fighter.accent}AA) drop-shadow(0 10px 0 rgba(0,0,0,0.55))`,
      }}
    >
      <div className={`mm-fighter-art ${anim ? 'idle-bob' : ''}`}>
        <Sprite fighter={fighter} side={side} state="stance" />
      </div>
      <div className="mm-nameplate">
        <div className="mm-fighter-name">{fighter.shortName}</div>
        <div className="mm-fighter-arch">{fighter.archetype}</div>
      </div>
    </div>
  )
}
