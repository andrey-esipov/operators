import { useEffect, useMemo, useState } from 'react'
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
  // We only have the final round's log (newRound clears between rounds),
  // but that's still the most exciting fragment to surface as a "highlight."
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
  // Winner derivation — primary source is roundsWon (must be >= 2 for
  // either side to have legitimately reached match-end). If neither side
  // shows >= 2 (shouldn't happen, but be defensive against any future
  // state-mutation bug), fall back to the last log entry's attacker so
  // the screen at least matches the K.O.-landing fighter. The default of
  // 'a' (player) on a total tie is safer than the old default of 'b'.
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

  function handleContinue() {
    Sfx.menuSelect()
    if (arcadePlayerWon) {
      if (isFinalBoss) {
        setPhase('arcade-victory')
        return
      }
      // Advance arcade step then trigger next fight
      useGame.setState((s) => ({ arcadeStep: s.arcadeStep + 1 }))
      nextArcadeFight()
    } else {
      resetMatch()
    }
  }

  // Arcade-mode auto-advance. Players were getting stuck on the Victory
  // screen — either missing the NEXT STAGE button or assuming the game
  // would proceed on its own. We give a visible 6-second countdown that
  // clicking the button can override (handleContinue is idempotent enough
  // since it both increments step and triggers nextArcadeFight). Cancels
  // if the player navigates away or the phase changes.
  const ARCADE_AUTOADVANCE_SECONDS = 6
  const [secondsLeft, setSecondsLeft] = useState(ARCADE_AUTOADVANCE_SECONDS)
  useEffect(() => {
    if (!arcadePlayerWon) return
    if (isFinalBoss) return  // Final boss → user clicks "CLAIM YOUR PRIZE"
    setSecondsLeft(ARCADE_AUTOADVANCE_SECONDS)
    const tick = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1))
    }, 1000)
    const advance = setTimeout(() => {
      // Same flow as the manual NEXT STAGE click.
      useGame.setState((s) => ({ arcadeStep: s.arcadeStep + 1 }))
      nextArcadeFight()
    }, ARCADE_AUTOADVANCE_SECONDS * 1000)
    return () => {
      clearInterval(tick)
      clearTimeout(advance)
    }
  }, [arcadePlayerWon, isFinalBoss, nextArcadeFight])

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden p-6">
      <div
        className="absolute inset-0"
        style={{
          background:
            winnerSide === 'a'
              ? 'radial-gradient(circle at center, #E6394644 0%, #1A0F2E 60%, #0F0A1A 100%)'
              : 'radial-gradient(circle at center, #00B4D844 0%, #0F1A2E 60%, #0F0A1A 100%)',
        }}
      />

      <div className="relative z-10 font-display tracking-widest text-center" style={{
        color: '#FFD60A',
        textShadow: '6px 6px 0 black, 0 0 24px #F77F00',
        fontSize: arcadePlayerLost ? 84 : 96,
      }}>
        {arcadePlayerLost ? 'DEFEATED' : 'VICTORY'}
      </div>
      <div className="relative z-10 font-display text-2xl tracking-widest mt-2" style={{ color: winner.accent }}>
        {winner.name.toUpperCase()} WINS
      </div>

      {mode === 'arcade' && arcadePlayerWon && (
        <div className="relative z-10 font-display text-base tracking-widest mt-3 text-white/80">
          STAGE {arcadeStep + 1} / {ARCADE_PROGRESSION.length}
          {isFinalBoss && <span style={{ color: '#FFD60A' }}> · FINAL BOSS DEFEATED</span>}
        </div>
      )}

      <div className="relative z-10 mt-8 flex items-end gap-12">
        <div className="flex flex-col items-center opacity-50">
          <div style={{ width: 160, height: 230 }}>
            <Sprite fighter={loser} side={winnerSide === 'a' ? 'b' : 'a'} state="lose" />
          </div>
          <div className="font-display text-base tracking-widest mt-2 text-white/60">{loser.shortName}</div>
          <div className="font-body text-base italic text-white/40 mt-1 max-w-xs text-center px-2">"{loser.voiceLines.lose}"</div>
        </div>

        <div className="flex flex-col items-center">
          <div style={{ width: 220, height: 300 }}>
            <Sprite fighter={winner} side={winnerSide} state="win" />
          </div>
          <div className="font-display text-lg tracking-widest mt-3" style={{ color: winner.accent }}>{winner.shortName}</div>
          <div className="font-body text-xl italic text-white mt-1 max-w-md text-center px-2">"{winner.voiceLines.win}"</div>
        </div>
      </div>

      {/* MATCH STATS — biggest hit, longest combo, final HP %.
          This is the highlight reel that turns into a tweet. */}
      <div className="relative z-10 mt-5 grid grid-cols-3 gap-3 max-w-2xl">
        <StatTile label="BIGGEST HIT" value={`${matchStats.biggest} DMG`} accent="#E63946" />
        <StatTile label="LONGEST STREAK" value={`${matchStats.longestCombo}× COMBO`} accent="#FFD60A" />
        <StatTile label="WINNER HP" value={`${winnerHpPct}%`} accent={winnerHpPct >= 90 ? '#06D6A0' : '#FCBF49'} />
      </div>

      <div className="relative z-10 mt-4 px-6 py-3 max-w-xl text-center" style={{
        background: 'rgba(15,10,26,0.7)',
        border: '2px solid #FFD60A',
      }}>
        <div className="font-display text-[10px] tracking-widest" style={{ color: '#FFD60A' }}>
          QUOTE BANK · {quoteBank.length} ENTRIES UNLOCKED
        </div>
        <div className="font-body text-base text-white/70 mt-1">
          Every move you played added a real podcast quote to your library.
        </div>
      </div>

      <div className="relative z-10 mt-8 flex gap-3 flex-wrap justify-center">
        {arcadePlayerWon && (
          <button
            onClick={handleContinue}
            className="px-6 py-3 font-display text-base tracking-widest"
            style={{
              background: 'linear-gradient(180deg, #FFD60A44, #F7798044)',
              color: 'white',
              border: '2px solid #FFD60A',
              boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2), 0 0 16px rgba(255,214,10,0.45)',
              cursor: 'pointer',
              animation: !isFinalBoss ? 'flash 1.2s ease-in-out infinite' : undefined,
            }}
          >
            {isFinalBoss
              ? 'CLAIM YOUR PRIZE →'
              : `NEXT STAGE → (auto in ${secondsLeft}s)`}
          </button>
        )}
        {!arcadePlayerWon && (
          <button
            onClick={() => {
              Sfx.menuSelect()
              resetMatch()
            }}
            className="px-6 py-3 font-display text-base tracking-widest"
            style={{
              background: 'linear-gradient(180deg, #F77F0044, #E6394644)',
              color: 'white',
              border: '2px solid #E63946',
              boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2)',
              cursor: 'pointer',
            }}
          >
            MAIN MENU
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

function StatTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      className="p-3 text-center"
      style={{
        background: 'rgba(15,10,26,0.7)',
        border: `2px solid ${accent}`,
        boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5)',
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
    // Lead with the highlight — the biggest hit or longest combo is more
    // compelling than just "X beat Y." Include the HP% so screenshots
    // make sense at a glance.
    const highlight = combo >= 3
      ? `${combo}-hit combo`
      : biggest >= 200
      ? `${biggest}-dmg finisher`
      : `${hpPct}% HP left`
    // Lead the hook: every move is a real framework from a real podcast
    // guest. The numbers are the proof; the framework angle is the share-worthy reason.
    const text = `OPERATORS · ${winner} beat ${loser} (${highlight}) using real frameworks from Lenny's guests. ${quoteBank} verbatim quotes unlocked. Built for #lennysbuildathon —`
    const url = 'https://operators.replit.app'
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
    window.open(tweetUrl, '_blank', 'noopener,noreferrer')
  }
  return (
    <button
      onClick={tweet}
      className="px-6 py-3 font-display text-base tracking-widest"
      style={{
        background: 'linear-gradient(180deg, #00B4D844, #0077B644)',
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
