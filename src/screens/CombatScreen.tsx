import { useEffect, useState, useMemo } from 'react'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { pickQuoteForMove } from '../lib/quotePool'
import type { Move } from '../types'
import { Sprite } from '../components/Sprite'
import { HpBar } from '../components/HpBar'
import { SuperMeter } from '../components/SuperMeter'
import { MomentumBar } from '../components/MomentumBar'
import { MoveCard } from '../components/MoveCard'
import { StageBackground } from '../components/StageBackground'
import { ComboBanner } from '../components/ComboBanner'
import { DamageFloats } from '../components/DamageFloat'
import { StatusChip } from '../components/StatusChip'
import { KOCinematic } from '../components/KOCinematic'
import { FightIntro } from '../components/FightIntro'
import { StatusHalo } from '../components/StatusHalo'
import { HitSparks } from '../components/HitSparks'
import { youtubeDeepLink } from '../lib/youtube'
import { Sfx } from '../lib/audio'
import { AnimatePresence, motion } from 'framer-motion'

export function CombatScreen() {
  const mode = useGame((s) => s.mode)
  const fighterA = useGame((s) => s.fighterA)
  const fighterB = useGame((s) => s.fighterB)
  const scenario = useGame((s) => s.scenario)
  const round = useGame((s) => s.round)
  const roundsWon = useGame((s) => s.roundsWon)
  const activeSide = useGame((s) => s.activeSide)
  const log = useGame((s) => s.log)
  const lastFlash = useGame((s) => s.lastFlash)
  const koCinematic = useGame((s) => s.koCinematic)
  const soundCue = useGame((s) => s.soundCue)
  const damagePulses = useGame((s) => s.damagePulses)
  const castMove = useGame((s) => s.castMove)
  const aiPlay = useGame((s) => s.aiPlay)

  const [timeLeft, setTimeLeft] = useState(90)
  const [comboBanner, setComboBanner] = useState<{ title: string; kind: 'combo' | 'ult' | 'crit' } | null>(null)
  const [hitFlash, setHitFlash] = useState<'crit' | 'combo' | 'ult' | null>(null)
  const [shaking, setShaking] = useState(false)
  // Hit-lag: brief desaturate/scale on the side that just took damage. Re-keys on every damagePulse.
  const [hitLag, setHitLag] = useState<{ side: 'a' | 'b'; id: number } | null>(null)
  // Crit slow-mo: brief world-freeze + sepia/contrast filter on critical hits.
  const [critFreeze, setCritFreeze] = useState(false)
  // Live combo counter: number of successive damaging moves by the same side. Resets on side change or KO.
  const [comboStreak, setComboStreak] = useState<{ side: 'a' | 'b'; count: number; id: number } | null>(null)
  // Hit-spark burst trigger — bumped per damaging hit so <HitSparks/> re-fires
  const [hitSpark, setHitSpark] = useState<{ id: number; side: 'a' | 'b'; kind: 'light' | 'heavy' | 'crit' | 'combo' | 'ult' } | null>(null)
  const [lastQuote, setLastQuote] = useState<{ q: string; ep: string; t: string; name: string; fighterId: string } | null>(null)
  /** Which side is currently in attack-pose (briefly after casting) */
  const [attackingSide, setAttackingSide] = useState<'a' | 'b' | null>(null)
  const resetMatch = useGame((s) => s.resetMatch)

  // ESC quits to menu. ZXCVB casts moves 1-4 + ult (alt: 12345). R fires
  // a READ. Keys are only honored on the human player's turn during the
  // fight phase — the VS mode hot-seat is hands-off whenever the bot is
  // thinking, so this maps cleanly to "your turn" without extra gating.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { resetMatch(); return }
      // Ignore typed input in an input/textarea (search bars elsewhere)
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return

      const s = useGame.getState()
      if (s.phase !== 'fight') return
      // Active-side gating: in single-player (arcade/practice/daily) only
      // player A is human; in vs both sides are human and bind in turn.
      const humanIsActive = s.mode === 'vs' || s.activeSide === 'a'
      if (!humanIsActive) return

      const activeRt = s.activeSide === 'a' ? s.fighterA : s.fighterB
      if (!activeRt) return
      const def = getFighter(activeRt.defId)
      if (!def) return

      // Z X C V → moves[0..3]; B → ult; R → read; 1..5 mirrors ZXCVB.
      const key = e.key.toLowerCase()
      const idxFromLetter: Record<string, number> = { z: 0, x: 1, c: 2, v: 3, b: 4 }
      const idxFromNum: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4 }
      const idx = idxFromLetter[key] ?? idxFromNum[key]
      if (idx !== undefined) {
        e.preventDefault()
        const m = idx < 4 ? def.moves[idx] : def.ult
        if (!m) return
        // Standard affordability gate — castMove itself also rejects but
        // checking here avoids the click sfx for an obviously-invalid cast.
        const canAfford = activeRt.momentum >= m.momentum
        const cd = (activeRt.cooldowns[m.id] ?? 0) > 0
        if (!canAfford || cd) return
        if (m.type === 'ultimate' && activeRt.superMeter < 100) return
        if (m.requiresSelfStatus && !activeRt.status.some((x) => x.key === m.requiresSelfStatus)) return
        castMove(m)
        return
      }
      if (key === 'r' && !activeRt.read && activeRt.momentum >= 1) {
        // Open the READ picker with a quick-pick to 'heavy' as default.
        // We don't have a multi-key cascade for picking subtype, so the
        // keyboard shortcut just predicts the most common type (heavy).
        // Mouse-users still get the full picker via the on-screen button.
        e.preventDefault()
        useGame.getState().castRead('heavy')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [resetMatch, castMove])

  // Audio cues
  useEffect(() => {
    if (!soundCue) return
    switch (soundCue.kind) {
      case 'crit': Sfx.crit(); break
      case 'combo': Sfx.combo(); break
      case 'ult': Sfx.ult(); break
      case 'heavy': Sfx.heavy(); break
      default: Sfx.light()
    }
  }, [soundCue?.id])

  // Combat log effects: combo banner + hit flash + screen shake + quote callout
  useEffect(() => {
    if (log.length === 0) return
    const last = log[log.length - 1]
    if (last.comboTitle) {
      setComboBanner({ title: last.comboTitle, kind: last.flash ?? 'combo' })
      setTimeout(() => setComboBanner(null), 2400)
    }
    if (last.flash) {
      setHitFlash(last.flash)
      setTimeout(() => setHitFlash(null), 200)
    }
    // Crit slow-mo — freeze the world for 240ms before resuming
    if (last.flash === 'crit') {
      setCritFreeze(true)
      setTimeout(() => setCritFreeze(false), 240)
    }
    // Combo streak — increment if same attacker dealt damage again, else reset
    if (last.finalDamage > 0) {
      setComboStreak((prev) => {
        const id = log.length
        if (prev && prev.side === last.attacker) {
          return { side: last.attacker, count: prev.count + 1, id }
        }
        return { side: last.attacker, count: 1, id }
      })
    } else {
      setComboStreak(null)
    }
    if (last.finalDamage > 50) {
      setShaking(true)
      setTimeout(() => setShaking(false), 220)
    }
    if (last.quote) {
      const att = last.attacker === 'a' ? fighterA : fighterB
      const def = att ? getFighter(att.defId) : null
      // Rotate quotes per cast — 40% chance pull from fighter's verbatim quote pool
      const fighterIdForQuote = att?.defId
      const moveForQuote = def ? [...def.moves, def.ult].find((m) => m.id === last.moveId) : null
      const rotated = fighterIdForQuote && moveForQuote
        ? pickQuoteForMove(fighterIdForQuote, moveForQuote)
        : { quote: last.quote, episode: last.episode, timestamp: last.timestamp }
      setLastQuote({
        q: rotated.quote,
        ep: rotated.episode || last.episode,
        t: rotated.timestamp || last.timestamp,
        name: def?.shortName ?? '',
        fighterId: fighterIdForQuote ?? '',
      })
      // Read time — a touch longer than the previous 4.5-6.5s window so
      // longer verbatim quotes are readable, but still expire so the
      // game doesn't feel sluggish.
      const readTime = Math.min(9000, Math.max(6000, rotated.quote.length * 70))
      setTimeout(() => setLastQuote(null), readTime)
    }
    // Attack sprite pose: briefly switch the attacker to attack frame.
    // 800ms is long enough for the pose swap + lunge to register visually
    // without dragging out the turn rhythm.
    setAttackingSide(last.attacker)
    setTimeout(() => setAttackingSide(null), 800)

    // Hit-lag: the defender briefly desaturates + scales. Stronger hits
    // trigger a slightly longer flash. Re-keys per turn so CSS animation restarts.
    const defenderSide: 'a' | 'b' = last.attacker === 'a' ? 'b' : 'a'
    if (last.finalDamage > 0) {
      setHitLag({ side: defenderSide, id: log.length })
      setTimeout(() => setHitLag(null), 220)

      // Hit sparks at the defender's body
      const sparkKind: 'light' | 'heavy' | 'crit' | 'combo' | 'ult' =
        last.flash === 'ult' ? 'ult' :
        last.flash === 'combo' ? 'combo' :
        last.flash === 'crit' ? 'crit' :
        last.finalDamage > 70 ? 'heavy' : 'light'
      setHitSpark({ id: log.length, side: last.attacker, kind: sparkKind })
    }
  }, [log.length])

  // Round timer
  useEffect(() => {
    setTimeLeft(90)
    const id = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000)
    return () => clearInterval(id)
  }, [round])

  // Timer expiry → higher-HP side wins the round
  useEffect(() => {
    if (timeLeft !== 0) return
    if (!fighterA || !fighterB) return
    // Trigger the same end-of-round path that K.O. uses
    const winner: 'a' | 'b' = fighterA.hp >= fighterB.hp ? 'a' : 'b'
    useGame.setState((s) => ({
      phase: s.roundsWon.a + (winner === 'a' ? 1 : 0) >= 2 || s.roundsWon.b + (winner === 'b' ? 1 : 0) >= 2 ? 'match-end' : 'round-end',
      roundsWon: {
        a: s.roundsWon.a + (winner === 'a' ? 1 : 0),
        b: s.roundsWon.b + (winner === 'b' ? 1 : 0),
      },
      // Synthesize a "time-up" log entry so RoundEnd shows something useful
      log: [...s.log, {
        turn: s.turn,
        attacker: winner,
        moveId: 'time-up',
        moveName: 'TIME UP',
        baseDamage: 0,
        scenarioMultiplier: 1,
        comboBonus: 0,
        critMultiplier: 1,
        finalDamage: 0,
        hpAfter: { a: fighterA.hp, b: fighterB.hp },
        quote: 'Time wins arguments.',
        episode: 'host',
        timestamp: 'TIME',
        appliedStatuses: [],
      }],
    }))
  }, [timeLeft, fighterA, fighterB])

  // Bot AI for player B in single-player modes (arcade / practice / daily)
  useEffect(() => {
    if (mode === 'vs') return
    if (activeSide !== 'b') return
    const id = setTimeout(() => aiPlay('b'), 1200 + Math.random() * 600)
    return () => clearTimeout(id)
  }, [activeSide, mode, aiPlay])

  if (!fighterA || !fighterB) return null
  const a = getFighter(fighterA.defId)!
  const b = getFighter(fighterB.defId)!

  const aSuperReady = fighterA.superMeter >= 100
  const bSuperReady = fighterB.superMeter >= 100

  // Flash kind of the move currently animating. `lastFlash` in the store is
  // sticky — game.ts only overwrites it when the new move ALSO carries a
  // flash (crit/combo/ult). For light/heavy hits between flashy moves the
  // value persists, which caused the ult win-pose to stay locked on for
  // both fighters after any ultimate was cast. Reading the flash from the
  // log entry that matches the currently-attacking side instead means the
  // pose + colored drop-shadow only apply to the move that actually had
  // the flash.
  const lastLogEntry = log[log.length - 1]
  const inFlightFlash: 'ult' | 'combo' | 'crit' | undefined =
    attackingSide && lastLogEntry?.attacker === attackingSide ? lastLogEntry.flash : undefined

  return (
    <div
      className={`relative w-full h-full overflow-hidden ${shaking ? 'shake' : ''}`}
      style={{
        filter: critFreeze ? 'saturate(1.6) contrast(1.4) hue-rotate(-12deg)' : 'none',
        transition: critFreeze ? 'none' : 'filter 180ms ease-out',
      }}
    >
      {/* Stage background */}
      <StageBackground scenario={scenario} shake={shaking} />

      {/* Hit flash overlay */}
      <AnimatePresence>
        {hitFlash && (
          <motion.div
            key={lastFlash?.id ?? 'flash'}
            initial={{ opacity: 0.85 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute inset-0 z-30 pointer-events-none"
            style={{
              background:
                hitFlash === 'ult'
                  ? '#F72585'
                  : hitFlash === 'crit'
                  ? '#FFFFFF'
                  : '#FFD60A',
            }}
          />
        )}
      </AnimatePresence>

      {/* TOP HUD */}
      <div className="absolute left-0 right-0 top-0 z-20 px-6 pt-3 flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <HpBar hp={fighterA.hp} maxHp={fighterA.maxHp} side="a" name={a.shortName} />
          <div className="flex items-center gap-4 mt-1">
            <SuperMeter value={fighterA.superMeter} side="a" />
            <MomentumBar value={fighterA.momentum} side="a" />
          </div>
          <div className="flex gap-1 mt-1">
            {fighterA.status.map((s) => <StatusChip key={s.key} status={s} />)}
          </div>
        </div>

        <div className="flex flex-col items-center pt-2">
          <div className="font-display text-[10px] tracking-widest text-white/70">
            ROUND {round}/3
          </div>
          {/* Best-of-3 dot grid: 2 dots per side; filled = round won. */}
          <div className="flex gap-3 mt-1">
            <div className="flex gap-1.5">
              {[0, 1].map((i) => (
                <span
                  key={`a-${i}`}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: roundsWon.a > i ? '#E63946' : 'transparent',
                    border: `2px solid ${roundsWon.a > i ? '#E63946' : 'rgba(230,57,70,0.4)'}`,
                    boxShadow: roundsWon.a > i ? '0 0 8px #E63946' : 'none',
                    transition: 'all 0.3s',
                  }}
                />
              ))}
            </div>
            <div className="flex gap-1.5">
              {[0, 1].map((i) => (
                <span
                  key={`b-${i}`}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: roundsWon.b > i ? '#00B4D8' : 'transparent',
                    border: `2px solid ${roundsWon.b > i ? '#00B4D8' : 'rgba(0,180,216,0.4)'}`,
                    boxShadow: roundsWon.b > i ? '0 0 8px #00B4D8' : 'none',
                    transition: 'all 0.3s',
                  }}
                />
              ))}
            </div>
          </div>
          <div
            className="font-num text-5xl tabular-nums mt-2"
            style={{
              color: timeLeft < 15 ? '#EF233C' : '#FFD60A',
              textShadow: '3px 3px 0 black',
              animation: timeLeft < 10 && timeLeft > 0 ? 'hpCritPulse 0.9s ease-in-out infinite' : undefined,
            }}
          >
            {timeLeft}
          </div>
        </div>

        <div className="flex flex-col gap-1 items-end">
          <HpBar hp={fighterB.hp} maxHp={fighterB.maxHp} side="b" name={b.shortName} />
          <div className="flex items-center gap-4 mt-1 flex-row-reverse">
            <SuperMeter value={fighterB.superMeter} side="b" />
            <MomentumBar value={fighterB.momentum} side="b" />
          </div>
          <div className="flex gap-1 mt-1 flex-row-reverse">
            {fighterB.status.map((s) => <StatusChip key={s.key} status={s} />)}
          </div>
        </div>
      </div>

      {/* Quit button (top-right) */}
      <button
        onClick={() => {
          Sfx.menuMove()
          resetMatch()
        }}
        className="absolute top-2 right-2 z-30 px-2 py-1 font-display text-[7px] tracking-widest text-white/60 hover:text-white"
        title="ESC to quit"
        style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)' }}
      >
        QUIT [ESC]
      </button>

      {/* FIGHTERS */}
      <div className="absolute left-0 right-0 z-10" style={{ bottom: 200 }}>
        <div className="flex items-end justify-between px-12 md:px-20">
          <div
            key={`a-${hitLag?.side === 'a' ? hitLag.id : 'idle'}`}
            className={hitLag?.side === 'a' ? 'hit-lag-a' : ''}
            style={{
              width: 340, height: 440,
              filter:
                // Casting attacker: strong colored backlight by move kind
                attackingSide === 'a' && inFlightFlash === 'ult'
                  ? 'drop-shadow(0 0 32px #F72585) drop-shadow(0 0 64px #7209B7)'
                  : attackingSide === 'a' && inFlightFlash === 'combo'
                  ? 'drop-shadow(0 0 28px #FFD60A) drop-shadow(0 0 56px #F77F00)'
                  : attackingSide === 'a' && inFlightFlash === 'crit'
                  ? 'drop-shadow(0 0 24px white) drop-shadow(0 0 48px #FFD60A)'
                  : attackingSide === 'a'
                  ? 'drop-shadow(0 0 18px #FCBF49) drop-shadow(0 8px 16px rgba(0,0,0,0.6))'
                  : activeSide === 'a'
                  ? 'drop-shadow(0 0 16px #FFD60A)'
                  : 'drop-shadow(0 8px 16px rgba(0,0,0,0.6))',
              transition: 'filter 0.2s',
              position: 'relative',
            }}
          >
            <StatusHalo status={fighterA.status} superReady={aSuperReady} />
            <Sprite
              fighter={a}
              side="a"
              state={
                fighterA.hp <= 0
                  ? 'lose'
                  : attackingSide === 'a'
                  ? (inFlightFlash === 'ult' ? 'ult' : 'attack')
                  : 'stance'
              }
              shake={shaking && damagePulses[damagePulses.length-1]?.side === 'a'}
            />
          </div>
          <div
            key={`b-${hitLag?.side === 'b' ? hitLag.id : 'idle'}`}
            className={hitLag?.side === 'b' ? 'hit-lag-b' : ''}
            style={{
              width: 340, height: 440,
              filter:
                attackingSide === 'b' && inFlightFlash === 'ult'
                  ? 'drop-shadow(0 0 32px #F72585) drop-shadow(0 0 64px #7209B7)'
                  : attackingSide === 'b' && inFlightFlash === 'combo'
                  ? 'drop-shadow(0 0 28px #FFD60A) drop-shadow(0 0 56px #F77F00)'
                  : attackingSide === 'b' && inFlightFlash === 'crit'
                  ? 'drop-shadow(0 0 24px white) drop-shadow(0 0 48px #FFD60A)'
                  : attackingSide === 'b'
                  ? 'drop-shadow(0 0 18px #FCBF49) drop-shadow(0 8px 16px rgba(0,0,0,0.6))'
                  : activeSide === 'b'
                  ? 'drop-shadow(0 0 16px #FFD60A)'
                  : 'drop-shadow(0 8px 16px rgba(0,0,0,0.6))',
              transition: 'filter 0.2s',
              position: 'relative',
            }}
          >
            <StatusHalo status={fighterB.status} superReady={bSuperReady} />
            <Sprite
              fighter={b}
              side="b"
              state={
                fighterB.hp <= 0
                  ? 'lose'
                  : attackingSide === 'b'
                  ? (inFlightFlash === 'ult' ? 'ult' : 'attack')
                  : 'stance'
              }
              shake={shaking && damagePulses[damagePulses.length-1]?.side === 'b'}
            />
          </div>
        </div>
      </div>

      {/* Hit sparks at the defender's body */}
      <HitSparks trigger={hitSpark} />

      {/* Damage floats */}
      <DamageFloats pulses={damagePulses} />

      {/* Quote callout (real podcast quote) */}
      <AnimatePresence>
        {lastQuote && (
          <motion.div
            key={lastQuote.q}
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -30, opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute left-1/2 z-20 -translate-x-1/2 px-6 py-3 max-w-2xl text-center"
            style={{
              top: '46%',
              background: 'rgba(15,10,26,0.92)',
              border: '2px solid #FFD60A',
              boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.1), 0 0 24px rgba(255,214,10,0.4)',
            }}
          >
            <div className="font-body text-2xl text-white leading-snug italic">
              "{lastQuote.q}"
            </div>
            <div className="flex items-center justify-center gap-3 mt-2">
              <span className="font-display text-[8px] tracking-widest" style={{ color: '#FFD60A' }}>
                — {lastQuote.name} · {lastQuote.ep} · {lastQuote.t}
              </span>
              {(() => {
                const link = youtubeDeepLink(lastQuote.fighterId, lastQuote.t)
                return link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-display text-[8px] tracking-widest px-2 py-0.5"
                    style={{ border: '1px solid #FFD60A', color: '#FFD60A', textDecoration: 'none' }}
                  >
                    ▶ EPISODE
                  </a>
                ) : null
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Combo banner */}
      <ComboBanner title={comboBanner?.title ?? null} kind={comboBanner?.kind} />

      {/* FIGHT! intro — fires on every fight phase entry */}
      <FightIntro round={round} triggerKey={`${round}-${roundsWon.a + roundsWon.b}`} />

      {/* Live combo streak counter — shows on the attacker's side */}
      {comboStreak && comboStreak.count >= 2 && (
        <div
          key={comboStreak.id}
          className="absolute z-30 pointer-events-none"
          style={{
            top: '34%',
            [comboStreak.side === 'a' ? 'left' : 'right']: '22%',
            animation: 'comboBump 0.4s ease-out',
          }}
        >
          <div
            className="font-display tracking-widest"
            style={{
              color: '#FFD60A',
              fontSize: 48,
              textShadow: '4px 4px 0 black, 0 0 16px #F77F00',
              letterSpacing: '0.1em',
              transform: 'skewX(-6deg)',
              lineHeight: 1,
            }}
          >
            {comboStreak.count}×
          </div>
          <div
            className="font-display"
            style={{
              color: '#FFD60A',
              fontSize: 11,
              letterSpacing: '0.35em',
              textShadow: '2px 2px 0 black',
              marginTop: 2,
            }}
          >
            COMBO
          </div>
        </div>
      )}

      {/* K.O. cinematic overlay */}
      {koCinematic && (
        <KOCinematic
          key={koCinematic.id}
          winner={koCinematic.winner}
          loser={koCinematic.loser}
          winnerId={koCinematic.winner === 'a' ? fighterA?.defId ?? null : fighterB?.defId ?? null}
          loserId={koCinematic.loser === 'a' ? fighterA?.defId ?? null : fighterB?.defId ?? null}
          id={koCinematic.id}
        />
      )}

      {/* MOVE BAR */}
      <ActiveMoves
        side={activeSide}
        fighterA={fighterA}
        fighterB={fighterB}
        onCast={(m) => castMove(m)}
        mode={mode}
        aSuperReady={aSuperReady}
        bSuperReady={bSuperReady}
      />
    </div>
  )
}

