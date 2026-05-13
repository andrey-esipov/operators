import { useEffect } from 'react'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'

export function ArcadeVictory() {
  const selectedA = useGame((s) => s.selectedA)
  const quoteBank = useGame((s) => s.quoteBank)
  const resetMatch = useGame((s) => s.resetMatch)

  useEffect(() => {
    Sfx.victory()
    setTimeout(() => Sfx.victory(), 600)
  }, [])

  if (!selectedA) return null
  const player = getFighter(selectedA)!

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden p-6">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at center, #FFD60A33 0%, #F77F0033 40%, #1A0F2E 80%, #0F0A1A 100%)',
        }}
      />

      {/* Confetti pixels */}
      {Array.from({ length: 80 }).map((_, i) => {
        const colors = ['#FFD60A', '#F77F00', '#E63946', '#06D6A0', '#00B4D8', '#F72585']
        const c = colors[i % colors.length]
        const left = (i * 31) % 100
        const top = (i * 17) % 80
        const size = 3 + (i % 4)
        return (
          <div
            key={i}
            className="absolute sway"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: size,
              height: size,
              background: c,
              opacity: 0.85,
              animationDelay: `${(i * 0.1) % 4}s`,
            }}
          />
        )
      })}

      <div className="relative z-10 font-display tracking-widest text-center" style={{
        color: '#FFD60A',
        textShadow: '8px 8px 0 black, 0 0 32px #F77F00',
        fontSize: 80,
      }}>
        ARCADE
      </div>
      <div className="relative z-10 font-display tracking-widest text-center mt-1" style={{
        color: '#FFFFFF',
        textShadow: '6px 6px 0 black, 0 0 16px #FFD60A',
        fontSize: 72,
      }}>
        COMPLETE
      </div>

      <div className="relative z-10 font-display text-base tracking-widest text-white/80 mt-6 max-w-2xl text-center">
        YOU BEAT LENNY.
      </div>
      <div className="relative z-10 font-body text-2xl text-white mt-4 max-w-2xl text-center italic px-4">
        "You found a new pattern. I'll add it to the show." — Lenny Rachitsky
      </div>

      <div className="relative z-10 mt-10 flex flex-col items-center gap-4">
        <div style={{ width: 220, height: 300 }}>
          <Sprite fighter={player} side="a" state="win" />
        </div>
        <div className="font-display text-2xl tracking-widest" style={{ color: player.accent, textShadow: '3px 3px 0 black' }}>
          {player.shortName} · CHAMPION
        </div>
      </div>

      <div className="relative z-10 mt-8 px-6 py-3 max-w-xl text-center" style={{
        background: 'rgba(15,10,26,0.7)',
        border: '2px solid #FFD60A',
      }}>
        <div className="font-display text-[10px] tracking-widest" style={{ color: '#FFD60A' }}>
          QUOTE BANK · {quoteBank.length} ENTRIES UNLOCKED
        </div>
        <div className="font-body text-base text-white/70 mt-1">
          You've built a personal playbook of {quoteBank.length} real frameworks from Lenny's guests.
        </div>
      </div>

      <button
        onClick={() => {
          Sfx.menuSelect()
          resetMatch()
        }}
        className="relative z-10 mt-8 px-8 py-4 font-display text-base tracking-widest"
        style={{
          background: 'linear-gradient(180deg, #FFD60A44, #F7798044)',
          color: 'white',
          border: '2px solid #FFD60A',
          boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2), 0 0 24px rgba(255,214,10,0.4)',
        }}
      >
        MAIN MENU
      </button>
    </div>
  )
}
