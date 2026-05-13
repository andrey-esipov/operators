import { useState } from 'react'
import { useGame } from '../state/game'
import { STARTING_ROSTER, getFighter, UNLOCKABLES } from '../data/fighters'
import { SCENARIOS } from '../data/scenarios'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'
import type { ScenarioId } from '../types'

const ROSTER_ORDER = [...STARTING_ROSTER, ...UNLOCKABLES]

export function CharacterSelect() {
  const mode = useGame((s) => s.mode)
  const startMatch = useGame((s) => s.startMatch)
  const startArcade = useGame((s) => s.startArcade)
  const setPhase = useGame((s) => s.setPhase)
  const [side, setSide] = useState<'a' | 'b'>('a')
  const [selectedA, setSelectedA] = useState<string | null>(null)
  const [selectedB, setSelectedB] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>('chesky')
  const [scenario, setScenario] = useState<ScenarioId>('pre-pmf')

  const hoveredFighter = hovered ? getFighter(hovered) : null
  const arcadeMode = mode === 'arcade'

  function pickFighter(id: string) {
    Sfx.menuSelect()
    if (arcadeMode) {
      // Arcade only picks player 1, then auto-starts
      setSelectedA(id)
      setTimeout(() => startArcade(id), 400)
      return
    }
    if (side === 'a') {
      setSelectedA(id)
      setSide('b')
    } else {
      setSelectedB(id)
      if (selectedA) {
        startMatch(selectedA, id, scenario)
      }
    }
  }

  return (
    <div className="relative w-full h-full flex flex-col p-6 gap-4 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at center, #3B2360 0%, #1A0F2E 60%, #0F0A1A 100%)',
        }}
      />

      <div className="relative z-10 flex items-center justify-between">
        <button
          onClick={() => {
            Sfx.menuMove()
            setPhase('menu')
          }}
          className="font-display text-[10px] tracking-widest text-white/70"
        >
          ← BACK
        </button>
        <h1 className="font-display text-2xl tracking-widest" style={{ color: '#FFD60A', textShadow: '4px 4px 0 rgba(0,0,0,0.6)' }}>
          {arcadeMode ? 'ARCADE MODE · PICK YOUR FIGHTER' : 'SELECT YOUR OPERATOR'}
        </h1>
        <div className="font-display text-[10px] tracking-widest text-white/70">
          {arcadeMode ? 'PLAYER 1' : `P${side === 'a' ? '1' : '2'} PICKING`}
        </div>
      </div>

      {/* Selected side display */}
      {arcadeMode ? (
        <div className="relative z-10 px-4 py-2 text-center font-display text-base tracking-widest text-white/80">
          Beat 8 stages. Final boss: Lenny himself. Win once to unlock the rest of the roster.
        </div>
      ) : (
        <div className="relative z-10 grid grid-cols-3 gap-4 items-end">
          <SideCard side="a" id={selectedA} active={side === 'a'} />
          <ScenarioPicker scenario={scenario} onChange={setScenario} />
          <SideCard side="b" id={selectedB} active={side === 'b'} />
        </div>
      )}

      {/* Roster grid */}
      <div className="relative z-10 grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3 flex-1 content-start">
        {ROSTER_ORDER.map((id) => {
          const f = getFighter(id)!
          const isLocked = UNLOCKABLES.includes(id)
          const isSelected = selectedA === id || selectedB === id
          return (
            <button
              key={id}
              onMouseEnter={() => {
                setHovered(id)
                Sfx.menuMove()
              }}
              onClick={() => !isLocked && pickFighter(id)}
              disabled={isLocked}
              className="relative aspect-square flex items-center justify-center transition-transform hover:scale-105"
              style={{
                background: `linear-gradient(180deg, ${f.accent}33, ${f.accent}11)`,
                border: `2px solid ${isSelected ? 'white' : f.accent}`,
                boxShadow:
                  hovered === id
                    ? `0 0 0 2px ${f.accent}, inset -2px -2px 0 rgba(0,0,0,0.4)`
                    : 'inset -2px -2px 0 rgba(0,0,0,0.4), inset 2px 2px 0 rgba(255,255,255,0.15)',
                cursor: isLocked ? 'not-allowed' : 'pointer',
                opacity: isLocked ? 0.4 : 1,
              }}
            >
              <Sprite fighter={f} side="a" state="stance" />
              <div
                className="absolute left-0 right-0 bottom-0 font-display text-[7px] tracking-widest text-center py-1 text-white"
                style={{ background: 'rgba(0,0,0,0.7)' }}
              >
                {f.shortName}
              </div>
              {isLocked && (
                <div className="absolute inset-0 flex items-center justify-center font-display text-xl text-white/80" style={{ background: 'rgba(0,0,0,0.6)' }}>
                  ?
                </div>
              )}
            </button>
          )
        })}
      </div>

      {hoveredFighter && (
        <div className="relative z-10 px-6 py-3 font-body text-base" style={{
          background: 'rgba(15,10,26,0.85)',
          borderTop: `2px solid ${hoveredFighter.accent}`,
        }}>
          <div className="flex items-baseline gap-3">
            <span className="font-display text-base tracking-widest" style={{ color: hoveredFighter.accent }}>
              {hoveredFighter.name.toUpperCase()}
            </span>
            <span className="font-display text-[8px] tracking-widest text-white/60">
              · {hoveredFighter.episode}
            </span>
            <span className="font-display text-[8px] tracking-widest text-white/40">
              · {hoveredFighter.archetype}
            </span>
          </div>
          <p className="text-white/80 text-xl mt-1">{hoveredFighter.bio}</p>
          <p className="text-white/60 text-base mt-1 italic">
            Signature: {hoveredFighter.ult.name} — "{hoveredFighter.ult.quote}"
          </p>
        </div>
      )}
    </div>
  )
}

