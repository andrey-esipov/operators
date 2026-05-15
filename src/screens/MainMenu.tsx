import { useEffect, useMemo, useState } from 'react'
import { useGame } from '../state/game'
import { Sfx } from '../lib/audio'
import { Logo } from '../components/Logo'
import { FIGHTERS, FEATURED_ROSTER, getFighter } from '../data/fighters'
import { SCENARIO_ORDER } from '../data/scenarios'
import { Sprite } from '../components/Sprite'
import { PULL_QUOTES } from '../data/pull-quotes'
import { AttractMode } from './AttractMode'
import { prefetchScreen } from './registry'

export function MainMenu() {
  const setPhase = useGame((s) => s.setPhase)
  const setMode = useGame((s) => s.setMode)
  const toggleCrt = useGame((s) => s.toggleCrt)
  const crt = useGame((s) => s.crtEnabled)
  const toggleMusic = useGame((s) => s.toggleMusic)
  const music = useGame((s) => s.musicEnabled)
  const toggleVoice = useGame((s) => s.toggleVoice)
  const voice = useGame((s) => s.voiceEnabled)

  // Cycle through hand-curated pull quotes every 7 seconds
  const allQuotes = useMemo(() => {
    // Shuffle once so the order isn't predictable but never plays a low-quality auto-extracted line
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
    const id = setInterval(() => {
      setQuoteIdx((i) => (i + 1) % allQuotes.length)
    }, 7000)
    return () => clearInterval(id)
  }, [allQuotes.length])

  // Featured fighters — only the ones with hand-curated sprite art appear
  // in the menu's hero rotation, silhouette carousel, and roster strip.
  // Wave-4 fighters live in CharacterSelect but stay off the marquee until
  // their sprites ship.
  const featured = useMemo(() => {
    const out = FEATURED_ROSTER.map((id) => getFighter(id)).filter((f): f is typeof FIGHTERS[number] => !!f)
    return out.length > 0 ? out : FIGHTERS  // defensive fallback
  }, [])

  // Animated focus on a fighter — rotates every 2.5s through FEATURED only.
  const [focusIdx, setFocusIdx] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setFocusIdx((i) => (i + 1) % featured.length)
    }, 2500)
    return () => clearInterval(id)
  }, [featured.length])

  // Attract mode: defaults ON at first menu load — the sizzle reel IS
  // the first-impression experience (SF II opens to its attract mode too).
  // Any explicit click/key/touch/wheel drops the player into the real menu;
  // 10s of idle on the menu re-arms the reel.
  const [attract, setAttract] = useState(true)
  useEffect(() => {
    if (attract) {
      // Only explicit interactions exit. Pointermove is intentionally ignored.
      function exit() { setAttract(false) }
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
    // Menu is showing — arm the idle timer
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastX = 0, lastY = 0
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

  // Operator of the Day — deterministic from today's date, same for everyone
  // today. Drawn from the featured pool so the pill always names a fighter
  // with finished art.
  const operatorOfDay = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    let h = 0
    for (let i = 0; i < today.length; i++) h = (h * 31 + today.charCodeAt(i)) >>> 0
    return featured[h % featured.length]
  }, [featured])

  // PRESS START blink
  const [blinkOn, setBlinkOn] = useState(true)
  useEffect(() => {
    const id = setInterval(() => setBlinkOn((b) => !b), 700)
    return () => clearInterval(id)
  }, [])

  function go(mode: 'vs' | 'arcade' | 'practice') {
    Sfx.menuSelect()
    setMode(mode)
    setPhase('character-select')
  }

  const startDaily = useGame((s) => s.startDaily)
  const startRandom = useGame((s) => s.startRandom)
  const difficulty = useGame((s) => s.difficulty)
  const setDifficulty = useGame((s) => s.setDifficulty)

  const currentQuote = allQuotes[quoteIdx]
  const focusFighter = featured[focusIdx % featured.length]
  const opposingFighter = featured[(focusIdx + Math.floor(featured.length / 2)) % featured.length]

  if (attract) {
    return <AttractMode onExit={() => setAttract(false)} />
  }

  return (
    <div className="relative w-full h-full flex flex-col items-center overflow-y-auto overflow-x-hidden">
      {/* BG — 5-layer parallax */}
      <HeroBackground />
      <Starfield />
      <DiamondGrid />
      <SpotLight />
      <SilhouetteCarousel />

      {/* Operator-of-the-Day pill — top-left, compact */}
      <div
        className="absolute top-3 left-3 z-20 flex items-center gap-2 px-2.5 py-1"
        style={{
          background: `linear-gradient(90deg, ${operatorOfDay.accent}44 0%, rgba(0,0,0,0.6) 100%)`,
          border: `1px solid ${operatorOfDay.accent}AA`,
          boxShadow: `0 0 10px ${operatorOfDay.accent}66`,
        }}
      >
        <span className="font-display text-[7px] tracking-widest" style={{ color: operatorOfDay.accent }}>
          ☼ OP OF THE DAY
        </span>
        <span className="font-display text-[8px] tracking-widest text-white">
          {operatorOfDay.shortName}
        </span>
      </div>

      {/* LOGO — entry animation (scale-in + fade-in) then settle into float */}
      <div
        className="relative z-20 pt-4 logo-pulse logo-entry"
        style={{
          filter: 'drop-shadow(0 4px 0 black) drop-shadow(0 0 24px rgba(255,214,10,0.4)) drop-shadow(0 0 56px rgba(247,127,0,0.3))',
        }}
      >
        <Logo size={1} />
      </div>

      {/* Subtitle — accurate stats reflecting full roster. Numbers derive
          from the canonical data so they stay correct as the roster grows:
          one operator per FIGHTERS entry, one framework per move+ult, one
          stage per scenario. */}
      <p
        className="relative z-20 font-display text-[9px] tracking-widest mt-1 text-white/65 subtitle-entry"
        style={{ textShadow: '2px 2px 0 black' }}
      >
        {FIGHTERS.length} OPERATORS · {FIGHTERS.reduce((s, f) => s + f.moves.length + 1, 0)} FRAMEWORKS · {SCENARIO_ORDER.length} STAGES
      </p>

      {/* MID: rotating fighter spotlight — drawn from FEATURED_ROSTER only
          so the player always sees recognizable hand-drawn art on the hero
          screen. The opposing fighter is offset by half-roster so the pair
          rotates as a balanced VS, not the same neighbor every tick. */}
      <div className="relative z-20 mt-3 flex items-center gap-6">
        <FighterShowcase fighter={focusFighter} side="a" />
        <VsBadge />
        <FighterShowcase fighter={opposingFighter} side="b" />
      </div>

      {/* Rotating quote marquee — compact */}
      <div className="relative z-20 mt-3 max-w-2xl px-4">
        <div
          key={quoteIdx}
          className="text-center font-body italic text-white text-base px-3 py-1.5"
          style={{
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(255,255,255,0.18)',
            boxShadow: '0 0 12px rgba(255,214,10,0.15)',
            animation: 'banner-in 6s ease-out',
            minHeight: 40,
            lineHeight: 1.35,
          }}
        >
          {currentQuote ? (
            <>
              &ldquo;{currentQuote.quote}&rdquo;{' '}
              <span className="font-display text-[7px] tracking-widest" style={{ color: '#FFD60A' }}>
                — {currentQuote.who} · {currentQuote.episode}
              </span>
            </>
          ) : (
            <span className="text-white/40">…loading verbatim quotes…</span>
          )}
        </div>
      </div>

      {/* MENU — clean hierarchy:
          Row 1 (primary):     ARCADE · VS · MARQUEE
          Row 2 (modes):       DAILY · PRACTICE · RANDOM · GENERATE YOU
          Row 3 (library):     HOW TO PLAY · ENCYCLOPEDIA · QUOTE BANK · STATS
          Row 4 (preferences): DIFFICULTY · MUSIC · VOICE · CRT · CREDITS
      */}
      <div className="relative z-20 flex flex-col gap-3 mt-4 items-center menu-cta-stack px-4">
        {/* Row 1: the three headline play modes sit shoulder-to-shoulder
            so the user can pick the experience that matches what they
            came in for — climb the gauntlet, fight a friend, or jump
            straight into a hand-curated dream matchup. */}
        <div className="flex gap-3 flex-wrap justify-center">
          <MenuButton
            label="▶ ARCADE MODE"
            subtitle="8-stage gauntlet · boss Lenny"
            onClick={() => go('arcade')}
            onHover={() => prefetchScreen('character-select')}
            accent="#E63946"
          />
          <MenuButton
            label="VS MODE"
            subtitle="local 2-player hot seat"
            onClick={() => go('vs')}
            onHover={() => prefetchScreen('character-select')}
            accent="#00B4D8"
          />
          <MenuButton
            label="★ MARQUEE"
            subtitle="curated dream matchups"
            onClick={() => { Sfx.menuSelect(); setPhase('marquee-matchups') }}
            onHover={() => prefetchScreen('marquee-matchups')}
            accent="#FFD60A"
          />
        </div>

        {/* Row 2: alt modes in one row */}
        <div className="flex gap-2 flex-wrap justify-center">
          <MidButton
            label="◇ DAILY"
            subtitle="today's matchup"
            onClick={() => { Sfx.menuSelect(); startDaily() }}
            onHover={() => prefetchScreen('pre-fight')}
            accent="#06D6A0"
          />
          <MidButton
            label="◇ PRACTICE"
            subtitle="train freely"
            onClick={() => go('practice')}
            onHover={() => prefetchScreen('character-select')}
            accent="#FCBF49"
          />
          <MidButton
            label="◇ RANDOM"
            subtitle="dice rolls"
            onClick={() => { Sfx.menuSelect(); startRandom() }}
            onHover={() => prefetchScreen('pre-fight')}
            accent="#F72585"
          />
          <MidButton
            label="★ GENERATE YOU"
            subtitle="your fighter card"
            onClick={() => { Sfx.menuSelect(); setPhase('generate-fighter') }}
            onHover={() => prefetchScreen('generate-fighter')}
            accent="#7209B7"
          />
        </div>

        {/* Row 3: library — knowledge tools, grouped */}
        <ButtonGroup label="LIBRARY">
          <SmallButton label="HOW TO PLAY"  onClick={() => { Sfx.menuSelect(); setPhase('how-to-play') }}             onHover={() => prefetchScreen('how-to-play')} />
          <SmallButton label="ENCYCLOPEDIA" onClick={() => { Sfx.menuSelect(); setPhase('framework-encyclopedia') }} onHover={() => prefetchScreen('framework-encyclopedia')} />
          <SmallButton label="QUOTE BANK"   onClick={() => { Sfx.menuSelect(); setPhase('quote-bank') }}              onHover={() => prefetchScreen('quote-bank')} />
          <SmallButton label="STATS · ★"    onClick={() => { Sfx.menuSelect(); setPhase('stats') }}                   onHover={() => prefetchScreen('stats')} />
        </ButtonGroup>

        {/* Row 4: settings + dev/demo, grouped */}
        <ButtonGroup label="SETTINGS">
          <SmallButton
            label={`DIFFICULTY · ${difficulty.toUpperCase()}`}
            title="EASY: weak bots · NORMAL: random bots · HARD: scenario specialists with greedy ult AI"
            onClick={() => {
              Sfx.menuMove()
              setDifficulty(difficulty === 'easy' ? 'normal' : difficulty === 'normal' ? 'hard' : 'easy')
            }}
          />
          <SmallButton label={`MUSIC · ${music ? 'ON' : 'OFF'}`}  onClick={toggleMusic} title="Toggle background music" />
          <SmallButton label={`VOICE · ${voice ? 'ON' : 'OFF'}`} onClick={toggleVoice} title="Toggle fighter voice lines (browser TTS)" />
          <SmallButton label={`CRT · ${crt ? 'ON' : 'OFF'}`} onClick={toggleCrt} title="Retro CRT scanline filter — toggle off for a flat modern look" />
          <SmallButton label="◇ CREDITS" onClick={() => { Sfx.menuSelect(); setPhase('credits') }} title="Credits" onHover={() => prefetchScreen('credits')} />
        </ButtonGroup>
      </div>

      {/* Blinking press-start */}
      <div className="relative z-20 mt-3" style={{ height: 16 }}>
        <div
          className="font-display text-[9px] tracking-widest"
          style={{
            color: '#FFD60A',
            textShadow: '2px 2px 0 black, 0 0 8px #F77F00',
            opacity: blinkOn ? 1 : 0.2,
            transition: 'opacity 80ms',
          }}
        >
          ◇ PRESS START ◇
        </div>
      </div>

      {/* Roster strip — horizontally scrollable. Shows only featured fighters
          (the ones with finished art) so the live carousel never highlights
          a placeholder silhouette. The focused fighter auto-scrolls into
          view, matching SF II's character-select pacing. */}
      <div className="relative z-20 mt-2 mb-2 w-full px-4">
        <div
          className="flex gap-2 overflow-x-auto pb-2 roster-strip"
          style={{
            scrollbarWidth: 'thin',
            scrollBehavior: 'smooth',
          }}
        >
          {featured.map((f, i) => (
            <div
              key={f.id}
              ref={(el) => {
                if (i === focusIdx && el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
                }
              }}
              style={{
                width: 56,
                height: 56,
                flexShrink: 0,
                border: `2px solid ${i === focusIdx ? '#FFD60A' : f.accent}`,
                boxShadow: i === focusIdx ? `0 0 12px #FFD60A` : 'none',
                background: `linear-gradient(180deg, ${f.accent}33, ${f.accent}11)`,
                padding: 2,
                transform: i === focusIdx ? 'scale(1.12)' : 'scale(1)',
                transition: 'transform 0.25s',
              }}
              title={f.shortName}
            >
              <Sprite fighter={f} side="a" state="stance" />
            </div>
          ))}
        </div>
      </div>

      {/* Bottom footer */}
      <div className="absolute bottom-1 left-0 right-0 text-center font-display text-[7px] tracking-widest text-white/40 z-20">
        v1.0 · #LENNYSBUILDATHON · JUNE 3 SUBMISSION · OPERATORS.REPLIT.APP
      </div>
    </div>
  )
}

