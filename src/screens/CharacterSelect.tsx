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
import { heroYOffset, portraitYOffset } from './select/hero-framing'
import type { Discipline, Era, FighterDef, Move, ScenarioId } from '../types'

const ROSTER_ORDER = [...STARTING_ROSTER, ...UNLOCKABLES]

// Dev-only store bridge so screenshot/automation tooling can drive phase and
// picks deterministically without walking the whole menu tree. Stripped from
// production builds by the `import.meta.env.DEV` guard.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __ops?: unknown }).__ops = useGame
}

type DisciplineFilter = Discipline | 'all'
type EraFilter = Era | 'all'

const DISCIPLINE_FILTER_ORDER: DisciplineFilter[] = [
  'all', 'product', 'design', 'engineering', 'growth', 'ai', 'capital', 'ops', 'host',
]
const ERA_FILTER_ORDER: EraFilter[] = ['all', 'early', 'mid', 'recent']

// Player-side identity. Warm = P1, cool = P2. This is the ONLY saturated colour
// that carries meaning across the whole screen; the operator accent is used
// purely as light so the chrome never turns into a rainbow.
const SIDE_COLOR = { a: '#E63946', b: '#00B4D8' } as const
const SIDE_LABEL = { a: 'PLAYER 1', b: 'PLAYER 2' } as const

