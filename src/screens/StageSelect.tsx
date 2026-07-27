import { useState } from 'react'
import { useGame } from '../state/game'
import { SCENARIOS, SCENARIO_ORDER } from '../data/scenarios'
import { getFighter } from '../data/fighters'
import { Sfx } from '../lib/audio'
import type { ScenarioId } from '../types'
import './select/select.css'

/**
 * Stage Select — appears after both fighters are picked (VS mode only).
 *
 * Rebuilt to the same AAA material language as CharacterSelect: a dominant
 * cinematic stage preview (the real backdrop art from /stages, not an emoji)
 * fills the left half and swaps on hover; the eight stage cards + AUTO sit on
 * the right as a dense, subordinate grid with real bevelled material. Player
 * identity (P1 warm / P2 cool) is carried through the VS header and the
 * per-fighter stage-bonus readout.
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

  // What's hovered/picked determines which stage details to show. When nothing
  // is hovered and AUTO is armed, we still showcase a real battleground behind a
  // "dice decides" ceremony banner so the dominant panel is never dead space.
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
      className="sel-root flex flex-col p-4 gap-3"
      style={{
        ['--sel-accent' as string]: accent,
        ['--sel-side' as string]: '#FFD60A',
      }}
    >
      {/* Art-directed background */}
      <div className="sel-bg" />
      <div className="sel-bg-bands" />
      <div className="sel-bg-grid" />
      <div className="sel-bg-vignette" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between flex-shrink-0">
        <button
          onClick={() => {
            Sfx.menuMove()
            setPhase('character-select')
          }}
          className="sel-chip font-display text-[10px] tracking-widest text-white/80 px-2 py-1"
          style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer' }}
        >
          ← BACK
        </button>
        <h1
          className="font-display text-2xl tracking-widest"
          style={{ color: '#FFD60A', textShadow: `3px 3px 0 rgba(0,0,0,0.7), 0 0 22px ${accent}66` }}
        >
          SELECT YOUR BATTLEGROUND
        </h1>
        <VsHeader a={fighterA} b={fighterB} />
      </div>

      {/* MAIN */}
      <div className="relative z-10 flex gap-4 flex-1 min-h-0">
        {/* LEFT: dominant stage preview */}
        <div className="sel-hero flex-shrink-0 flex flex-col" style={{ flex: '0 0 clamp(420px, 42%, 640px)' }}>
          <StagePreview
            key={featuredScenario.id + (isAutoIdle ? '-auto' : '')}
            scenario={featuredScenario}
            fighterA={fighterA}
            fighterB={fighterB}
            isAuto={isAutoIdle}
          />
        </div>

        {/* RIGHT: stage grid */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <div className="font-display text-[9px] tracking-widest text-white/55 mb-2 flex-shrink-0" style={{ textShadow: '1px 1px 0 #000' }}>
            ▸ CHOOSE YOUR ARENA
          </div>
          <div className="grid grid-cols-3 gap-2 pr-1 pt-1" style={{ flex: '1 1 0', gridTemplateRows: 'repeat(3, minmax(0, 1fr))' }}>
            {/* AUTO card — a deliberate "special slot", not an empty hole:
                scanline texture + ghost "?" + gold shimmer frame. */}
            <button
              onMouseEnter={() => { Sfx.menuMove(); setHovered(null) }}
              onMouseLeave={() => setHovered(null)}
              onClick={() => { Sfx.menuSelect(); setPicked('auto') }}
              className={`sel-cell relative flex flex-col items-center justify-center text-center overflow-hidden ${picked === 'auto' ? 'sel-cell-cursor' : ''}`}
              style={{
                minHeight: 118,
                border: `2px solid ${picked === 'auto' ? '#FFE27A' : '#FFD60A88'}`,
                background:
                  'repeating-linear-gradient(135deg, rgba(255,214,10,0.06) 0px, rgba(255,214,10,0.06) 2px, transparent 2px, transparent 7px),' +
                  'radial-gradient(80% 70% at 50% 40%, rgba(90,70,20,0.85), rgba(12,8,20,0.95))',
                boxShadow: picked === 'auto'
                  ? '0 0 22px #FFD60Acc, inset 0 0 0 1px #FFE27A, inset 0 1px 0 rgba(255,255,255,0.2)'
                  : '0 0 12px #FFD60A44, inset 0 0 0 1px rgba(255,214,10,0.35), inset -2px -2px 0 rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.12)',
                cursor: 'pointer',
              }}
            >
              {/* Ghost question-mark watermark */}
              <span
                aria-hidden
                className="absolute font-display"
                style={{ fontSize: 72, color: 'rgba(255,214,10,0.08)', lineHeight: 1, top: '50%', left: '50%', transform: 'translate(-50%,-52%)' }}
              >
                ?
              </span>
              <span className="text-4xl mb-1 relative" style={{ filter: 'drop-shadow(0 0 10px #FFD60A)' }}>🎲</span>
              <span className="font-display text-[11px] tracking-widest text-white relative" style={{ textShadow: '1px 1px 0 #000' }}>RANDOM</span>
              <span className="font-display text-[7px] tracking-widest mt-1 relative" style={{ color: '#FFE27A' }}>AUTO-PICK</span>
            </button>

            {SCENARIO_ORDER.map((id) => {
              const s = SCENARIOS[id]
              const isPicked = picked === id
              const isHovered = hovered === id
              const isActive = isPicked || isHovered
              const aBonus = fighterA?.scenarioBonus[id]
              const bBonus = fighterB?.scenarioBonus[id]
              return (
                <button
                  key={id}
                  onMouseEnter={() => { Sfx.menuMove(); setHovered(id) }}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => { Sfx.menuSelect(); setPicked(id) }}
                  className={`sel-cell relative flex flex-col justify-end text-left overflow-hidden ${isActive ? 'sel-cell-cursor' : ''} ${isPicked ? 'sel-confirm-pop' : ''}`}
                  style={{
                    minHeight: 118,
                    border: `${isActive ? '2px' : '1px'} solid ${isPicked ? s.accent : isHovered ? s.accent : 'rgba(255,255,255,0.14)'}`,
                    boxShadow: isPicked
                      ? `0 0 0 2px ${s.accent}, 0 0 20px ${s.accent}aa`
                      : isHovered
                      ? `0 0 16px ${s.accent}99, inset 0 1px 0 rgba(255,255,255,0.12)`
                      : 'inset -2px -2px 0 rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)',
                    cursor: 'pointer',
                  }}
                >
                  {/* Stage art */}
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `url(/stages/${id}.png)`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      opacity: isActive ? 1 : 0.5,
                      filter: isActive ? 'none' : 'saturate(0.8) brightness(0.85)',
                      transition: 'opacity 130ms ease, filter 130ms ease',
                    }}
                  />
                  {/* Legibility gradient */}
                  <div
                    className="absolute inset-0"
                    style={{ background: `linear-gradient(180deg, transparent 30%, rgba(6,4,12,0.9) 100%)` }}
                  />
                  {/* Era stamp — stencilled plate, not a web pill */}
                  <span
                    className="absolute top-1.5 left-1.5 font-display text-[7px] tracking-widest px-1.5 py-0.5"
                    style={{
                      color: '#fff',
                      background: `linear-gradient(180deg, ${s.accent}, ${s.accent}bb)`,
                      boxShadow: `inset 1px 1px 0 rgba(255,255,255,0.4), inset -1px -1px 0 rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.7)`,
                      clipPath: 'polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)',
                      textShadow: '1px 1px 0 rgba(0,0,0,0.6)',
                    }}
                  >
                    {s.tag}
                  </span>
                  <div className="relative p-2">
                    <div className="font-display text-[10px] tracking-wider text-white leading-tight" style={{ textShadow: '1px 1px 0 #000' }}>
                      {s.name}
                    </div>
                    {(!!aBonus && aBonus >= 1.3) || (!!bBonus && bBonus >= 1.3) ? (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {!!aBonus && aBonus >= 1.3 && (
                          <span className="font-display text-[6px] tracking-widest px-1 py-0.5" style={{ color: '#fff', background: '#E63946cc' }}>
                            P1 +{Math.round((aBonus - 1) * 100)}%
                          </span>
                        )}
                        {!!bBonus && bBonus >= 1.3 && (
                          <span className="font-display text-[6px] tracking-widest px-1 py-0.5" style={{ color: '#fff', background: '#00B4D8cc' }}>
                            P2 +{Math.round((bBonus - 1) * 100)}%
                          </span>
                        )}
                      </div>
                    ) : null}
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
          className="sel-cta px-10 py-3 font-display text-xl tracking-widest"
          style={{
            background: 'linear-gradient(180deg, #E63946, #B01e2c)',
            color: 'white',
            border: '2px solid #FFD60A',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), inset -2px -2px 0 rgba(0,0,0,0.5), 0 0 28px #E6394699',
            cursor: 'pointer',
            letterSpacing: '5px',
            textShadow: '2px 2px 0 black',
            clipPath: 'polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
          }}
        >
          ▶ FIGHT!
        </button>
      </div>
    </div>
  )
}

