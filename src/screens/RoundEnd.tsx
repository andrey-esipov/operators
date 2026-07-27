import { useEffect } from 'react'
import './ceremony/devExpose'
import './ceremony/ceremony.css'
import { ShockRing, ImpactFlash, StageBackdrop, WinnerFloor } from './ceremony/CeremonyFX'
import { PowerWord, Kicker, CER_GRAD } from './ceremony/CeremonyType'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { Sfx } from '../lib/audio'
import { Sprite } from '../components/Sprite'
import type { Side } from '../types'

export function RoundEnd() {
  const fighterA = useGame((s) => s.fighterA)
  const fighterB = useGame((s) => s.fighterB)
  const newRound = useGame((s) => s.newRound)
  const roundsWon = useGame((s) => s.roundsWon)
  const log = useGame((s) => s.log)
  const scenario = useGame((s) => s.scenario)

  const lastEntry = log[log.length - 1]
  // Winner derivation. HP is the source of truth at K.O. — whichever side is
  // still standing won the round. Fall back to the log only on a double-KO / time-up.
  const winnerSide: Side | null =
    fighterA && fighterB
      ? fighterB.hp <= 0 && fighterA.hp > 0 ? 'a'
        : fighterA.hp <= 0 && fighterB.hp > 0 ? 'b'
        : (lastEntry?.attacker ?? null)
      : null
  const loserSide: Side | null = winnerSide === 'a' ? 'b' : winnerSide === 'b' ? 'a' : null
  const winner = winnerSide && fighterA && fighterB
    ? winnerSide === 'a' ? getFighter(fighterA.defId)! : getFighter(fighterB.defId)!
    : null
  const loser = loserSide && fighterA && fighterB
    ? loserSide === 'a' ? getFighter(fighterA.defId)! : getFighter(fighterB.defId)!
    : null
  const isPerfect = !!(
    winner && winnerSide && fighterA && fighterB &&
    (winnerSide === 'a' ? fighterA.hp === fighterA.maxHp : fighterB.hp === fighterB.maxHp)
  )
  // Double-KO / time-up: neither side is clearly standing.
  const isDraw = !!(fighterA && fighterB && fighterA.hp <= 0 && fighterB.hp <= 0)

  useEffect(() => {
    Sfx.ko()
    // PERFECT rounds get a slightly longer beat to celebrate. Kept punchy —
    // round transitions should feel like punctuation, not a loading screen.
    const id = setTimeout(() => newRound(), isPerfect ? 3200 : 2400)
    return () => clearTimeout(id)
  }, [isPerfect, newRound])

  if (!fighterA || !fighterB || !winner || !loser || !winnerSide || !loserSide) return null

  const accent = winner.accent || '#FFD60A'

  return (
    <div className="cer-anim relative w-full h-full flex items-center justify-center overflow-hidden" style={{ background: '#05030b' }}>
      <StageBackdrop scenario={scenario} tint={isPerfect ? '#F7A400' : '#F0431F'} dim={isPerfect ? 0.5 : 0.42} />
      <div className="cer-rays" style={{ opacity: 0.18 }} />
      <div className="cer-grain" />
      {/* Hard white impact flash — a HELD hit-freeze flash makes the ~120ms
          impact frame the visual peak (screen blend keeps the KO letters
          readable while the arena blows out), plus a fast percussive second
          flash. */}
      {!isDraw && (
        <div
          className="absolute inset-0 pointer-events-none z-30"
          style={{ background: 'white', mixBlendMode: 'screen', opacity: 0, animation: 'cer-hitfreeze 0.34s linear both' }}
        />
      )}
      <ImpactFlash duration={0.12} delay={0.18} />
      {/* Radial speed lines punching out from the KO. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'repeating-conic-gradient(from 0deg at 50% 42%, rgba(255,255,255,0.10) 0deg 1.4deg, transparent 1.4deg 5deg)',
          maskImage: 'radial-gradient(circle at 50% 42%, black 6%, transparent 46%)',
          WebkitMaskImage: 'radial-gradient(circle at 50% 42%, black 6%, transparent 46%)',
          animation: 'cer-impact-flash 0.5s ease-out both',
        }}
      />

      {/* Everything shakes hard on impact, then settles. Held ABOVE the white
          hit-freeze flash (z-40 > z-30) so on the ~120ms money frame the dark
          keylined K.O. silhouettes crisply against the blown-white arena —
          the SF6/GGST impact read — instead of washing out with it. */}
      <div
        className="relative z-40 flex flex-col items-center"
        style={{ animation: 'cer-shake-hard 0.32s ease-out both' }}
      >
        {isPerfect && (
          <div className="flex items-center gap-3 mb-1">
            <span style={{ color: '#FFD60A', fontSize: 'clamp(20px,3vw,34px)' }}>★</span>
            <PowerWord
              size="clamp(28px, 5vw, 62px)"
              color="#FFE68A"
              gradient={CER_GRAD.gold}
              glow="#FFB703"
              glow2="#F77F00"
              skew={-8}
              entrance="slam"
              live
            >
              PERFECT
            </PowerWord>
            <span style={{ color: '#FFD60A', fontSize: 'clamp(20px,3vw,34px)' }}>★</span>
          </div>
        )}

        {/* The word IS the design. Enormous, chromatic, lands in ~130ms. */}
        <div className="relative">
          {/* KO IMPACT BURST — detonates behind the word at t0: a blinding
              white-hot core plus radial shards, so the first frame reads as the
              moment a punch connects, not a static red overlay. */}
          {!isDraw && (
            <div className="absolute pointer-events-none" style={{ left: '50%', top: '50%', width: 0, height: 0, zIndex: 0 }}>
              <div
                className="absolute"
                style={{
                  left: 0, top: 0, width: 'clamp(320px,44vw,640px)', height: 'clamp(320px,44vw,640px)',
                  transform: 'translate(-50%,-50%)',
                  background: `radial-gradient(circle at center, #fff 0%, #FFE7C2 16%, ${accent}cc 34%, transparent 62%)`,
                  animation: 'cer-ko-burst 0.4s cubic-bezier(0.1,0.8,0.3,1) both',
                }}
              />
              {[0, 30, 62, 90, 122, 150].map((rot, i) => (
                <div
                  key={rot}
                  className="absolute"
                  style={{
                    left: 0, top: 0,
                    width: 'clamp(280px,52vw,760px)', height: i % 2 ? 5 : 8,
                    transformOrigin: 'center',
                    background: `linear-gradient(90deg, transparent, #fff 46%, #fff 54%, transparent)`,
                    boxShadow: `0 0 14px ${accent}`,
                    ['--rot' as string]: `${rot}deg`,
                    animation: `cer-ko-shard ${0.42 + (i % 3) * 0.05}s cubic-bezier(0.1,0.85,0.3,1) both`,
                  }}
                />
              ))}
            </div>
          )}
          {/* angular energy slashes flanking the KO */}
          <span className="absolute top-1/2 -left-[6%] pointer-events-none" style={{
            width: 'clamp(60px,10vw,150px)', height: 8, transform: 'translateY(-50%) skewX(-30deg)',
            background: `linear-gradient(90deg, transparent, ${accent})`, boxShadow: `0 0 16px ${accent}`,
            animation: 'cer-wipe-left 0.3s ease-out 0.1s both',
          }} />
          <span className="absolute top-1/2 -right-[6%] pointer-events-none" style={{
            width: 'clamp(60px,10vw,150px)', height: 8, transform: 'translateY(-50%) skewX(-30deg)',
            background: `linear-gradient(270deg, transparent, ${accent})`, boxShadow: `0 0 16px ${accent}`,
            animation: 'cer-wipe-right 0.3s ease-out 0.1s both',
          }} />
          <PowerWord
            size={isDraw ? 'clamp(64px, 13vw, 180px)' : 'clamp(110px, 21vw, 300px)'}
            color="#FFFFFF"
            gradient={isDraw ? CER_GRAD.ice : CER_GRAD.steel}
            echo={isDraw ? '#1f6f88' : '#C81020'}
            echoOffset="0.08em"
            glow="#F77F00"
            glow2="#E63946"
            skew={-8}
            entrance="ko"
            live
            idle
            style={{ position: 'relative', zIndex: 3 }}
          >
            {isDraw ? 'DRAW' : 'K.O.'}
          </PowerWord>
        </div>

        <div className="flex items-end gap-8 md:gap-16 mt-2">
          {/* Loser — slumped, desaturated, off to the side. */}
          <div
            className="flex flex-col items-center"
            style={{ animation: 'cer-loser-in 0.5s ease-out 0.15s both' }}
          >
            <div style={{ width: 'min(24vw, 235px)', height: 'min(33vh, 265px)', filter: 'grayscale(0.6) brightness(0.7)' }}>
              <Sprite fighter={loser} side={loserSide} state="lose" />
            </div>
            <Kicker style={{ marginTop: 2, fontSize: 'clamp(9px,1vw,12px)', letterSpacing: '0.28em', color: 'rgba(255,255,255,0.5)' }}>
              {loser.shortName} · DOWN
            </Kicker>
          </div>

          {/* Winner — larger, rises into a hero pose, breathes, shock rings at the feet. */}
          <div className="flex flex-col items-center relative" style={{ animation: 'cer-hero-rise 0.55s cubic-bezier(0.15,0.9,0.3,1) 0.12s both' }}>
            {/* light beam behind the winner */}
            <div className="absolute pointer-events-none" style={{
              left: '50%', bottom: '4%', width: '62%', height: '150%', transform: 'translateX(-50%)',
              background: `linear-gradient(180deg, transparent, ${accent}33 60%, ${accent}66)`,
              clipPath: 'polygon(38% 0, 62% 0, 100% 100%, 0 100%)',
              animation: 'cer-beam-breathe 2.8s ease-in-out infinite',
            }} />
            <div className="absolute" style={{ left: '50%', bottom: '14%' }}>
              <ShockRing color={accent} size={200} thickness={4} delay={0.25} duration={0.6} />
            </div>
            <div className="relative" style={{ width: 'min(42vw, 450px)', height: 'min(60vh, 520px)' }}>
              <div
                className="cer-breathe"
                style={{
                  width: '100%', height: '100%',
                  filter: `drop-shadow(0 0 32px ${accent}) drop-shadow(6px 10px 0 rgba(0,0,0,0.5))`,
                }}
              >
                <Sprite fighter={winner} side={winnerSide} state="win" />
              </div>
              <WinnerFloor color={accent} />
            </div>
          </div>
        </div>

        {/* WINS banner — angular slab. */}
        <div
          className="cer-type mt-1"
          style={{ animation: 'cer-rise-fade 0.45s ease-out 0.35s both' }}
        >
          <div
            className="cer-cond inline-block px-6 py-1"
            style={{
              transform: 'skewX(-10deg)',
              background: `linear-gradient(150deg, rgba(8,4,14,0.9), ${accent}cc)`,
              border: '2px solid rgba(255,255,255,0.85)',
              boxShadow: `5px 5px 0 rgba(0,0,0,0.5), 0 0 22px ${accent}88`,
            }}
          >
            <span
              className="cer-display"
              style={{
                display: 'inline-block', transform: 'skewX(10deg)', color: '#fff',
                fontSize: 'clamp(20px, 3vw, 40px)', letterSpacing: '0.04em',
                textShadow: `2px 2px 0 rgba(0,0,0,0.8), 0 0 16px ${accent}`,
              }}
            >
              {winner.shortName} WINS THE ROUND
            </span>
          </div>
        </div>

        {/* Round tally — diamonds. */}
        <div className="flex gap-4 mt-3" style={{ animation: 'cer-rise-fade 0.45s ease-out 0.45s both' }}>
          <RoundDot won={roundsWon.a > 0} color={fighterA ? (getFighter(fighterA.defId)?.accent ?? '#E63946') : '#E63946'} />
          <RoundDot won={roundsWon.b > 0} color={fighterB ? (getFighter(fighterB.defId)?.accent ?? '#00B4D8') : '#00B4D8'} />
        </div>

        {lastEntry?.quote && (
          <div
            className="cer-type cer-quote mt-3 max-w-2xl text-center px-6"
            style={{
              fontStyle: 'italic', fontWeight: 500, fontSize: 'clamp(16px,2vw,24px)',
              color: 'rgba(255,255,255,0.82)', letterSpacing: '0.01em', lineHeight: 1.15,
              animation: 'cer-rise-fade 0.45s ease-out 0.55s both',
              textShadow: '1px 1px 0 rgba(0,0,0,0.8)',
            }}
          >
            “{lastEntry.quote}”
            <span style={{ color: accent, fontStyle: 'normal', fontWeight: 600 }}> — {lastEntry.episode}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function RoundDot({ won, color }: { won: boolean; color: string }) {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        transform: 'rotate(45deg)',
        background: won ? color : 'rgba(255,255,255,0.08)',
        border: '2px solid rgba(255,255,255,0.85)',
        boxShadow: won ? `0 0 16px ${color}` : 'none',
      }}
    />
  )
}
