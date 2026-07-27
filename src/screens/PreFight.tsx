import { useEffect, useState } from 'react'
import './ceremony/devExpose'
import './ceremony/ceremony.css'
import { ShockRing, ImpactFlash, SpeedStreaks } from './ceremony/CeremonyFX'
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
  const selectedB = useGame((s) => s.selectedB)
  const mode = useGame((s) => s.mode)
  const isBossFight = selectedB === 'lenny'

  // Authored VS cinematic. Practice mode gets a compressed ~2.4s window (the
  // store cuts to 'fight' early there); everything else gets the full ~4.2s.
  //   beat 0 : stage slams down, camera pushes in
  //   beat 1 : fighters SLAM in from opposite sides + names crash + shock rings
  //   beat 2 : VS impacts center — white flash + camera shake — then holds
  //   beat 3 : FIGHT! punches into the central gap, cut to combat
  const fast = mode === 'practice'
  const T = fast ? { b1: 380, b2: 1050, b3: 1850 } : { b1: 650, b2: 1750, b3: 3200 }
  const [beat, setBeat] = useState(0)
  useEffect(() => {
    const tStage = setTimeout(() => Announcer.stage(scenario), 300)
    const t1 = setTimeout(() => setBeat(1), T.b1)
    const t2 = setTimeout(() => setBeat(2), T.b2)
    const t3 = setTimeout(() => setBeat(3), T.b3)
    return () => {
      clearTimeout(tStage); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3)
    }
  }, [scenario, T.b1, T.b2, T.b3])

  useEffect(() => {
    if (beat === 1) Sfx.menuSelect()
    if (beat === 3) Sfx.fight()
  }, [beat])

  // Warm the browser cache for every sprite pose we'll need mid-fight.
  useEffect(() => {
    if (!fighterA || !fighterB) return
    const POSES = ['stance', 'attack', 'win', 'lose'] as const
    const urls: string[] = []
    for (const id of [fighterA.defId, fighterB.defId]) {
      for (const pose of POSES) urls.push(`/sprites/${id}/${pose}.png`)
    }
    const imgs = urls.map((u) => { const img = new Image(); img.src = u; return img })
    return () => { imgs.forEach((i) => { i.src = '' }) }
  }, [fighterA?.defId, fighterB?.defId])

  if (!fighterA || !fighterB) return null
  const a = getFighter(fighterA.defId)!
  const b = getFighter(fighterB.defId)!
  const stage = SCENARIOS[scenario]
  const flavor = SCENARIO_FLAVOR[scenario]
  const realStage = `/stages/${scenario}.png`

  const warm = a.accent || '#E63946'
  const cool = isBossFight ? '#F72585' : (b.accent || '#00B4D8')

  return (
    <div className="cer-anim relative w-full h-full overflow-hidden">
      {/* Camera rig — the whole scene shakes on the VS and FIGHT impacts. */}
      <div
        className="absolute inset-0"
        style={{
          animation:
            beat === 2 ? 'cer-shake-hard 0.4s ease-out both'
            : beat === 3 ? 'cer-shake-hard 0.3s ease-out both'
            : undefined,
        }}
      >
        {/* Stage backdrop with a slow push-in. */}
        <img
          src={realStage}
          alt={stage.name}
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            imageRendering: 'pixelated',
            filter: isBossFight && beat >= 1
              ? 'brightness(0.6) saturate(1.4) contrast(1.15)'
              : beat < 2 ? 'brightness(0.5) saturate(1.05)' : 'brightness(0.8) saturate(1.1)',
            transform: beat === 0 ? 'scale(1.2)' : beat === 1 ? 'scale(1.1)' : 'scale(1.02)',
            transition: 'filter 0.5s, transform 1.6s cubic-bezier(0.2,0.7,0.3,1)',
          }}
        />

        {/* Hard diagonal split — warm (player A) vs cool (player B) — wiping in
            from opposite edges as the fighters slam. Keeps the arena readable
            underneath at low opacity. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            clipPath: 'polygon(0 0, 60% 0, 40% 100%, 0 100%)',
            background: `linear-gradient(120deg, ${warm}55 0%, ${warm}18 55%, transparent 100%)`,
            opacity: beat >= 1 ? 1 : 0,
            transform: beat >= 1 ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.45s cubic-bezier(0.2,0.8,0.2,1), opacity 0.3s',
            mixBlendMode: 'screen',
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            clipPath: 'polygon(60% 0, 100% 0, 100% 100%, 40% 100%)',
            background: `linear-gradient(240deg, ${cool}55 0%, ${cool}18 55%, transparent 100%)`,
            opacity: beat >= 1 ? 1 : 0,
            transform: beat >= 1 ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.45s cubic-bezier(0.2,0.8,0.2,1), opacity 0.3s',
            mixBlendMode: 'screen',
          }}
        />
        {/* Bright seam down the diagonal. */}
        <div
          className="absolute inset-y-[-10%] left-1/2 w-[3px] pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.85), transparent)',
            transform: 'translateX(-50%) rotate(11deg)',
            opacity: beat >= 1 ? 0.9 : 0,
            transition: 'opacity 0.4s',
            boxShadow: '0 0 18px rgba(255,255,255,0.7)',
          }}
        />

        {/* Boss aura for Lenny. */}
        {isBossFight && beat >= 1 && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(247,37,133,0.18) 0%, rgba(114,9,183,0.28) 40%, rgba(15,10,26,0.6) 100%)',
              mixBlendMode: 'screen',
              animation: 'bossAura 2.4s ease-in-out infinite',
            }}
          />
        )}

        {/* Vignette + scanlines. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.82) 100%)' }}
        />
        <div className="absolute inset-0 pointer-events-none crt-overlay" />

        {/* Speed streaks on the slam. */}
        {beat === 1 && <SpeedStreaks />}

        {/* FIGHTER A — slams in from the left, anchored bottom-left. */}
        <div
          className="absolute z-20"
          style={{
            left: '4%', bottom: '6%',
            width: 'min(38vw, 460px)', height: 'min(70vh, 620px)',
          }}
        >
          <div
            style={{
              width: '100%', height: '100%', position: 'relative',
              filter: `drop-shadow(0 0 26px ${warm}) drop-shadow(6px 10px 0 rgba(0,0,0,0.5))`,
              opacity: beat >= 1 ? 1 : 0,
              animation: beat >= 1 ? 'cer-slam-left 0.6s cubic-bezier(0.2,0.9,0.25,1) both' : undefined,
            }}
          >
            <Sprite fighter={a} side="a" state="stance" />
            <FloorShadow />
          </div>
          {beat === 1 && (
            <div className="absolute" style={{ left: '45%', bottom: '4%' }}>
              <ShockRing color={warm} size={140} delay={0.18} />
            </div>
          )}
        </div>

        {/* FIGHTER B — slams in from the right, anchored bottom-right, staggered. */}
        <div
          className="absolute z-20"
          style={{
            right: '4%', bottom: '6%',
            width: 'min(38vw, 460px)', height: 'min(70vh, 620px)',
          }}
        >
          <div
            style={{
              width: '100%', height: '100%', position: 'relative',
              filter: isBossFight
                ? `drop-shadow(0 0 30px ${cool}) drop-shadow(0 0 60px #7209B7)`
                : `drop-shadow(0 0 26px ${cool}) drop-shadow(-6px 10px 0 rgba(0,0,0,0.5))`,
              opacity: beat >= 1 ? 1 : 0,
              animation: beat >= 1 ? 'cer-slam-right 0.6s cubic-bezier(0.2,0.9,0.25,1) 0.18s both' : undefined,
            }}
          >
            <Sprite fighter={b} side="b" state="stance" />
            <FloorShadow />
          </div>
          {beat === 1 && (
            <div className="absolute" style={{ right: '45%', bottom: '4%' }}>
              <ShockRing color={cool} size={140} delay={0.34} />
            </div>
          )}
        </div>

        {/* NAME PLATE A — crashes in from the left, upper-left corner. */}
        <div
          className="absolute z-30"
          style={{
            top: '13%', left: '4%',
            opacity: beat >= 1 ? 1 : 0,
            animation: beat >= 1 ? 'cer-name-left 0.5s cubic-bezier(0.2,0.9,0.25,1) 0.1s both' : undefined,
          }}
        >
          <NamePlate name={a.shortName} sub={`${a.episode} · ${a.archetype}`} color={warm} align="left" />
        </div>

        {/* NAME PLATE B — crashes in from the right, lower-right corner. */}
        <div
          className="absolute z-30 text-right"
          style={{
            bottom: '16%', right: '4%',
            opacity: beat >= 1 ? 1 : 0,
            animation: beat >= 1 ? 'cer-name-right 0.5s cubic-bezier(0.2,0.9,0.25,1) 0.28s both' : undefined,
          }}
        >
          {isBossFight && (
            <div
              className="font-display tracking-widest mb-2 px-3 py-1 inline-block"
              style={{
                background: 'linear-gradient(90deg, #7209B7, #F72585, #7209B7)',
                color: 'white', fontSize: 11, letterSpacing: '0.4em',
                border: '2px solid white', textShadow: '2px 2px 0 black',
                boxShadow: '0 0 16px #F72585', animation: 'bossBannerPulse 1.4s ease-in-out infinite',
              }}
            >
              ★ FINAL BOSS ★
            </div>
          )}
          <NamePlate name={b.shortName} sub={`${b.episode} · ${b.archetype}`} color={cool} align="right" />
        </div>

        {/* STAGE title — slams down from the top at beat 0, then persists small. */}
        <div className="absolute top-6 left-0 right-0 text-center px-6 z-30 pointer-events-none">
          <div
            className="font-display text-[10px] tracking-widest text-white/70 mb-2"
            style={{ textShadow: '2px 2px 0 black' }}
          >
            ◇ ROUND {round} of 3 ◇
          </div>
          <div
            className="font-display tracking-widest inline-block"
            style={{
              color: '#FFD60A',
              fontSize: beat === 0 ? 'clamp(28px, 4vw, 56px)' : 'clamp(16px, 1.8vw, 24px)',
              textShadow: '5px 5px 0 black, 0 0 24px #F77F00',
              animation: beat === 0 ? 'cer-title-drop 0.55s cubic-bezier(0.2,0.9,0.25,1) both' : undefined,
              transform: 'skewX(-6deg)',
              transition: 'font-size 0.4s',
            }}
          >
            {stage.name}
          </div>
          {beat === 0 && (
            <div
              className="font-display tracking-widest mt-3 mx-auto max-w-3xl"
              style={{ color: '#F77F00', fontSize: 'clamp(11px,1.3vw,16px)', textShadow: '3px 3px 0 black' }}
            >
              {flavor.tagline}
            </div>
          )}
        </div>

        {/* VS badge — impacts the center seam at beat 2. */}
        {beat >= 2 && beat < 3 && (
          <div className="absolute inset-0 z-30 pointer-events-none">
            <div className="absolute left-1/2 top-1/2">
              <ShockRing color="#FFD60A" size={180} thickness={5} duration={0.55} />
              <ShockRing color="#FFFFFF" size={120} thickness={3} delay={0.06} duration={0.5} />
            </div>
            <div
              className="absolute left-1/2 top-1/2 font-display"
              style={{
                fontSize: 'clamp(72px, 12vw, 160px)',
                color: '#FFD60A',
                textShadow: '8px 8px 0 black, 0 0 30px #F77F00, 0 0 60px #E63946',
                animation: 'cer-vs-impact 0.5s cubic-bezier(0.15,0.85,0.3,1) both, cer-vs-idle 1.1s ease-in-out 0.5s infinite',
              }}
            >
              VS
            </div>
          </div>
        )}

        {/* FIGHT! — punches into the central gap at beat 3. */}
        {beat >= 3 && (
          <>
            <ImpactFlash />
            <div className="absolute inset-0 z-30 pointer-events-none">
              <div className="absolute left-1/2 top-1/2">
                <ShockRing color="#F72585" size={220} thickness={6} duration={0.5} />
                <ShockRing color="#FFD60A" size={140} thickness={4} delay={0.05} duration={0.45} />
              </div>
              <div
                className="absolute left-1/2 top-1/2 font-display"
                style={{
                  fontSize: 'clamp(64px, 11vw, 150px)',
                  color: 'white',
                  textShadow: '8px 8px 0 black, 0 0 34px #F72585, 0 0 68px #FFD60A',
                  animation: 'cer-fight-punch 0.36s cubic-bezier(0.15,0.9,0.3,1) both, cer-fight-jitter 0.18s steps(2) 0.36s 3',
                }}
              >
                FIGHT!
              </div>
            </div>
          </>
        )}

        {/* Scenario bonus reminder — bottom center. */}
        <div className="absolute bottom-5 left-0 right-0 text-center px-6 z-30 pointer-events-none">
          <div
            className="inline-block px-5 py-2 font-display text-xs tracking-widest"
            style={{
              background: 'rgba(0,0,0,0.8)',
              border: '2px solid #FFD60A',
              color: '#FFD60A',
              textShadow: '2px 2px 0 black, 0 0 12px #F77F00',
              boxShadow: '0 0 18px rgba(255,214,10,0.4), inset -2px -2px 0 rgba(0,0,0,0.5)',
              opacity: beat >= 2 ? 1 : 0,
              transition: 'opacity 0.4s',
              animation: beat >= 2 ? 'flash 1.8s ease-in-out infinite' : undefined,
            }}
          >
            {scenarioBonusLine(a, b, scenario)}
          </div>
        </div>
      </div>
    </div>
  )
}

