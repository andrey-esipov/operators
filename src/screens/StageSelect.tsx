import { useState } from 'react'
import { useGame } from '../state/game'
import { SCENARIOS, SCENARIO_ORDER } from '../data/scenarios'
import { getFighter } from '../data/fighters'
import { Sfx } from '../lib/audio'
import type { ScenarioId } from '../types'

/**
 * Stage Select — appears after both fighters are picked (VS mode only).
 *
 * - 8 stage cards in a 4×2 grid, each with icon + tag + topical description
 * - "AUTO" card that randomizes
 * - Highlights which fighters get a bonus in the hovered/selected stage
 * - Starts match on confirm
 */
export function StageSelect() {
  const selectedA = useGame((s) => s.selectedA)
  const selectedB = useGame((s) => s.selectedB)
  const startMatch = useGame((s) => s.startMatch)
  const setPhase = useGame((s) => s.setPhase)

  const [picked, setPicked] = useState<ScenarioId | 'auto'>('auto')
  const [hovered, setHovered] = useState<ScenarioId | null>(null)

  const fighterA = selectedA ? getFighter(selectedA) : null
  const fighterB = selectedB ? getFighter(selectedB) : null

  // What's hovered/picked determines which stage details to show
  const active = hovered ?? (picked === 'auto' ? null : picked)
  const activeScenario = active ? SCENARIOS[active] : null

  function confirm() {
    if (!fighterA || !fighterB) return
    Sfx.menuSelect()
    const chosen: ScenarioId =
      picked === 'auto'
        ? SCENARIO_ORDER[Math.floor(Math.random() * SCENARIO_ORDER.length)]
        : picked
    startMatch(fighterA.id, fighterB.id, chosen)
  }

  return (
    <div className="relative w-full h-full flex flex-col p-4 gap-3 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at top, rgba(247,127,0,0.25) 0%, transparent 55%), linear-gradient(180deg, #1A0F2E 0%, #0F0A1A 100%)',
        }}
      />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between flex-shrink-0">
        <button
          onClick={() => {
            Sfx.menuMove()
            setPhase('character-select')
          }}
          className="font-display text-[10px] tracking-widest text-white/70"
        >
          ← BACK
        </button>
        <h1
          className="font-display text-2xl tracking-widest"
          style={{ color: '#FFD60A', textShadow: '4px 4px 0 rgba(0,0,0,0.6)' }}
        >
          SELECT YOUR BATTLEGROUND
        </h1>
        <div className="font-display text-[10px] tracking-widest text-white/70">
          {fighterA?.shortName} <span className="text-white/40">VS</span> {fighterB?.shortName}
        </div>
      </div>

      {/* MAIN AREA */}
      <div className="relative z-10 grid grid-cols-3 gap-4 flex-1 min-h-0">
        {/* LEFT: stage grid (8 stages + AUTO) */}
        <div className="col-span-2 grid grid-cols-3 gap-2 content-start auto-rows-max overflow-y-auto pr-1">
          {/* AUTO card — first */}
          <button
            onMouseEnter={() => {
              Sfx.menuMove()
              setHovered(null)
            }}
            onMouseLeave={() => setHovered(null)}
            onClick={() => {
              Sfx.menuSelect()
              setPicked('auto')
            }}
            className="relative flex flex-col items-start text-left p-3 transition-transform hover:scale-[1.02]"
            style={{
              background:
                picked === 'auto'
                  ? 'linear-gradient(180deg, rgba(255,214,10,0.25), rgba(255,214,10,0.08))'
                  : 'linear-gradient(180deg, rgba(255,214,10,0.08), rgba(0,0,0,0.4))',
              border: `2px solid ${picked === 'auto' ? '#FFD60A' : '#FFD60A66'}`,
              boxShadow:
                picked === 'auto'
                  ? '0 0 18px #FFD60A88, inset -2px -2px 0 rgba(0,0,0,0.5)'
                  : 'inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.1)',
              minHeight: 110,
              cursor: 'pointer',
            }}
          >
            <div className="flex items-center justify-between w-full">
              <span
                className="font-display text-[10px] tracking-widest"
                style={{ color: '#FFD60A' }}
              >
                AUTO
              </span>
              <span className="text-2xl">🎲</span>
            </div>
            <div className="font-display text-base tracking-wider text-white mt-1">
              RANDOM STAGE
            </div>
            <p className="font-body text-sm text-white/80 mt-1 leading-snug">
              Let the dice pick the battleground. Most matches go this way.
            </p>
          </button>

          {SCENARIO_ORDER.map((id) => {
            const s = SCENARIOS[id]
            const isPicked = picked === id
            const isHovered = hovered === id
            const aBonus = fighterA?.scenarioBonus[id]
            const bBonus = fighterB?.scenarioBonus[id]
            return (
              <button
                key={id}
                onMouseEnter={() => {
                  Sfx.menuMove()
                  setHovered(id)
                }}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  Sfx.menuSelect()
                  setPicked(id)
                }}
                className="relative flex flex-col items-start text-left p-3 transition-transform hover:scale-[1.02]"
                style={{
                  background: isPicked
                    ? `linear-gradient(180deg, ${s.accent}3A, ${s.accent}11)`
                    : `linear-gradient(180deg, ${s.accent}1A, rgba(0,0,0,0.4))`,
                  border: `2px solid ${isPicked ? s.accent : isHovered ? s.accent : s.accent + '66'}`,
                  boxShadow: isPicked
                    ? `0 0 16px ${s.accent}AA, inset -2px -2px 0 rgba(0,0,0,0.5)`
                    : isHovered
                    ? `0 0 12px ${s.accent}55, inset -2px -2px 0 rgba(0,0,0,0.5)`
                    : 'inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.1)',
                  minHeight: 110,
                  cursor: 'pointer',
                }}
              >
                <div className="flex items-center justify-between w-full">
                  <span
                    className="font-display text-[10px] tracking-widest"
                    style={{ color: s.accent }}
                  >
                    {s.tag}
                  </span>
                  <span className="text-2xl" style={{ filter: 'drop-shadow(0 0 4px ' + s.accent + ')' }}>{s.icon}</span>
                </div>
                <div className="font-display text-base tracking-wider text-white mt-1 leading-tight">
                  {s.name}
                </div>
                <p className="font-body text-sm text-white/80 mt-1 leading-snug line-clamp-2">
                  {s.description}
                </p>

                {/* Bonus indicators */}
                <div className="flex gap-1 mt-2 flex-wrap">
                  {aBonus && aBonus >= 1.3 && (
                    <span
                      className="font-display text-[7px] tracking-widest px-1.5 py-0.5"
                      style={{
                        background: fighterA!.accent + '33',
                        border: `1px solid ${fighterA!.accent}`,
                        color: 'white',
                      }}
                    >
                      {fighterA!.shortName} +{Math.round((aBonus - 1) * 100)}%
                    </span>
                  )}
                  {bBonus && bBonus >= 1.3 && (
                    <span
                      className="font-display text-[7px] tracking-widest px-1.5 py-0.5"
                      style={{
                        background: fighterB!.accent + '33',
                        border: `1px solid ${fighterB!.accent}`,
                        color: 'white',
                      }}
                    >
                      {fighterB!.shortName} +{Math.round((bBonus - 1) * 100)}%
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* RIGHT: detail panel */}
        <div
          className="overflow-y-auto p-4"
          style={{
            background: 'rgba(15,10,26,0.9)',
            border: `3px solid ${activeScenario?.accent ?? '#FFD60A'}`,
            boxShadow: `inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.1), 0 0 24px ${(activeScenario?.accent ?? '#FFD60A')}55`,
          }}
        >
          {activeScenario ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-4xl" style={{ filter: `drop-shadow(0 0 8px ${activeScenario.accent})` }}>
                  {activeScenario.icon}
                </span>
                <div>
                  <div
                    className="font-display text-[9px] tracking-widest"
                    style={{ color: activeScenario.accent }}
                  >
                    {activeScenario.tag}
                  </div>
                  <div className="font-display text-xl tracking-wider text-white leading-none">
                    {activeScenario.name}
                  </div>
                </div>
              </div>

              <p className="font-body text-base text-white/85 mt-3 leading-relaxed">
                {activeScenario.longDescription}
              </p>

              <div
                className="mt-4 p-3 italic font-body text-base text-white/90"
                style={{
                  background: `${activeScenario.accent}1A`,
                  borderLeft: `3px solid ${activeScenario.accent}`,
                }}
              >
                &ldquo;{activeScenario.flavorQuote}&rdquo;
              </div>

              {/* Per-fighter bonus rundown */}
              <div className="mt-4 space-y-1.5">
                <div
                  className="font-display text-[9px] tracking-widest pb-1"
                  style={{ color: activeScenario.accent, borderBottom: `1px solid ${activeScenario.accent}55` }}
                >
                  STAGE BONUSES
                </div>
                {fighterA && (
                  <FighterBonusRow
                    fighter={fighterA.shortName}
                    accent={fighterA.accent}
                    mult={fighterA.scenarioBonus[activeScenario.id] ?? 1.0}
                  />
                )}
                {fighterB && (
                  <FighterBonusRow
                    fighter={fighterB.shortName}
                    accent={fighterB.accent}
                    mult={fighterB.scenarioBonus[activeScenario.id] ?? 1.0}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-6xl mb-3">🎲</div>
              <div className="font-display text-base tracking-widest text-white">
                AUTO-SELECTED STAGE
              </div>
              <p className="font-body text-base text-white/70 mt-2 leading-snug">
                Hover a stage to preview it, or click a stage card to lock it in.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* CONFIRM */}
      <div className="relative z-10 flex justify-center flex-shrink-0 pt-2">
        <button
          onClick={confirm}
          onMouseEnter={Sfx.menuMove}
          className="px-8 py-3 font-display text-xl tracking-widest hover:translate-y-[-2px] transition-transform"
          style={{
            background: 'linear-gradient(180deg, #E6394655, #E6394622)',
            color: 'white',
            border: '3px solid #E63946',
            boxShadow:
              'inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2), 0 0 24px #E6394666',
            cursor: 'pointer',
            letterSpacing: '4px',
            textShadow: '2px 2px 0 black',
          }}
        >
          ▶ FIGHT!
        </button>
      </div>
    </div>
  )
}

function FighterBonusRow({ fighter, accent, mult }: { fighter: string; accent: string; mult: number }) {
  const pct = Math.round((mult - 1) * 100)
  const sign = pct >= 0 ? '+' : ''
  const bigBonus = mult >= 1.3
  return (
    <div
      className="flex items-center justify-between p-2 font-display text-[9px] tracking-widest"
      style={{
        background: bigBonus ? `${accent}22` : 'rgba(0,0,0,0.3)',
        border: `1px solid ${bigBonus ? accent : 'rgba(255,255,255,0.1)'}`,
      }}
    >
      <span style={{ color: accent }}>{fighter}</span>
      <span
        style={{
          color: pct >= 30 ? '#06D6A0' : pct > 0 ? '#FFD60A' : '#FFFFFF99',
        }}
      >
        {sign}
        {pct}% DMG
      </span>
    </div>
  )
}
