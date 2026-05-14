import { useEffect, useState } from 'react'
import { Announcer } from '../lib/announcer'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { SCENARIOS } from '../data/scenarios'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'
import type { ScenarioId } from '../types'

// Punchy scenario flavor — the humor + setting users want to grok
const SCENARIO_FLAVOR: Record<ScenarioId, { tagline: string; flavor: string }> = {
  'pre-pmf': {
    tagline: 'NO TRACTION. NO REVENUE. NO PROBLEM.',
    flavor: 'Whiteboards, ramen, and existential dread. The wedge is yours to find.',
  },
  hypergrowth: {
    tagline: 'BURN RATE? WHAT BURN RATE?',
    flavor: 'Charts going up and to the right. Pray they keep going.',
  },
  plateau: {
    tagline: 'THE GROWTH STOPPED. THE QUESTIONS BEGAN.',
    flavor: 'Empty boardroom at sunset. Someone has to call it.',
  },
  'ai-native': {
    tagline: 'SHIP THE PREVIEW. LEARN AT GPU SPEED.',
    flavor: 'Cooling fans humming. Models training. Every shipping window is shorter than the last.',
  },
  monetization: {
    tagline: 'WILLINGNESS TO PAY IS CONVERSATION #1.',
    flavor: 'Three tiers. Always three tiers. Anchor, target, premium.',
  },
  crisis: {
    tagline: 'CASH IS LOW. PEOPLE ARE SCARED.',
    flavor: 'The hardest decisions of your operator career — made under fluorescent emergency lighting.',
  },
  'ipo-prep': {
    tagline: 'INVESTOR DAY. NO SECOND CHANCES.',
    flavor: 'Five thousand seats. One screen. One narrative. Don\'t blink.',
  },
  distribution: {
    tagline: 'WHERE ATTENTION GOES, VALUE FLOWS.',
    flavor: 'Distribution has become the most important moat. — Spiegel, ep 308.',
  },
}