function SideCard({ side, id, active }: { side: 'a' | 'b'; id: string | null; active: boolean }) {
  const f = id ? getFighter(id) : null
  return (
    <div
      className="flex flex-col items-center gap-2 p-3"
      style={{
        background: active ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.3)',
        border: `2px solid ${active ? (side === 'a' ? '#E63946' : '#00B4D8') : '#2A1F33'}`,
        boxShadow: active ? `0 0 24px ${side === 'a' ? '#E6394644' : '#00B4D844'}` : 'none',
        minHeight: 140,
      }}
    >
      <span className="font-display text-[10px] tracking-widest" style={{ color: side === 'a' ? '#E63946' : '#00B4D8' }}>
        PLAYER {side === 'a' ? '1' : '2'}
      </span>
      {f ? (
        <>
          <div style={{ width: 100, height: 140 }}>
            <Sprite fighter={f} side={side} state="stance" />
          </div>
          <span className="font-display text-[10px] tracking-widest text-white">{f.shortName}</span>
        </>
      ) : (
        <div className="font-body text-2xl text-white/40">{active ? 'PICK!' : '...'}</div>
      )}
    </div>
  )
}

function ScenarioPicker({ scenario, onChange }: { scenario: ScenarioId; onChange: (s: ScenarioId) => void }) {
  const ids = Object.keys(SCENARIOS) as ScenarioId[]
  return (
    <div className="flex flex-col items-center gap-2 p-3" style={{ background: 'rgba(0,0,0,0.3)', border: '2px solid #FFD60A' }}>
      <span className="font-display text-[10px] tracking-widest" style={{ color: '#FFD60A' }}>STAGE</span>
      <select
        value={scenario}
        onChange={(e) => {
          Sfx.menuMove()
          onChange(e.target.value as ScenarioId)
        }}
        className="font-display text-[9px] tracking-widest bg-transparent text-white border-2 border-yellow-400 px-3 py-1"
      >
        {ids.map((id) => (
          <option key={id} value={id} style={{ background: '#1A1230' }}>
            {SCENARIOS[id].name}
          </option>
        ))}
      </select>
      <p className="font-body text-base text-white/80 text-center px-2">{SCENARIOS[scenario].description}</p>
    </div>
  )
}
