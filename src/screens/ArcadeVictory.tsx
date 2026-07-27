import { useEffect } from 'react'
import './ceremony/devExpose'
import './ceremony/ceremony.css'
import { ImpactFlash, StageBackdrop, WinnerFloor } from './ceremony/CeremonyFX'
import { PowerWord, Kicker, CER_GRAD } from './ceremony/CeremonyType'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'

const CONFETTI = ['#FFD60A', '#F77F00', '#E63946', '#06D6A0', '#00B4D8', '#F72585']

export function ArcadeVictory() {
  const selectedA = useGame((s) => s.selectedA)
  const quoteBank = useGame((s) => s.quoteBank)
  const resetMatch = useGame((s) => s.resetMatch)
  const scenario = useGame((s) => s.scenario)

  useEffect(() => {
    Sfx.victory()
    const t = setTimeout(() => Sfx.victory(), 600)
    return () => clearTimeout(t)
  }, [])

  if (!selectedA) return null
  const player = getFighter(selectedA)!
  const accent = player.accent || '#FFD60A'

  return (
    <div className="cer-anim relative w-full h-full flex flex-col items-center justify-center overflow-hidden px-6 py-4" style={{ background: '#05030b' }}>
      <StageBackdrop scenario={scenario} tint="#F7A400" dim={0.36} />
      <div className="cer-rays" style={{ opacity: 0.26 }} />
      <div className="cer-grain" />
      <ImpactFlash duration={0.3} />

      {/* Falling ribbon confetti. */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 70 }).map((_, i) => {
          const c = CONFETTI[i % CONFETTI.length]
          const left = (i * 37) % 100
          const w = 4 + (i % 3) * 2
          const h = 10 + (i % 4) * 4
          const dur = 3 + (i % 5) * 0.7
          const delay = (i % 12) * 0.32
          return (
            <div
              key={i}
              className="absolute"
              style={{
                left: `${left}%`, top: 0, width: w, height: h,
                background: c, opacity: 0.92,
                boxShadow: `0 0 6px ${c}`,
                animation: `cer-ribbon ${dur}s linear ${delay}s infinite`,
              }}
            />
          )
        })}
      </div>

      {/* TITLE — ARCADE / COMPLETE, two heavy lines, staggered crash. */}
      <div className="relative z-10 flex flex-col items-center" style={{ animation: 'cer-shake-hard 0.3s ease-out both' }}>
        <PowerWord size="clamp(58px, 9vw, 132px)" color="#FFD60A" gradient={CER_GRAD.gold} echo="#B3122F" echoOffset="0.08em" glow="#F77F00" glow2="#E63946" skew={-8} entrance="ko" live idle>
          ARCADE
        </PowerWord>
        <div style={{ marginTop: '-0.12em' }}>
          <PowerWord size="clamp(58px, 9vw, 132px)" color="#FFFFFF" gradient={CER_GRAD.steel} echo="#7A1F6B" echoOffset="0.08em" glow="#FFD60A" glow2="#F77F00" skew={-8} entrance="slam" delay={0.12} live idle>
            COMPLETE
          </PowerWord>
        </div>
      </div>

      <div className="cer-type relative z-10 mt-3" style={{ animation: 'cer-rise-fade 0.45s ease-out 0.35s both' }}>
        <Kicker color="rgba(255,255,255,0.85)" style={{ fontSize: 'clamp(12px,1.5vw,18px)', letterSpacing: '0.32em' }}>
          YOU BEAT LENNY
        </Kicker>
      </div>

      {/* Champion — large, lit, rising into frame with a defeated Lenny beside. */}
      <div className="relative z-10 mt-3 flex items-end justify-center gap-10 md:gap-16">
        {(() => {
          const lenny = getFighter('lenny')
          return lenny ? (
            <div
              className="flex flex-col items-center"
              style={{ animation: 'cer-loser-in 0.5s ease-out 0.4s both' }}
            >
              <div style={{ width: 'min(14vw, 130px)', height: 'min(16vh, 130px)', filter: 'grayscale(0.6) brightness(0.7)' }}>
                <Sprite fighter={lenny} side="b" state="lose" />
              </div>
              <Kicker style={{ marginTop: 6, fontSize: 'clamp(9px,1vw,12px)', color: 'rgba(255,255,255,0.5)' }}>LENNY · DEFEATED</Kicker>
            </div>
          ) : null
        })()}
        <div
          className="flex flex-col items-center relative"
          style={{ animation: 'cer-hero-rise 0.6s cubic-bezier(0.15,0.9,0.3,1) 0.3s both' }}
        >
          {/* light beam + spotlight behind the champion */}
          <div className="absolute pointer-events-none" style={{
            left: '50%', bottom: '4%', width: '60%', height: '150%', transform: 'translateX(-50%)',
            background: `linear-gradient(180deg, transparent, ${accent}33 60%, ${accent}66)`,
            clipPath: 'polygon(38% 0, 62% 0, 100% 100%, 0 100%)',
            animation: 'cer-beam-breathe 2.8s ease-in-out infinite',
          }} />
          <div
            className="absolute pointer-events-none"
            style={{
              left: '50%', top: '46%', width: '145%', height: '145%',
              transform: 'translate(-50%,-50%)',
              background: `radial-gradient(ellipse at center, ${accent}55 0%, transparent 64%)`,
              animation: 'cer-spotlight 2.6s ease-in-out infinite',
            }}
          />
          <div className="relative" style={{ width: 'min(34vw, 360px)', height: 'min(48vh, 380px)' }}>
            <div
              className="cer-breathe"
              style={{ width: '100%', height: '100%', filter: `drop-shadow(0 0 38px ${accent}) drop-shadow(6px 10px 0 rgba(0,0,0,0.5))` }}
            >
              <Sprite fighter={player} side="a" state="win" />
            </div>
            <WinnerFloor color={accent} />
          </div>
          <div className="cer-type mt-1" style={{ transform: 'skewX(-10deg)' }}>
            <span className="cer-display" style={{ display: 'inline-block', transform: 'skewX(10deg)', color: accent, fontSize: 'clamp(22px,3vw,40px)', letterSpacing: '0.03em', textShadow: `2px 2px 0 rgba(0,0,0,0.85), 0 0 18px ${accent}` }}>
              {player.shortName} · CHAMPION
            </span>
          </div>
        </div>
      </div>

      {/* Pull-quote. */}
      <div
        className="cer-type cer-quote relative z-10 mt-4 max-w-2xl text-center px-6"
        style={{
          fontStyle: 'italic', fontWeight: 500, fontSize: 'clamp(16px,2vw,24px)',
          color: '#fff', lineHeight: 1.2, textShadow: '1px 1px 0 rgba(0,0,0,0.8)',
          animation: 'cer-rise-fade 0.45s ease-out 0.55s both',
        }}
      >
        “You found a new pattern. I’ll add it to the show.”
        <span style={{ color: accent, fontStyle: 'normal', fontWeight: 600 }}> — Lenny Rachitsky</span>
      </div>

      <div
        className="cer-type relative z-10 mt-3"
        style={{ animation: 'cer-rise-fade 0.45s ease-out 0.65s both' }}
      >
        <Kicker color="#FFD60A" style={{ fontSize: 'clamp(9px,1.1vw,13px)' }}>
          QUOTE BANK · {quoteBank.length} FRAMEWORKS UNLOCKED
        </Kicker>
      </div>

      <div
        className="relative z-10 mt-5 flex gap-4 flex-wrap justify-center"
        style={{ animation: 'cer-rise-fade 0.45s ease-out 0.8s both' }}
      >
        <button
          onClick={() => { Sfx.menuSelect(); useGame.getState().setPhase('generate-fighter') }}
          className="cer-btn cer-type px-9 py-4"
          style={{
            background: 'linear-gradient(180deg, #F72585, #7209B7)',
            color: '#fff',
            fontSize: 'clamp(14px,1.6vw,18px)',
            border: '2px solid rgba(255,255,255,0.9)',
            boxShadow: '0 6px 0 rgba(0,0,0,0.5), 0 0 26px rgba(247,37,133,0.6)',
          }}
        >
          ★ UNLOCK YOURSELF →
        </button>
        <button
          onClick={() => { Sfx.menuSelect(); resetMatch() }}
          className="cer-btn cer-type px-9 py-4"
          style={{
            background: `linear-gradient(180deg, ${accent}, ${accent}aa)`,
            color: '#0a0612',
            fontSize: 'clamp(14px,1.6vw,18px)',
            border: '2px solid #fff',
            boxShadow: `0 6px 0 rgba(0,0,0,0.5), 0 0 24px ${accent}88`,
            textShadow: '0 1px 0 rgba(255,255,255,0.4)',
          }}
        >
          MAIN MENU
        </button>
      </div>
    </div>
  )
}
