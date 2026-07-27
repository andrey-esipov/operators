import { useEffect, useMemo, useState } from 'react'
import './ceremony/devExpose'
import './ceremony/ceremony.css'
import { ImpactFlash, StageBackdrop, WinnerFloor } from './ceremony/CeremonyFX'
import { PowerWord, Kicker, CER_GRAD } from './ceremony/CeremonyType'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'
import { ARCADE_PROGRESSION } from '../data/scenarios'

export function MatchEnd() {
  const fighterA = useGame((s) => s.fighterA)
  const fighterB = useGame((s) => s.fighterB)
  const roundsWon = useGame((s) => s.roundsWon)
  const resetMatch = useGame((s) => s.resetMatch)
  const quoteBank = useGame((s) => s.quoteBank)
  const log = useGame((s) => s.log)
  const mode = useGame((s) => s.mode)
  const arcadeStep = useGame((s) => s.arcadeStep)
  const nextArcadeFight = useGame((s) => s.nextArcadeFight)
  const setPhase = useGame((s) => s.setPhase)
  const scenario = useGame((s) => s.scenario)

  useEffect(() => {
    if (roundsWon.a >= 2) Sfx.victory()
    else if (roundsWon.b >= 2) Sfx.defeat()
  }, [])

  // Final-round stats — biggest single hit and the longest combo streak.
  const matchStats = useMemo(() => {
    let biggest = 0
    let longestCombo = 0
    let currentStreak = 0
    let currentSide: 'a' | 'b' | null = null
    for (const entry of log) {
      if (entry.finalDamage > biggest) biggest = entry.finalDamage
      if (entry.finalDamage > 0) {
        if (entry.attacker === currentSide) {
          currentStreak += 1
        } else {
          currentSide = entry.attacker
          currentStreak = 1
        }
        if (currentStreak > longestCombo) longestCombo = currentStreak
      }
    }
    return { biggest, longestCombo }
  }, [log])

  if (!fighterA || !fighterB) return null
  const winnerSide: 'a' | 'b' =
    roundsWon.a >= 2 ? 'a'
    : roundsWon.b >= 2 ? 'b'
    : (log[log.length - 1]?.attacker ?? 'a')
  const winner = winnerSide === 'a' ? getFighter(fighterA.defId)! : getFighter(fighterB.defId)!
  const loser = winnerSide === 'a' ? getFighter(fighterB.defId)! : getFighter(fighterA.defId)!
  const winnerHpPct = Math.round(
    ((winnerSide === 'a' ? fighterA.hp : fighterB.hp) /
     (winnerSide === 'a' ? fighterA.maxHp : fighterB.maxHp)) * 100
  )

  const arcadePlayerWon = mode === 'arcade' && winnerSide === 'a'
  const arcadePlayerLost = mode === 'arcade' && winnerSide === 'b'
  const isFinalBoss = mode === 'arcade' && arcadeStep === ARCADE_PROGRESSION.length - 1

  const accent = winner.accent || '#FFD60A'
  const loserSide: 'a' | 'b' = winnerSide === 'a' ? 'b' : 'a'
  // When the arcade player loses, the emotional focus flips: THEIR fighter is
  // the large, defeated hero and the CPU that beat them stands as the small,
  // lit victor. On a win it's the classic champion-large / fallen-small frame.
  const hero = arcadePlayerLost
    ? { fighter: loser, side: loserSide, state: 'lose' as const, quote: loser.voiceLines.lose, glow: '#5a6373', defeated: true }
    : { fighter: winner, side: winnerSide, state: 'win' as const, quote: winner.voiceLines.win, glow: accent, defeated: false }
  const foil = arcadePlayerLost
    ? { fighter: winner, side: winnerSide, state: 'win' as const, label: `${winner.shortName} WINS`, litVictor: true }
    : { fighter: loser, side: loserSide, state: 'lose' as const, label: loser.shortName, litVictor: false }

  function handleContinue() {
    Sfx.menuSelect()
    if (arcadePlayerWon) {
      if (isFinalBoss) { setPhase('arcade-victory'); return }
      useGame.setState((s) => ({ arcadeStep: s.arcadeStep + 1 }))
      nextArcadeFight()
    } else {
      resetMatch()
    }
  }

  const ARCADE_AUTOADVANCE_SECONDS = 6
  const [secondsLeft, setSecondsLeft] = useState(ARCADE_AUTOADVANCE_SECONDS)
  useEffect(() => {
    if (!arcadePlayerWon) return
    if (isFinalBoss) return
    setSecondsLeft(ARCADE_AUTOADVANCE_SECONDS)
    const tick = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    const advance = setTimeout(() => {
      useGame.setState((s) => ({ arcadeStep: s.arcadeStep + 1 }))
      nextArcadeFight()
    }, ARCADE_AUTOADVANCE_SECONDS * 1000)
    return () => { clearInterval(tick); clearTimeout(advance) }
  }, [arcadePlayerWon, isFinalBoss, nextArcadeFight])

  const titleColor = arcadePlayerLost ? '#9DB8DE' : '#FFD60A'

  return (
    <div className="cer-anim relative w-full h-full flex flex-col items-center justify-center overflow-hidden px-6 py-4" style={{ background: '#05030b' }}>
      {/* Real stage backdrop — state-graded: warm gold for a win, cold steel
          for a loss, so the two results read as opposite moods at a glance. */}
      <StageBackdrop
        scenario={scenario}
        tint={arcadePlayerLost ? '#2E5C8A' : '#F7A400'}
        dim={arcadePlayerLost ? 0.24 : 0.36}
      />
      {!arcadePlayerLost && <div className="cer-rays" style={{ opacity: 0.16 }} />}
      <div className="cer-grain" />
      <ImpactFlash duration={0.22} />

      {/* RESULT WORD — enormous, crashes down from the top. */}
      <div className="relative z-10" style={{ animation: 'cer-shake-hard 0.3s ease-out both' }}>
        <PowerWord
          size={arcadePlayerLost ? 'clamp(78px, 13.5vw, 200px)' : 'clamp(86px, 15vw, 224px)'}
          color={arcadePlayerLost ? '#DCE4F2' : '#FFFFFF'}
          gradient={arcadePlayerLost ? CER_GRAD.steel : CER_GRAD.gold}
          echo={arcadePlayerLost ? '#0A1A33' : '#B3122F'}
          echoOffset="0.08em"
          glow={arcadePlayerLost ? '#2E5C8A' : '#F77F00'}
          glow2={arcadePlayerLost ? '#12335c' : '#E63946'}
          skew={-8}
          entrance="ko"
          live
          idle
        >
          {arcadePlayerLost ? 'DEFEATED' : 'VICTORY'}
        </PowerWord>
      </div>
      <div
        className="cer-type relative z-10 mt-1"
        style={{ animation: 'cer-rise-fade 0.45s ease-out 0.25s both' }}
      >
        <Kicker color={titleColor} style={{ fontSize: 'clamp(14px,2vw,24px)', letterSpacing: '0.28em', fontWeight: 700 }}>
          {arcadePlayerLost ? `DEFEATED BY ${winner.name.toUpperCase()}` : `${winner.name.toUpperCase()} · WINNER`}
        </Kicker>
      </div>

      {mode === 'arcade' && arcadePlayerWon && (
        <div className="cer-type relative z-10 mt-2" style={{ animation: 'cer-rise-fade 0.45s ease-out 0.32s both' }}>
          <Kicker color="rgba(255,255,255,0.75)" style={{ fontSize: 'clamp(10px,1.2vw,14px)' }}>
            STAGE {arcadeStep + 1} / {ARCADE_PROGRESSION.length}
            {isFinalBoss && <span style={{ color: '#FFD60A' }}> · FINAL BOSS DEFEATED</span>}
          </Kicker>
        </div>
      )}

      {/* HERO ROW — the winner reads as the large, lit figure; the fallen
          fighter is small and dim. On a player loss the roles swap so the
          player's own fighter is the large defeated hero (never the enemy). */}
      <div className="relative z-10 mt-3 flex items-end justify-center gap-8 md:gap-16">
        <div
          className="flex flex-col items-center"
          style={{ animation: 'cer-loser-in 0.5s ease-out 0.2s both' }}
        >
          <div style={{
            width: 'min(21vw, 200px)', height: 'min(27vh, 210px)',
            filter: foil.litVictor
              ? `drop-shadow(0 0 20px ${accent}) brightness(1.02)`
              : 'grayscale(0.7) brightness(0.62)',
          }}>
            <Sprite fighter={foil.fighter} side={foil.side} state={foil.state} />
          </div>
          <Kicker style={{
            marginTop: 2, fontSize: 'clamp(9px,1vw,12px)',
            color: foil.litVictor ? accent : 'rgba(255,255,255,0.5)',
            letterSpacing: '0.18em', fontWeight: 700,
          }}>{foil.label}</Kicker>
          {!foil.litVictor && (
            <div className="cer-type cer-quote mt-1 max-w-[16ch] text-center leading-tight" style={{ fontStyle: 'italic', fontSize: 'clamp(12px,1.3vw,15px)', color: 'rgba(255,255,255,0.4)' }}>“{loser.voiceLines.lose}”</div>
          )}
        </div>

        <div
          className="flex flex-col items-center relative"
          style={{ animation: 'cer-hero-rise 0.6s cubic-bezier(0.15,0.9,0.3,1) 0.15s both' }}
        >
          {/* Spotlight cone behind the champion (warm on a win, cold on a loss). */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: '50%', top: '46%', width: '140%', height: '140%',
              transform: 'translate(-50%,-50%)',
              background: `radial-gradient(ellipse at center, ${hero.glow}${hero.defeated ? '33' : '55'} 0%, transparent 66%)`,
              animation: 'cer-spotlight 2.6s ease-in-out infinite',
            }}
          />
          <div
            style={{
              width: 'min(40vw, 440px)', height: 'min(52vh, 430px)', position: 'relative',
            }}
          >
            <div
              className={hero.defeated ? '' : 'cer-breathe'}
              style={{
                width: '100%', height: '100%',
                filter: hero.defeated
                  ? 'grayscale(0.85) brightness(0.66) drop-shadow(6px 12px 0 rgba(0,0,0,0.6))'
                  : `drop-shadow(0 0 36px ${accent}) drop-shadow(6px 10px 0 rgba(0,0,0,0.5))`,
                transform: hero.defeated ? 'rotate(-2deg) translateY(6px)' : undefined,
              }}
            >
              <Sprite fighter={hero.fighter} side={hero.side} state={hero.state} />
            </div>
            <WinnerFloor color={hero.defeated ? '#3a3f4d' : accent} />
          </div>
          <div className="cer-type mt-1" style={{ transform: 'skewX(-10deg)' }}>
            <span className="cer-display" style={{ display: 'inline-block', transform: 'skewX(10deg)', color: hero.defeated ? '#c8ccd6' : accent, fontSize: 'clamp(22px,3vw,38px)', letterSpacing: '0.03em', textShadow: hero.defeated ? '2px 2px 0 rgba(0,0,0,0.85)' : `2px 2px 0 rgba(0,0,0,0.85), 0 0 18px ${accent}` }}>
              {hero.fighter.shortName}
            </span>
          </div>
          <div className="cer-type cer-quote mt-1 max-w-[32ch] text-center leading-tight" style={{ fontStyle: 'italic', fontWeight: 500, fontSize: 'clamp(14px,1.6vw,19px)', color: hero.defeated ? 'rgba(255,255,255,0.6)' : '#fff', textShadow: '1px 1px 0 rgba(0,0,0,0.8)' }}>“{hero.quote}”</div>
        </div>
      </div>

      {/* MATCH STATS — one cohesive result bar (reads designed, not like three
          floating dashboard cards). */}
      <StatBar
        lost={arcadePlayerLost}
        stats={[
          { label: 'BIGGEST HIT', value: `${matchStats.biggest}`, unit: 'DMG', accent: '#FF3B57' },
          { label: 'LONGEST STREAK', value: `${matchStats.longestCombo}×`, unit: 'COMBO', accent: '#FFD60A' },
          { label: arcadePlayerLost ? 'ENEMY HP' : 'WINNER HP', value: `${winnerHpPct}`, unit: '% LEFT', accent: winnerHpPct >= 90 ? '#06D6A0' : '#FCBF49' },
        ]}
      />

      <div
        className="cer-type relative z-10 mt-3"
        style={{ animation: 'cer-rise-fade 0.45s ease-out 0.8s both' }}
      >
        <Kicker color="#FFD60A" style={{ fontSize: 'clamp(9px,1.05vw,13px)' }}>
          QUOTE BANK · {quoteBank.length} ENTRIES UNLOCKED · REAL PODCAST FRAMEWORKS
        </Kicker>
      </div>

      <div
        className="relative z-10 mt-4 flex gap-4 flex-wrap justify-center"
        style={{ animation: 'cer-rise-fade 0.45s ease-out 0.95s both' }}
      >
        {arcadePlayerWon && (
          <button
            onClick={handleContinue}
            className="cer-btn cer-type px-8 py-3"
            style={{
              background: `linear-gradient(180deg, ${accent}, ${accent}aa)`,
              color: '#0a0612',
              fontSize: 'clamp(13px,1.5vw,17px)',
              border: '2px solid #fff',
              boxShadow: `0 6px 0 rgba(0,0,0,0.5), 0 0 24px ${accent}88`,
              textShadow: '0 1px 0 rgba(255,255,255,0.4)',
            }}
          >
            {isFinalBoss ? 'CLAIM YOUR PRIZE →' : `NEXT STAGE → (${secondsLeft}s)`}
          </button>
        )}
        {!arcadePlayerWon && (
          <button
            onClick={() => { Sfx.menuSelect(); resetMatch() }}
            className="cer-btn cer-type px-8 py-3"
            style={{
              background: 'linear-gradient(180deg, #E63946, #7209B7)',
              color: '#fff',
              fontSize: 'clamp(13px,1.5vw,17px)',
              border: '2px solid rgba(255,255,255,0.9)',
              boxShadow: '0 6px 0 rgba(0,0,0,0.5), 0 0 22px rgba(230,57,70,0.6)',
            }}
          >
            REMATCH / MENU
          </button>
        )}
        <ShareButton
          winner={winner.shortName}
          loser={loser.shortName}
          quoteBank={quoteBank.length}
          biggest={matchStats.biggest}
          combo={matchStats.longestCombo}
          hpPct={winnerHpPct}
        />
      </div>
    </div>
  )
}

