import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useGame } from '../state/game'
import { Sfx } from '../lib/audio'
import { FIGHTERS, FEATURED_ROSTER, getFighter } from '../data/fighters'
import { Sprite } from '../components/Sprite'
import { AttractMode } from './AttractMode'
import { prefetchScreen } from './registry'
import type { Phase } from '../types'
import './menu/menu.css'

const prefersReduced =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

type ModeAct = 'story' | 'vs' | 'practice' | 'marquee'

interface ModeDef {
  id: string
  index: string
  label: string
  sub: string
  tag: string
  accent: string
  act: ModeAct
  prefetch: Parameters<typeof prefetchScreen>[0]
  primary?: boolean
}

const MODES: ModeDef[] = [
  {
    id: 'story',
    index: '01',
    label: 'STORY MODE',
    sub: "8 chapters on Lenny's Podcast — your career, one fight at a time",
    tag: '▶ START',
    accent: '#FF2E88',
    act: 'story',
    prefetch: 'character-select',
    primary: true,
  },
  {
    id: 'vs',
    index: '02',
    label: 'VS MODE',
    sub: 'Local two-player hot seat',
    tag: '2P',
    accent: '#37D0FF',
    act: 'vs',
    prefetch: 'character-select',
  },
  {
    id: 'marquee',
    index: '03',
    label: 'MARQUEE',
    sub: 'Curated dream matchups',
    tag: '★',
    accent: '#FFC23D',
    act: 'marquee',
    prefetch: 'marquee-matchups',
  },
  {
    id: 'practice',
    index: '04',
    label: 'PRACTICE',
    sub: 'Train freely, no stakes',
    tag: '◇',
    accent: '#FCBF49',
    act: 'practice',
    prefetch: 'character-select',
  },
]

