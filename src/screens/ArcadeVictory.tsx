import { useEffect } from 'react'
import './ceremony/devExpose'
import './ceremony/ceremony.css'
import { ImpactFlash } from './ceremony/CeremonyFX'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'

const CONFETTI = ['#FFD60A', '#F77F00', '#E63946', '#06D6A0', '#00B4D8', '#F72585']

export function ArcadeVictory() {
  const selectedA = useGame((s) => s.selectedA)
  const quoteBank = useGame((s) => s.quoteBank)
  const resetMatch = useGame((s) => s.resetMatch)

  useEffect(() => {
    Sfx.victory()
    const t = setTimeout(() => Sfx.victory(), 600)
    return () => clearTimeout(t)
  }, [])

  if (!selectedA) return null
  const player = getFighter(selectedA)!
  const accent = player.accent || '#FFD60A'

  return (
    <div className="cer-anim relative w-full h-full flex flex-col items-center justify-center overflow-hidden px-6 py-4">
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 40%, #FFD60A33 0%, #F77F0033 38%, #1A0F2E 78%, #0F0A1A 100%)',
        }}
      />
      <div className="cer-rays" style={{ opacity: 0.6 }} />
      <ImpactFlash duration={0.3} />

      {/* Falling confetti. */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 60 }).map((_, i) => {
          const c = CONFETTI[i % CONFETTI.length]
          const left = (i * 37) % 100
          const size = 4 + (i % 4)
          const dur = 3 + (i % 5) * 0.7
          const delay = (i % 10) * 0.35
          return (
            <div
              key={i}
              className="absolute"
              style={{
                left: `${left}%`, top: 0, width: size, height: size + 2,
                background: c, opacity: 0.9,
                animation: `cer-confetti ${dur}s linear ${delay}s infinite`,
              }}
            />
          )
        })}
      </div>

      <div
        className="relative z-10 font-display tracking-widest text-center"
        style={{
          color: '#FFD60A',
          textShadow: '8px 8px 0 black, 0 0 32px #F77F00',
          fontSize: 'clamp(40px, 6vw, 74px)',
          animation: 'cer-title-crash 0.5s cubic-bezier(0.15,0.9,0.3,1) both',
        }}
      >
        ARCADE
      </div>
      <div
        className="relative z-10 font-display tracking-widest text-center mt-1"
        style={{
          color: '#FFFFFF',
          textShadow: '6px 6px 0 black, 0 0 16px #FFD60A',
          fontSize: 'clamp(32px, 5vw, 58px)',
          animation: 'cer-title-crash 0.5s cubic-bezier(0.15,0.9,0.3,1) 0.12s both',
        }}
      >
        COMPLETE
      </div>

      <div
        className="relative z-10 font-display text-sm tracking-widest text-white/85 mt-3"
        style={{ animation: 'cer-rise-fade 0.5s ease-out 0.35s both' }}
      >
        YOU BEAT LENNY.
      </div>

      {/* Champion — large, lit, rising into frame with a defeated Lenny beside. */}
      <div className="relative z-10 mt-3 flex items-end justify-center gap-8 md:gap-14">
        {(() => {
          const lenny = getFighter('lenny')
          return lenny ? (
            <div
              className="flex flex-col items-center"
              style={{ opacity: 0.55, animation: 'cer-loser-in 0.5s ease-out 0.4s both' }}
            >
              <div style={{ width: 'min(14vw, 130px)', height: 'min(16vh, 130px)' }}>
                <Sprite fighter={lenny} side="b" state="lose" />
              </div>
              <div className="font-display text-xs tracking-widest mt-2 text-white/55">LENNY · DEFEATED</div>
            </div>
          ) : null
        })()}
        <div
          className="flex flex-col items-center relative"
          style={{ animation: 'cer-hero-rise 0.6s cubic-bezier(0.15,0.9,0.3,1) 0.3s both' }}
        >
          <div
            className="absolute pointer-events-none"
            style={{
              left: '50%', top: '46%', width: '135%', height: '135%',
              transform: 'translate(-50%,-50%)',
              background: `radial-gradient(ellipse at center, ${accent}55 0%, transparent 66%)`,
              animation: 'cer-spotlight 2.6s ease-in-out infinite',
            }}
          />
          <div style={{ width: 'min(28vw, 300px)', height: 'min(38vh, 300px)', filter: `drop-shadow(0 0 36px ${accent})` }}>
            <Sprite fighter={player} side="a" state="win" />
          </div>
          <div
            className="font-display tracking-widest mt-1"
            style={{ color: accent, fontSize: 'clamp(18px, 2.6vw, 30px)', textShadow: '3px 3px 0 black' }}
          >
            {player.shortName} · CHAMPION
          </div>
        </div>
      </div>

      <div
        className="relative z-10 font-body text-base italic text-white mt-3 max-w-2xl text-center px-4 leading-tight"
        style={{ animation: 'cer-rise-fade 0.5s ease-out 0.55s both' }}
      >
        "You found a new pattern. I'll add it to the show." — Lenny Rachitsky
      </div>

      <div
        className="relative z-10 mt-2 font-display text-[10px] tracking-widest"
        style={{ color: '#FFD60A', animation: 'cer-rise-fade 0.5s ease-out 0.65s both' }}
      >
        QUOTE BANK · {quoteBank.length} FRAMEWORKS UNLOCKED
      </div>

      <div
        className="relative z-10 mt-4 flex gap-3 flex-wrap justify-center"
        style={{ animation: 'cer-rise-fade 0.5s ease-out 0.8s both' }}
      >
        <button
          onClick={() => { Sfx.menuSelect(); useGame.getState().setPhase('generate-fighter') }}
          className="px-8 py-4 font-display text-base tracking-widest"
          style={{
            background: 'linear-gradient(180deg, #7209B7aa, #F72585aa)',
            color: 'white',
            border: '2px solid #F72585',
            boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2), 0 0 24px #F7258588',
            cursor: 'pointer',
            animation: 'flash 1.4s ease-in-out infinite',
          }}
        >
          ★ UNLOCK YOURSELF →
        </button>
        <button
          onClick={() => { Sfx.menuSelect(); resetMatch() }}
          className="px-8 py-4 font-display text-base tracking-widest"
          style={{
            background: 'linear-gradient(180deg, #FFD60A44, #F7798044)',
            color: 'white',
            border: '2px solid #FFD60A',
            boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2), 0 0 24px rgba(255,214,10,0.4)',
            cursor: 'pointer',
          }}
        >
          MAIN MENU
        </button>
      </div>
    </div>
  )
}
