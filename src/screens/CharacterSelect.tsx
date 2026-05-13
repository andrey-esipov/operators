import { useState } from 'react'
import { useGame } from '../state/game'
import { STARTING_ROSTER, getFighter, UNLOCKABLES, FIGHTERS } from '../data/fighters'
import { SCENARIOS } from '../data/scenarios'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'
import type { FighterDef, Move, ScenarioId } from '../types'

const ROSTER_ORDER = [...STARTING_ROSTER, ...UNLOCKABLES]

export function CharacterSelect() {
  const mode = useGame((s) => s.mode)
  const startArcade = useGame((s) => s.startArcade)
  const setPhase = useGame((s) => s.setPhase)
  const [side, setSide] = useState<'a' | 'b'>('a')
  const [selectedA, setSelectedA] = useState<string | null>(null)
  const [selectedB, setSelectedB] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string>('chesky')
  const [expanded, setExpanded] = useState(false)

  const setSelectedSide = useGame((s) => s.setSelectedSide)

  const hoveredFighter = getFighter(hovered)
  const arcadeMode = mode === 'arcade'

  function pickFighter(id: string) {
    Sfx.menuSelect()
    if (arcadeMode) {
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
        // Persist both picks into the store, then advance to stage select
        setSelectedSide('a', selectedA)
        setSelectedSide('b', id)
        setTimeout(() => useGame.getState().setPhase('stage-select'), 250)
      }
    }
  }

  return (
    <div className="relative w-full h-full flex flex-col p-4 gap-3 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at center, #3B2360 0%, #1A0F2E 60%, #0F0A1A 100%)',
        }}
      />

      <div className="relative z-10 flex items-center justify-between flex-shrink-0">
        <button
          onClick={() => {
            Sfx.menuMove()
            setPhase('menu')
          }}
          className="font-display text-[10px] tracking-widest text-white/70"
        >
          ← BACK
        </button>
        <h1
          className="font-display text-2xl tracking-widest"
          style={{
            color: '#FFD60A',
            textShadow: '4px 4px 0 rgba(0,0,0,0.6)',
          }}
        >
          {arcadeMode ? 'ARCADE MODE · PICK YOUR FIGHTER' : 'SELECT YOUR OPERATOR'}
        </h1>
        <div className="font-display text-[10px] tracking-widest text-white/70">
          {arcadeMode ? 'PLAYER 1' : `P${side === 'a' ? '1' : '2'} PICKING`}
        </div>
      </div>

      {/* Selected sides (VS mode only) */}
      {!arcadeMode && (
        <div className="relative z-10 grid grid-cols-3 gap-3 items-end flex-shrink-0">
          <SideCard side="a" id={selectedA} active={side === 'a'} />
          <NextStepHint hasA={!!selectedA} hasB={!!selectedB} />
          <SideCard side="b" id={selectedB} active={side === 'b'} />
        </div>
      )}

      {arcadeMode && (
        <div className="relative z-10 px-4 py-2 text-center font-display text-base tracking-widest text-white/80 flex-shrink-0">
          Beat 8 stages. Final boss: Lenny himself.
        </div>
      )}

      {/* MAIN AREA: roster + profile */}
      <div className="relative z-10 flex gap-4 flex-1 min-h-0">
        {/* LEFT: roster grid — auto-fits cells to available width.
            ~92px min-cell means we get 6 cols on a typical desktop pane
            but degrade to 5 on smaller viewports without overflowing. */}
        <div
          className="grid gap-2 content-start auto-rows-max overflow-y-auto pr-2"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))',
            flex: '1 1 0',
          }}
        >
          {ROSTER_ORDER.map((id) => {
            const f = getFighter(id)!
            const isLocked = UNLOCKABLES.includes(id)
            const isSelected = selectedA === id || selectedB === id
            const isHovered = hovered === id
            return (
              <button
                key={id}
                onMouseEnter={() => {
                  setHovered(id)
                  Sfx.menuMove()
                }}
                onClick={() => !isLocked && pickFighter(id)}
                disabled={isLocked}
                className="relative aspect-square flex flex-col items-center justify-center transition-transform hover:scale-105 overflow-hidden"
                style={{
                  background: `linear-gradient(180deg, ${f.accent}33, ${f.accent}11)`,
                  border: `2px solid ${isSelected ? 'white' : isHovered ? f.accent : f.accent + '88'}`,
                  boxShadow: isHovered
                    ? `0 0 16px ${f.accent}, inset -2px -2px 0 rgba(0,0,0,0.4)`
                    : 'inset -2px -2px 0 rgba(0,0,0,0.4), inset 2px 2px 0 rgba(255,255,255,0.15)',
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  opacity: isLocked ? 0.4 : 1,
                  minHeight: 92,
                }}
              >
                <div className="absolute inset-0 flex items-center justify-center pb-3">
                  <Sprite fighter={f} side="a" state="stance" />
                </div>
                <div
                  className="absolute left-0 right-0 bottom-0 font-display text-[8px] text-center py-[3px] text-white truncate"
                  style={{
                    background: 'rgba(0,0,0,0.78)',
                    letterSpacing: '0.5px',
                  }}
                  title={f.shortName}
                >
                  {f.shortName}
                </div>
                {isLocked && (
                  <div
                    className="absolute inset-0 flex items-center justify-center font-display text-2xl text-white/90"
                    style={{ background: 'rgba(0,0,0,0.6)' }}
                  >
                    ?
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* RIGHT: profile card */}
        {hoveredFighter && (
          <div
            className="overflow-y-auto pr-1"
            style={{
              background: 'rgba(15,10,26,0.9)',
              border: `3px solid ${hoveredFighter.accent}`,
              boxShadow: `inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.1), 0 0 24px ${hoveredFighter.accent}55`,
              flex: '0 0 420px',
              maxWidth: 420,
            }}
          >
            <ProfileCard fighter={hoveredFighter} expanded={expanded} onToggle={() => setExpanded((x) => !x)} />
          </div>
        )}
      </div>
    </div>
  )
}

function ProfileCard({
  fighter,
  expanded,
  onToggle,
}: {
  fighter: FighterDef
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="p-4">
      {/* HEADER */}
      <div className="flex gap-4 items-start">
        <div style={{ width: 130, height: 180, flexShrink: 0 }}>
          <Sprite fighter={fighter} side="a" state="stance" />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="font-display text-2xl tracking-widest"
            style={{ color: fighter.accent, textShadow: '3px 3px 0 black' }}
          >
            {fighter.name.toUpperCase()}
          </div>
          <div className="font-display text-[8px] tracking-widest text-white/60 mt-1">
            {fighter.archetype} · {fighter.episode}
          </div>
          <p className="font-body text-base text-white/90 mt-2 leading-snug">{fighter.bio}</p>
          {/* Quick stats */}
          <div className="flex gap-3 mt-3 font-display text-[8px] tracking-widest">
            <Stat label="HP" value={String(fighter.maxHp)} color="#06D6A0" />
            <Stat
              label="BEST IN"
              value={(() => {
                const tops = Object.entries(fighter.scenarioBonus)
                  .filter(([, v]) => v >= 1.3)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 2)
                  .map(([k]) => SCENARIOS[k as ScenarioId].tag)
                return tops.length > 0 ? tops.join(' / ') : 'ALL-ROUNDER'
              })()}
              color="#FFD60A"
            />
          </div>
          <button
            onClick={onToggle}
            className="mt-3 font-display text-[9px] tracking-widest px-3 py-1"
            style={{
              background: `${fighter.accent}33`,
              color: fighter.accent,
              border: `1px solid ${fighter.accent}`,
            }}
          >
            {expanded ? '▾ HIDE MOVE LIST' : '▸ SEE FULL MOVE LIST'}
          </button>
        </div>
      </div>

      {/* SIGNATURE ULT — always shown */}
      <div
        className="mt-4 p-3"
        style={{
          background: `linear-gradient(180deg, #F7258544, #F7258522)`,
          border: '2px solid #F72585',
          boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5)',
        }}
      >
        <div className="flex items-baseline justify-between">
          <span className="font-display text-[9px] tracking-widest" style={{ color: '#F72585' }}>
            ⚡ SIGNATURE ULTIMATE
          </span>
          <span className="font-num text-base tabular-nums text-white">
            {fighter.ult.baseDamage} DMG
          </span>
        </div>
        <div className="font-display text-base tracking-wider text-white mt-1">{fighter.ult.name}</div>
        <p className="font-body italic text-lg text-white/85 mt-1 leading-snug">
          &ldquo;{fighter.ult.quote}&rdquo;
        </p>
        <p className="font-display text-[7px] tracking-widest mt-1 text-white/50">
          {fighter.ult.episode} · {fighter.ult.timestamp}
        </p>
        {fighter.ult.requiresSelfStatus && (
          <p className="font-display text-[7px] tracking-widest mt-2" style={{ color: '#FFD60A' }}>
            REQUIRES: {fighter.ult.requiresSelfStatus.replace('_', ' ')}
          </p>
        )}
      </div>

      {/* MOVE LIST — expandable */}
      {expanded && (
        <div className="mt-4 space-y-2">
          <div
            className="font-display text-[10px] tracking-widest"
            style={{ color: fighter.accent, borderBottom: `1px solid ${fighter.accent}` }}
          >
            ▌ FULL MOVE LIST
          </div>
          {fighter.moves.map((m) => (
            <MoveDetail key={m.id} move={m} />
          ))}

          {/* Scenario bonus full breakdown */}
          <div
            className="font-display text-[10px] tracking-widest mt-4 pt-2"
            style={{ color: fighter.accent, borderBottom: `1px solid ${fighter.accent}` }}
          >
            ▌ SCENARIO BONUSES
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {Object.entries(fighter.scenarioBonus).map(([sc, mult]) => (
              <div
                key={sc}
                className="p-2 font-display text-[8px] tracking-widest"
                style={{
                  background: mult >= 1.5 ? '#FFD60A22' : mult >= 1.3 ? '#F7790022' : '#3B236022',
                  border: `1px solid ${mult >= 1.5 ? '#FFD60A' : mult >= 1.3 ? '#F77F00' : '#3B2360'}`,
                  color: 'white',
                }}
              >
                <div className="text-white/70">{SCENARIOS[sc as ScenarioId].name}</div>
                <div style={{ color: mult >= 1.5 ? '#FFD60A' : mult >= 1.3 ? '#F77F00' : '#90E0EF' }}>
                  +{Math.round((mult - 1) * 100)}% damage
                </div>
              </div>
            ))}
          </div>

          {/* Voice line sample */}
          <div
            className="font-display text-[10px] tracking-widest mt-4 pt-2"
            style={{ color: fighter.accent, borderBottom: `1px solid ${fighter.accent}` }}
          >
            ▌ VOICE LINES
          </div>
          <div className="font-body text-base text-white/85 leading-snug space-y-1 italic mt-2">
            <p>• Match start: &ldquo;{fighter.voiceLines.matchStart}&rdquo;</p>
            <p>• On win: &ldquo;{fighter.voiceLines.win}&rdquo;</p>
            <p>• On crit: &ldquo;{fighter.voiceLines.crit}&rdquo;</p>
            <p>• Trash talk: &ldquo;{fighter.voiceLines.trash[0]}&rdquo;</p>
          </div>
        </div>
      )}
    </div>
  )
}

function MoveDetail({ move }: { move: Move }) {
  const TYPE_COLOR: Record<Move['type'], string> = {
    light: '#90E0EF',
    heavy: '#E63946',
    setup: '#06D6A0',
    combo: '#FFD60A',
    ultimate: '#F72585',
  }
  const color = TYPE_COLOR[move.type]
  return (
    <div
      className="p-2"
      style={{
        background: `${color}22`,
        border: `1px solid ${color}`,
        boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.4)',
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[8px] tracking-widest" style={{ color }}>
          {move.type.toUpperCase()}
        </span>
        <span className="font-display text-[8px] tracking-widest text-white/60">
          {move.momentum} MOM · {move.baseDamage} DMG
        </span>
      </div>
      <div className="font-display text-[10px] tracking-wider text-white mt-1">{move.name}</div>
      <p className="font-body italic text-base text-white/85 mt-1 leading-snug">
        &ldquo;{move.quote}&rdquo;
        <span className="font-display text-[7px] tracking-widest ml-1 text-white/40">
          — {move.episode} · {move.timestamp}
        </span>
      </p>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-white/50" style={{ color }}>
        {label}
      </div>
      <div className="font-num text-base tabular-nums text-white">{value || '—'}</div>
    </div>
  )
}

function SideCard({ side, id, active }: { side: 'a' | 'b'; id: string | null; active: boolean }) {
  const f = id ? getFighter(id) : null
  return (
    <div
      className="flex flex-col items-center gap-1 p-2"
      style={{
        background: active ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.3)',
        border: `2px solid ${active ? (side === 'a' ? '#E63946' : '#00B4D8') : '#2A1F33'}`,
        boxShadow: active ? `0 0 24px ${side === 'a' ? '#E6394644' : '#00B4D844'}` : 'none',
        minHeight: 100,
      }}
    >
      <span
        className="font-display text-[10px] tracking-widest"
        style={{ color: side === 'a' ? '#E63946' : '#00B4D8' }}
      >
        PLAYER {side === 'a' ? '1' : '2'}
      </span>
      {f ? (
        <>
          <div style={{ width: 70, height: 90 }}>
            <Sprite fighter={f} side={side} state="stance" />
          </div>
          <span className="font-display text-[9px] tracking-widest text-white">{f.shortName}</span>
        </>
      ) : (
        <div className="font-body text-xl text-white/40">{active ? 'PICK!' : '...'}</div>
      )}
    </div>
  )
}

function NextStepHint({ hasA, hasB }: { hasA: boolean; hasB: boolean }) {
  const ready = hasA && hasB
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 p-3 text-center"
      style={{
        background: 'rgba(0,0,0,0.4)',
        border: `2px solid ${ready ? '#06D6A0' : '#FFD60A66'}`,
        boxShadow: ready
          ? '0 0 14px #06D6A0AA, inset -2px -2px 0 rgba(0,0,0,0.5)'
          : 'inset -2px -2px 0 rgba(0,0,0,0.5)',
      }}
    >
      <span
        className="font-display text-[10px] tracking-widest"
        style={{ color: ready ? '#06D6A0' : '#FFD60A' }}
      >
        {hasA && !hasB ? '↓ P2 PICKS' : hasA && hasB ? '✓ READY' : 'P1 PICKS FIRST'}
      </span>
      <p className="font-body text-sm text-white/70 leading-snug">
        {ready
          ? 'Next: select your battleground.'
          : 'After both picks you choose the stage (or let it auto-pick).'}
      </p>
    </div>
  )
}

// Suppress unused-import warning for FIGHTERS / ScenarioId — kept for type references inside SCENARIOS lookups
void FIGHTERS
void (null as ScenarioId | null)