/** Bespoke gpt-image-2 background if /menu/title-hero.png exists, else procedural fallback */
function HeroBackground() {
  const [bgLoaded, setBgLoaded] = useState(false)
  const [bgErrored, setBgErrored] = useState(false)
  return (
    <>
      {/* Procedural fallback / underlay */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 30% 20%, #6E2B6D 0%, transparent 60%), radial-gradient(circle at 70% 80%, #E63946 0%, transparent 50%), linear-gradient(180deg, #1A0F2E 0%, #3B2360 50%, #F77F00 95%, #E63946 100%)',
        }}
      />
      {/* Pixel mountains silhouette */}
      <svg
        className="absolute left-0 right-0 bottom-0"
        viewBox="0 0 200 60"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '40%' }}
      >
        <polygon
          points="0,60 0,30 20,15 35,28 55,8 75,30 95,18 120,32 145,12 165,30 200,18 200,60"
          fill="#1A1230"
        />
        <polygon
          points="0,60 0,40 30,25 60,40 90,28 130,42 165,30 200,36 200,60"
          fill="#3B2360"
          opacity="0.85"
        />
      </svg>

      {/* Bespoke artwork overlay */}
      {!bgErrored && (
        <img
          src="/menu/title-hero.png"
          alt="OPERATORS title screen"
          onLoad={() => setBgLoaded(true)}
          onError={() => setBgErrored(true)}
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            imageRendering: 'pixelated',
            // Bumped from 0.55 (when the bg had invented characters we wanted
            // to dim) to 0.85 (now the bg has REAL roster sprites we want to
            // showcase). `screen` blend keeps the stage glow integrated with
            // the procedural fallback underneath.
            opacity: bgLoaded ? 0.85 : 0,
            transition: 'opacity 0.6s',
            mixBlendMode: 'screen',
          }}
        />
      )}
      {/* The title-hero.png already has six real-roster sprites composited
          onto it by scripts/composite-title-hero.ts — see that file for the
          lineup table. Adding overlay sprites on top here would duplicate
          them, so we let the bg artwork do the work. */}
      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.75) 100%)',
        }}
      />
    </>
  )
}