function ReadButton({ momentum, disabled }: { momentum: number; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const castRead = useGame((s) => s.castRead)
  const canAfford = momentum >= 1

  function pick(type: 'light' | 'heavy' | 'setup' | 'combo' | 'ultimate') {
    Sfx.menuSelect()
    setOpen(false)
    castRead(type)
  }

  return (
    <div className="flex justify-center mt-2">
      {!open ? (
        <button
          disabled={!canAfford || disabled}
          onClick={() => { Sfx.menuMove(); setOpen(true) }}
          className="px-3 py-1 font-display text-[9px] tracking-widest transition-transform hover:translate-y-[-1px]"
          style={{
            background: 'rgba(0,180,216,0.15)',
            color: '#00B4D8',
            border: '2px solid #00B4D8',
            boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.1)',
            opacity: !canAfford || disabled ? 0.4 : 1,
            cursor: !canAfford || disabled ? 'not-allowed' : 'pointer',
          }}
          title={disabled ? 'Read already active' : !canAfford ? 'Needs 1 momentum' : 'Predict opponent type — halves their next attack + +20 super'}
        >
          ◎ READ OPPONENT [R] · 1 mom
        </button>
      ) : (
        <div className="flex items-center gap-2 px-3 py-1" style={{ background: 'rgba(0,180,216,0.15)', border: '2px solid #00B4D8' }}>
          <span className="font-display text-[8px] tracking-widest text-white/70">PREDICT THEIR NEXT MOVE:</span>
          {(['light','heavy','setup','combo','ultimate'] as const).map((t) => (
            <button
              key={t}
              onClick={() => pick(t)}
              className="px-1.5 py-0.5 font-display text-[8px] tracking-widest"
              style={{
                background: '#0F0A1A',
                color: '#00B4D8',
                border: '1px solid #00B4D8',
                cursor: 'pointer',
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
          <button
            onClick={() => { Sfx.menuMove(); setOpen(false) }}
            className="px-1.5 py-0.5 font-display text-[8px] tracking-widest text-white/50"
            style={{ background: 'transparent', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

function ActiveMoves({
  side,
  fighterA,
  fighterB,
  onCast,
  mode,
  aSuperReady,
  bSuperReady,
}: {
  side: 'a' | 'b'
  fighterA: NonNullable<ReturnType<typeof useGame.getState>['fighterA']>
  fighterB: NonNullable<ReturnType<typeof useGame.getState>['fighterB']>
  onCast: (m: Move) => void
  mode: 'vs' | 'arcade' | 'practice' | 'daily'
  aSuperReady: boolean
  bSuperReady: boolean
}) {
  const activeRt = side === 'a' ? fighterA : fighterB
  const def = useMemo(() => getFighter(activeRt.defId)!, [activeRt.defId])
  const superReady = side === 'a' ? aSuperReady : bSuperReady

  // In single-player modes (arcade / practice / daily) only player A is human.
  const showHumanControls = !(mode !== 'vs' && side === 'b')

  return (
    <div className="absolute left-0 right-0 bottom-0 z-20 px-6 pb-4">
      {showHumanControls ? (
        <>
          <div className="font-display text-[10px] tracking-widest text-center mb-2" style={{ color: side === 'a' ? '#E63946' : '#00B4D8' }}>
            P{side === 'a' ? '1' : '2'} · {def.shortName} · CHOOSE MOVE
            {activeRt.read && (
              <span className="ml-2 px-1.5 py-0.5" style={{ background: '#00B4D8', color: '#0F0A1A', fontSize: '8px' }}>
                READING {activeRt.read.toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex gap-2 flex-wrap justify-center">
            {def.moves.map((m, i) => (
              <MoveCard
                key={m.id}
                move={m}
                canAfford={activeRt.momentum >= m.momentum}
                lastMoveId={activeRt.lastMoveId}
                cooldown={activeRt.cooldowns[m.id] ?? 0}
                hotkey={['Z', 'X', 'C', 'V'][i]}
                onClick={() => onCast(m)}
              />
            ))}
            <MoveCard
              move={def.ult}
              canAfford={activeRt.momentum >= def.ult.momentum}
              isUltimate
              superReady={superReady}
              hasRequiredStatus={
                !def.ult.requiresSelfStatus ||
                activeRt.status.some((s) => s.key === def.ult.requiresSelfStatus)
              }
              lastMoveId={activeRt.lastMoveId}
              cooldown={activeRt.cooldowns[def.ult.id] ?? 0}
              hotkey="B"
              onClick={() => onCast(def.ult)}
            />
          </div>
          <ReadButton momentum={activeRt.momentum} disabled={!!activeRt.read} />
        </>
      ) : (
        <div className="text-center font-display text-base tracking-widest text-white/60 py-6 animate-pulse">
          {def.shortName} IS THINKING...
        </div>
      )}
    </div>
  )
}
