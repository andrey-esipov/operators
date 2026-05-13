import { useGame } from '../state/game'
import { Sfx } from '../lib/audio'
import { Logo } from '../components/Logo'

export function MainMenu() {
  const setPhase = useGame((s) => s.setPhase)
  const setMode = useGame((s) => s.setMode)
  const toggleCrt = useGame((s) => s.toggleCrt)
  const crt = useGame((s) => s.crtEnabled)

  function go(mode: 'vs' | 'arcade') {
    Sfx.menuSelect()
    setMode(mode)
    setPhase('character-select')
  }

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center">
      {/* Background animated stage */}
      <BgStage />

      {/* Logo */}
      <div className="relative z-10 logo-pulse">
        <Logo size={1} />
      </div>

      {/* Tagline */}
      <p className="relative z-10 font-display text-[10px] tracking-widest mt-2 text-white/60">
        BUILT ON LENNY'S PODCAST · #LENNYSBUILDATHON
      </p>

      {/* Menu */}
      <div className="relative z-10 flex flex-col gap-4 mt-12 items-center">
        <MenuButton label="ARCADE MODE" onClick={() => go('arcade')} />
        <MenuButton label="VS MODE" onClick={() => go('vs')} />
        <MenuButton
          label="QUOTE BANK"
          onClick={() => {
            Sfx.menuSelect()
            setPhase('quote-bank')
          }}
          secondary
        />
        <MenuButton label={`CRT  ·  ${crt ? 'ON' : 'OFF'}`} onClick={toggleCrt} secondary />
      </div>

      <div className="absolute bottom-6 left-0 right-0 text-center font-display text-[8px] tracking-widest text-white/40 z-10">
        v0.1 · MAY 27 SUBMISSION · OPERATORS.REPLIT.APP
      </div>
    </div>
  )
}

function MenuButton({ label, onClick, secondary }: { label: string; onClick: () => void; secondary?: boolean }) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={Sfx.menuMove}
      className="px-8 py-3 font-display text-base tracking-widest transition-transform hover:translate-y-[-2px]"
      style={{
        background: secondary ? 'transparent' : 'linear-gradient(180deg, #F77F0044, #E6394644)',
        color: secondary ? '#FCBF49' : '#FFFFFF',
        border: `2px solid ${secondary ? '#FCBF49' : '#E63946'}`,
        boxShadow:
          'inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2), 0 0 0 1px rgba(0,0,0,0.5)',
        cursor: 'pointer',
        minWidth: 300,
        letterSpacing: '4px',
      }}
    >
      {label}
    </button>
  )
}

function BgStage() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, #1A0F2E 0%, #3B2360 60%, #F77F00 90%, #E63946 100%)',
        }}
      />
      {/* Sun */}
      <div
        className="absolute"
        style={{
          width: 220,
          height: 220,
          left: '50%',
          top: '60%',
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(circle, #FFD60A 0%, #F77F00 50%, transparent 70%)',
          opacity: 0.7,
        }}
      />
      {/* Pixel mountains */}
      <svg
        className="absolute left-0 right-0 bottom-0"
        viewBox="0 0 200 60"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '40%' }}
      >
        <polygon points="0,60 0,30 20,15 35,28 55,8 75,30 95,18 120,32 145,12 165,30 200,18 200,60" fill="#1A1230" />
        <polygon points="0,60 0,40 30,25 60,40 90,28 130,42 165,30 200,36 200,60" fill="#3B2360" opacity="0.85" />
      </svg>
    </div>
  )
}