function DiamondGrid() {
  return (
    <div
      className="absolute inset-0 z-10 pointer-events-none"
      style={{
        opacity: 0.18,
        backgroundImage: `
          repeating-linear-gradient(45deg, transparent 0 14px, #FFD60A 14px 15px, transparent 15px 30px),
          repeating-linear-gradient(-45deg, transparent 0 14px, #F72585 14px 15px, transparent 15px 30px)
        `,
        mixBlendMode: 'screen',
      }}
    />
  )
}

function SpotLight() {
  return (
    <div
      className="absolute z-10 pointer-events-none"
      style={{
        left: '50%',
        top: '0%',
        width: 600,
        height: 800,
        transform: 'translateX(-50%) rotate(0deg)',
        background:
          'radial-gradient(ellipse at top, rgba(252,191,73,0.5) 0%, rgba(247,127,0,0.2) 30%, transparent 70%)',
        animation: 'sway 6s ease-in-out infinite',
      }}
    />
  )
}

/** Drifting starfield — slow parallax layer behind the title artwork. */
function Starfield() {
  return (
    <div className="absolute inset-0 z-[5] pointer-events-none overflow-hidden">
      {Array.from({ length: 80 }).map((_, i) => {
        const left = (i * 13) % 100
        const top = (i * 7) % 70
        const size = (i % 3) + 1
        const colors = ['#FFFFFF', '#FFD60A', '#90E0EF', '#F77F00']
        return (
          <div
            key={i}
            className="absolute"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: size,
              height: size,
              background: colors[i % colors.length],
              opacity: 0.55,
              boxShadow: `0 0 ${size * 2}px ${colors[i % colors.length]}`,
              animation: `starTwinkle ${1.4 + (i % 5) * 0.4}s ease-in-out ${(i * 0.13) % 3}s infinite`,
            }}
          />
        )
      })}
      <style>{`
        @keyframes starTwinkle {
          0%, 100% { opacity: 0.75; transform: scale(1) }
          50%      { opacity: 0.15; transform: scale(0.5) }
        }
      `}</style>
    </div>
  )
}