// Base vertical framing (before per-fighter offset). Tuned so the standard
// 1024² stance art reads as a chest-up portrait in the grid and a full,
// floor-planted figure in the hero.
const PORTRAIT_BASE = -13
const HERO_BASE = 2

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

  const [disciplineFilter, setDisciplineFilter] = useState<DisciplineFilter>('all')
  const [eraFilter, setEraFilter] = useState<EraFilter>('all')
  const [query, setQuery] = useState('')

  const setSelectedSide = useGame((s) => s.setSelectedSide)
  const startPractice = useGame((s) => s.startPractice)

  const hoveredFighter = getFighter(hovered)
  const arcadeMode = mode === 'arcade'
  const storyMode = mode === 'story'
  const singlePickerMode = arcadeMode || storyMode

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
      setTimeout(() => startStory(id), 420)
      return
    }
    if (arcadeMode) {
      setSelectedA(id)
      setTimeout(() => startArcade(id), 420)
      return
    }
    if (mode === 'practice') {
      if (side === 'a') {
        setSelectedA(id)
        setSide('b')
      } else {
        setSelectedB(id)
        if (selectedA) setTimeout(() => startPractice(selectedA, id), 260)
      }
      return
    }
    if (side === 'a') {
      setSelectedA(id)
      setSide('b')
    } else {
      setSelectedB(id)
      if (selectedA) {
        setSelectedSide('a', selectedA)
        setSelectedSide('b', id)
        setTimeout(() => useGame.getState().setPhase('stage-select'), 320)
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
      const grid = gridRef.current
      let cols = 8
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
  const heroAccent = hoveredFighter?.accent ?? '#F72585'

  // Standoff sides. Each panel shows that player's committed pick; the side
  // that is currently choosing tracks the live cursor so both fighters face
  // off across the roster the way SF6/KOF/Tekken stage the pre-fight standoff.
  const p1Fighter: FighterDef | null = selectedA ? (getFighter(selectedA) ?? null) : (side === 'a' ? (hoveredFighter ?? null) : null)
  const p2Fighter: FighterDef | null = selectedB ? (getFighter(selectedB) ?? null) : (side === 'b' ? (hoveredFighter ?? null) : null)
  const numOf = (f: FighterDef | null) => (f ? String(Math.max(0, ROSTER_ORDER.indexOf(f.id)) + 1).padStart(2, '0') : '00')

  return (
    <div
      className="sel-root flex flex-col"
      style={{
        ['--sel-accent' as string]: heroAccent,
        ['--sel-side' as string]: sideColor,
        ['--sel-p1' as string]: SIDE_COLOR.a,
        ['--sel-p2' as string]: SIDE_COLOR.b,
        padding: '14px 16px 16px',
        gap: 10,
      }}
    >
      {/* Layered atmospheric background */}
      <div className="sel-bg" />
      <div className="sel-bg-glow" />
      <div className="sel-bg-bands" />
      <div className="sel-bg-scan" />
      <div className="sel-bg-vignette" />

      {/* ── Header rail ─────────────────────────────────────────────── */}
      <div className="relative z-10 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { Sfx.menuMove(); setPhase('menu') }}
            className="sel-btn sel-h"
            style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)', padding: '4px 4px' }}
          >
            ‹ BACK
          </button>
          <button
            onClick={() => {
              Sfx.menuSelect()
              const pool = filteredRoster.filter((id) => !UNLOCKABLES.includes(id))
              if (pool.length === 0) return
              const pick = pool[Math.floor(Math.random() * pool.length)]
              setHovered(pick)
              setTimeout(() => pickFighter(pick), 220)
            }}
            className="sel-btn sel-h"
            style={{
              fontSize: 11,
              color: '#fff',
              padding: '5px 12px',
              background: 'linear-gradient(180deg, #2a2036, #16101f)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -2px 0 rgba(0,0,0,0.55)',
              clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
            }}
            title="Random from current filter"
          >
            ⤨ RANDOM
          </button>
        </div>

        {singlePickerMode ? (
          <h1
            className="sel-name-face"
            style={{
              fontSize: 26,
              letterSpacing: '0.14em',
              color: '#fff',
              textShadow: `2px 2px 0 rgba(0,0,0,0.8), 0 0 22px ${sideColor}66`,
              lineHeight: 1,
            }}
          >
            {storyMode ? "TONIGHT'S GUEST" : 'PICK YOUR FIGHTER'}
          </h1>
        ) : (
          <div className="sel-matchup" aria-label="matchup">
            <div className="sel-matchup-side sel-matchup-a">
              <span className="sel-name sel-matchup-name" title={p1Fighter?.name}>
                {p1Fighter ? p1Fighter.shortName : '—'}
              </span>
              <span className="sel-matchup-tag sel-h" style={{ color: SIDE_COLOR.a }}>P1</span>
            </div>
            <div className="sel-matchup-vs sel-name-face" aria-hidden>
              <span>VS</span>
            </div>
            <div className="sel-matchup-side sel-matchup-b">
              <span className="sel-matchup-tag sel-h" style={{ color: SIDE_COLOR.b }}>P2</span>
              <span className="sel-name sel-matchup-name" title={p2Fighter?.name}>
                {p2Fighter ? p2Fighter.shortName : '—'}
              </span>
            </div>
          </div>
        )}

        <div
          className="sel-h"
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.2em',
            color: '#fff',
            padding: '6px 14px',
            background: `linear-gradient(180deg, ${sideColor}, ${sideColor}99)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35), 0 0 16px ${sideColor}66`,
            clipPath: 'polygon(8px 0, 100% 0, 100% 100%, calc(100% - 8px) 100%, 0 100%, 0 0)',
            textShadow: '1px 1px 0 rgba(0,0,0,0.6)',
          }}
        >
          {singlePickerMode ? '▸ CHOOSE' : `▸ ${SIDE_LABEL[side]} · CHOOSE`}
        </div>
      </div>

      {/* ── Main: P1 standoff · roster · P2 standoff ──────────────────── */}
      <div className="relative z-10 flex gap-3 flex-1 min-h-0">
        {/* P1 standoff (left, faces inward) */}
        <StandoffHero
          side="a"
          fighter={p1Fighter}
          num={numOf(p1Fighter)}
          active={singlePickerMode ? true : side === 'a' && !selectedA}
          locked={!!selectedA}
          singlePicker={singlePickerMode}
        />

        {/* ─── CENTER: filters + roster + info dock ─────────────────── */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 gap-2">
          {(arcadeMode || storyMode) && (
            <div
              className="sel-h flex-shrink-0 px-3 py-2 text-center"
              style={{
                fontSize: 11,
                letterSpacing: '0.16em',
                color: storyMode ? '#F72585' : '#FCBF49',
                background: 'rgba(0,0,0,0.4)',
                boxShadow: `inset 0 0 0 1px ${storyMode ? '#F7258555' : '#FCBF4955'}`,
                clipPath: 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)',
              }}
            >
              {arcadeMode ? 'BEAT 8 STAGES · FINAL BOSS: LENNY' : '8 CHAPTERS · LENNY IN THE FINAL SEGMENT'}
            </div>
          )}

          {/* Compact arcade filter strip (one line, low-key) */}
          <div className="sel-filterbar flex items-center flex-shrink-0">
            {DISCIPLINE_FILTER_ORDER.map((d) => (
              <FilterTab
                key={d}
                label={d === 'all' ? 'ALL' : DISCIPLINE_LABEL[d]}
                count={d === 'all' ? totalRoster : (disciplineCounts[d] ?? 0)}
                color={d === 'all' ? sideColor : DISCIPLINE_COLOR[d]}
                showDot={d !== 'all'}
                active={disciplineFilter === d}
                onClick={() => { Sfx.menuMove(); setDisciplineFilter(d) }}
              />
            ))}
            <span className="sel-filterbar-div" />
            {ERA_FILTER_ORDER.map((e) => (
              <FilterTab
                key={e}
                label={e === 'all' ? 'ERA' : ERA_LABEL[e].split(' · ')[0]}
                count={e === 'all' ? 0 : (eraCounts[e] ?? 0)}
                color={e === 'all' ? 'rgba(255,255,255,0.6)' : '#FCBF49'}
                showDot={false}
                active={eraFilter === e}
                onClick={() => { Sfx.menuMove(); setEraFilter(e) }}
              />
            ))}
            <div className="flex-1" />
            <div className="sel-search">
              <span aria-hidden className="sel-h" style={{ fontSize: 12, color: query ? sideColor : 'rgba(255,255,255,0.45)', textShadow: query ? `0 0 6px ${sideColor}` : 'none' }}>⌕</span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search"
                className="sel-cond"
                style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 15, width: 92, fontWeight: 600 }}
              />
            </div>
            {anyFilterActive && (
              <button onClick={clearFilters} className="sel-tab" style={{ ['--tab-c' as string]: '#fff' }}>✕</button>
            )}
          </div>

          {/* Roster */}
          <div className="sel-rostermod relative flex flex-col flex-1 min-w-0 min-h-0">
            <div className="sel-h flex-shrink-0 flex items-center justify-between" style={{ fontSize: 9, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.42)', marginBottom: 5, textShadow: '1px 1px 0 #000' }}>
              <span>{filteredRoster.length === totalRoster ? `${totalRoster} OPERATORS` : `${filteredRoster.length} / ${totalRoster} MATCH`}</span>
              <span style={{ color: 'rgba(255,255,255,0.3)' }}>◄ ► ▲ ▼ MOVE · ENTER LOCK</span>
            </div>

            <div
              ref={gridRef}
              role="listbox"
              aria-label="Operator roster"
              tabIndex={0}
              onKeyDown={onRosterKey}
              className="sel-grid outline-none"
              style={{ gridTemplateColumns: 'repeat(8, 1fr)', gridAutoRows: '1fr', flex: '1 1 0' }}
            >
              {filteredRoster.length === 0 ? (
                <div className="col-span-full text-center sel-cond py-12" style={{ color: 'rgba(255,255,255,0.55)', fontSize: 18 }}>
                  No operators match those filters.{' '}
                  <button onClick={clearFilters} className="underline" style={{ cursor: 'pointer', color: '#fff' }}>reset</button>.
                </div>
              ) : filteredRoster.map((id) => {
                const f = getFighter(id)!
                return (
                  <RosterCell
                    key={id}
                    fighter={f}
                    isCursor={hovered === id}
                    isP1={selectedA === id}
                    isP2={selectedB === id}
                    locked={UNLOCKABLES.includes(id)}
                    marquee={storyMode && isMarquee(id)}
                    onEnter={() => { setHovered(id); Sfx.menuMove() }}
                    onPick={() => pickFighter(id)}
                  />
                )
              })}
            </div>

            {expanded && hoveredFighter && (
              <MoveDrawer fighter={hoveredFighter} onClose={() => { Sfx.menuMove(); setExpanded(false) }} />
            )}
          </div>

          {/* Info dock — the live-hovered operator's kit */}
          {hoveredFighter && (
            <CenterDock
              key={`dock-${hoveredFighter.id}`}
              fighter={hoveredFighter}
              side={side}
              expanded={expanded}
              onToggleMoves={() => { Sfx.menuMove(); setExpanded((x) => !x) }}
            />
          )}
        </div>

        {/* P2 standoff (right, faces inward) — VS mode only */}
        {!singlePickerMode && (
          <StandoffHero
            side="b"
            fighter={p2Fighter}
            num={numOf(p2Fighter)}
            active={side === 'b' && !selectedB}
            locked={!!selectedB}
            singlePicker={false}
          />
        )}
      </div>
    </div>
  )
}

