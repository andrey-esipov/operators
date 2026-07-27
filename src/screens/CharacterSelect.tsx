import { useMemo, useState, useRef, useCallback } from 'react'
import { useGame } from '../state/game'
import './select/select.css'
import { STARTING_ROSTER, getFighter, UNLOCKABLES, FIGHTERS } from '../data/fighters'
import { isMarquee } from '../data/story-career-arcs'
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

// Player-side identity colours. Warm = P1, cool = P2. Reinforced everywhere
// (hero frame, VS strip, roster selection) so it's always obvious whose turn
// it is and which fighter belongs to whom.
const SIDE_COLOR = { a: '#E63946', b: '#00B4D8' } as const
const SIDE_GLOW = { a: '#F77F00', b: '#0077B6' } as const
const SIDE_LABEL = { a: 'PLAYER 1', b: 'PLAYER 2' } as const

export function CharacterSelect() {
  const mode = useGame((s) => s.mode)
  const startArcade = useGame((s) => s.startArcade)
  const startStory = useGame((s) => s.startStory)
  const setPhase = useGame((s) => s.setPhase)
  const [side, setSide] = useState<'a' | 'b'>('a')
  const [selectedA, setSelectedA] = useState<string | null>(null)
  const [selectedB, setSelectedB] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string>('chesky')
  const [expanded, setExpanded] = useState(false)
  const gridRef = useRef<HTMLDivElement | null>(null)

  // Filter state — discipline + era chips + free-text search.
  // 'all' means no filter on that axis. Search matches name, shortName,
  // archetype, bio, or any move name (case-insensitive).
  const [disciplineFilter, setDisciplineFilter] = useState<DisciplineFilter>('all')
  const [eraFilter, setEraFilter] = useState<EraFilter>('all')
  const [query, setQuery] = useState('')

  const setSelectedSide = useGame((s) => s.setSelectedSide)

  const hoveredFighter = getFighter(hovered)
  const arcadeMode = mode === 'arcade'
  const storyMode = mode === 'story'
  const singlePickerMode = arcadeMode || storyMode

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
    if (storyMode) {
      setSelectedA(id)
      setTimeout(() => startStory(id), 400)
      return
    }
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

  // Keyboard navigation over the roster grid. Native <button> focus already
  // gives Tab + Enter; this layers arrow-key movement (measuring the live
  // column count from the DOM so it tracks the responsive grid) and Enter/Space
  // to pick — strictly better than today.
  const onRosterKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const key = e.key
      if (
        key !== 'ArrowRight' && key !== 'ArrowLeft' &&
        key !== 'ArrowUp' && key !== 'ArrowDown' &&
        key !== 'Enter' && key !== ' '
      ) return
      const list = filteredRoster
      if (list.length === 0) return
      const cur = Math.max(0, list.indexOf(hovered))
      if (key === 'Enter' || key === ' ') {
        e.preventDefault()
        const id = list[cur]
        if (id && !UNLOCKABLES.includes(id)) pickFighter(id)
        return
      }
      e.preventDefault()
      // Derive columns by counting cells that share the first row's top offset.
      const grid = gridRef.current
      let cols = 6
      if (grid) {
        const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-cell]'))
        if (cells.length > 1) {
          const top0 = cells[0].offsetTop
          const c = cells.filter((el) => el.offsetTop === top0).length
          if (c > 0) cols = c
        }
      }
      let next = cur
      if (key === 'ArrowRight') next = Math.min(list.length - 1, cur + 1)
      else if (key === 'ArrowLeft') next = Math.max(0, cur - 1)
      else if (key === 'ArrowDown') next = Math.min(list.length - 1, cur + cols)
      else if (key === 'ArrowUp') next = Math.max(0, cur - cols)
      if (next !== cur) {
        Sfx.menuMove()
        setHovered(list[next])
        gridRef.current?.querySelector<HTMLElement>(`[data-cell="${list[next]}"]`)?.focus()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredRoster, hovered]
  )

  const sideColor = SIDE_COLOR[side]
  const sideGlow = SIDE_GLOW[side]
  const heroAccent = hoveredFighter?.accent ?? '#F72585'
  const heroDiscipline = hoveredFighter ? getDiscipline(hoveredFighter) : 'product'

  return (
    <div
      className="sel-root flex flex-col p-4 gap-3"
      style={{
        ['--sel-accent' as string]: heroAccent,
        ['--sel-side' as string]: sideColor,
      }}
    >
      {/* Layered, art-directed background */}
      <div className="sel-bg" />
      <div className="sel-bg-bands" />
      <div className="sel-bg-grid" />
      <div className="sel-bg-vignette" />

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
          className="font-display text-lg tracking-widest relative"
          style={{
            color: '#C79216',
            textShadow: `2px 2px 0 rgba(0,0,0,0.7), 0 0 12px ${sideGlow}44`,
            opacity: 0.92,
          }}
        >
          {storyMode
            ? "STORY MODE · TONIGHT'S GUEST"
            : arcadeMode
              ? 'ARCADE · PICK YOUR FIGHTER'
              : 'SELECT YOUR OPERATOR'}
        </h1>
        <div
          className="font-display text-[10px] tracking-widest px-3 py-1.5"
          style={{
            color: sideColor,
            background: `linear-gradient(180deg, ${sideColor}2E, ${sideColor}10)`,
            border: `1px solid ${sideColor}`,
            boxShadow: `inset -2px -2px 0 rgba(0,0,0,0.4), 0 0 14px ${sideColor}55`,
            clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
          }}
        >
          {singlePickerMode ? '▸ PLAYER 1' : `▸ ${SIDE_LABEL[side]} · CHOOSE`}
        </div>
      </div>

      {/* MAIN: dominant hero (left) + subordinate roster (right) */}
      <div className="relative z-10 flex gap-4 flex-1 min-h-0">
        {/* ─── HERO STAGE — the biggest thing on screen ─────────────── */}
        {hoveredFighter && (
          <div
            className="sel-hero flex-shrink-0 flex flex-col"
            style={{ flex: '0 0 clamp(400px, 34%, 560px)' }}
          >
            <div className="relative flex-1 min-h-0">
              <div className="sel-hero-slab" />
              <div className="sel-hero-halo" />
              <div className="sel-hero-watermark">
                {DISCIPLINE_LABEL[heroDiscipline]}
              </div>
              <div className="sel-hero-floor" />
              {/* Keyed by id so the render snaps/re-animates on every swap */}
              <div className="sel-hero-figure" key={hoveredFighter.id}>
                <div style={{ width: '86%', height: '96%' }}>
                  <Sprite fighter={hoveredFighter} side={side} state="stance" />
                </div>
              </div>
              {/* Player-identity tab — asserts P1/P2 by side colour regardless of
                  the character-specific accent behind the fighter. */}
              {!singlePickerMode && (
                <div
                  className="absolute top-3 left-3 z-10 font-display text-[9px] tracking-widest px-2.5 py-1.5"
                  style={{
                    color: '#fff',
                    background: `linear-gradient(180deg, ${sideColor}, ${sideColor}bb)`,
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 8px rgba(0,0,0,0.6), 0 0 16px ${sideColor}88`,
                    clipPath: 'polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
                    textShadow: '1px 1px 0 rgba(0,0,0,0.6)',
                  }}
                >
                  ▸ {SIDE_LABEL[side]}
                </div>
              )}
            </div>

            {/* Nameplate + core identity — animates in on swap */}
            <HeroNameplate
              key={`np-${hoveredFighter.id}`}
              fighter={hoveredFighter}
              side={side}
              expanded={expanded}
              onToggleMoves={() => { Sfx.menuMove(); setExpanded((x) => !x) }}
            />
          </div>
        )}

        {/* ─── RIGHT COLUMN — VS strip · filters · roster ───────────── */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 gap-3">
          {/* VS strip (VS mode only) — compact player identity */}
          {!singlePickerMode && (
            <div className="flex items-stretch gap-2 flex-shrink-0">
              <PickSlot side="a" id={selectedA} active={side === 'a'} />
              <div className="flex flex-col items-center justify-center px-1">
                <span
                  className="font-display text-lg"
                  style={{ color: '#FFD60A', textShadow: '2px 2px 0 black' }}
                >
                  VS
                </span>
                <span className="font-display text-[7px] tracking-widest text-white/50 mt-1 text-center">
                  {selectedA && selectedB ? 'READY' : selectedA ? 'P2 PICKS' : 'P1 PICKS'}
                </span>
              </div>
              <PickSlot side="b" id={selectedB} active={side === 'b'} />
            </div>
          )}

          {(arcadeMode || storyMode) && (
            <div
              className="relative flex-shrink-0 px-3 py-2 text-center font-display text-[10px] tracking-widest"
              style={{
                color: storyMode ? '#F72585' : '#FCBF49',
                background: 'rgba(0,0,0,0.35)',
                border: `1px solid ${storyMode ? '#F7258566' : '#FCBF4966'}`,
              }}
            >
              {arcadeMode ? 'BEAT 8 STAGES · FINAL BOSS: LENNY' : '8 CHAPTERS · LENNY IN THE FINAL SEGMENT'}
            </div>
          )}

          {/* FILTER CONSOLE — a recessed material panel so the chips read as
              raised switches sitting inside a physical control cluster. */}
          <div
            className="flex-shrink-0 flex flex-col gap-2 px-3 py-2.5"
            style={{
              background: 'linear-gradient(180deg, rgba(8,5,14,0.94), rgba(17,11,27,0.92))',
              boxShadow: 'inset 0 3px 10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 0 1px rgba(255,255,255,0.05)',
              clipPath: 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)',
            }}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="font-display text-[8px] tracking-widest px-1.5 py-1 mr-0.5"
                style={{ color: 'rgba(255,255,255,0.5)', background: 'rgba(0,0,0,0.5)', boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.6)', letterSpacing: '0.15em' }}
              >DISCIPLINE</span>
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
          <span
            className="font-display text-[8px] tracking-widest px-1.5 py-1 mr-0.5"
            style={{ color: 'rgba(255,255,255,0.5)', background: 'rgba(0,0,0,0.5)', boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.6)', letterSpacing: '0.15em' }}
          >ERA</span>
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
          <div
            className="flex items-center gap-1.5 px-2 py-1"
            style={{
              background: 'linear-gradient(180deg, rgba(0,0,0,0.7), rgba(0,0,0,0.5))',
              border: `1px solid ${query ? sideColor : 'rgba(255,255,255,0.18)'}`,
              boxShadow: query
                ? `inset 2px 2px 4px rgba(0,0,0,0.75), inset -1px -1px 0 rgba(255,255,255,0.12), 0 0 10px ${sideColor}44`
                : 'inset 2px 2px 4px rgba(0,0,0,0.75), inset -1px -1px 0 rgba(255,255,255,0.12)',
              clipPath: 'polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)',
              minWidth: 150,
              maxWidth: 220,
            }}
          >
            <span aria-hidden className="font-display text-[11px] leading-none" style={{ color: query ? sideColor : 'rgba(255,255,255,0.5)', textShadow: query ? `0 0 6px ${sideColor}` : 'none' }}>⌕</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search…"
              className="flex-1 min-w-0 bg-transparent font-body text-base text-white placeholder:text-white/30"
              style={{ outline: 'none', border: 'none' }}
            />
          </div>
          {anyFilterActive && (
            <button
              onClick={clearFilters}
              className="sel-chip font-display text-[8px] tracking-widest px-2 py-1"
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

      {/* ROSTER — dense, subordinate to the hero */}
      <div className="relative flex flex-col flex-1 min-w-0 min-h-0">
        <div className="font-display text-[9px] tracking-widest text-white/55 mb-1.5 flex-shrink-0" style={{ textShadow: '1px 1px 0 #000' }}>
          {filteredRoster.length === totalRoster
            ? '▸ CHOOSE YOUR OPERATOR'
            : `▸ ${filteredRoster.length} MATCH`}
        </div>
        <div
          ref={gridRef}
          role="listbox"
          aria-label="Operator roster"
          tabIndex={0}
          onKeyDown={onRosterKey}
          className="grid gap-2 content-start auto-rows-max overflow-y-auto pr-2 pt-1 outline-none"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
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
              const isHovered = hovered === id
              const discColor = DISCIPLINE_COLOR[getDiscipline(f)]
              // In Story Mode, the marquee 8 get a visible gold rim + star
              // badge so players know which fighters have a hand-written
              // career arc waiting for them. Non-marquee fighters still play
              // Story Mode but get the universal tournament dialogue.
              const marquee = storyMode && isMarquee(id)
              const selByA = selectedA === id
              const selByB = selectedB === id
              const isCursor = isHovered
              // Uniform, legible border language (kills the old rainbow):
              //  · picked  → that player's colour (P1 warm / P2 cool) + white
              //  · cursor  → the active side's colour, thick
              //  · marquee → gold rim
              //  · idle    → quiet neutral edge; craft is carried by the pip
              const borderCol = selByA
                ? SIDE_COLOR.a
                : selByB
                ? SIDE_COLOR.b
                : isCursor
                ? sideColor
                : marquee
                ? '#FFD60A'
                : 'rgba(255,255,255,0.12)'
              const pickGlow = selByA ? SIDE_COLOR.a : selByB ? SIDE_COLOR.b : sideColor
              return (
                <button
                  key={id}
                  data-cell={id}
                  onMouseEnter={() => {
                    setHovered(id)
                    Sfx.menuMove()
                  }}
                  onClick={() => !isLocked && pickFighter(id)}
                  disabled={isLocked}
                  aria-label={`${f.name} — ${f.archetype}${isLocked ? ', locked' : ''}${marquee ? ', ★ marquee story arc' : ''}`}
                  aria-selected={isCursor}
                  className={`sel-cell relative aspect-square flex flex-col items-center justify-center overflow-hidden ${isCursor ? 'sel-cell-cursor' : ''} ${(selByA || selByB) ? 'sel-confirm-pop' : ''} ${marquee && !isCursor ? 'marquee-pulse' : ''}`}
                  style={{
                    background: marquee
                      ? 'linear-gradient(180deg, rgba(255,240,200,0.1) 0%, rgba(60,48,20,0.78) 14%, rgba(12,8,20,0.94) 100%)'
                      : 'linear-gradient(180deg, rgba(255,255,255,0.09) 0%, rgba(46,33,66,0.78) 14%, rgba(11,7,18,0.95) 100%)',
                    border: `${(selByA || selByB || isCursor) ? '2px' : '1px'} solid ${borderCol}`,
                    boxShadow: (selByA || selByB)
                      ? `0 0 0 2px ${pickGlow}, 0 0 22px ${pickGlow}, inset 0 -14px 18px -12px ${f.accent}`
                      : isCursor
                      ? `0 0 18px ${sideColor}cc, inset 0 -16px 20px -12px ${f.accent}, inset 0 1px 0 rgba(255,255,255,0.16)`
                      : marquee
                      ? `0 0 12px #FFD60A55, inset -2px -2px 0 rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)`
                      : 'inset 0 2px 0 rgba(255,255,255,0.12), inset -2px -3px 0 rgba(0,0,0,0.55), 0 4px 9px rgba(0,0,0,0.5)',
                    cursor: isLocked ? 'not-allowed' : 'pointer',
                    opacity: isLocked ? 0.4 : (isCursor || selByA || selByB || marquee) ? 1 : 0.7,
                    filter: isLocked
                      ? 'none'
                      : isCursor
                      ? 'brightness(1.14) saturate(1.06)'
                      : (selByA || selByB || marquee)
                      ? 'none'
                      : 'brightness(0.58) saturate(0.85)',
                    minHeight: 84,
                  }}
                >
                  {/* Discipline pip — the one intentional colour cue, so the
                      grid stays scannable by craft without rainbow borders. */}
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top: 4,
                      left: 4,
                      width: 7,
                      height: 7,
                      background: discColor,
                      border: '1px solid rgba(0,0,0,0.6)',
                      boxShadow: `0 0 6px ${discColor}`,
                    }}
                  />
                  {/* Player-pick corner flag */}
                  {(selByA || selByB) && (
                    <span
                      className="absolute top-0 right-0 font-display text-[7px] px-1 py-0.5"
                      style={{
                        color: 'white',
                        background: selByA ? SIDE_COLOR.a : SIDE_COLOR.b,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.6)',
                      }}
                    >
                      {selByA ? 'P1' : 'P2'}
                    </span>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center pb-3">
                    <Sprite fighter={f} side={selByB ? 'b' : 'a'} state="stance" />
                  </div>
                  <div
                    className="absolute left-0 right-0 bottom-0 font-display text-center py-[3px] text-white truncate"
                    style={{
                      background: 'rgba(0,0,0,0.82)',
                      fontSize: f.shortName.length > 8 ? '6.5px' : '8px',
                      letterSpacing: f.shortName.length > 8 ? '0' : '0.5px',
                      borderTop: `1px solid ${isCursor ? sideColor : 'transparent'}`,
                    }}
                    title={f.shortName}
                  >
                    {f.shortName.toUpperCase()}
                  </div>
                  {isLocked && (
                    <div
                      className="absolute inset-0 flex items-center justify-center font-display text-2xl text-white/90"
                      style={{ background: 'rgba(0,0,0,0.6)' }}
                    >
                      ?
                    </div>
                  )}
                  {marquee && !isLocked && (
                    <div
                      className="absolute font-display"
                      style={{
                        top: 3,
                        right: 3,
                        fontSize: 9,
                        lineHeight: 1,
                        color: '#FFD60A',
                        textShadow: '1px 1px 0 black, 0 0 6px #FFD60A',
                        letterSpacing: '0.05em',
                      }}
                      title="Marquee operator — bespoke 8-chapter story arc"
                      aria-hidden
                    >
                      ★
                    </div>
                  )}
                </button>
              )
            })}
          </div>
          {expanded && hoveredFighter && (
            <MoveDrawer fighter={hoveredFighter} onClose={() => { Sfx.menuMove(); setExpanded(false) }} />
          )}
        </div>
      </div>
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
      title={`${count} operators`}
      className="sel-chip font-display text-[8px] tracking-widest px-2 py-1"
      style={{
        background: active
          ? `linear-gradient(180deg, ${color}44, ${color}18)`
          : 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.4))',
        color: active ? '#fff' : 'rgba(255,255,255,0.7)',
        border: `1px solid ${active ? color : 'rgba(255,255,255,0.12)'}`,
        boxShadow: active
          ? `0 0 12px ${color}66, inset 0 1px 0 rgba(255,255,255,0.2), inset -1px -1px 0 rgba(0,0,0,0.4)`
          : 'inset 0 1px 0 rgba(255,255,255,0.06), inset -1px -1px 0 rgba(0,0,0,0.4)',
        cursor: 'pointer',
        letterSpacing: '0.15em',
        clipPath: 'polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)',
      }}
    >
      <span
        aria-hidden
        className="inline-block mr-1.5 align-middle"
        style={{ width: 6, height: 6, background: color, boxShadow: active ? `0 0 5px ${color}` : 'none', opacity: active ? 1 : 0.45 }}
      />
      {label}
    </button>
  )
}

