import { useEffect, useMemo, useState } from 'react'
import './ceremony/devExpose'
import './ceremony/ceremony.css'
import { ImpactFlash } from './ceremony/CeremonyFX'
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

  return (
    <div className="cer-anim relative w-full h-full flex flex-col items-center justify-center overflow-hidden px-6 py-4">
      {/* Background keyed to the winner's colour. */}
      <div
        className="absolute inset-0"
        style={{
          background: arcadePlayerLost
            ? 'radial-gradient(circle at 50% 40%, #55111d 0%, #1A0F0F 60%, #0F0A0A 100%)'
            : winnerSide === 'a'
              ? `radial-gradient(circle at 50% 40%, ${accent}55 0%, #1A0F2E 58%, #0F0A1A 100%)`
              : `radial-gradient(circle at 50% 40%, ${accent}55 0%, #0F1A2E 58%, #0F0A1A 100%)`,
        }}
      />
      {!arcadePlayerLost && <div className="cer-rays" style={{ opacity: 0.45 }} />}
      <ImpactFlash duration={0.25} />

      {/* TITLE — crashes down from the top. */}
      <div
        className="relative z-10 font-display tracking-widest text-center"
        style={{
          color: arcadePlayerLost ? '#E63946' : '#FFD60A',
          textShadow: '6px 6px 0 black, 0 0 26px #F77F00',
          fontSize: arcadePlayerLost ? 'clamp(46px, 7vw, 84px)' : 'clamp(50px, 7.5vw, 92px)',
          animation: 'cer-title-crash 0.5s cubic-bezier(0.15,0.9,0.3,1) both',
        }}
      >
        {arcadePlayerLost ? 'DEFEATED' : 'VICTORY'}
      </div>
      <div
        className="relative z-10 font-display tracking-widest mt-1"
        style={{
          color: accent, fontSize: 'clamp(16px, 2.2vw, 28px)',
          textShadow: '3px 3px 0 black',
          animation: 'cer-rise-fade 0.5s ease-out 0.25s both',
        }}
      >
        {winner.name.toUpperCase()} WINS
      </div>

      {mode === 'arcade' && arcadePlayerWon && (
        <div className="relative z-10 font-display text-sm tracking-widest mt-2 text-white/80">
          STAGE {arcadeStep + 1} / {ARCADE_PROGRESSION.length}
          {isFinalBoss && <span style={{ color: '#FFD60A' }}> · FINAL BOSS DEFEATED</span>}
        </div>
      )}

      {/* HERO ROW — winner large and lit, loser small and dim. */}
      <div className="relative z-10 mt-2 flex items-end justify-center gap-6 md:gap-12">
        <div
          className="flex flex-col items-center"
          style={{ animation: 'cer-loser-in 0.5s ease-out 0.2s both' }}
        >
          <div style={{ width: 'min(15vw, 140px)', height: 'min(18vh, 140px)' }}>
            <Sprite fighter={loser} side={winnerSide === 'a' ? 'b' : 'a'} state="lose" />
          </div>
          <div className="font-display text-xs tracking-widest mt-1 text-white/55">{loser.shortName}</div>
          <div className="font-body text-sm italic text-white/40 mt-1 max-w-[14ch] text-center leading-tight">"{loser.voiceLines.lose}"</div>
        </div>

        <div
          className="flex flex-col items-center relative"
          style={{ animation: 'cer-hero-rise 0.6s cubic-bezier(0.15,0.9,0.3,1) 0.15s both' }}
        >
          {/* Spotlight cone behind the champion. */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: '50%', top: '46%', width: '130%', height: '130%',
              transform: 'translate(-50%,-50%)',
              background: `radial-gradient(ellipse at center, ${accent}55 0%, transparent 68%)`,
              animation: 'cer-spotlight 2.6s ease-in-out infinite',
            }}
          />
          <div
            style={{
              width: 'min(30vw, 300px)', height: 'min(38vh, 300px)', position: 'relative',
              filter: `drop-shadow(0 0 34px ${accent})`,
            }}
          >
            <Sprite fighter={winner} side={winnerSide} state="win" />
          </div>
          <div
            className="font-display tracking-widest mt-1"
            style={{ color: accent, fontSize: 'clamp(18px, 2.6vw, 30px)', textShadow: '3px 3px 0 black' }}
          >
            {winner.shortName}
          </div>
          <div className="font-body text-base italic text-white mt-1 max-w-[30ch] text-center leading-tight">"{winner.voiceLines.win}"</div>
        </div>
      </div>

      {/* MATCH STATS — pop up in sequence. */}
      <div className="relative z-10 mt-3 grid grid-cols-3 gap-3 max-w-2xl">
        <StatTile label="BIGGEST HIT" value={`${matchStats.biggest} DMG`} accent="#E63946" delay={0.5} />
        <StatTile label="LONGEST STREAK" value={`${matchStats.longestCombo}× COMBO`} accent="#FFD60A" delay={0.6} />
        <StatTile label="WINNER HP" value={`${winnerHpPct}%`} accent={winnerHpPct >= 90 ? '#06D6A0' : '#FCBF49'} delay={0.7} />
      </div>

      <div
        className="relative z-10 mt-2 font-display text-[10px] tracking-widest"
        style={{ color: '#FFD60A', animation: 'cer-rise-fade 0.5s ease-out 0.8s both' }}
      >
        QUOTE BANK · {quoteBank.length} ENTRIES UNLOCKED · REAL PODCAST FRAMEWORKS
      </div>

      <div
        className="relative z-10 mt-3 flex gap-3 flex-wrap justify-center"
        style={{ animation: 'cer-rise-fade 0.5s ease-out 0.95s both' }}
      >
        {arcadePlayerWon && (
          <button
            onClick={handleContinue}
            className="px-7 py-3 font-display text-base tracking-widest"
            style={{
              background: 'linear-gradient(180deg, #FFD60A66, #F7798066)',
              color: 'white',
              border: '2px solid #FFD60A',
              boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2), 0 0 20px rgba(255,214,10,0.5)',
              cursor: 'pointer',
              animation: !isFinalBoss ? 'flash 1.2s ease-in-out infinite' : undefined,
            }}
          >
            {isFinalBoss ? 'CLAIM YOUR PRIZE →' : `NEXT STAGE → (auto in ${secondsLeft}s)`}
          </button>
        )}
        {!arcadePlayerWon && (
          <button
            onClick={() => { Sfx.menuSelect(); resetMatch() }}
            className="px-7 py-3 font-display text-base tracking-widest"
            style={{
              background: 'linear-gradient(180deg, #F77F0055, #E6394655)',
              color: 'white',
              border: '2px solid #E63946',
              boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2)',
              cursor: 'pointer',
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

function StatTile({ label, value, accent, delay }: { label: string; value: string; accent: string; delay: number }) {
  return (
    <div
      className="p-3 text-center"
      style={{
        background: 'rgba(15,10,26,0.72)',
        border: `2px solid ${accent}`,
        boxShadow: `inset -2px -2px 0 rgba(0,0,0,0.5), 0 0 14px ${accent}44`,
        animation: `cer-tile-pop 0.45s cubic-bezier(0.2,0.9,0.3,1) ${delay}s both`,
      }}
    >
      <div className="font-display text-[8px] tracking-widest" style={{ color: accent }}>{label}</div>
      <div className="font-num text-2xl tabular-nums text-white mt-1">{value}</div>
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
      className="px-7 py-3 font-display text-base tracking-widest"
      style={{
        background: 'linear-gradient(180deg, #00B4D855, #0077B655)',
        color: 'white',
        border: '2px solid #00B4D8',
        boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2)',
        cursor: 'pointer',
      }}
    >
      ↗ TWEET RESULT
    </button>
  )
}