/** Fighter silhouettes drifting across the background, very subtle. */
function SilhouetteCarousel() {
  // Hand-picked silhouettes from the featured pool: a CEO, an investor, a
  // PM heavyweight, and a designer — so the drifting background figures
  // read as a varied roster rather than a single archetype.
  const sel = [
    getFighter('chesky'),
    getFighter('andreessen'),
    getFighter('doshi'),
    getFighter('dylan'),
  ].filter((f): f is NonNullable<typeof f> => !!f)
  return (
    <div className="absolute inset-0 z-[6] pointer-events-none overflow-hidden">
      {sel.map((f, i) => (
        <div
          key={f.id}
          className="absolute"
          style={{
            left: `${15 + i * 24}%`,
            bottom: '8%',
            width: 70,
            height: 96,
            opacity: 0.08,
            filter: 'brightness(0)',
            animation: `silhouetteDrift ${28 + i * 4}s linear ${i * 5}s infinite`,
          }}
        >
          <Sprite fighter={f} side="a" state="stance" />
        </div>
      ))}
      <style>{`
        @keyframes silhouetteDrift {
          0%   { transform: translateX(0)    translateY(0) }
          50%  { transform: translateX(80px) translateY(-12px) }
          100% { transform: translateX(0)    translateY(0) }
        }
      `}</style>
    </div>
  )
}