/* ── Standoff hero ─ one imposing render per player side ──────────── */
function StandoffHero({
  side,
  fighter,
  num,
  active,
  locked,
  singlePicker,
}: {
  side: 'a' | 'b'
  fighter: FighterDef | null
  num: string
  active: boolean
  locked: boolean
  singlePicker: boolean
}) {
  const sideColor = SIDE_COLOR[side]
  const basis = singlePicker ? 'clamp(360px, 33%, 520px)' : 'clamp(340px, 27.5%, 480px)'
  const cls = [
    'sel-standoff',
    side === 'a' ? 'sel-standoff-a' : 'sel-standoff-b',
    active ? 'is-active' : '',
    locked ? 'is-locked' : '',
    fighter ? '' : 'is-empty',
  ].filter(Boolean).join(' ')
  const disc = fighter ? getDiscipline(fighter) : null
  const era = fighter ? getEra(fighter) : null
  const hpPct = fighter ? Math.max(0.35, Math.min(1, fighter.maxHp / 1200)) : 0

  return (
    <div
      className={cls}
      style={{ ['--sel-side' as string]: sideColor, ['--sel-accent' as string]: fighter?.accent ?? sideColor, flex: `0 0 ${basis}` }}
    >
      <div className="sel-standoff-stage relative flex-1 min-h-0">
        <div className="sel-standoff-index sel-name-face" aria-hidden>{num}</div>
        <div className="sel-standoff-floor" />
        {fighter ? (
          <div className="sel-standoff-figure" key={fighter.id}>
            <div className="sel-standoff-figwrap" style={{ transform: `translateY(${HERO_BASE + heroYOffset(fighter.id)}%)` }}>
              <Sprite fighter={fighter} side={side} state="stance" />
            </div>
          </div>
        ) : (
          <div className="sel-standoff-empty" aria-hidden>
            <div className="sel-standoff-empty-silhouette" />
            <div className="sel-standoff-empty-mark sel-name-face">?</div>
            <div className="sel-standoff-empty-prompt sel-h">
              {active ? 'CHOOSING' : 'WAITING FOR PLAYER 2'}
            </div>
          </div>
        )}

        <div className="sel-standoff-tab sel-h">{singlePicker ? 'OPERATOR' : SIDE_LABEL[side]}</div>
        {disc && era && (
          <div className="sel-standoff-tags">
            <Tag color={DISCIPLINE_COLOR[disc]}>{DISCIPLINE_LABEL[disc]}</Tag>
            <Tag color="#FCBF49">{ERA_LABEL[era].split(' · ')[0]}</Tag>
          </div>
        )}
        {locked && <div className="sel-standoff-lock sel-h">✔ LOCKED IN</div>}
      </div>

      <div
        className="sel-standoff-name"
        style={{
          background: `linear-gradient(180deg, ${(fighter?.accent ?? sideColor)}1c, rgba(6,4,12,0.96) 62%)`,
          boxShadow: `inset 0 2px 0 ${sideColor}, inset 0 3px 0 rgba(0,0,0,0.4)`,
        }}
      >
        <div className="sel-standoff-plabel sel-h" style={{ color: sideColor }}>
          {SIDE_LABEL[side]}{fighter ? (locked ? ' · READY' : ' · CHOOSING') : ''}
        </div>
        {fighter ? (
          <>
            <div className="sel-name sel-standoff-nametext" style={{ fontSize: 'clamp(26px, 2.9vw, 54px)' }} title={fighter.name}>
              {fighter.name}
            </div>
            <div className="sel-h sel-standoff-arch" style={{ fontSize: 11, letterSpacing: '0.16em', color: fighter.accent, textTransform: 'uppercase' }}>
              {fighter.archetype}
            </div>
            <div className="sel-standoff-hp">
              <span className="sel-h" style={{ fontSize: 9, letterSpacing: '0.12em', color: '#06D6A0' }}>HP</span>
              <div className="sel-standoff-hpbar">
                <div style={{ position: 'absolute', inset: 0, width: `${hpPct * 100}%`, background: 'linear-gradient(180deg, #5affce, #06D6A0 60%, #04966f)', boxShadow: '0 0 8px #06D6A0aa, inset 0 1px 0 rgba(255,255,255,0.5)' }} />
              </div>
              <span style={{ fontFamily: 'VT323, monospace', fontSize: 16, color: '#fff' }}>{fighter.maxHp}</span>
            </div>
          </>
        ) : (
          <div className="sel-name sel-standoff-nametext" style={{ fontSize: 'clamp(20px, 2vw, 34px)', color: 'rgba(255,255,255,0.3)' }}>
            {active ? 'CHOOSING' : 'STANDBY'}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Center dock ─ live-hovered operator kit strip under the roster ──── */
function CenterDock({
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

  return (
    <div className="sel-dock flex-shrink-0 flex items-center gap-2.5" key={fighter.id}>
      <div className="sel-dock-ult flex items-center gap-2.5" style={{ borderLeft: `3px solid ${fighter.accent}` }}>
        <span className="sel-h" style={{ fontSize: 10, letterSpacing: '0.12em', color: fighter.accent }}>⚡ ULT</span>
        <span className="sel-cond truncate" style={{ fontSize: 15, color: '#fff', fontWeight: 700, letterSpacing: '0.02em' }} title={fighter.ult.name}>{fighter.ult.name}</span>
        <span className="tabular-nums" style={{ fontFamily: 'VT323, monospace', fontSize: 16, color: 'rgba(255,255,255,0.9)' }}>{fighter.ult.baseDamage}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="sel-h" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.42)' }}>BEST IN</span>
        {bestIn.map((t) => (
          <span key={t} className="sel-h" style={{ fontSize: 9, letterSpacing: '0.08em', color: '#FFD60A', padding: '2px 7px', background: '#FFD60A16', boxShadow: 'inset 0 0 0 1px #FFD60A55' }}>{t}</span>
        ))}
      </div>
      <div className="flex-1" />
      <button
        onClick={onToggleMoves}
        className="sel-btn"
        style={{
          fontSize: 10, color: '#fff', padding: '6px 13px',
          background: expanded ? `linear-gradient(180deg, ${sideColor}cc, ${sideColor}88)` : 'linear-gradient(180deg, #2a2036, #14101d)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -2px 0 rgba(0,0,0,0.5)',
          clipPath: 'polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%)',
        }}
      >
        {expanded ? '▾ HIDE' : '▸ MOVES'}
      </button>
      <button
        onClick={() => {
          Sfx.menuSelect()
          useGame.getState().setSpotlightFighter(fighter.id)
          useGame.getState().setPhase('fighter-spotlight')
        }}
        className="sel-btn"
        style={{
          fontSize: 10, color: '#3a2600', padding: '6px 13px',
          background: 'linear-gradient(180deg, #FFE87A, #E0A400)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -2px 0 rgba(120,80,0,0.55)',
          clipPath: 'polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%)',
        }}
      >
        ★ SPOTLIGHT
      </button>
    </div>
  )
}

/* ── Roster cell — uniform graphite portrait ─────────────────────────── */
function RosterCell({
  fighter,
  isCursor,
  isP1,
  isP2,
  locked,
  marquee,
  onEnter,
  onPick,
}: {
  fighter: FighterDef
  isCursor: boolean
  isP1: boolean
  isP2: boolean
  locked: boolean
  marquee: boolean
  onEnter: () => void
  onPick: () => void
}) {
  const disc = getDiscipline(fighter)
  const discColor = DISCIPLINE_COLOR[disc]
  const cls = [
    'sel-cell',
    isCursor ? 'is-cursor' : '',
    isP1 ? 'is-p1' : '',
    isP2 ? 'is-p2' : '',
    (isP1 || isP2) ? 'is-confirm' : '',
    marquee ? 'is-marquee' : '',
    locked ? 'is-locked' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      data-cell={fighter.id}
      onMouseEnter={onEnter}
      onClick={() => !locked && onPick()}
      disabled={locked}
      aria-label={`${fighter.name} — ${fighter.archetype}${locked ? ', locked' : ''}${marquee ? ', marquee story arc' : ''}`}
      aria-selected={isCursor}
      className={cls}
    >
      <div className="sel-portrait" style={{ top: `${PORTRAIT_BASE + portraitYOffset(fighter.id)}%` }}>
        <Sprite fighter={fighter} side={isP2 ? 'b' : 'a'} state="stance" />
      </div>
      <div className="sel-cell-disc" style={{ background: discColor, boxShadow: `0 0 6px ${discColor}` }} />

      {(isP1 || isP2) && (
        <span className="sel-cell-flag" style={{ background: isP1 ? SIDE_COLOR.a : SIDE_COLOR.b }}>{isP1 ? 'P1' : 'P2'}</span>
      )}

      {(isCursor || isP1 || isP2) && !locked && (
        <span className="sel-cell-name">{fighter.shortName.toUpperCase()}</span>
      )}

      {locked && (
        <div className="absolute inset-0 flex items-center justify-center sel-name-face" style={{ fontSize: 26, color: 'rgba(255,255,255,0.8)', background: 'rgba(0,0,0,0.55)' }}>?</div>
      )}
    </button>
  )
}

/* ── Filter tab + small helpers ──────────────────────────────────────── */
function FilterTab({
  label, count, color, showDot, active, onClick,
}: {
  label: string
  count: number
  color: string
  showDot: boolean
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={`${count} operators`}
      className={`sel-tab ${active ? 'is-active' : ''}`}
      style={{ ['--tab-c' as string]: color }}
    >
      {showDot && <span className="sel-tab-dot" style={{ background: active ? '#0a0810' : color }} />}
      {label}
      <span className="sel-tab-count">{count}</span>
    </button>
  )
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="sel-h"
      style={{ fontSize: 9, letterSpacing: '0.12em', padding: '3px 7px', color, background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}`, textShadow: '1px 1px 0 rgba(0,0,0,0.5)' }}
    >
      {children}
    </span>
  )
}

/* ── Move drawer (expandable spec sheet) ─────────────────────────────── */
function MoveDrawer({ fighter, onClose }: { fighter: FighterDef; onClose: () => void }) {
  return (
    <div
      className="sel-panel absolute z-30 overflow-y-auto p-4"
      style={{ top: 0, right: 0, bottom: 0, width: 'min(440px, 62%)', borderLeft: `3px solid ${fighter.accent}`, boxShadow: `-12px 0 40px rgba(0,0,0,0.6), inset 0 0 40px ${fighter.accent}18` }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="sel-name-face" style={{ fontSize: 22, color: fighter.accent, textShadow: '2px 2px 0 #000' }}>{fighter.name}</div>
        <button onClick={onClose} className="sel-btn sel-h" style={{ fontSize: 10, color: '#fff', padding: '5px 10px', background: 'rgba(255,255,255,0.08)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.3)' }}>✕ CLOSE</button>
      </div>
      <div className="sel-h" style={{ fontSize: 11, letterSpacing: '0.16em', color: fighter.accent, borderBottom: `1px solid ${fighter.accent}`, paddingBottom: 4, marginBottom: 8 }}>▌ FULL MOVE LIST</div>
      <div className="space-y-2">
        {fighter.moves.map((m) => <MoveDetail key={m.id} move={m} />)}
      </div>
      <div className="sel-h" style={{ fontSize: 11, letterSpacing: '0.16em', color: fighter.accent, borderBottom: `1px solid ${fighter.accent}`, paddingBottom: 4, margin: '16px 0 8px' }}>▌ SCENARIO BONUSES</div>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(fighter.scenarioBonus).map(([sc, mult]) => (
          <div key={sc} className="p-2 sel-h" style={{ fontSize: 9, letterSpacing: '0.08em', background: mult >= 1.5 ? '#FFD60A22' : mult >= 1.3 ? '#F7790022' : '#3B236022', boxShadow: `inset 0 0 0 1px ${mult >= 1.5 ? '#FFD60A' : mult >= 1.3 ? '#F77F00' : '#3B2360'}`, color: 'white' }}>
            <div style={{ color: 'rgba(255,255,255,0.7)' }}>{SCENARIOS[sc as ScenarioId].name}</div>
            <div style={{ color: mult >= 1.5 ? '#FFD60A' : mult >= 1.3 ? '#F77F00' : '#90E0EF' }}>+{Math.round((mult - 1) * 100)}% damage</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MoveDetail({ move }: { move: Move }) {
  const TYPE_COLOR: Record<Move['type'], string> = {
    light: '#90E0EF', heavy: '#E63946', setup: '#06D6A0', combo: '#FFD60A', ultimate: '#F72585',
  }
  const color = TYPE_COLOR[move.type]
  return (
    <div className="p-2" style={{ background: `${color}1c`, boxShadow: `inset 0 0 0 1px ${color}`, borderLeft: `3px solid ${color}` }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="sel-h" style={{ fontSize: 9, letterSpacing: '0.12em', color }}>{move.type.toUpperCase()}</span>
        <span className="sel-h" style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>{move.type === 'ultimate' ? Math.min(move.momentum, 5) : move.momentum} MOM · {move.baseDamage} DMG</span>
      </div>
      <div className="sel-cond" style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginTop: 2 }}>{move.name}</div>
      <p className="sel-cond" style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(255,255,255,0.82)', marginTop: 2, lineHeight: 1.15 }}>
        &ldquo;{move.quote}&rdquo;
        <span className="sel-h" style={{ fontSize: 8, marginLeft: 4, color: 'rgba(255,255,255,0.4)' }}>— {move.episode} · {move.timestamp}</span>
      </p>
    </div>
  )
}

// Suppress unused-import warning for FIGHTERS / ScenarioId — kept for type references.
void FIGHTERS
void (null as ScenarioId | null)
