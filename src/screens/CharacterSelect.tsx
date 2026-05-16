import { useMemo, useState } from 'react'
import { useGame } from '../state/game'
import { STARTING_ROSTER, getFighter, UNLOCKABLES, FIGHTERS } from '../data/fighters'
import {
  getDiscipline,
  getEra,
  DISCIPLINE_LABEL,
  DISCIPLINE_COLOR,
  ERA_LABEL,
} from '../data/fighter-taxonomy'
import { SCENARIOS } from '../data/scenarios'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'
import type { Discipline, Era, FighterDef, Move, ScenarioId } from '../types'

const ROSTER_ORDER = [...STARTING_ROSTER, ...UNLOCKABLES]

type DisciplineFilter = Discipline | 'all'
type EraFilter = Era | 'all'

const DISCIPLINE_FILTER_ORDER: DisciplineFilter[] = [
  'all', 'product', 'design', 'engineering', 'growth', 'ai', 'capital', 'ops', 'host',
]
const ERA_FILTER_ORDER: EraFilter[] = ['all', 'early', 'mid', 'recent']

export function CharacterSelect() {
  const mode = useGame((s) => s.mode)
  const startArcade = useGame((s) => s.startArcade)
  const setPhase = useGame((s) => s.setPhase)
  const [side, setSide] = useState<'a' | 'b'>('a')
  const [selectedA, setSelectedA] = useState<string | null>(null)
  const [selectedB, setSelectedB] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string>('chesky')
  const [expanded, setExpanded] = useState(false)

  // Filter state — discipline + era chips + free-text search.
  // 'all' means no filter on that axis. Search matches name, shortName,
  // archetype, bio, or any move name (case-insensitive).
  const [disciplineFilter, setDisciplineFilter] = useState<DisciplineFilter>('all')
  const [eraFilter, setEraFilter] = useState<EraFilter>('all')
  const [query, setQuery] = useState('')

  const setSelectedSide = useGame((s) => s.setSelectedSide)

  const hoveredFighter = getFighter(hovered)
  const arcadeMode = mode === 'arcade'

  const startPractice = useGame((s) => s.startPractice)

  // Distribution of fighters across disciplines — fuels the chip badges so
  // a player can see at a glance which buckets are populated.
  const disciplineCounts = useMemo(() => {
    const out: Partial<Record<Discipline, number>> = {}
    for (const id of ROSTER_ORDER) {
      const f = getFighter(id)
      if (!f) continue
      const d = getDiscipline(f)
      out[d] = (out[d] ?? 0) + 1
    }
    return out
  }, [])

  const eraCounts = useMemo(() => {
    const out: Partial<Record<Era, number>> = {}
    for (const id of ROSTER_ORDER) {
      const f = getFighter(id)
      if (!f) continue
      const e = getEra(f)
      out[e] = (out[e] ?? 0) + 1
    }
    return out
  }, [])

  // Filtered roster — applies discipline, era, and query in that order.
  // Always preserves ROSTER_ORDER so locked entries stay at the tail.
  const filteredRoster = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ROSTER_ORDER.filter((id) => {
      const f = getFighter(id)
      if (!f) return false
      if (disciplineFilter !== 'all' && getDiscipline(f) !== disciplineFilter) return false
      if (eraFilter !== 'all' && getEra(f) !== eraFilter) return false
      if (!q) return true
      const hay = [
        f.name, f.shortName, f.archetype, f.bio,
        ...f.moves.map((m) => m.name),
        f.ult.name,
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [disciplineFilter, eraFilter, query])

  function pickFighter(id: string) {
    Sfx.menuSelect()
    if (arcadeMode) {
      setSelectedA(id)
      setTimeout(() => startArcade(id), 400)
      return
    }
    if (mode === 'practice') {
      // Practice mode flow: P1 picks themselves, P2 picks dummy opponent.
      if (side === 'a') {
        setSelectedA(id)
        setSide('b')
      } else {
        setSelectedB(id)
        if (selectedA) {
          setTimeout(() => startPractice(selectedA, id), 250)
        }
      }
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

  function clearFilters() {
    Sfx.menuMove()
    setDisciplineFilter('all')
    setEraFilter('all')
    setQuery('')
  }

  const anyFilterActive = disciplineFilter !== 'all' || eraFilter !== 'all' || query.trim() !== ''
  const totalRoster = ROSTER_ORDER.length

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              Sfx.menuMove()
              setPhase('menu')
            }}
            className="font-display text-[10px] tracking-widest text-white/70"
          >
            ← BACK
          </button>
          {/* RANDOM pick — handy when players don't know who to pick, and
              for press/replay value. Picks an unlocked fighter from the
              currently-FILTERED list so the random respects the player's
              "I want a growth specialist" intent. */}
          <button
            onClick={() => {
              Sfx.menuSelect()
              const pool = filteredRoster.filter((id) => !UNLOCKABLES.includes(id))
              if (pool.length === 0) return
              const pick = pool[Math.floor(Math.random() * pool.length)]
              setHovered(pick)
              setTimeout(() => pickFighter(pick), 200)
            }}
            className="font-display text-[10px] tracking-widest px-2 py-1"
            style={{
              background: 'rgba(247,37,133,0.2)',
              color: '#F72585',
              border: '1px solid #F72585',
              boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.4)',
              cursor: 'pointer',
            }}
            title="Random from current filter"
          >
            🎲 RANDOM
          </button>
        </div>
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

      {/* FILTER BAR — discipline chips · era chips · search · reset.
          Discipline chips are color-coded to their accent so the bucket
          colors carry over into the roster cells the player just picked
          from. Counts on each chip surface how many fighters live there. */}
      <div className="relative z-10 flex-shrink-0 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-display text-[8px] tracking-widest text-white/40 pr-1">DISCIPLINE</span>
          {DISCIPLINE_FILTER_ORDER.map((d) => (
            <FilterChip
              key={d}
              label={d === 'all' ? 'ALL' : DISCIPLINE_LABEL[d]}
              count={d === 'all' ? totalRoster : (disciplineCounts[d] ?? 0)}
              color={d === 'all' ? '#FFFFFF' : DISCIPLINE_COLOR[d]}
              active={disciplineFilter === d}
              onClick={() => { Sfx.menuMove(); setDisciplineFilter(d) }}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-display text-[8px] tracking-widest text-white/40 pr-1">ERA</span>
          {ERA_FILTER_ORDER.map((e) => (
            <FilterChip
              key={e}
              label={e === 'all' ? 'ALL' : ERA_LABEL[e]}
              count={e === 'all' ? totalRoster : (eraCounts[e] ?? 0)}
              color="#FCBF49"
              active={eraFilter === e}
              onClick={() => { Sfx.menuMove(); setEraFilter(e) }}
            />
          ))}
          <div className="flex-1" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search name · framework · archetype…"
            className="px-2 py-1 font-body text-base text-white placeholder:text-white/30"
            style={{
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.2)',
              minWidth: 240,
              outline: 'none',
            }}
          />
          {anyFilterActive && (
            <button
              onClick={clearFilters}
              className="font-display text-[8px] tracking-widest px-2 py-1"
              style={{
                background: 'rgba(255,255,255,0.06)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.3)',
                cursor: 'pointer',
              }}
            >
              ✕ RESET
            </button>
          )}
        </div>
      </div>

      {/* MAIN AREA: roster + profile */}
      <div className="relative z-10 flex gap-4 flex-1 min-h-0">
        {/* LEFT: roster grid — auto-fits cells to available width.
            ~92px min-cell means we get 6 cols on a typical desktop pane
            but degrade to 5 on smaller viewports without overflowing. */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <div className="font-display text-[8px] tracking-widest text-white/40 mb-1">
            {filteredRoster.length === totalRoster
              ? `${totalRoster} OPERATORS`
              : `${filteredRoster.length} / ${totalRoster} OPERATORS`}
          </div>
          <div
            className="grid gap-2 content-start auto-rows-max overflow-y-auto pr-2"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))',
              flex: '1 1 0',
            }}
          >
            {filteredRoster.length === 0 ? (
              <div
                className="col-span-full text-center font-body text-base text-white/50 py-12"
              >
                No operators match those filters. <button
                  onClick={clearFilters}
                  className="underline hover:text-white"
                  style={{ cursor: 'pointer' }}
                >reset filters</button>.
              </div>
            ) : filteredRoster.map((id) => {
              const f = getFighter(id)!
              const isLocked = UNLOCKABLES.includes(id)
              const isSelected = selectedA === id || selectedB === id
              const isHovered = hovered === id
              const discColor = DISCIPLINE_COLOR[getDiscipline(f)]
              return (
                <button
                  key={id}
                  onMouseEnter={() => {
                    setHovered(id)
                    Sfx.menuMove()
                  }}
                  onClick={() => !isLocked && pickFighter(id)}
                  disabled={isLocked}
                  aria-label={`${f.name} — ${f.archetype}${isLocked ? ', locked' : ''}`}
                  className={`relative aspect-square flex flex-col items-center justify-center transition-transform hover:scale-105 overflow-hidden ${isSelected ? 'lock-in-pulse' : ''}`}
                  style={{
                    background: `linear-gradient(180deg, ${f.accent}33, ${f.accent}11)`,
                    border: `2px solid ${isSelected ? 'white' : isHovered ? f.accent : f.accent + '88'}`,
                    boxShadow: isSelected
                      ? `0 0 24px white, 0 0 48px ${f.accent}, inset -2px -2px 0 rgba(0,0,0,0.4)`
                      : isHovered
                      ? `0 0 16px ${f.accent}, inset -2px -2px 0 rgba(0,0,0,0.4)`
                      : 'inset -2px -2px 0 rgba(0,0,0,0.4), inset 2px 2px 0 rgba(255,255,255,0.15)',
                    cursor: isLocked ? 'not-allowed' : 'pointer',
                    opacity: isLocked ? 0.4 : 1,
                    minHeight: 92,
                  }}
                >
                  {/* Discipline marker — tiny corner pip so the player can
                      visually scan the grid by craft (PMs, designers, AI
                      builders, etc.) without reading the label. */}
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top: 4,
                      left: 4,
                      width: 8,
                      height: 8,
                      background: discColor,
                      border: '1px solid rgba(0,0,0,0.6)',
                      boxShadow: `0 0 6px ${discColor}`,
                    }}
                  />
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

function FilterChip({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string
  count: number
  color: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="font-display text-[8px] tracking-widest px-2 py-1 transition-transform hover:translate-y-[-1px]"
      style={{
        background: active ? `${color}33` : 'rgba(0,0,0,0.45)',
        color: active ? color : 'rgba(255,255,255,0.75)',
        border: `1px solid ${active ? color : 'rgba(255,255,255,0.15)'}`,
        boxShadow: active ? `0 0 10px ${color}55, inset -1px -1px 0 rgba(0,0,0,0.4)` : 'inset -1px -1px 0 rgba(0,0,0,0.4)',
        cursor: 'pointer',
        letterSpacing: '0.15em',
      }}
    >
      {label}
      <span className="ml-1.5" style={{ opacity: active ? 1 : 0.55 }}>
        {count}
      </span>
    </button>
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
          {/* Discipline + era tags — surfaces the same taxonomy the filter
              chips operate on so the player understands why a fighter
              appeared under a given filter. */}
          <div className="flex gap-2 mt-2">
            <Tag color={DISCIPLINE_COLOR[getDiscipline(fighter)]}>
              {DISCIPLINE_LABEL[getDiscipline(fighter)]}
            </Tag>
            <Tag color="#FCBF49">{ERA_LABEL[getEra(fighter)].split(' · ')[0]}</Tag>
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
          <div className="flex gap-2 mt-3">
            <button
              onClick={onToggle}
              className="font-display text-[9px] tracking-widest px-3 py-1"
              style={{
                background: `${fighter.accent}33`,
                color: fighter.accent,
                border: `1px solid ${fighter.accent}`,
              }}
            >
              {expanded ? '▾ HIDE MOVE LIST' : '▸ SEE FULL MOVE LIST'}
            </button>
            <button
              onClick={() => {
                Sfx.menuSelect()
                useGame.getState().setSpotlightFighter(fighter.id)
                useGame.getState().setPhase('fighter-spotlight')
              }}
              className="font-display text-[9px] tracking-widest px-3 py-1"
              style={{
                background: 'rgba(255,214,10,0.18)',
                color: '#FFD60A',
                border: '1px solid #FFD60A',
              }}
            >
              ★ SPOTLIGHT →
            </button>
          </div>
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

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="font-display text-[7px] tracking-widest px-1.5 py-0.5"
      style={{
        background: `${color}22`,
        color,
        border: `1px solid ${color}`,
        letterSpacing: '0.15em',
      }}
    >
      {children}
    </span>
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
          {move.type === 'ultimate' ? Math.min(move.momentum, 5) : move.momentum} MOM · {move.baseDamage} DMG
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