export function MainMenu() {
  const setPhase = useGame((s) => s.setPhase)
  const setMode = useGame((s) => s.setMode)
  const toggleMusic = useGame((s) => s.toggleMusic)
  const music = useGame((s) => s.musicEnabled)
  const toggleVoice = useGame((s) => s.toggleVoice)
  const voice = useGame((s) => s.voiceEnabled)
  const difficulty = useGame((s) => s.difficulty)
  const setDifficulty = useGame((s) => s.setDifficulty)

  // Featured fighters — only ones with hand-curated sprite art.
  const featured = useMemo(() => {
    const out = FEATURED_ROSTER.map((id) => getFighter(id)).filter(
      (f): f is (typeof FIGHTERS)[number] => !!f,
    )
    return out.length > 0 ? out : FIGHTERS
  }, [])

  // Rotating VS spotlight on the right — a fresh pairing every 3.6s.
  const [focusIdx, setFocusIdx] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFocusIdx((i) => (i + 1) % featured.length), 3600)
    return () => clearInterval(id)
  }, [featured.length])

  // Attract mode: on by first load, exits on any input, re-arms after 12s idle.
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
      timer = setTimeout(() => setAttract(true), 12_000)
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

  const [leaving, setLeaving] = useState(false)
  const [kbNav, setKbNav] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // ── Moving selection cursor ──────────────────────────────────────────
  const [activeIndex, setActiveIndex] = useState(0) // STORY is the default pick
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [cursor, setCursor] = useState({ top: 0, height: 0 })
  const [cursorReady, setCursorReady] = useState(false)

  const positionCursor = useCallback((idx: number) => {
    const el = itemRefs.current[idx]
    if (!el) return
    setCursor({ top: el.offsetTop, height: el.offsetHeight })
  }, [])

  useLayoutEffect(() => {
    positionCursor(activeIndex)
  }, [activeIndex, positionCursor])

  // Reposition once fonts have loaded / on resize, so the highlight never
  // ends up misaligned after a late web-font layout shift.
  useEffect(() => {
    let raf = 0
    const recalc = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        positionCursor(activeIndex)
        setCursorReady(true)
      })
    }
    recalc()
    const t = window.setTimeout(recalc, 360)
    document.fonts?.ready?.then(recalc).catch(() => {})
    window.addEventListener('resize', recalc)
    return () => {
      window.clearTimeout(t)
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', recalc)
    }
  }, [activeIndex, positionCursor])

  // Authored menu-out transition, then navigate.
  const leaveTo = useCallback((fn: () => void) => {
    Sfx.menuSelect()
    if (prefersReduced) {
      fn()
      return
    }
    setLeaving(true)
    window.setTimeout(fn, 300)
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

  const activate = useCallback(
    (m: ModeDef) => {
      if (m.act === 'marquee') goPhase('marquee-matchups')
      else go(m.act)
    },
    [go, goPhase],
  )

  const focusMode = useCallback(
    (idx: number, viaKeyboard: boolean) => {
      setActiveIndex((prev) => {
        if (prev !== idx) Sfx.menuMove()
        return idx
      })
      if (viaKeyboard) itemRefs.current[idx]?.focus()
    },
    [],
  )

  // Roving keyboard/gamepad nav across the mode list. Up/Down (and Left/Right)
  // move the cursor; Enter/Space confirm the current pick.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const k = e.key
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(k)) {
        e.preventDefault()
        setKbNav(true)
        const dir = k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1
        setActiveIndex((i) => {
          const n = (i + dir + MODES.length) % MODES.length
          if (n !== i) Sfx.menuMove()
          itemRefs.current[n]?.focus()
          return n
        })
      } else if (k === 'Enter' || k === ' ') {
        e.preventDefault()
        setKbNav(true)
        activate(MODES[activeIndex])
      }
    },
    [activeIndex, activate],
  )

  const focusFighter = featured[focusIdx % featured.length]
  const opposingFighter = featured[(focusIdx + Math.floor(featured.length / 2)) % featured.length]

  if (attract) {
    return <AttractMode onExit={() => setAttract(false)} />
  }

  const animClass = prefersReduced ? '' : 'mm-anim'
  const activeMode = MODES[activeIndex]

  return (
    <div
      ref={rootRef}
      className={`mm-root ${animClass} ${leaving ? 'mm-leaving' : ''} ${kbNav ? 'mm-kbd' : ''}`}
      onKeyDown={onKeyDown}
      onPointerMove={() => kbNav && setKbNav(false)}
      onPointerDown={() => kbNav && setKbNav(false)}
    >
      {/* ── Background stack ── */}
      <img
        src="/menu/title-hero.png"
        alt=""
        aria-hidden
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
        className={`mm-bg-art ${animClass}`}
      />
      <div className="mm-grade" />
      <div className="mm-panel" />
      <div className="mm-panel-edge" />
      <div className="mm-vignette" />
      <div className={`mm-sweep ${animClass}`} />
      <div className={`mm-embers ${animClass}`} aria-hidden />
      <div className="mm-scan" />
      <div className="mm-grain" />
      <div className="mm-corners" aria-hidden>
        <span /><span /><span /><span />
      </div>

      <div className="mm-stage">
        {/* ── LEFT: brand + nav + utility ── */}
        <div className="mm-left">
          <div className="mm-brand">
            <div className={`mm-eyebrow ${animClass ? 'mm-in' : ''}`}>
              A Tactical Fighter on Lenny&rsquo;s Podcast
            </div>
            <h1
              className={`mm-logo ${animClass ? 'mm-in d1' : ''}`}
              data-text="OPERATORS"
            >
              OPERATORS
            </h1>
            <span className={`mm-logo-slash ${animClass ? 'mm-in d2' : ''}`} />
          </div>

          {/* Primary navigation — one clear winner (STORY), then modes. */}
          <nav className="mm-menu" aria-label="Main menu" ref={menuRef}>
            <div
              className={`mm-cursor ${cursorReady ? '' : ''}`}
              style={{
                top: cursor.top,
                height: cursor.height,
                ['--mm-accent' as string]: activeMode.accent,
                opacity: cursorReady ? 1 : 0,
              }}
            />
            {MODES.map((m, i) => (
              <button
                key={m.id}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                data-menu-item
                className={`mm-item ${m.primary ? 'mm-primary' : ''} ${activeIndex === i ? 'mm-on' : ''}`}
                style={{ ['--accent' as string]: m.accent }}
                onClick={() => activate(m)}
                onMouseEnter={() => {
                  focusMode(i, false)
                  prefetchScreen(m.prefetch)
                }}
                onFocus={() => {
                  setActiveIndex(i)
                  prefetchScreen(m.prefetch)
                }}
                aria-label={`${m.label} — ${m.sub}`}
              >
                <span className="mm-index">{m.index}</span>
                <span className="mm-item-main">
                  <span className="mm-item-head">
                    <span className="mm-item-label">{m.label}</span>
                    <span className="mm-item-tag">{m.tag}</span>
                  </span>
                  <span className="mm-item-sub">{m.sub}</span>
                </span>
              </button>
            ))}
          </nav>

          {/* Lower cluster: de-emphasised utilities. */}
          <div className="mm-lower">
            <div className="mm-util">
              <div className="mm-util-row">
                <span className="mm-util-label">Library</span>
                <Chip label="How to Play" onClick={() => goPhase('how-to-play')} onHover={() => prefetchScreen('how-to-play')} />
                <Chip label="Encyclopedia" onClick={() => goPhase('framework-encyclopedia')} onHover={() => prefetchScreen('framework-encyclopedia')} />
                <Chip label="Quote Bank" onClick={() => goPhase('quote-bank')} onHover={() => prefetchScreen('quote-bank')} />
                <Chip label="Stats" onClick={() => goPhase('stats')} onHover={() => prefetchScreen('stats')} />
                <Chip label="Credits" onClick={() => goPhase('credits')} onHover={() => prefetchScreen('credits')} />
              </div>
              <div className="mm-util-row">
                <span className="mm-util-label">Setup</span>
                <Chip
                  label={
                    <>
                      Difficulty ·{' '}
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
                  label={
                    <>
                      Music ·{' '}
                      <span className={music ? 'mm-toggle-on' : 'mm-toggle-off'}>
                        {music ? 'ON' : 'OFF'}
                      </span>
                    </>
                  }
                  title="Toggle background music"
                  onClick={toggleMusic}
                />
                <Chip
                  label={
                    <>
                      Voice ·{' '}
                      <span className={voice ? 'mm-toggle-on' : 'mm-toggle-off'}>
                        {voice ? 'ON' : 'OFF'}
                      </span>
                    </>
                  }
                  title="Toggle fighter voice lines (browser TTS)"
                  onClick={toggleVoice}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: featured VS showcase ── */}
        <div className="mm-right">
          <div className="mm-show-tag">◇ Tonight&rsquo;s Card ◇</div>
          <div className="mm-show-floor" />
          <div className="mm-show">
            <ShowcaseFighter fighter={focusFighter} side="a" anim={animClass} />
            <div className="mm-vs">VS</div>
            <ShowcaseFighter fighter={opposingFighter} side="b" anim={animClass} />
          </div>
        </div>
      </div>

      <div className="mm-hint">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Navigate
        </span>
        <span>
          <kbd>⏎</kbd> Select
        </span>
      </div>
    </div>
  )
}

/* ── Utility chip ───────────────────────────────────────────────────── */
function Chip({
  label,
  onClick,
  onHover,
  title,
}: {
  label: React.ReactNode
  onClick: () => void
  onHover?: () => void
  title?: string
}) {
  return (
    <button
      className="mm-chip"
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
      className="mm-fighter"
      style={{ ['--faccent' as string]: fighter.accent }}
    >
      <div
        className={`mm-fighter-art ${anim ? 'idle-bob' : ''}`}
        style={{
          filter: `drop-shadow(0 0 22px ${fighter.accent}88) drop-shadow(0 18px 10px rgba(0,0,0,0.55))`,
        }}
      >
        <Sprite fighter={fighter} side={side} state="stance" />
      </div>
      <div className="mm-nameplate">
        <div className="mm-fighter-name">{fighter.shortName}</div>
        <div className="mm-fighter-arch">{fighter.archetype}</div>
      </div>
    </div>
  )
}