function FighterShowcase({ fighter, side }: { fighter: typeof FIGHTERS[0]; side: 'a' | 'b' }) {
  // Showcase keys on `fighter.id` so the sprite + name + archetype all
  // re-mount together — the small entry animation runs on every rotation,
  // which reads as a "vs cabinet" character roll instead of a static swap.
  return (
    <div
      key={fighter.id}
      className="flex flex-col items-center showcase-entry"
      style={{
        filter: `drop-shadow(0 0 22px ${fighter.accent}AA) drop-shadow(0 8px 0 rgba(0,0,0,0.6))`,
      }}
    >
      <div style={{ width: 220, height: 300 }} className="idle-bob">
        <Sprite fighter={fighter} side={side} state="stance" />
      </div>
      <div
        className="font-display text-base tracking-widest mt-1"
        style={{ color: fighter.accent, textShadow: '2px 2px 0 black' }}
      >
        {fighter.shortName}
      </div>
      <div
        className="font-display text-[7px] tracking-widest mt-0.5 text-white/55"
        style={{ letterSpacing: '0.25em' }}
      >
        {fighter.archetype}
      </div>
    </div>
  )
}

function VsBadge() {
  return (
    <div
      className="font-display text-5xl tracking-widest"
      style={{
        color: '#FFD60A',
        textShadow: '4px 4px 0 black, 0 0 16px #F77F00',
        animation: 'logo-pulse 1.8s ease-in-out infinite',
      }}
    >
      VS
    </div>
  )
}