function HeroNameplate({
  fighter,
  side,
  expanded,
  onToggleMoves,
}: {
  fighter: FighterDef
  side: 'a' | 'b'
  expanded: boolean
  onToggleMoves: () => void
}) {
  const sideColor = SIDE_COLOR[side]
  const bestIn = (() => {
    const tops = Object.entries(fighter.scenarioBonus)
      .filter(([, v]) => v >= 1.3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([k]) => SCENARIOS[k as ScenarioId].tag)
    return tops.length > 0 ? tops : ['ALL-ROUNDER']
  })()
  const hpPct = Math.max(0.35, Math.min(1, fighter.maxHp / 1200))

  return (
    <div
      className="sel-nameplate flex-shrink-0 px-4 pt-3 pb-3"
      style={{
        background: `linear-gradient(180deg, ${fighter.accent}14, rgba(10,7,20,0.92) 55%)`,
        borderTop: `2px solid ${fighter.accent}`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), 0 -6px 20px -8px ${fighter.accent}`,
      }}
    >
      {/* Name + episode */}
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div
            className="font-display leading-none"
            style={{
              fontSize: 'clamp(20px, 2.6vw, 36px)',
              color: '#fff',
              textShadow: `3px 3px 0 #000, 0 0 22px ${fighter.accent}aa`,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
            title={fighter.name}
          >
            {fighter.name.toUpperCase()}
          </div>
          <div className="font-display text-[8px] tracking-widest mt-1" style={{ color: fighter.accent }}>
            {fighter.archetype} · {fighter.episode}
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <Tag color={DISCIPLINE_COLOR[getDiscipline(fighter)]}>
            {DISCIPLINE_LABEL[getDiscipline(fighter)]}
          </Tag>
          <Tag color="#FCBF49">{ERA_LABEL[getEra(fighter)].split(' · ')[0]}</Tag>
        </div>
      </div>

      {/* Bio — kept to a single storytelling line */}
      <p className="font-body text-base text-white/85 mt-2 leading-snug line-clamp-2">
        {fighter.bio}
      </p>

      {/* HP bar + BEST IN */}
      <div className="flex items-center gap-3 mt-2.5">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-display text-[8px] tracking-widest" style={{ color: '#06D6A0' }}>HP</span>
          <div className="flex-1 h-2.5 relative" style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.15)' }}>
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: `${hpPct * 100}%`,
                background: 'linear-gradient(180deg, #29f0b4, #06D6A0)',
                boxShadow: '0 0 8px #06D6A0aa',
              }}
            />
          </div>
          <span className="font-num text-base tabular-nums text-white">{fighter.maxHp}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        <span className="font-display text-[7px] tracking-widest text-white/40">BEST IN</span>
        {bestIn.map((t) => (
          <span
            key={t}
            className="font-display text-[7px] tracking-widest px-1.5 py-0.5"
            style={{ color: '#FFD60A', background: '#FFD60A1A', border: '1px solid #FFD60A66' }}
          >
            {t}
          </span>
        ))}
      </div>

      {/* Signature ult — hero ribbon, compact */}
      <div
        className="mt-2.5 px-3 py-2 relative overflow-hidden"
        style={{
          background: 'linear-gradient(100deg, #7209B755, #F7258533)',
          borderLeft: '3px solid #F72585',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
        }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display text-[8px] tracking-widest" style={{ color: '#F72585' }}>⚡ ULTIMATE</span>
          <span className="font-num text-base tabular-nums text-white/90">{fighter.ult.baseDamage} DMG</span>
        </div>
        <div className="font-display text-[11px] tracking-wider text-white mt-0.5 truncate" title={fighter.ult.name}>
          {fighter.ult.name}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-2.5">
        <button
          onClick={onToggleMoves}
          className="sel-chip flex-1 font-display text-[9px] tracking-widest px-3 py-1.5"
          style={{
            background: expanded ? `${sideColor}33` : `${fighter.accent}22`,
            color: '#fff',
            border: `1px solid ${expanded ? sideColor : fighter.accent}`,
            cursor: 'pointer',
          }}
        >
          {expanded ? '▾ HIDE DETAILS' : '▸ MOVE LIST'}
        </button>
        <button
          onClick={() => {
            Sfx.menuSelect()
            useGame.getState().setSpotlightFighter(fighter.id)
            useGame.getState().setPhase('fighter-spotlight')
          }}
          className="sel-chip flex-1 font-display text-[9px] tracking-widest px-3 py-1.5"
          style={{
            background: 'rgba(255,214,10,0.16)',
            color: '#FFD60A',
            border: '1px solid #FFD60A',
            cursor: 'pointer',
          }}
        >
          ★ SPOTLIGHT
        </button>
      </div>
    </div>
  )
}

