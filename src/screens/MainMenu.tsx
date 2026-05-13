import { useEffect, useMemo, useState } from 'react'
import { useGame } from '../state/game'
import { Sfx } from '../lib/audio'
import { Logo } from '../components/Logo'
import { FIGHTERS } from '../data/fighters'
import { Sprite } from '../components/Sprite'
import { PULL_QUOTES } from '../data/pull-quotes'

export function MainMenu() {
  const setPhase = useGame((s) => s.setPhase)
  const setMode = useGame((s) => s.setMode)
  const toggleCrt = useGame((s) => s.toggleCrt)
  const crt = useGame((s) => s.crtEnabled)
  const toggleMusic = useGame((s) => s.toggleMusic)
  const music = useGame((s) => s.musicEnabled)

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

  // Animated focus on a fighter — rotates every 2.5s
  const [focusIdx, setFocusIdx] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setFocusIdx((i) => (i + 1) % FIGHTERS.length)
    }, 2500)
    return () => clearInterval(id)
  }, [])

  // PRESS START blink
  const [blinkOn, setBlinkOn] = useState(true)
  useEffect(() => {
    const id = setInterval(() => setBlinkOn((b) => !b), 700)
    return () => clearInterval(id)
  }, [])

  function go(mode: 'vs' | 'arcade') {
    Sfx.menuSelect()
    setMode(mode)
    setPhase('character-select')
  }

  const currentQuote = allQuotes[quoteIdx]
  const focusFighter = FIGHTERS[focusIdx]

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden">
      {/* BG — bespoke gpt-image-2 hero if available, else a fallback */}
      <HeroBackground />

      {/* Animated geometric overlay */}
      <DiamondGrid />

      {/* Animated stage lights */}
      <SpotLight />

      {/* TOP: logo */}
      <div className="relative z-20 pt-6 logo-pulse">
        <Logo size={1} />
      </div>

      <p className="relative z-20 font-display text-[10px] tracking-widest mt-2 text-white/80"
         style={{ textShadow: '2px 2px 0 black' }}>
        ★ A TACTICAL FIGHTER ON LENNY&apos;S PODCAST ★
      </p>

      {/* MID: rotating fighter spotlight */}
      <div className="relative z-20 mt-3 flex items-center gap-6">
        <FighterShowcase fighter={focusFighter} side="a" />
        <VsBadge />
        <FighterShowcase fighter={FIGHTERS[(focusIdx + 4) % FIGHTERS.length]} side="b" />
      </div>

      {/* Rotating quote marquee */}
      <div className="relative z-20 mt-2 max-w-3xl px-4">
        <div
          key={quoteIdx}
          className="text-center font-body italic text-white text-xl px-4 py-2"
          style={{
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: '0 0 12px rgba(255,214,10,0.15)',
            animation: 'banner-in 6s ease-out',
            minHeight: 50,
          }}
        >
          {currentQuote ? (
            <>
              &ldquo;{currentQuote.quote}&rdquo;{' '}
              <span className="font-display text-[8px] tracking-widest" style={{ color: '#FFD60A' }}>
                — {currentQuote.who} · {currentQuote.episode}
              </span>
            </>
          ) : (
            <span className="text-white/40">…loading verbatim quotes from the archive…</span>
          )}
        </div>
      </div>

      {/* PRESS START / menu buttons */}
      <div className="relative z-20 flex flex-col gap-3 mt-4 items-center">
        <MenuButton
          label="▶ ARCADE MODE"
          subtitle="8-stage gauntlet · final boss Lenny"
          onClick={() => go('arcade')}
          accent="#E63946"
        />
        <MenuButton
          label="VS MODE"
          subtitle="local 2-player hot seat"
          onClick={() => go('vs')}
          accent="#00B4D8"
        />
        <div className="flex gap-2">
          <SmallButton label="HOW TO PLAY" onClick={() => { Sfx.menuSelect(); setPhase('how-to-play') }} />
          <SmallButton label="QUOTE BANK" onClick={() => { Sfx.menuSelect(); setPhase('quote-bank') }} />
          <SmallButton label={`♪ ${music ? 'ON' : 'OFF'}`} onClick={toggleMusic} />
          <SmallButton label={`CRT · ${crt ? 'ON' : 'OFF'}`} onClick={toggleCrt} />
        </div>
      </div>

      {/* BOTTOM: blinking press-start + roster strip */}
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
          ◇ PRESS ARCADE TO START ◇
        </div>
      </div>

      {/* Roster strip — all 8 fighters at the bottom */}
      <div className="relative z-20 mt-2 mb-2 flex gap-2 px-4">
        {FIGHTERS.map((f, i) => (
          <div
            key={f.id}
            style={{
              width: 56,
              height: 56,
              border: `2px solid ${i === focusIdx ? '#FFD60A' : f.accent}`,
              boxShadow: i === focusIdx ? `0 0 12px #FFD60A` : 'none',
              background: `linear-gradient(180deg, ${f.accent}33, ${f.accent}11)`,
              padding: 2,
              transform: i === focusIdx ? 'scale(1.1)' : 'scale(1)',
              transition: 'transform 0.2s',
            }}
          >
            <Sprite fighter={f} side="a" state="stance" />
          </div>
        ))}
      </div>

      {/* Bottom footer */}
      <div className="absolute bottom-1 left-0 right-0 text-center font-display text-[7px] tracking-widest text-white/40 z-20">
        v1.0.0 · BUILD #LENNYSBUILDATHON · MAY 27 SUBMISSION · OPERATORS.REPLIT.APP
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
            opacity: bgLoaded ? 0.55 : 0,
            transition: 'opacity 0.6s',
            mixBlendMode: 'screen',
          }}
        />
      )}
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

function FighterShowcase({ fighter, side }: { fighter: typeof FIGHTERS[0]; side: 'a' | 'b' }) {
  return (
    <div
      className="flex flex-col items-center"
      style={{ filter: 'drop-shadow(0 0 16px #FFD60A88)' }}
    >
      <div style={{ width: 140, height: 200 }} className="idle-bob">
        <Sprite fighter={fighter} side={side} state="stance" />
      </div>
      <div
        className="font-display text-[10px] tracking-widest mt-1"
        style={{ color: fighter.accent, textShadow: '2px 2px 0 black' }}
      >
        {fighter.shortName}
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
  accent,
}: {
  label: string
  subtitle: string
  onClick: () => void
  accent: string
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={Sfx.menuMove}
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

function SmallButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={Sfx.menuMove}
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