export function PreFight() {
  const fighterA = useGame((s) => s.fighterA)
  const fighterB = useGame((s) => s.fighterB)
  const scenario = useGame((s) => s.scenario)
  const round = useGame((s) => s.round)

  // Pre-fight has 3 beats:
  // 0  → 1100ms : "STAGE" reveal with location image + tagline
  // 1100 → 2500ms : Fighters slide in with VS badge
  // 2500 → 4200ms : "FIGHT!" pulse + scenario flavor
  const [beat, setBeat] = useState(0)
  useEffect(() => {
    // Announce the stage at the start of pre-fight (deferred slightly to
    // sit cleanly after any previous menu chime).
    const tStage = setTimeout(() => Announcer.stage(scenario), 300)
    const t1 = setTimeout(() => setBeat(1), 1100)
    const t2 = setTimeout(() => setBeat(2), 2500)
    return () => {
      clearTimeout(tStage)
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [scenario])

  useEffect(() => {
    if (beat === 0) Sfx.menuSelect()
    if (beat === 2) Sfx.fight()
  }, [beat])

  if (!fighterA || !fighterB) return null
  const a = getFighter(fighterA.defId)!
  const b = getFighter(fighterB.defId)!
  const stage = SCENARIOS[scenario]
  const flavor = SCENARIO_FLAVOR[scenario]
  const realStage = `/stages/${scenario}.png`

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      {/* The actual stage image as the backdrop */}
      <img
        src={realStage}
        alt={stage.name}
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          imageRendering: 'pixelated',
          filter: beat < 2 ? 'brightness(0.55) saturate(1.1)' : 'brightness(0.85) saturate(1.1)',
          transition: 'filter 0.6s',
        }}
      />
      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 25%, rgba(0,0,0,0.85) 100%)',
        }}
      />
      {/* Scanlines */}
      <div className="absolute inset-0 pointer-events-none crt-overlay" />

      {/* BEAT 0: stage reveal */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center z-10 transition-opacity duration-500 ${
          beat === 0 ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ pointerEvents: 'none' }}
      >
        <div
          className="font-display text-[10px] tracking-widest text-white/60 mb-2"
          style={{ textShadow: '2px 2px 0 black' }}
        >
          ◇ ROUND {round} of 3 · STAGE {round} ◇
        </div>
        <div
          className="font-display text-5xl tracking-widest text-center px-6"
          style={{
            color: '#FFD60A',
            textShadow: '6px 6px 0 black, 0 0 24px #F77F00',
            transform: 'skewX(-6deg)',
          }}
        >
          {stage.name}
        </div>
        <div
          className="font-display text-base tracking-widest text-center mt-3 px-6 max-w-3xl"
          style={{
            color: '#F77F00',
            textShadow: '3px 3px 0 black',
          }}
        >
          {flavor.tagline}
        </div>
      </div>

      {/* BEAT 1: fighters slide in */}
      <div
        className={`absolute inset-0 flex items-center justify-center z-10 transition-opacity duration-500 ${
          beat >= 1 ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ pointerEvents: 'none' }}
      >
        <div className="flex items-center gap-10 md:gap-16">
          <div
            className="flex flex-col items-center"
            style={{
              transform: beat >= 1 ? 'translateX(0)' : 'translateX(-200px)',
              transition: 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
              filter: 'drop-shadow(0 0 24px #E63946)',
            }}
          >
            <div style={{ width: 200, height: 280 }}>
              <Sprite fighter={a} side="a" state="stance" />
            </div>
            <div
              className="font-display text-base tracking-widest mt-3 px-4 py-1"
              style={{
                color: 'white',
                background: a.accent,
                textShadow: '2px 2px 0 black',
                boxShadow: '0 0 16px ' + a.accent,
                border: '2px solid white',
              }}
            >
              {a.shortName}
            </div>
            <div className="font-display text-[8px] tracking-widest text-white/70 mt-1">
              {a.episode} · {a.archetype}
            </div>
          </div>

          <div
            className="font-display text-7xl tracking-widest"
            style={{
              color: '#FFD60A',
              textShadow: '6px 6px 0 black, 0 0 24px #F77F00',
              transform: beat >= 1 ? 'scale(1) rotate(-4deg)' : 'scale(0) rotate(180deg)',
              transition: 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
              animation: beat >= 1 ? 'logo-pulse 1.2s ease-in-out infinite' : undefined,
            }}
          >
            VS
          </div>

          <div
            className="flex flex-col items-center"
            style={{
              transform: beat >= 1 ? 'translateX(0)' : 'translateX(200px)',
              transition: 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
              filter: 'drop-shadow(0 0 24px #00B4D8)',
            }}
          >
            <div style={{ width: 200, height: 280 }}>
              <Sprite fighter={b} side="b" state="stance" />
            </div>
            <div
              className="font-display text-base tracking-widest mt-3 px-4 py-1"
              style={{
                color: 'white',
                background: b.accent,
                textShadow: '2px 2px 0 black',
                boxShadow: '0 0 16px ' + b.accent,
                border: '2px solid white',
              }}
            >
              {b.shortName}
            </div>
            <div className="font-display text-[8px] tracking-widest text-white/70 mt-1">
              {b.episode} · {b.archetype}
            </div>
          </div>
        </div>
      </div>

      {/* BEAT 2: FIGHT! + scenario flavor */}
      <div
        className={`absolute inset-0 z-20 transition-opacity duration-300 ${
          beat >= 2 ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ pointerEvents: 'none' }}
      >
        {/* Stage flavor at top */}
        <div className="absolute top-8 left-0 right-0 text-center px-6">
          <div
            className="font-display text-base tracking-widest mb-1"
            style={{ color: '#FFD60A', textShadow: '3px 3px 0 black' }}
          >
            ▌ {stage.name}
          </div>
          <p
            className="font-body text-xl text-white/90 italic max-w-3xl mx-auto leading-snug"
            style={{ textShadow: '2px 2px 0 rgba(0,0,0,0.85)' }}
          >
            &ldquo;{flavor.flavor}&rdquo;
          </p>
        </div>

        {/* FIGHT! */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="font-display text-9xl tracking-widest"
            style={{
              color: 'white',
              textShadow: '8px 8px 0 black, 0 0 32px #F72585, 0 0 64px #FFD60A',
              animation: 'logo-pulse 0.5s ease-in-out infinite',
              transform: 'skewX(-8deg)',
            }}
          >
            FIGHT!
          </div>
        </div>

        {/* Scenario bonus reminder at bottom */}
        <div className="absolute bottom-10 left-0 right-0 text-center px-6">
          <div
            className="inline-block px-4 py-2 font-display text-[9px] tracking-widest"
            style={{
              background: 'rgba(0,0,0,0.7)',
              border: '2px solid #FFD60A',
              color: '#FFD60A',
              textShadow: '2px 2px 0 black',
            }}
          >
            {scenarioBonusLine(a, b, scenario)}
          </div>
        </div>
      </div>
    </div>
  )
}

function scenarioBonusLine(
  a: ReturnType<typeof getFighter>,
  b: ReturnType<typeof getFighter>,
  scenario: ScenarioId
): string {
  if (!a || !b) return ''
  const aBonus = a.scenarioBonus[scenario]
  const bBonus = b.scenarioBonus[scenario]
  const parts: string[] = []
  if (aBonus && aBonus > 1) parts.push(`${a.shortName} +${Math.round((aBonus - 1) * 100)}%`)
  if (bBonus && bBonus > 1) parts.push(`${b.shortName} +${Math.round((bBonus - 1) * 100)}%`)
  if (parts.length === 0) return '◇ NEUTRAL GROUND — NO SCENARIO BONUS ◇'
  return '⚡ SCENARIO BONUS · ' + parts.join('  /  ') + ' ⚡'
}
