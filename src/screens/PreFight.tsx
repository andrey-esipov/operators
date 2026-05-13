import { useEffect } from 'react'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { SCENARIOS } from '../data/scenarios'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'

export function PreFight() {
  const fighterA = useGame((s) => s.fighterA)
  const fighterB = useGame((s) => s.fighterB)
  const scenario = useGame((s) => s.scenario)
  const round = useGame((s) => s.round)

  useEffect(() => {
    Sfx.fight()
  }, [])

  if (!fighterA || !fighterB) return null
  const a = getFighter(fighterA.defId)!
  const b = getFighter(fighterB.defId)!
  const stage = SCENARIOS[scenario]

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(135deg, #E63946 0%, #1A1230 50%, #00B4D8 100%)',
        }}
      />

      {/* Stage banner */}
      <div className="absolute top-12 left-0 right-0 text-center z-10">
        <div className="font-display text-[10px] tracking-widest text-white/70">
          STAGE {round}
        </div>
        <div className="font-display text-3xl tracking-widest mt-1" style={{ color: '#FFD60A', textShadow: '4px 4px 0 black' }}>
          {stage.name}
        </div>
        <div className="font-body text-xl text-white/80 mt-2 px-12">
          {stage.description}
        </div>
      </div>

      <div className="relative z-10 flex items-center gap-12">
        <div className="flex flex-col items-center">
          <div style={{ width: 180, height: 260 }}>
            <Sprite fighter={a} side="a" state="stance" />
          </div>
          <div className="font-display text-base tracking-widest mt-3" style={{ color: a.accent }}>
            {a.shortName}
          </div>
          <div className="font-display text-[8px] tracking-widest text-white/60 mt-1">
            {a.episode}
          </div>
        </div>

        <div className="font-display text-7xl tracking-widest" style={{
          color: '#FFD60A',
          textShadow: '6px 6px 0 black, 0 0 24px #F77F00',
          animation: 'logo-pulse 1.4s ease-in-out infinite',
        }}>
          VS
        </div>

        <div className="flex flex-col items-center">
          <div style={{ width: 180, height: 260 }}>
            <Sprite fighter={b} side="b" state="stance" />
          </div>
          <div className="font-display text-base tracking-widest mt-3" style={{ color: b.accent }}>
            {b.shortName}
          </div>
          <div className="font-display text-[8px] tracking-widest text-white/60 mt-1">
            {b.episode}
          </div>
        </div>
      </div>

      <div className="absolute bottom-16 left-0 right-0 text-center z-10">
        <div className="font-display text-5xl tracking-widest" style={{
          color: 'white',
          textShadow: '4px 4px 0 black',
          animation: 'flash 0.6s infinite',
        }}>
          FIGHT!
        </div>
      </div>
    </div>
  )
}