function StatBar({ stats, lost }: { stats: { label: string; value: string; unit: string; accent: string }[]; lost: boolean }) {
  const edge = lost ? '#2E5C8A' : '#FFB400'
  return (
    <div
      className="cer-type relative z-10 mt-5"
      style={{
        animation: 'cer-tile-pop 0.5s cubic-bezier(0.2,0.9,0.3,1) 0.5s both',
      }}
    >
      <div
        className="flex items-stretch"
        style={{
          background: 'linear-gradient(160deg, rgba(10,7,17,0.94), rgba(18,11,26,0.86))',
          borderTop: `4px solid ${edge}`,
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          clipPath: 'polygon(18px 0, 100% 0, calc(100% - 18px) 100%, 0 100%)',
          boxShadow: `0 10px 34px rgba(0,0,0,0.6), 0 0 26px ${edge}22`,
          padding: '2px',
        }}
      >
        {stats.map((s, i) => (
          <div
            key={s.label}
            className="flex flex-col justify-center px-8 py-3"
            style={{
              borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.12)' : undefined,
              minWidth: 180,
            }}
          >
            <div className="cer-cond" style={{ fontSize: 'clamp(10px,1.15vw,14px)', fontWeight: 700, letterSpacing: '0.24em', color: s.accent }}>{s.label}</div>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="cer-display" style={{ fontSize: 'clamp(38px,4.8vw,66px)', color: '#fff', lineHeight: 0.84, textShadow: `0 2px 0 rgba(0,0,0,0.6), 0 0 16px ${s.accent}55` }}>{s.value}</span>
              <span className="cer-cond" style={{ fontSize: 'clamp(11px,1.25vw,16px)', fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.6)' }}>{s.unit}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ShareButton({
  winner, loser, quoteBank, biggest, combo, hpPct,
}: {
  winner: string; loser: string; quoteBank: number
  biggest: number; combo: number; hpPct: number
}) {
  function tweet() {
    Sfx.menuSelect()
    const highlight = combo >= 3
      ? `${combo}-hit combo`
      : biggest >= 200
      ? `${biggest}-dmg finisher`
      : `${hpPct}% HP left`
    const text = `OPERATORS · ${winner} beat ${loser} (${highlight}) using real frameworks from Lenny's guests. ${quoteBank} verbatim quotes unlocked. Built for #lennysbuildathon —`
    const url = 'https://operators.replit.app'
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
    window.open(tweetUrl, '_blank', 'noopener,noreferrer')
  }
  return (
    <button
      onClick={tweet}
      className="cer-btn cer-type px-8 py-3"
      style={{
        background: 'linear-gradient(180deg, #00B4D8, #0077B6)',
        color: '#fff',
        fontSize: 'clamp(13px,1.5vw,17px)',
        border: '2px solid rgba(255,255,255,0.9)',
        boxShadow: '0 6px 0 rgba(0,0,0,0.5), 0 0 22px rgba(0,180,216,0.5)',
      }}
    >
      ↗ TWEET RESULT
    </button>
  )
}
