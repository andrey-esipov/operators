import { useEffect, useState } from 'react'
import './ceremony/devExpose'
import './ceremony/ceremony.css'
import { ShockRing, ImpactFlash, SpeedStreaks } from './ceremony/CeremonyFX'
import { PowerWord, Nameplate, Kicker } from './ceremony/CeremonyType'
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
  const T = fast ? { b1: 360, b2: 1000, b3: 1800 } : { b1: 600, b2: 1650, b3: 3100 }
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
    <div className="cer-anim relative w-full h-full overflow-hidden" style={{ background: '#05030b' }}>
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
              ? 'brightness(0.52) saturate(1.5) contrast(1.18)'
              : beat < 2 ? 'brightness(0.44) saturate(1.05)' : 'brightness(0.66) saturate(1.12)',
            transform: beat === 0 ? 'scale(1.22)' : beat === 1 ? 'scale(1.12)' : 'scale(1.03)',
            transition: 'filter 0.5s, transform 1.6s cubic-bezier(0.2,0.7,0.3,1)',
          }}
        />

        {/* BOLD diagonal color-block split — warm (A) vs cool (B) — full-bleed
            skewed panels that slam in from opposite edges. Strong enough to
            read as a designed split while the arena stays visible under them. */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: '-8%', bottom: '-8%', left: '-14%', width: '72%',
            transform: beat >= 1 ? 'translateX(0) skewX(-11deg)' : 'translateX(-115%) skewX(-11deg)',
            transition: 'transform 0.5s cubic-bezier(0.2,0.85,0.2,1)',
            background: `linear-gradient(100deg, ${warm}dd 0%, ${warm}66 46%, ${warm}10 74%, transparent 100%)`,
            mixBlendMode: 'soft-light',
          }}
        />
        <div
          className="absolute pointer-events-none"
          style={{
            top: '-8%', bottom: '-8%', right: '-14%', width: '72%',
            transform: beat >= 1 ? 'translateX(0) skewX(-11deg)' : 'translateX(115%) skewX(-11deg)',
            transition: 'transform 0.5s cubic-bezier(0.2,0.85,0.2,1)',
            background: `linear-gradient(260deg, ${cool}dd 0%, ${cool}66 46%, ${cool}10 74%, transparent 100%)`,
            mixBlendMode: 'soft-light',
          }}
        />
        {/* Saturated accent rails hugging the outer edges. */}
        <div className="absolute inset-y-0 left-0 w-[10px] pointer-events-none" style={{ background: warm, opacity: beat >= 1 ? 0.9 : 0, boxShadow: `0 0 30px ${warm}`, transition: 'opacity 0.4s' }} />
        <div className="absolute inset-y-0 right-0 w-[10px] pointer-events-none" style={{ background: cool, opacity: beat >= 1 ? 0.9 : 0, boxShadow: `0 0 30px ${cool}`, transition: 'opacity 0.4s' }} />

        {/* Bold diagonal energy slash that physically cuts the frame in two. */}
        <div
          className="absolute inset-y-[-14%] left-1/2 pointer-events-none"
          style={{
            width: 14,
            background: 'linear-gradient(180deg, transparent, #ffffff 12%, rgba(255,255,255,0.7) 50%, #ffffff 88%, transparent)',
            transform: 'translateX(-50%) rotate(11deg)',
            opacity: beat >= 1 ? 1 : 0,
            transition: 'opacity 0.4s',
            clipPath: 'polygon(50% 0, 100% 4%, 62% 50%, 100% 96%, 50% 100%, 0 96%, 38% 50%, 0 4%)',
            boxShadow: '0 0 34px rgba(255,255,255,0.95), 0 0 90px rgba(120,200,255,0.6)',
            animation: beat >= 1 ? 'cer-seam-pulse 1.4s ease-in-out infinite' : undefined,
          }}
        />
        {beat >= 1 && (
          <div
            className="absolute left-1/2 top-1/2 pointer-events-none"
            style={{
              width: 3, height: '60%',
              background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.9), transparent)',
              animation: 'cer-seam-scan 1.8s ease-in-out infinite',
              boxShadow: '0 0 18px #fff',
            }}
          />
        )}

        {/* Marching chevrons behind each slam. */}
        {beat === 1 && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {[0, 1, 2].map((i) => (
              <div key={`cl${i}`} className="absolute" style={{
                top: `${30 + i * 14}%`, left: 0, width: 90, height: 8,
                background: `linear-gradient(90deg, transparent, ${warm})`,
                ['--chev-from' as string]: '-20vw', ['--chev-to' as string]: '30vw',
                animation: `cer-chev-drift ${0.55 + i * 0.05}s ease-out ${i * 0.05}s both`,
              }} />
            ))}
            {[0, 1, 2].map((i) => (
              <div key={`cr${i}`} className="absolute" style={{
                top: `${36 + i * 14}%`, right: 0, width: 90, height: 8,
                background: `linear-gradient(270deg, transparent, ${cool})`,
                ['--chev-from' as string]: '20vw', ['--chev-to' as string]: '-30vw',
                animation: `cer-chev-drift ${0.55 + i * 0.05}s ease-out ${0.1 + i * 0.05}s both`,
              }} />
            ))}
          </div>
        )}

        {/* Boss aura for Lenny. */}
        {isBossFight && beat >= 1 && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(247,37,133,0.2) 0%, rgba(114,9,183,0.3) 40%, rgba(15,10,26,0.6) 100%)',
              mixBlendMode: 'screen',
              animation: 'bossAura 2.4s ease-in-out infinite',
            }}
          />
        )}

        {/* Vignette + grain + scanlines. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, transparent 26%, rgba(0,0,0,0.86) 100%)' }}
        />
        <div className="cer-grain" />
        <div className="absolute inset-0 pointer-events-none crt-overlay" />

        {/* Speed streaks on the slam. */}
        {beat === 1 && <SpeedStreaks />}

        {/* FIGHTER A — slams in from the left, anchored bottom-left. */}
        <div
          className="absolute z-20"
          style={{
            left: '0%', bottom: '-4%',
            width: 'min(45vw, 580px)', height: 'min(88vh, 850px)',
          }}
        >
          <div
            style={{
              width: '100%', height: '100%', position: 'relative',
              filter: `drop-shadow(0 0 30px ${warm}) drop-shadow(8px 12px 0 rgba(0,0,0,0.55))`,
              opacity: beat >= 1 ? 1 : 0,
              animation: beat >= 1 ? 'cer-slam-left 0.6s cubic-bezier(0.2,0.9,0.25,1) both' : undefined,
            }}
          >
            <div className="cer-breathe-slow" style={{ width: '100%', height: '100%' }}>
              <Sprite fighter={a} side="a" state="stance" />
            </div>
            <FloorShadow />
          </div>
          {beat === 1 && (
            <div className="absolute" style={{ left: '45%', bottom: '4%' }}>
              <ShockRing color={warm} size={150} delay={0.18} />
            </div>
          )}
        </div>

        {/* FIGHTER B — slams in from the right, anchored bottom-right, staggered. */}
        <div
          className="absolute z-20"
          style={{
            right: '0%', bottom: '-4%',
            width: 'min(45vw, 580px)', height: 'min(88vh, 850px)',
          }}
        >
          <div
            style={{
              width: '100%', height: '100%', position: 'relative',
              filter: isBossFight
                ? `drop-shadow(0 0 34px ${cool}) drop-shadow(0 0 68px #7209B7)`
                : `drop-shadow(0 0 30px ${cool}) drop-shadow(-8px 12px 0 rgba(0,0,0,0.55))`,
              opacity: beat >= 1 ? 1 : 0,
              animation: beat >= 1 ? 'cer-slam-right 0.6s cubic-bezier(0.2,0.9,0.25,1) 0.16s both' : undefined,
            }}
          >
            <div className="cer-breathe-slow" style={{ width: '100%', height: '100%' }}>
              <Sprite fighter={b} side="b" state="stance" />
            </div>
            <FloorShadow />
          </div>
          {beat === 1 && (
            <div className="absolute" style={{ right: '45%', bottom: '4%' }}>
              <ShockRing color={cool} size={150} delay={0.34} />
            </div>
          )}
        </div>

        {/* NAME PLATE A — crashes in from the left, upper-left corner. */}
        <div
          className="absolute z-30"
          style={{
            top: '12%', left: '3%',
            opacity: beat >= 1 ? 1 : 0,
            animation: beat >= 1 ? 'cer-plate-left 0.52s cubic-bezier(0.2,0.9,0.25,1) 0.08s both' : undefined,
          }}
        >
          <Nameplate name={a.shortName} sub={`${a.episode.toUpperCase()} · ${a.archetype}`} color={warm} align="left" tag={fast ? 'TRAINING' : '1P'} />
        </div>

        {/* NAME PLATE B — crashes in from the right, lower-right corner. */}
        <div
          className="absolute z-30"
          style={{
            bottom: '15%', right: '3%',
            opacity: beat >= 1 ? 1 : 0,
            animation: beat >= 1 ? 'cer-plate-right 0.52s cubic-bezier(0.2,0.9,0.25,1) 0.26s both' : undefined,
          }}
        >
          <Nameplate
            name={b.shortName}
            sub={`${b.episode.toUpperCase()} · ${b.archetype}`}
            color={cool}
            align="right"
            tag={isBossFight ? '★ FINAL BOSS ★' : mode === 'vs' ? '2P' : 'CPU'}
            tagStyle={isBossFight ? { background: 'linear-gradient(90deg,#7209B7,#F72585,#7209B7)', animation: 'bossBannerPulse 1.4s ease-in-out infinite' } : undefined}
          />
        </div>

        {/* TOP HUD — round pips + stage name. */}
        <div
          className="absolute top-5 left-0 right-0 z-30 pointer-events-none flex flex-col items-center"
          style={{ animation: 'cer-hud-in 0.5s cubic-bezier(0.2,0.9,0.25,1) both' }}
        >
          <div className="flex items-center gap-3 mb-2">
            <div style={{ height: 2, width: 'clamp(40px,7vw,120px)', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.7))' }} />
            {[1, 2, 3].map((r) => (
              <div key={r} style={{
                width: 12, height: 12, transform: 'rotate(45deg)',
                background: r <= round ? '#FFD60A' : 'rgba(255,255,255,0.18)',
                boxShadow: r <= round ? '0 0 12px #FFD60A' : 'none',
                border: '1px solid rgba(255,255,255,0.5)',
              }} />
            ))}
            <div style={{ height: 2, width: 'clamp(40px,7vw,120px)', background: 'linear-gradient(90deg,rgba(255,255,255,0.7),transparent)' }} />
          </div>
          <Kicker style={{ fontSize: 'clamp(9px,1vw,12px)', letterSpacing: '0.5em', color: 'rgba(255,255,255,0.6)' }}>
            {fast ? 'TRAINING' : `ROUND ${round} OF 3`}
          </Kicker>
          <div
            className="cer-type cer-display"
            style={{
              color: '#FFD60A',
              fontSize: beat === 0 ? 'clamp(30px, 5vw, 66px)' : 'clamp(20px, 2.4vw, 32px)',
              lineHeight: 1,
              marginTop: 4,
              letterSpacing: '0.02em',
              textShadow: '4px 4px 0 rgba(0,0,0,0.9), 0 0 26px #F77F00',
              transform: 'skewX(-8deg)',
              transition: 'font-size 0.4s',
              animation: beat === 0 ? 'cer-word-slam 0.5s cubic-bezier(0.2,0.9,0.25,1) both' : undefined,
            }}
          >
            {stage.name.toUpperCase()}
          </div>
          {beat === 0 && (
            <div
              className="cer-type cer-cond"
              style={{ color: '#FBBF24', fontSize: 'clamp(12px,1.5vw,18px)', fontWeight: 600, letterSpacing: '0.16em', marginTop: 10, textShadow: '2px 2px 0 rgba(0,0,0,0.8)' }}
            >
              {flavor.tagline}
            </div>
          )}
        </div>

        {/* VS badge — impacts the center seam at beat 2 and holds until FIGHT. */}
        {beat === 2 && (
          <div className="absolute inset-0 z-30 pointer-events-none">
            <div className="absolute left-1/2 top-1/2">
              <ShockRing color="#FFD60A" size={220} thickness={6} duration={0.6} />
              <ShockRing color="#FFFFFF" size={150} thickness={3} delay={0.06} duration={0.55} />
            </div>
            {/* Angular backing plate behind the VS. */}
            <div
              className="absolute left-1/2 top-1/2"
              style={{
                width: 'clamp(200px, 30vw, 460px)', height: 'clamp(150px, 22vw, 340px)',
                transform: 'translate(-50%,-50%) rotate(-7deg)',
                clipPath: 'polygon(14% 0, 100% 6%, 86% 100%, 0 94%)',
                background: 'linear-gradient(135deg, rgba(10,6,20,0.82), rgba(35,10,30,0.5))',
                border: '2px solid rgba(255,255,255,0.22)',
                boxShadow: '0 0 60px rgba(0,0,0,0.7)',
                animation: 'cer-vs-crash 0.46s cubic-bezier(0.15,0.9,0.3,1) both',
              }}
            />
            <div className="absolute left-1/2 top-1/2">
              <PowerWord
                size="clamp(140px, 24vw, 340px)"
                color="#FFD60A"
                glow="#F77F00"
                glow2="#E63946"
                skew={0}
                entrance="vs"
                live
                style={{ position: 'absolute', transformOrigin: 'center', animation: 'cer-vs-crash 0.46s cubic-bezier(0.15,0.9,0.3,1) both, cer-vs-hum 1.2s ease-in-out 0.5s infinite' }}
              >
                VS
              </PowerWord>
            </div>
          </div>
        )}

        {/* FIGHT! — punches into the central gap at beat 3. */}
        {beat >= 3 && (
          <>
            <ImpactFlash />
            <div className="absolute inset-0 z-30 pointer-events-none">
              <div className="absolute left-1/2 top-1/2">
                <ShockRing color="#F72585" size={260} thickness={7} duration={0.5} />
                <ShockRing color="#FFD60A" size={170} thickness={4} delay={0.05} duration={0.45} />
              </div>
              <div
                className="absolute left-1/2 top-1/2"
                style={{ transform: 'translate(-50%,-50%)' }}
              >
                <PowerWord
                  size="clamp(110px, 19vw, 280px)"
                  color="#FFFFFF"
                  glow="#F72585"
                  glow2="#FFD60A"
                  skew={-8}
                  entrance="slam"
                  live
                  style={{ animation: 'cer-word-slam 0.34s cubic-bezier(0.16,0.9,0.28,1) both, cer-fight-jitter 0.18s steps(2) 0.34s 3' }}
                >
                  FIGHT!
                </PowerWord>
              </div>
            </div>
          </>
        )}

        {/* Scenario bonus reminder — bottom center. */}
        <div className="absolute bottom-4 left-0 right-0 text-center px-6 z-30 pointer-events-none">
          <div
            className="cer-type cer-cond inline-block px-6 py-2"
            style={{
              background: 'rgba(6,4,14,0.82)',
              border: '1px solid rgba(255,214,10,0.6)',
              borderLeft: '4px solid #FFD60A',
              borderRight: '4px solid #FFD60A',
              color: '#FFD60A',
              fontWeight: 600,
              fontSize: 'clamp(11px,1.3vw,15px)',
              letterSpacing: '0.2em',
              textShadow: '1px 1px 0 rgba(0,0,0,0.8)',
              boxShadow: '0 0 22px rgba(255,214,10,0.3)',
              opacity: beat >= 2 ? 1 : 0,
              transform: 'skewX(-8deg)',
              transition: 'opacity 0.4s',
            }}
          >
            <span style={{ display: 'inline-block', transform: 'skewX(8deg)' }}>{scenarioBonusLine(a, b, scenario)}</span>
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
        width: '58%', height: 30,
        background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 70%)',
        pointerEvents: 'none',
      }}
    />
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