/* ── VS header — compact player identity with portraits ─────────────── */
function VsHeader({ a, b }: { a: ReturnType<typeof getFighter> | null; b: ReturnType<typeof getFighter> | null }) {
  return (
    <div className="flex items-center gap-2 font-display text-[10px] tracking-widest">
      <span style={{ color: '#E63946', textShadow: '1px 1px 0 #000' }}>{a?.shortName ?? 'P1'}</span>
      <span className="text-white/50">VS</span>
      <span style={{ color: '#00B4D8', textShadow: '1px 1px 0 #000' }}>{b?.shortName ?? 'P2'}</span>
    </div>
  )
}

/* ── Dominant stage preview ─────────────────────────────────────────── */
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
    <div className="sel-stage-hero relative flex flex-col h-full">
      {/* Cinematic art */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(/stages/${scenario.id}.png)`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: isAuto ? 'saturate(0.9) brightness(0.72)' : 'none',
          }}
        />
        <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 40%, rgba(8,5,16,0.95) 100%)` }} />
        <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 90px ${scenario.accent}55` }} />

        {/* AUTO ceremony badge — sits over real art so the panel is never dead */}
        {isAuto && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
            <div className="text-6xl mb-3" style={{ filter: 'drop-shadow(0 0 16px #FFD60A)' }}>🎲</div>
            <div
              className="font-display tracking-widest px-4 py-2"
              style={{
                fontSize: 'clamp(16px, 1.9vw, 26px)',
                color: '#0c0716',
                background: 'linear-gradient(180deg, #FFE27A, #FFB703)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 4px 16px rgba(0,0,0,0.6)',
                clipPath: 'polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
                textShadow: '1px 1px 0 rgba(255,255,255,0.4)',
              }}
            >
              RANDOM DRAW
            </div>
            <p className="font-body text-lg text-white/80 mt-3 leading-snug max-w-[26ch]" style={{ textShadow: '1px 1px 0 #000' }}>
              Hover a battleground to preview it, or hit FIGHT and let the dice decide.
            </p>
          </div>
        )}

        {/* Title block overlaid on the art */}
        {!isAuto && (
          <div className="absolute left-4 right-4 bottom-3">
            <div
              className="inline-block font-display text-[9px] tracking-widest px-2 py-1 mb-2"
              style={{ color: '#fff', background: `${scenario.accent}dd`, boxShadow: '0 2px 6px rgba(0,0,0,0.6)' }}
            >
              {scenario.tag}
            </div>
            <div
              className="font-display leading-tight"
              style={{ fontSize: 'clamp(20px, 2.5vw, 34px)', color: '#fff', textShadow: `3px 3px 0 #000, 0 0 20px ${scenario.accent}` }}
            >
              {scenario.name}
            </div>
          </div>
        )}
      </div>

      {/* Detail slab */}
      <div
        className="flex-shrink-0 px-4 py-3"
        style={{
          background: `linear-gradient(180deg, ${scenario.accent}14, rgba(10,7,20,0.94) 60%)`,
          borderTop: `2px solid ${isAuto ? '#FFD60A' : scenario.accent}`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12)`,
        }}
      >
        {isAuto ? (
          <p className="font-body text-lg text-white/80 leading-snug">
            One of nine battlegrounds will be chosen at random when the match begins. Stage bonuses still apply — pick deliberately to swing the odds.
          </p>
        ) : (
          <>
            <p className="font-body text-lg text-white/90 leading-snug line-clamp-3" style={{ textShadow: '1px 1px 0 #000' }}>{scenario.longDescription}</p>
            <div
              className="mt-2 px-3 py-1.5 italic font-body text-lg text-white"
              style={{ background: `${scenario.accent}22`, borderLeft: `3px solid ${scenario.accent}`, textShadow: '1px 1px 0 #000' }}
            >
              &ldquo;{scenario.flavorQuote}&rdquo;
            </div>
          </>
        )}

        {/* Stage bonuses */}
        {!isAuto && (
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {fighterA && (
              <FighterBonusRow side="a" name={fighterA.shortName} mult={fighterA.scenarioBonus[scenario.id] ?? 1.0} />
            )}
            {fighterB && (
              <FighterBonusRow side="b" name={fighterB.shortName} mult={fighterB.scenarioBonus[scenario.id] ?? 1.0} />
            )}
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
  const sideColor = side === 'a' ? '#E63946' : '#00B4D8'
  return (
    <div
      className="flex items-center justify-between px-2 py-1.5 font-display text-[9px] tracking-widest"
      style={{
        background: bigBonus ? `${sideColor}22` : 'rgba(0,0,0,0.35)',
        border: `1px solid ${bigBonus ? sideColor : 'rgba(255,255,255,0.12)'}`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      <span style={{ color: sideColor }}>{side === 'a' ? 'P1 ' : 'P2 '}{name}</span>
      <span
        className="text-[12px]"
        style={{
          color: pct >= 30 ? '#0AF0A8' : pct > 0 ? '#FFD60A' : pct < 0 ? '#FF6B6B' : '#FFFFFFcc',
          textShadow: pct !== 0 ? `0 0 8px ${pct >= 30 ? '#0AF0A8' : pct > 0 ? '#FFD60A' : '#FF6B6B'}66, 1px 1px 0 rgba(0,0,0,0.8)` : '1px 1px 0 rgba(0,0,0,0.8)',
        }}
      >
        {sign}{pct}% <span className="text-[8px] opacity-70">DMG</span>
      </span>
    </div>
  )
}