/**
 * Full spec-sheet content (move list · scenario bonuses · voice lines), now
 * behind a toggle so the default view stays a clean hero portrait rather than
 * a wall of text. Rendered as a material drawer over the roster.
 */
function MoveDrawer({ fighter, onClose }: { fighter: FighterDef; onClose: () => void }) {
  return (
    <div
      className="sel-panel absolute z-30 overflow-y-auto p-4"
      style={{
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(440px, 60%)',
        borderLeft: `3px solid ${fighter.accent}`,
        boxShadow: `-12px 0 40px rgba(0,0,0,0.6), inset 0 0 40px ${fighter.accent}18`,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="font-display text-sm tracking-widest" style={{ color: fighter.accent, textShadow: '2px 2px 0 #000' }}>
          {fighter.name.toUpperCase()}
        </div>
        <button
          onClick={onClose}
          className="sel-chip font-display text-[9px] tracking-widest px-2 py-1"
          style={{ color: '#fff', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}
        >
          ✕ CLOSE
        </button>
      </div>

      <div className="font-display text-[10px] tracking-widest pb-1 mb-2" style={{ color: fighter.accent, borderBottom: `1px solid ${fighter.accent}` }}>
        ▌ FULL MOVE LIST
      </div>
      <div className="space-y-2">
        {fighter.moves.map((m) => (
          <MoveDetail key={m.id} move={m} />
        ))}
      </div>

      <div className="font-display text-[10px] tracking-widest mt-4 pb-1 mb-2" style={{ color: fighter.accent, borderBottom: `1px solid ${fighter.accent}` }}>
        ▌ SCENARIO BONUSES
      </div>
      <div className="grid grid-cols-2 gap-2">
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

      <div className="font-display text-[10px] tracking-widest mt-4 pb-1 mb-2" style={{ color: fighter.accent, borderBottom: `1px solid ${fighter.accent}` }}>
        ▌ VOICE LINES
      </div>
      <div className="font-body text-base text-white/85 leading-snug space-y-1 italic">
        <p>• Match start: &ldquo;{fighter.voiceLines.matchStart}&rdquo;</p>
        <p>• On win: &ldquo;{fighter.voiceLines.win}&rdquo;</p>
        <p>• On crit: &ldquo;{fighter.voiceLines.crit}&rdquo;</p>
        <p>• Trash talk: &ldquo;{fighter.voiceLines.trash[0]}&rdquo;</p>
      </div>
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

function PickSlot({ side, id, active }: { side: 'a' | 'b'; id: string | null; active: boolean }) {
  const f = id ? getFighter(id) : null
  const color = SIDE_COLOR[side]
  const glow = SIDE_GLOW[side]
  return (
    <div
      className={`sel-panel flex items-center gap-2 px-2 py-1.5 flex-1 min-w-0 ${active && !f ? 'sel-slot-active' : ''}`}
      style={{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ['--sel-side' as any]: color,
        borderTop: `2px solid ${color}`,
        boxShadow: f
          ? `inset 0 0 0 1px ${color}88, 0 0 14px ${color}44`
          : active
          ? undefined
          : 'inset -2px -2px 0 rgba(0,0,0,0.45)',
        flexDirection: side === 'b' ? 'row-reverse' : 'row',
        textAlign: side === 'b' ? 'right' : 'left',
      }}
    >
      <div
        className="flex-shrink-0 relative"
        style={{
          width: 48,
          height: 56,
          background: f ? `radial-gradient(60% 60% at 50% 45%, ${glow}55, transparent)` : 'rgba(0,0,0,0.35)',
          border: `1px solid ${f ? color : 'rgba(255,255,255,0.12)'}`,
        }}
      >
        {f ? (
          <Sprite fighter={f} side={side} state="stance" />
        ) : (
          <div className="w-full h-full flex items-center justify-center font-display text-[9px]" style={{ color: active ? color : 'rgba(255,255,255,0.3)' }}>
            {active ? '?' : '—'}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-[9px] tracking-widest" style={{ color }}>
          {SIDE_LABEL[side]}
        </div>
        <div className="font-display text-[11px] tracking-wider text-white truncate" style={{ textShadow: '1px 1px 0 #000' }}>
          {f ? f.shortName : active ? 'CHOOSING…' : 'WAITING'}
        </div>
      </div>
    </div>
  )
}

// Suppress unused-import warning for FIGHTERS / ScenarioId — kept for type references inside SCENARIOS lookups
void FIGHTERS
void (null as ScenarioId | null)
