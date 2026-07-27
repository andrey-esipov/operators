import { useState } from 'react'
import { useGame } from '../state/game'
import { SCENARIOS, SCENARIO_ORDER } from '../data/scenarios'
import { getFighter } from '../data/fighters'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'
import type { ScenarioId } from '../types'
import './select/select.css'

/**
 * Stage Select — appears after both fighters are picked (VS mode only).
 *
 * Built to the SAME AAA material language as CharacterSelect: a dominant
 * cinematic stage render fills the left (a real `.sel-hero` slab with the
 * backdrop art, swapping on hover), the arenas sit right as a dense
 * `.sel-stagecard` grid, and the locked-in fighters ride the header as mirrored
 * P1/P2 plates. Gold is reserved for the RANDOM ceremony and the FIGHT trigger.
 */
const SIDE_COLOR = { a: '#E63946', b: '#00B4D8' } as const
const SIDE_LABEL = { a: 'PLAYER 1', b: 'PLAYER 2' } as const

export function StageSelect() {
  const selectedA = useGame((s) => s.selectedA)
  const selectedB = useGame((s) => s.selectedB)
  const startMatch = useGame((s) => s.startMatch)
  const setPhase = useGame((s) => s.setPhase)

  const [picked, setPicked] = useState<ScenarioId | 'auto'>('auto')
  const [hovered, setHovered] = useState<ScenarioId | null>(null)

  const fighterA = selectedA ? getFighter(selectedA) : null
  const fighterB = selectedB ? getFighter(selectedB) : null

  // When nothing is hovered and AUTO is armed we still showcase a real arena
  // behind the ceremony banner, so the dominant panel is never dead space.
  const isAutoIdle = !hovered && picked === 'auto'
  const featuredId: ScenarioId = hovered ?? (picked === 'auto' ? SCENARIO_ORDER[0] : picked)
  const featuredScenario = SCENARIOS[featuredId]
  const accent = hovered
    ? SCENARIOS[hovered].accent
    : picked === 'auto'
      ? '#FFD60A'
      : SCENARIOS[picked].accent

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
    <div
      className="sel-root flex flex-col"
      style={{
        ['--sel-accent' as string]: accent,
        ['--sel-side' as string]: '#FFD60A',
        ['--sel-p1' as string]: SIDE_COLOR.a,
        ['--sel-p2' as string]: SIDE_COLOR.b,
        padding: '14px 16px 16px',
        gap: 10,
      }}
    >
      {/* Layered atmospheric background — identical system to CharacterSelect */}
      <div className="sel-bg" />
      <div className="sel-bg-glow" />
      <div className="sel-bg-bands" />
      <div className="sel-bg-scan" />
      <div className="sel-bg-vignette" />

      {/* Header rail */}
      <div className="relative z-10 flex items-center justify-between flex-shrink-0">
        <button
          onClick={() => { Sfx.menuMove(); setPhase('character-select') }}
          className="sel-btn sel-h"
          style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)', padding: '4px 4px' }}
        >
          &lsaquo; BACK
        </button>

        <h1
          className="sel-name-face"
          style={{
            fontSize: 26,
            letterSpacing: '0.14em',
            color: '#fff',
            textShadow: '2px 2px 0 rgba(0,0,0,0.8), 0 0 22px rgba(255,214,10,0.4)',
            lineHeight: 1,
          }}
        >
          SELECT YOUR BATTLEGROUND
        </h1>

        <div className="sel-h" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', color: '#FFD60A', textShadow: '1px 1px 0 #000' }}>
          STAGE
        </div>
      </div>

      {/* VS plates */}
      <div className="relative z-10 flex items-stretch flex-shrink-0">
        <VsPlate side="a" fighter={fighterA} />
        <div className="sel-name-face flex items-center justify-center flex-shrink-0" style={{ width: 46, fontSize: 22, color: '#FFD60A', textShadow: '2px 2px 0 #000, 0 0 16px rgba(255,214,10,0.6)' }}>VS</div>
        <VsPlate side="b" fighter={fighterB} />
      </div>

      {/* MAIN */}
      <div className="relative z-10 flex gap-4 flex-1 min-h-0">
        {/* LEFT: dominant cinematic arena render */}
        <div className="sel-hero flex-shrink-0 flex flex-col" style={{ flex: '0 0 clamp(430px, 40%, 620px)' }}>
          <StagePreview
            key={featuredScenario.id + (isAutoIdle ? '-auto' : '')}
            scenario={featuredScenario}
            fighterA={fighterA}
            fighterB={fighterB}
            isAuto={isAutoIdle}
          />
        </div>

        {/* RIGHT: arena grid */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <div className="sel-h flex-shrink-0" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.5)', marginBottom: 8, textShadow: '1px 1px 0 #000' }}>
            CHOOSE YOUR ARENA
          </div>
          <div className="grid gap-2.5 pr-1" style={{ flex: '1 1 0', gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: '1fr', alignContent: 'stretch' }}>
            {/* RANDOM card — a designed ceremony slot, not an empty hole. */}
            <button
              onMouseEnter={() => { Sfx.menuMove(); setHovered(null) }}
              onMouseLeave={() => setHovered(null)}
              onClick={() => { Sfx.menuSelect(); setPicked('auto') }}
              className={`sel-stagecard sel-stage-random flex flex-col items-center justify-center text-center ${picked === 'auto' ? 'is-active is-random-on' : ''}`}
              style={{ minHeight: 0 }}
            >
              <span aria-hidden className="sel-stage-random-q sel-name-face">?</span>
              <span className="sel-name-face relative" style={{ fontSize: 22, color: '#fff', letterSpacing: '0.04em', lineHeight: 1, textShadow: '2px 2px 0 #000' }}>RANDOM</span>
              <span className="sel-h relative" style={{ fontSize: 8, letterSpacing: '0.22em', color: '#FFE27A', marginTop: 4 }}>DICE DECIDES</span>
            </button>

            {SCENARIO_ORDER.map((id) => {
              const s = SCENARIOS[id]
              const isPicked = picked === id
              const isHovered = hovered === id
              const isActive = isPicked || isHovered
              const aBonus = fighterA?.scenarioBonus[id]
              const bBonus = fighterB?.scenarioBonus[id]
              const showA = !!aBonus && aBonus >= 1.3
              const showB = !!bBonus && bBonus >= 1.3
              return (
                <button
                  key={id}
                  data-stage={id}
                  onMouseEnter={() => { Sfx.menuMove(); setHovered(id) }}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => { Sfx.menuSelect(); setPicked(id) }}
                  className={`sel-stagecard flex flex-col justify-end text-left ${isActive ? 'is-active' : ''}`}
                  style={{
                    minHeight: 0,
                    boxShadow: isPicked
                      ? `inset 0 0 0 2px ${s.accent}, 0 0 22px ${s.accent}aa, 0 6px 16px rgba(0,0,0,0.5)`
                      : isHovered
                        ? `inset 0 0 0 1px ${s.accent}, 0 0 16px ${s.accent}77, 0 6px 16px rgba(0,0,0,0.5)`
                        : undefined,
                  }}
                >
                  {/* Arena art */}
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `url(/stages/${id}.png)`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  {/* Legibility gradient */}
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(6,4,12,0) 34%, rgba(6,4,12,0.92) 100%)' }} />
                  {/* Accent underline — the single meaningful colour per card */}
                  <div className="absolute left-0 right-0 bottom-0" style={{ height: 3, background: s.accent, opacity: isActive ? 1 : 0.55 }} />
                  {/* Era stamp */}
                  <span
                    className="absolute sel-h"
                    style={{
                      top: 6, left: 6, fontSize: 8, letterSpacing: '0.14em', color: '#fff', padding: '2px 6px',
                      background: `${s.accent}dd`,
                      clipPath: 'polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)',
                      textShadow: '1px 1px 0 rgba(0,0,0,0.6)',
                    }}
                  >
                    {s.tag}
                  </span>
                  <div className="relative" style={{ padding: '8px 9px' }}>
                    <div className="sel-name-face" style={{ fontSize: 15, color: '#fff', letterSpacing: '0.02em', lineHeight: 0.95, textShadow: '2px 2px 0 #000' }}>
                      {s.name}
                    </div>
                    {(showA || showB) && (
                      <div className="flex gap-1" style={{ marginTop: 6 }}>
                        {showA && (
                          <span className="sel-h" style={{ fontSize: 8, letterSpacing: '0.06em', color: '#fff', padding: '2px 5px', background: `${SIDE_COLOR.a}dd` }}>
                            P1 +{Math.round((aBonus! - 1) * 100)}%
                          </span>
                        )}
                        {showB && (
                          <span className="sel-h" style={{ fontSize: 8, letterSpacing: '0.06em', color: '#fff', padding: '2px 5px', background: `${SIDE_COLOR.b}dd` }}>
                            P2 +{Math.round((bBonus! - 1) * 100)}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* CONFIRM */}
      <div className="relative z-10 flex justify-center flex-shrink-0 pt-1">
        <button
          onClick={confirm}
          onMouseEnter={Sfx.menuMove}
          className="sel-cta sel-cta-ready"
          style={{
            padding: '12px 56px',
            fontSize: 30,
            color: '#0c0716',
            background: 'linear-gradient(180deg, #FFE27A 0%, #FFC21F 55%, #F5A700 100%)',
            border: 'none',
            letterSpacing: '0.12em',
            textShadow: '0 1px 0 rgba(255,255,255,0.5)',
            clipPath: 'polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%)',
          }}
        >
          FIGHT
        </button>
      </div>
    </div>
  )
}

/* VS plate — mirrored player identity with locked portrait */
function VsPlate({ side, fighter }: { side: 'a' | 'b'; fighter: ReturnType<typeof getFighter> | null }) {
  const color = SIDE_COLOR[side]
  const cls = [
    'sel-plate',
    side === 'a' ? 'sel-plate-a' : 'sel-plate-b',
    fighter ? (side === 'a' ? 'is-filled-a' : 'is-filled-b') : '',
  ].filter(Boolean).join(' ')
  return (
    <div className={cls} style={{ ['--sel-side' as string]: color }}>
      <div className="sel-plate-portrait" style={{ boxShadow: `inset 0 0 0 1px ${fighter ? color : 'rgba(255,255,255,0.12)'}` }}>
        {fighter ? (
          <div className="sel-portrait" style={{ top: '-10%' }}>
            <Sprite fighter={fighter} side={side} state="stance" />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center sel-name-face" style={{ fontSize: 20, color: 'rgba(255,255,255,0.28)' }}>&mdash;</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="sel-h" style={{ fontSize: 9, letterSpacing: '0.16em', color }}>{SIDE_LABEL[side]}</div>
        <div className="sel-name-face truncate" style={{ fontSize: 20, color: '#fff', letterSpacing: '0.02em', textShadow: '1px 1px 0 #000', lineHeight: 1 }}>
          {fighter ? fighter.shortName : 'READY'}
        </div>
        {fighter && (
          <div className="sel-cond truncate" style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{fighter.archetype}</div>
        )}
      </div>
    </div>
  )
}

/* Dominant cinematic arena render */
function StagePreview({
  scenario,
  fighterA,
  fighterB,
  isAuto = false,
}: {
  scenario: (typeof SCENARIOS)[ScenarioId]
  fighterA: ReturnType<typeof getFighter> | null
  fighterB: ReturnType<typeof getFighter> | null
  isAuto?: boolean
}) {
  return (
    <div className="sel-stage-preview relative flex flex-col h-full">
      {/* Cinematic art */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(/stages/${scenario.id}.png)`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: isAuto ? 'saturate(0.85) brightness(0.6)' : 'none',
            transform: 'scale(1.04)',
          }}
        />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(8,5,16,0) 38%, rgba(8,5,16,0.96) 100%)' }} />
        <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 120px ${scenario.accent}44` }} />

        {/* RANDOM ceremony — designed, no emoji */}
        {isAuto && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
            <div className="sel-stage-ceremony sel-name-face" aria-hidden>?</div>
            <div
              className="sel-name-face relative"
              style={{ fontSize: 'clamp(28px, 3.4vw, 52px)', color: '#FFD60A', letterSpacing: '0.05em', lineHeight: 0.9, textShadow: '3px 3px 0 #000, 0 0 30px rgba(255,214,10,0.6)' }}
            >
              RANDOM<br />DRAW
            </div>
            <p className="sel-cond relative" style={{ fontSize: 17, color: 'rgba(255,255,255,0.8)', marginTop: 14, maxWidth: '24ch', lineHeight: 1.2, textShadow: '1px 1px 0 #000' }}>
              Hover an arena to preview it, or hit FIGHT and let the dice decide.
            </p>
          </div>
        )}

        {/* Title lockup overlaid on the art */}
        {!isAuto && (
          <div className="absolute left-5 right-5 bottom-4">
            <div
              className="inline-block sel-h"
              style={{ fontSize: 9, letterSpacing: '0.16em', color: '#fff', padding: '3px 8px', marginBottom: 8, background: `${scenario.accent}dd`, textShadow: '1px 1px 0 rgba(0,0,0,0.6)' }}
            >
              {scenario.tag}
            </div>
            <div
              className="sel-name-face"
              style={{ fontSize: 'clamp(30px, 3.6vw, 52px)', color: '#fff', letterSpacing: '0.01em', lineHeight: 0.88, textShadow: `3px 3px 0 #000, 0 0 26px ${scenario.accent}` }}
            >
              {scenario.name}
            </div>
          </div>
        )}
      </div>

      {/* Detail slab */}
      <div
        className="flex-shrink-0"
        style={{
          padding: '14px 18px 16px',
          background: `linear-gradient(180deg, ${scenario.accent}16, rgba(10,7,20,0.96) 62%)`,
          borderTop: `2px solid ${isAuto ? '#FFD60A' : scenario.accent}`,
        }}
      >
        {isAuto ? (
          <p className="sel-cond" style={{ fontSize: 17, color: 'rgba(255,255,255,0.82)', lineHeight: 1.25 }}>
            One of nine battlegrounds is chosen at random when the match begins. Stage bonuses still apply — pick deliberately to swing the odds.
          </p>
        ) : (
          <>
            <p className="sel-cond" style={{ fontSize: 17, color: 'rgba(255,255,255,0.9)', lineHeight: 1.22, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', textShadow: '1px 1px 0 #000' }}>
              {scenario.longDescription}
            </p>
            <div
              className="sel-cond"
              style={{ marginTop: 10, padding: '7px 12px', fontStyle: 'italic', fontSize: 16, color: '#fff', background: `${scenario.accent}22`, borderLeft: `3px solid ${scenario.accent}`, textShadow: '1px 1px 0 #000' }}
            >
              &ldquo;{scenario.flavorQuote}&rdquo;
            </div>
          </>
        )}

        {/* Stage bonuses */}
        {!isAuto && (
          <div className="grid grid-cols-2 gap-2" style={{ marginTop: 12 }}>
            {fighterA && <FighterBonusRow side="a" name={fighterA.shortName} mult={fighterA.scenarioBonus[scenario.id] ?? 1.0} />}
            {fighterB && <FighterBonusRow side="b" name={fighterB.shortName} mult={fighterB.scenarioBonus[scenario.id] ?? 1.0} />}
          </div>
        )}
      </div>
    </div>
  )
}

function FighterBonusRow({ side, name, mult }: { side: 'a' | 'b'; name: string; mult: number }) {
  const pct = Math.round((mult - 1) * 100)
  const sign = pct >= 0 ? '+' : ''
  const bigBonus = mult >= 1.3
  const sideColor = SIDE_COLOR[side]
  const valColor = pct >= 30 ? '#0AF0A8' : pct > 0 ? '#FFD60A' : pct < 0 ? '#FF6B6B' : 'rgba(255,255,255,0.8)'
  return (
    <div
      className="flex items-center justify-between"
      style={{
        padding: '6px 10px',
        background: bigBonus ? `${sideColor}22` : 'rgba(0,0,0,0.35)',
        boxShadow: `inset 0 0 0 1px ${bigBonus ? sideColor : 'rgba(255,255,255,0.12)'}`,
      }}
    >
      <span className="sel-h" style={{ fontSize: 9, letterSpacing: '0.1em', color: sideColor }}>{side === 'a' ? 'P1 ' : 'P2 '}{name}</span>
      <span
        className="sel-name-face"
        style={{ fontSize: 15, color: valColor, textShadow: pct !== 0 ? `0 0 8px ${valColor}66, 1px 1px 0 rgba(0,0,0,0.8)` : '1px 1px 0 rgba(0,0,0,0.8)' }}
      >
        {sign}{pct}% <span className="sel-h" style={{ fontSize: 8, opacity: 0.7 }}>DMG</span>
      </span>
    </div>
  )
}