function FloorShadow() {
  return (
    <div
      className="absolute"
      style={{
        left: '50%', bottom: '2%', transform: 'translateX(-50%)',
        width: '55%', height: 26,
        background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 70%)',
        pointerEvents: 'none',
      }}
    />
  )
}

function NamePlate({
  name, sub, color, align,
}: {
  name: string; sub: string; color: string; align: 'left' | 'right'
}) {
  return (
    <div className={align === 'right' ? 'inline-block text-right' : 'inline-block text-left'}>
      <div
        className="font-display tracking-widest px-5 py-2"
        style={{
          fontSize: 'clamp(22px, 3.2vw, 44px)',
          color: 'white',
          background: `linear-gradient(180deg, ${color}, ${color}bb)`,
          textShadow: '3px 3px 0 black',
          border: '3px solid white',
          boxShadow: `6px 6px 0 rgba(0,0,0,0.55), 0 0 22px ${color}`,
          transform: 'skewX(-12deg)',
        }}
      >
        <span style={{ display: 'inline-block', transform: 'skewX(12deg)' }}>{name}</span>
      </div>
      <div
        className="font-display text-[9px] tracking-widest text-white/80 mt-2 px-1"
        style={{ textShadow: '2px 2px 0 black' }}
      >
        {sub}
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