function MenuButton({
  label,
  subtitle,
  onClick,
  onHover,
  accent,
}: {
  label: string
  subtitle: string
  onClick: () => void
  onHover?: () => void
  accent: string
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => { Sfx.menuMove(); onHover?.() }}
      onFocus={() => onHover?.()}
      aria-label={`${label.replace(/[▶★◇\s]+/g, ' ').trim()} — ${subtitle}`}
      className="relative px-6 py-2 font-display text-lg tracking-widest hover:translate-y-[-2px] transition-transform"
      style={{
        background: `linear-gradient(180deg, ${accent}55, ${accent}22)`,
        color: 'white',
        border: `2px solid ${accent}`,
        boxShadow:
          `inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2), 0 0 24px ${accent}66`,
        cursor: 'pointer',
        minWidth: 360,
        letterSpacing: '3px',
        textShadow: '2px 2px 0 black',
      }}
    >
      {label}
      <div
        className="font-body text-base tracking-normal mt-0.5"
        style={{
          color: 'white',
          opacity: 0.7,
          textShadow: 'none',
          letterSpacing: 'normal',
        }}
      >
        {subtitle}
      </div>
    </button>
  )
}

function MidButton({
  label,
  subtitle,
  onClick,
  onHover,
  accent,
}: {
  label: string
  subtitle: string
  onClick: () => void
  onHover?: () => void
  accent: string
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => { Sfx.menuMove(); onHover?.() }}
      onFocus={() => onHover?.()}
      aria-label={`${label.replace(/[▶★◇\s]+/g, ' ').trim()} — ${subtitle}`}
      className="relative px-4 py-1.5 font-display text-base tracking-widest hover:translate-y-[-2px] transition-transform"
      style={{
        background: `linear-gradient(180deg, ${accent}55, ${accent}22)`,
        color: 'white',
        border: `2px solid ${accent}`,
        boxShadow:
          `inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2), 0 0 16px ${accent}55`,
        cursor: 'pointer',
        minWidth: 170,
        letterSpacing: '2px',
        textShadow: '2px 2px 0 black',
      }}
    >
      {label}
      <div
        className="font-body text-sm tracking-normal mt-0.5"
        style={{
          color: 'white',
          opacity: 0.7,
          textShadow: 'none',
          letterSpacing: 'normal',
        }}
      >
        {subtitle}
      </div>
    </button>
  )
}

function ButtonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap justify-center">
      <span
        className="font-display text-[7px] tracking-widest text-white/40 select-none"
        style={{ letterSpacing: '0.3em' }}
      >
        {label} ▸
      </span>
      {children}
    </div>
  )
}

function SmallButton({ label, onClick, title, onHover }: { label: string; onClick: () => void; title?: string; onHover?: () => void }) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => { Sfx.menuMove(); onHover?.() }}
      onFocus={() => onHover?.()}
      title={title}
      className="px-3 py-1.5 font-display text-[9px] tracking-widest hover:translate-y-[-1px] transition-transform"
      style={{
        background: 'rgba(0,0,0,0.4)',
        color: '#FCBF49',
        border: '1px solid #FCBF49',
        boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.4)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}
